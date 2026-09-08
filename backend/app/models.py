"""
Pydantic shapes used two ways in this project:
  1. As Gemini's `response_schema` - the model is forced to answer in this
     exact shape, so we never have to hand-parse or repair JSON.
  2. As FastAPI request/response models for the HTTP API.
"""
from pydantic import BaseModel, Field


# ------------------------------------------------------------- extraction

class ExtractedFact(BaseModel):
    entity: str = Field(description="The real-world subject the fact is about, e.g. 'Delhivery', 'India CPI inflation', 'Sahil Barua'.")
    attribute: str = Field(description="What is being stated about the entity, e.g. 'total revenue from operations', 'real GDP growth rate', 'role as Managing Director'.")
    value_raw: str = Field(description="The value exactly as stated in the source text, e.g. '25.4%', 'Rs 7,225 crore', 'resigned'.")
    value_numeric: float | None = Field(default=None, description="Best-effort numeric parse of value_raw, in the unit given by `unit`. Null if the fact isn't fundamentally a number (e.g. a status or a name).")
    unit: str | None = Field(default=None, description="Unit for value_numeric, e.g. '%', 'INR crore', 'USD billion', 'basis points'. Null if not applicable.")
    scope: str | None = Field(default=None, description="Any qualifier that changes what this value means: consolidated vs standalone, provisional vs final, a specific segment/state/subsidiary, base year used, etc. Null if unqualified.")
    as_of: str | None = Field(default=None, description="The time period or date the fact refers to, e.g. 'FY2024', 'Q4 FY24', 'as of 31 March 2025', 'CY2023'. Null if not time-bound.")
    page_number: int = Field(description="The page number (from the === PAGE N === markers) the quote below was found on.")
    quote: str = Field(description="A short verbatim excerpt (1-2 sentences max) from the source text that directly supports this fact. Must be actual text from the source, not a paraphrase.")
    confidence: float = Field(description="0 to 1: how confident you are this fact is complete, unambiguous, and correctly parsed.")
    issue: str | None = Field(default=None, description="If confidence is below ~0.6, a short note on what's uncertain (e.g. 'unit not stated', 'value looks truncated', 'unclear which entity this refers to'). Null otherwise.")


class ExtractionResult(BaseModel):
    facts: list[ExtractedFact]


# ------------------------------------------------------------- relationships

class RelationshipJudgement(BaseModel):
    pair_index: int = Field(description="Index of the pair being judged, matching the input list.")
    relationship: str = Field(description="One of: corroborates, contradicts, contextual, unrelated.")
    explanation: str = Field(description="1-3 sentences grounded in the two quotes, explaining the judgement. If 'contextual', explicitly name the contextual difference (time period, scope, definition, unit, revision) that reconciles the apparent conflict.")
    confidence: float = Field(description="0 to 1 confidence in this judgement.")


class RelationshipBatchResult(BaseModel):
    judgements: list[RelationshipJudgement]
