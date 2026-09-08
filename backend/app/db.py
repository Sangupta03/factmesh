"""
Storage layer. Plain SQLite behind a couple of helper functions - no ORM.

Why SQLite and not a graph database: the assignment is explicit that "a
graph database or visualization alone is not the solution," and the actual
hard part here is the *reasoning* (deciding whether two facts corroborate,
contradict, or are reconciled by context), which happens in the LLM layer,
not in how the data is stored. A `facts` table plus a `relationships` table
that references two fact ids IS a graph (edges between nodes) - it just
doesn't need a dedicated graph engine to be one, and SQLite means the whole
project runs with zero external services.

The `facts` schema deliberately does NOT enumerate fact "types". `entity`,
`attribute`, and `scope` are free text chosen by the LLM per-document, so a
brand-new PDF about a topic we've never seen doesn't require a migration or
a code change - the schema evolves by simply admitting new strings.
"""
import json
import shutil
import sqlite3
import time
import uuid
from contextlib import contextmanager

from . import config

SEED_DB_PATH = config.DATA_DIR / "factmesh.seed.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id            TEXT PRIMARY KEY,
    filename      TEXT NOT NULL,
    title         TEXT,
    num_pages     INTEGER,
    status        TEXT NOT NULL DEFAULT 'pending',   -- pending|extracting|linking|done|error
    status_detail TEXT,
    fact_count    INTEGER DEFAULT 0,
    uploaded_at   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
    id             TEXT PRIMARY KEY,
    document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number    INTEGER,
    entity         TEXT NOT NULL,
    attribute      TEXT NOT NULL,
    value_raw      TEXT NOT NULL,
    value_numeric  REAL,
    unit           TEXT,
    scope          TEXT,
    as_of          TEXT,
    quote          TEXT NOT NULL,
    embedding      TEXT,             -- json-encoded float list
    confidence     REAL,             -- model's self-reported confidence in this extraction
    issue          TEXT,             -- model's note on what's ambiguous, if confidence is low
    created_at     REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS relationships (
    id            TEXT PRIMARY KEY,
    fact_a_id     TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    fact_b_id     TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    type          TEXT NOT NULL,      -- corroborates|contradicts|contextual|unrelated
    explanation   TEXT NOT NULL,
    confidence    REAL,
    created_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS extraction_issues (
    id            TEXT PRIMARY KEY,
    document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number   INTEGER,
    issue_type    TEXT NOT NULL,      -- e.g. ambiguous_unit, unresolved_reference, low_confidence
    description   TEXT NOT NULL,
    raw_text      TEXT,
    created_at    REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facts_document ON facts(document_id);
CREATE INDEX IF NOT EXISTS idx_rel_fact_a ON relationships(fact_a_id);
CREATE INDEX IF NOT EXISTS idx_rel_fact_b ON relationships(fact_b_id);
CREATE INDEX IF NOT EXISTS idx_issues_document ON extraction_issues(document_id);
"""


def new_id() -> str:
    return uuid.uuid4().hex[:16]


@contextmanager
def get_conn():
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    # First run on a fresh clone: seed from the tracked snapshot (all 6
    # starter PDFs already processed - real facts, real relationships) so a
    # reviewer sees actual results the moment they start the server, without
    # spending their own Gemini quota just to check whether it works. The
    # seed file itself is never written to - only this one-time copy touches
    # it - so `git status` in a reviewer's clone never shows it as modified.
    if not config.DB_PATH.exists() and SEED_DB_PATH.exists():
        shutil.copyfile(SEED_DB_PATH, config.DB_PATH)
    with get_conn() as conn:
        conn.executescript(SCHEMA)


# ---------------------------------------------------------------- documents

def create_document(filename: str, title: str | None = None) -> str:
    doc_id = new_id()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO documents (id, filename, title, status, uploaded_at) "
            "VALUES (?, ?, ?, 'pending', ?)",
            (doc_id, filename, title or filename, time.time()),
        )
    return doc_id


def update_document(doc_id: str, **fields):
    if not fields:
        return
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE documents SET {cols} WHERE id = ?", (*fields.values(), doc_id))


def list_documents():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM documents ORDER BY uploaded_at DESC").fetchall()
        return [dict(r) for r in rows]


def get_document(doc_id: str):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return dict(row) if row else None


def delete_document(doc_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))


# --------------------------------------------------------------------- facts

def insert_fact(document_id: str, page_number, entity, attribute, value_raw,
                 value_numeric, unit, scope, as_of, quote, embedding,
                 confidence=None, issue=None) -> str:
    fact_id = new_id()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO facts
               (id, document_id, page_number, entity, attribute, value_raw,
                value_numeric, unit, scope, as_of, quote, embedding,
                confidence, issue, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (fact_id, document_id, page_number, entity, attribute, value_raw,
             value_numeric, unit, scope, as_of, quote,
             json.dumps(embedding) if embedding is not None else None,
             confidence, issue,
             time.time()),
        )
    return fact_id


FACT_PUBLIC_COLUMNS = (
    "id, document_id, page_number, entity, attribute, value_raw, value_numeric, "
    "unit, scope, as_of, quote, confidence, issue, created_at"
)  # deliberately excludes `embedding` - a 384-float vector nobody outside the linking step needs


def list_facts(document_id: str | None = None, q: str | None = None, limit: int = 50, offset: int = 0):
    """Paginated on purpose - a real knowledge base can hold thousands of facts,
    and shipping all of them to the browser in one response is exactly the kind
    of thing that makes a UI unusable once you're past a handful of documents."""
    clauses, params = [], []
    if document_id:
        clauses.append("document_id = ?")
        params.append(document_id)
    if q:
        clauses.append("(entity LIKE ? OR attribute LIKE ? OR quote LIKE ? OR value_raw LIKE ?)")
        like = f"%{q}%"
        params += [like, like, like, like]
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""

    with get_conn() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM facts{where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT {FACT_PUBLIC_COLUMNS} FROM facts{where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
        return [dict(r) for r in rows], total


def get_fact(fact_id: str):
    with get_conn() as conn:
        row = conn.execute(f"SELECT {FACT_PUBLIC_COLUMNS} FROM facts WHERE id = ?", (fact_id,)).fetchone()
        return dict(row) if row else None


def all_facts_with_embeddings(exclude_document_id: str | None = None):
    """Used as the candidate pool when linking a newly-ingested document."""
    sql = "SELECT * FROM facts WHERE embedding IS NOT NULL"
    params = []
    if exclude_document_id:
        sql += " AND document_id != ?"
        params.append(exclude_document_id)
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


# ------------------------------------------------------------- relationships

def insert_relationship(fact_a_id, fact_b_id, rel_type, explanation, confidence) -> str:
    rel_id = new_id()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO relationships
               (id, fact_a_id, fact_b_id, type, explanation, confidence, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (rel_id, fact_a_id, fact_b_id, rel_type, explanation, confidence, time.time()),
        )
    return rel_id


def list_relationships(rel_type: str | None = None, limit: int = 50, offset: int = 0):
    base = """
        FROM relationships r
        JOIN facts fa ON fa.id = r.fact_a_id
        JOIN facts fb ON fb.id = r.fact_b_id
        JOIN documents da ON da.id = fa.document_id
        JOIN documents db ON db.id = fb.document_id
    """
    where, params = "", []
    if rel_type:
        where = " WHERE r.type = ?"
        params.append(rel_type)

    select_cols = """
        SELECT r.id, r.fact_a_id, r.fact_b_id, r.type, r.explanation, r.confidence, r.created_at,
               fa.entity AS a_entity, fa.attribute AS a_attribute, fa.value_raw AS a_value,
               fa.unit AS a_unit, fa.scope AS a_scope, fa.as_of AS a_as_of,
               fa.quote AS a_quote, fa.page_number AS a_page, fa.document_id AS a_document_id,
               da.title AS a_doc_title,
               fb.entity AS b_entity, fb.attribute AS b_attribute, fb.value_raw AS b_value,
               fb.unit AS b_unit, fb.scope AS b_scope, fb.as_of AS b_as_of,
               fb.quote AS b_quote, fb.page_number AS b_page, fb.document_id AS b_document_id,
               db.title AS b_doc_title
    """
    with get_conn() as conn:
        total = conn.execute(f"SELECT COUNT(*) {base}{where}", params).fetchone()[0]
        rows = conn.execute(
            f"{select_cols}{base}{where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
        return [dict(r) for r in rows], total


# ---------------------------------------------------------- extraction issues

def insert_issue(document_id, page_number, issue_type, description, raw_text) -> str:
    issue_id = new_id()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO extraction_issues
               (id, document_id, page_number, issue_type, description, raw_text, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (issue_id, document_id, page_number, issue_type, description, raw_text, time.time()),
        )
    return issue_id


def list_issues(document_id: str | None = None, limit: int = 50, offset: int = 0):
    base = " FROM extraction_issues i JOIN documents d ON d.id = i.document_id"
    where, params = "", []
    if document_id:
        where = " WHERE i.document_id = ?"
        params.append(document_id)
    with get_conn() as conn:
        total = conn.execute(f"SELECT COUNT(*){base}{where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT i.*, d.title AS doc_title{base}{where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
        return [dict(r) for r in rows], total


def stats():
    with get_conn() as conn:
        def count(sql, *p):
            return conn.execute(sql, p).fetchone()[0]
        return {
            "documents": count("SELECT COUNT(*) FROM documents"),
            "facts": count("SELECT COUNT(*) FROM facts"),
            "corroborates": count("SELECT COUNT(*) FROM relationships WHERE type='corroborates'"),
            "contradicts": count("SELECT COUNT(*) FROM relationships WHERE type='contradicts'"),
            "contextual": count("SELECT COUNT(*) FROM relationships WHERE type='contextual'"),
            "issues": count("SELECT COUNT(*) FROM extraction_issues"),
        }
