"""
Local (no-API) embeddings, used only for the "find candidate facts worth
comparing" prefilter in pipeline.py.

This started out calling Gemini's embed_content, which worked fine until it
turned out the free tier caps that endpoint at 100 requests/day - and every
single fact in the knowledge base needs an embedding, so that quota was gone
after ~1.5 documents. Rather than ration something this cheap, this step
just doesn't need a hosted LLM at all: candidate matching is a similarity
prefilter, not a reasoning task, and a small local sentence-transformer
model (BAAI/bge-small-en-v1.5, running on CPU via ONNX through `fastembed`)
does that job well, for free, with no network round trip and no daily cap.
Gemini is reserved for the two steps that actually need LLM judgment:
extracting facts and deciding how two facts relate.

The model is ~130MB and downloads once (cached locally by fastembed/
huggingface_hub) on first use.
"""
import asyncio

from fastembed import TextEmbedding

_model = None
_model_lock = asyncio.Lock()

EMBED_DIM = 384  # BAAI/bge-small-en-v1.5's output size


def _load_model() -> TextEmbedding:
    global _model
    if _model is None:
        _model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
    return _model


def _embed_sync(texts: list[str]) -> list[list[float]]:
    model = _load_model()
    return [vec.tolist() for vec in model.embed(texts)]


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Runs on a worker thread - fastembed's ONNX inference is CPU-bound
    and synchronous, so this keeps it off the asyncio event loop."""
    if not texts:
        return []
    async with _model_lock:  # first call downloads+loads the model; avoid doing that twice concurrently
        return await asyncio.to_thread(_embed_sync, texts)
