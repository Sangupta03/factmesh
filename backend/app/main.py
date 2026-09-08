"""
FastAPI app: a handful of JSON endpoints plus the static frontend.
Upload kicks off extraction+linking as a background task so the request
returns immediately and the UI can poll /api/documents for progress -
useful for the "large PDFs" case where processing can take a minute or two.
"""
from pathlib import Path
from typing import Any

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db, config
from .pipeline import ingest_document

app = FastAPI(title="FactMesh")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


class NoCacheStaticFiles(StaticFiles):
    """
    Plain StaticFiles sends only ETag/Last-Modified, no Cache-Control - which
    means browsers apply their own heuristic freshness window and can serve
    a stale app.jsx on a plain refresh without even asking the server. That
    made "just refresh the browser" an unreliable instruction while this
    frontend was under active iteration. `no-cache` still allows a cheap
    304 via revalidation - it just stops the browser from skipping the
    request entirely.
    """

    def file_response(self, *args: Any, **kwargs: Any):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


@app.on_event("startup")
def _startup():
    db.init_db()


@app.post("/api/documents")
async def upload_document(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported.")

    doc_id = db.create_document(filename=file.filename, title=file.filename.rsplit(".", 1)[0])
    dest = config.UPLOADS_DIR / f"{doc_id}.pdf"
    contents = await file.read()
    dest.write_bytes(contents)

    background_tasks.add_task(ingest_document, doc_id, str(dest))
    return {"id": doc_id, "status": "pending"}


@app.get("/api/documents")
def get_documents():
    return db.list_documents()


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str):
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc


@app.delete("/api/documents/{doc_id}")
def remove_document(doc_id: str):
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    db.delete_document(doc_id)
    pdf_path = config.UPLOADS_DIR / f"{doc_id}.pdf"
    if pdf_path.exists():
        pdf_path.unlink()
    return {"ok": True}


@app.get("/api/facts")
def get_facts(document_id: str | None = None, q: str | None = None, limit: int = 50, offset: int = 0):
    items, total = db.list_facts(document_id=document_id, q=q, limit=min(limit, 200), offset=offset)
    return {"items": items, "total": total}


@app.get("/api/facts/{fact_id}")
def get_fact(fact_id: str):
    fact = db.get_fact(fact_id)
    if not fact:
        raise HTTPException(404, "Fact not found")
    return fact


@app.get("/api/relationships")
def get_relationships(type: str | None = None, limit: int = 50, offset: int = 0):
    items, total = db.list_relationships(rel_type=type, limit=min(limit, 200), offset=offset)
    return {"items": items, "total": total}


@app.get("/api/issues")
def get_issues(document_id: str | None = None, limit: int = 50, offset: int = 0):
    items, total = db.list_issues(document_id=document_id, limit=min(limit, 200), offset=offset)
    return {"items": items, "total": total}


@app.get("/api/stats")
def get_stats():
    return db.stats()


# Frontend last, so it doesn't swallow any /api/* route above.
app.mount("/", NoCacheStaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
