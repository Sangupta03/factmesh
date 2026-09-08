"""
All the knobs live here so nothing is hard-coded three layers deep in the
pipeline. Loaded once from backend/.env at import time.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")
# Candidate-matching embeddings are local (see embeddings.py), not Gemini -
# no API key or quota involved there.

DATA_DIR = BACKEND_DIR / "data"
UPLOADS_DIR = BACKEND_DIR / "uploads"
DB_PATH = DATA_DIR / "factmesh.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# How many characters of PDF text we bundle into one extraction call.
#
# This started at 7000 (roughly one page at a time) and had to go up by
# nearly 10x after hitting Gemini's free-tier daily request quota on a
# single 100-page document (90 chunks -> 90 calls -> quota gone before the
# document even finished). Gemini's context window comfortably fits an
# entire chunk this size, so the real constraint is "requests per day," not
# "characters per request" - bigger chunks and fewer, bigger calls is
# strictly better here, not just a quota workaround.
CHUNK_CHAR_BUDGET = 60000

# Candidate generation: how many nearest neighbours (by embedding) we pull
# per new fact before asking the LLM to actually judge the relationship,
# and how similar they need to be to bother asking at all.
CANDIDATE_TOP_K = 6
CANDIDATE_MIN_SIMILARITY = 0.55

# How many LLM calls we let run at once. Gemini free/dev tier rate-limits
# fairly aggressively, and blowing through it just means more retries, so
# this is a modest number rather than "as many as possible."
MAX_CONCURRENT_LLM_CALLS = 4
