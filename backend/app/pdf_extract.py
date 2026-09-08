"""
Turns a PDF into (page_number, text) pairs, then groups consecutive pages
into chunks that fit a sane character budget for the LLM.

Keeping page numbers attached all the way through is what lets every fact
we extract point back at an exact page - that's the "evidence" half of the
assignment's "link every fact to evidence in its source document."
"""
import pdfplumber

from . import config


def extract_pages(pdf_path: str) -> list[dict]:
    """Returns [{"page_number": 1, "text": "..."}, ...], 1-indexed."""
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            # Tables often carry the sharpest numeric facts (financial
            # statements, macro data tables) but extract_text() flattens
            # them badly. extract_table gives us a cleaner grid we render
            # back to text ourselves, appended after the prose.
            table_text = ""
            try:
                tables = page.extract_tables()
                for t in tables:
                    rows = [" | ".join(c or "" for c in row) for row in t if row]
                    table_text += "\n[TABLE]\n" + "\n".join(rows) + "\n"
            except Exception:
                pass  # a malformed table shouldn't kill extraction for the whole page
            pages.append({"page_number": i, "text": (text + table_text).strip()})
    return pages


def chunk_pages(pages: list[dict], char_budget: int = None) -> list[dict]:
    """
    Groups consecutive pages into chunks under `char_budget` characters,
    each chunk tagged with the page range it covers. Every page's text is
    wrapped in a `=== PAGE N ===` marker so the model can cite the exact
    page a fact came from, even though several pages travel in one prompt.
    """
    char_budget = char_budget or config.CHUNK_CHAR_BUDGET
    chunks = []
    current_pages, current_len = [], 0

    def flush():
        if not current_pages:
            return
        text = "\n\n".join(f"=== PAGE {p['page_number']} ===\n{p['text']}" for p in current_pages)
        chunks.append({
            "page_start": current_pages[0]["page_number"],
            "page_end": current_pages[-1]["page_number"],
            "text": text,
        })

    for page in pages:
        page_len = len(page["text"])
        if current_pages and current_len + page_len > char_budget:
            flush()
            current_pages, current_len = [], 0
        current_pages.append(page)
        current_len += page_len

    flush()
    return chunks
