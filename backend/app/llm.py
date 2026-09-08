"""
The only file that talks to Gemini. Two jobs:
  1. extract_facts(chunk_text)      -> structured facts + evidence quotes
  2. classify_relationships(pairs)  -> corroborates / contradicts / contextual / unrelated

(Embeddings for candidate matching are handled locally in embeddings.py, not
here - see that file for why.)

Everything here is wrapped in a retry because the API returns the occasional
transient 503 under load (seen during dev testing) - a real request
shouldn't fail just because Gemini was busy for one second.
"""
import asyncio

import httpx
from google import genai
from google.genai import types
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from google.genai.errors import ServerError, ClientError

from . import config
from .models import ExtractionResult, RelationshipBatchResult

_client = None


def _get_client() -> genai.Client:
    """
    Lazy on purpose: genai.Client() raises immediately if the API key is
    missing, and this used to run at import time - which meant the whole
    server refused to start (not just "uploads fail") if GEMINI_API_KEY
    wasn't set yet. Browsing an already-populated knowledge base shouldn't
    require an API key at all; only actually calling the LLM should.
    """
    global _client
    if _client is None:
        if not config.GEMINI_API_KEY:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Copy backend/.env.example to backend/.env and "
                "paste in a free key from https://aistudio.google.com/apikey to process PDFs."
            )
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


_llm_semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_LLM_CALLS)

# Retries both "Gemini told us it's overloaded" (ServerError, seen a lot in
# practice under load) and plain network hiccups (httpx raises these below
# the SDK's own response-parsing layer, so they aren't ServerErrors but are
# just as transient - a dropped TLS handshake shouldn't fail a whole chunk).
_retryable = retry(
    reraise=True,
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1.5, min=1, max=20),
    retry=retry_if_exception_type((ServerError, httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError)),
)


EXTRACTION_PROMPT = """You are building a fact-checking knowledge base from a document excerpt.

Document title: {doc_title}

Read the text below (it may span several pages, each marked "=== PAGE N ===") and \
extract every MEANINGFUL numerical or semantic fact stated in it. A meaningful fact is \
something a fact-checker or analyst would actually want to verify or compare against \
another document: financial figures, growth/inflation/macro numbers, dates, counts, \
named people and their roles or status, named events with outcomes, and similar \
concrete, checkable statements.

Do NOT extract:
- boilerplate, headers, page numbers, table-of-contents entries, disclaimers
- vague qualitative statements with nothing checkable in them ("the company performed well")
- the same fact twice if it is repeated verbatim in the same excerpt

For `entity`: resolve pronouns and generic references ("the Company", "the Bank", "it", "we") \
to the actual proper name (e.g. "Delhivery", "Reserve Bank of India") whenever it is clear from \
the document title or surrounding text. This matters a lot - the same real-world entity must be \
named the same way every time, or a later step that matches facts across documents by meaning \
will miss the match entirely.

For every fact, you MUST attach the exact page number it came from and a short verbatim \
quote from that page that supports it. If a number or statement is genuinely ambiguous, \
garbled, or missing key context (e.g. a unit is never stated, or a table value doesn't line \
up with its row label), still extract it but set confidence low and fill in `issue` \
explaining what's wrong - don't just silently skip it or silently guess.

TEXT:
{chunk}
"""

RELATIONSHIP_PROMPT = """You are reconciling facts pulled from different documents (or different \
sections of the same document) about overlapping subjects. For each pair below, decide the \
relationship between fact A and fact B:

- "corroborates": they describe the same real-world thing and agree (even if worded, rounded, \
  or formatted differently).
- "contradicts": they describe the same real-world thing (same entity, same time period/scope) \
  but genuinely disagree, with no reasonable explanation visible in the two facts themselves.
- "contextual": they LOOK like they disagree at first glance, but the difference is explained by \
  something visible in the two facts - different time periods, different scope (e.g. consolidated \
  vs standalone, national vs one state, provisional vs revised), a different definition, or \
  different units. If you pick this, your explanation MUST name the specific contextual difference.
- "unrelated": on closer look these are not actually measuring the same thing at all, despite \
  superficial similarity - including cases where they're about the same entity but are simply \
  DIFFERENT METRICS (e.g. a growth-rate percentage vs. an absolute currency figure; a headcount \
  vs. a revenue number). Two facts about the same company are not automatically related just \
  because they're both financial - they have to be candidate measurements of the same underlying \
  quantity for "contextual" or "contradicts" to even apply. This ALSO covers two DIFFERENT, \
  independent entities that happen to report a similarly-named metric - e.g. Company A's network \
  size vs. unrelated Company B's network size are two competitors' own separate statistics, not a \
  disagreement about the same underlying number. Two different companies (or two different \
  countries, two different people, etc.) are never "corroborates," "contradicts," or "contextual" \
  with each other - there is no shared real-world quantity to reconcile in the first place, no \
  matter how similar the attribute names look. Only classify as one of those three when fact A and \
  fact B are plausibly describing the *same* real-world entity's *same* underlying quantity.

Be conservative about "contradicts" - only use it when there is truly no contextual explanation \
available in the given information. Be equally conservative about "contextual": don't use it just \
because two fact from the same entity have different values for different years - that's only \
"contextual" if a reasonable reader would have expected them to match at first glance. If the two \
facts are plainly different metrics, describe different entities, or the time/scope difference is \
so obvious that no one would have expected agreement in the first place, call it "unrelated" \
instead. Ground every explanation in the actual quotes given, and make sure your explanation's own \
reasoning actually matches the relationship label you chose - never write an explanation that \
argues for one answer while the "relationship" field states another.

PAIRS (JSON):
{pairs_json}
"""


@_retryable
async def _generate(prompt: str, schema):
    async with _llm_semaphore:
        resp = await _get_client().aio.models.generate_content(
            model=config.GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
                temperature=0.1,
            ),
        )
    return resp.parsed


async def extract_facts(chunk_text: str, doc_title: str = "") -> list:
    try:
        prompt = EXTRACTION_PROMPT.format(doc_title=doc_title or "(untitled)", chunk=chunk_text)
        result: ExtractionResult = await _generate(prompt, ExtractionResult)
        return result.facts if result else []
    except (ClientError, ServerError, httpx.HTTPError) as e:
        # A malformed/oversized chunk (or a genuinely unsupported page, e.g. a
        # scanned image with no text layer), or a network blip that outlasted
        # every retry, shouldn't take the whole document down - one bad chunk
        # out of many just contributes zero facts instead of crashing the job.
        import logging
        logging.getLogger("factmesh.llm").warning("extract_facts chunk failed permanently: %r", e)
        return []


async def classify_relationships(pairs: list[dict]) -> list:
    """
    pairs: [{"index": 0, "a": {...fact fields...}, "b": {...fact fields...}}, ...]
    Returns list of RelationshipJudgement-like dicts, one per input pair (best effort).
    """
    if not pairs:
        return []
    import json
    pairs_json = json.dumps(pairs, default=str, indent=None)
    try:
        result: RelationshipBatchResult = await _generate(
            RELATIONSHIP_PROMPT.format(pairs_json=pairs_json), RelationshipBatchResult
        )
        return result.judgements if result else []
    except (ClientError, ServerError, httpx.HTTPError) as e:
        import logging
        logging.getLogger("factmesh.llm").warning("classify_relationships batch failed permanently: %r", e)
        return []


