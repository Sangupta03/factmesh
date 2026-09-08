"""
Orchestrates one document's journey from "uploaded PDF" to "facts linked
into the existing knowledge base." This is where the four things the
assignment asks for actually come together:

  extract      -> pdf_extract.py + llm.extract_facts
  ground       -> every fact carries page_number + quote (db.facts)
  compare      -> embedding nearest-neighbours narrow down candidates
  reconcile    -> llm.classify_relationships makes the corroborate /
                  contradict / contextual call, grounded in both quotes

IMPORTANT for incrementality: when document N+1 comes in, we only embed
and classify N+1's facts against what's already stored. We never recompute
relationships between documents that were already linked - that's what
lets this scale to "many PDFs" without redoing prior work each time.
"""
import asyncio
import logging

import numpy as np

from . import db, llm, embeddings, config
from .pdf_extract import extract_pages, chunk_pages

logger = logging.getLogger("factmesh.pipeline")

RELATIONSHIP_BATCH_SIZE = 20  # fewer, bigger calls - same quota reasoning as CHUNK_CHAR_BUDGET
LOW_CONFIDENCE_THRESHOLD = 0.6


def _fact_embed_text(entity: str, attribute: str, scope: str | None, as_of: str | None) -> str:
    parts = [entity, attribute]
    if scope:
        parts.append(scope)
    if as_of:
        parts.append(as_of)
    return " — ".join(p for p in parts if p)


def _cosine_sim_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a_norm = a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-9)
    b_norm = b / (np.linalg.norm(b, axis=1, keepdims=True) + 1e-9)
    return a_norm @ b_norm.T


def _fact_public_view(f: dict, doc_title: str) -> dict:
    """Trimmed-down view of a fact for the relationship-judging prompt -
    no ids/embeddings, just what a human would need to judge it."""
    return {
        "entity": f["entity"], "attribute": f["attribute"], "value": f["value_raw"],
        "unit": f["unit"], "scope": f["scope"], "as_of": f["as_of"],
        "quote": f["quote"], "document": doc_title, "page": f["page_number"],
    }


async def ingest_document(doc_id: str, pdf_path: str):
    try:
        doc_row = db.get_document(doc_id)
        doc_title = doc_row["title"] if doc_row else ""

        db.update_document(doc_id, status="extracting", status_detail="Reading PDF pages")
        pages = extract_pages(pdf_path)
        db.update_document(doc_id, num_pages=len(pages))

        chunks = chunk_pages(pages)
        db.update_document(doc_id, status_detail=f"Extracting facts from {len(chunks)} chunk(s) across {len(pages)} pages")

        chunk_results = await asyncio.gather(*[llm.extract_facts(c["text"], doc_title) for c in chunks])
        extracted = [f for chunk_facts in chunk_results for f in chunk_facts]

        if not extracted:
            db.update_document(doc_id, status="done", status_detail="No extractable facts found", fact_count=0)
            return

        db.update_document(doc_id, status="embedding", status_detail=f"Embedding {len(extracted)} facts")
        embed_inputs = [_fact_embed_text(f.entity, f.attribute, f.scope, f.as_of) for f in extracted]
        fact_vectors = await embeddings.embed_texts(embed_inputs)

        new_facts_meta = []  # [{id, embedding, ...fields}]
        for f, emb in zip(extracted, fact_vectors):
            fid = db.insert_fact(
                document_id=doc_id, page_number=f.page_number, entity=f.entity,
                attribute=f.attribute, value_raw=f.value_raw, value_numeric=f.value_numeric,
                unit=f.unit, scope=f.scope, as_of=f.as_of, quote=f.quote,
                embedding=emb, confidence=f.confidence, issue=f.issue,
            )
            if f.confidence is not None and f.confidence < LOW_CONFIDENCE_THRESHOLD:
                db.insert_issue(
                    doc_id, f.page_number, "low_confidence_extraction",
                    f.issue or "Model flagged this extraction as uncertain.", f.quote,
                )
            new_facts_meta.append({
                "id": fid, "embedding": emb, "entity": f.entity, "attribute": f.attribute,
                "value_raw": f.value_raw, "unit": f.unit, "scope": f.scope, "as_of": f.as_of,
                "quote": f.quote, "page_number": f.page_number,
            })

        db.update_document(doc_id, fact_count=len(new_facts_meta))

        db.update_document(doc_id, status="linking", status_detail="Comparing against existing knowledge base")
        existing = db.all_facts_with_embeddings(exclude_document_id=doc_id)
        rel_count = 0
        if existing:
            rel_count = await link_new_facts(doc_id, new_facts_meta, existing)

        db.update_document(
            doc_id, status="done",
            status_detail=f"{len(new_facts_meta)} facts extracted, {rel_count} relationships found",
        )
    except Exception as e:
        logger.exception("ingest_document failed for %s", doc_id)
        detail = str(e) or repr(e) or type(e).__name__
        db.update_document(doc_id, status="error", status_detail=detail[:500])


async def link_new_facts(new_doc_id: str, new_facts: list[dict], existing_facts: list[dict]) -> int:
    """Finds embedding-nearest candidates for each new fact among existing
    facts, then asks the LLM to judge each candidate pair. Returns the
    number of relationships actually stored."""
    import json as _json

    new_vecs = np.array([f["embedding"] for f in new_facts])
    existing_vecs = np.array([_json.loads(f["embedding"]) for f in existing_facts])
    sims = _cosine_sim_matrix(new_vecs, existing_vecs)

    doc_titles = {d["id"]: d["title"] for d in db.list_documents()}
    new_doc_title = doc_titles.get(new_doc_id, "this document")

    pairs = []  # each: {"new": fact_meta, "existing": fact_row, "sim": float}
    for i, new_fact in enumerate(new_facts):
        row = sims[i]
        top_idx = np.argsort(-row)[: config.CANDIDATE_TOP_K]
        for j in top_idx:
            sim = float(row[j])
            if sim >= config.CANDIDATE_MIN_SIMILARITY:
                pairs.append({"new": new_fact, "existing": existing_facts[int(j)], "sim": sim})

    if not pairs:
        return 0

    batches = [pairs[i:i + RELATIONSHIP_BATCH_SIZE] for i in range(0, len(pairs), RELATIONSHIP_BATCH_SIZE)]

    async def judge_batch(batch):
        payload = []
        for local_idx, p in enumerate(batch):
            payload.append({
                "pair_index": local_idx,
                "a": _fact_public_view(p["new"], new_doc_title),
                "b": _fact_public_view(p["existing"], doc_titles.get(p["existing"]["document_id"], "another document")),
            })
        judgements = await llm.classify_relationships(payload)
        return batch, judgements

    results = await asyncio.gather(*[judge_batch(b) for b in batches])

    stored = 0
    seen_pairs = set()  # (fact_a_id, fact_b_id) unordered, to avoid double-storing if two candidates collapse
    for batch, judgements in results:
        by_index = {j.pair_index: j for j in judgements}
        for local_idx, p in enumerate(batch):
            j = by_index.get(local_idx)
            if j is None or j.relationship not in ("corroborates", "contradicts", "contextual"):
                continue  # "unrelated" (or a missing judgement) is a filtered-out false positive, not stored
            a_id, b_id = p["new"]["id"], p["existing"]["id"]
            key = tuple(sorted((a_id, b_id)))
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            db.insert_relationship(a_id, b_id, j.relationship, j.explanation, j.confidence)
            stored += 1

    return stored
