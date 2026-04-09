"""Pydantic models for the ops conversational flow.

IntentClassification -- router output (LLM structured response)
ChatResponse         -- standardised backend -> frontend envelope
ConfirmAction        -- action awaiting user confirmation
"""

from typing import Any, Optional

from pydantic import BaseModel, Field


class IntentClassification(BaseModel):
    intent: str = Field(
        description=(
            "One of: general_enquiry, party_onboarding, data_query, upsert, "
            "continue, unclear"
        )
    )
    confidence: float = Field(
        ge=0.0, le=1.0,
        description="Confidence in the classification (0-1)",
    )
    table_name: str = Field(
        default="",
        description="Table name extracted from the message, if any",
    )
    action_hint: str = Field(
        default="",
        description="Action or operation hint extracted from the message, if any",
    )
    reason: str = Field(default="", description="Brief explanation")


class ConfirmAction(BaseModel):
    flow: str = Field(description="Sub-flow that generated this action")
    action_type: str = Field(
        description="'handler' or 'action' -- what will be executed"
    )
    description: str = Field(
        description="Human-readable summary of what will happen"
    )
    details: dict[str, Any] = Field(
        default_factory=dict,
        description="Structured payload/parameters for the action",
    )


class ChatResponse(BaseModel):
    session_id: str = ""
    current_flow: str = ""
    response_type: str = Field(
        default="message",
        description=(
            "One of: message, table, confirm, choose_flow, result, error"
        ),
    )
    message: str = ""
    table_data: Optional[dict[str, Any]] = Field(
        default=None,
        description="For data_query results: {columns: [...], rows: [...]}",
    )
    confirm_data: Optional[ConfirmAction] = Field(
        default=None,
        description="Action awaiting user confirmation",
    )
    flow_options: Optional[list[dict[str, str]]] = Field(
        default=None,
        description="Available flows when intent is unclear",
    )
