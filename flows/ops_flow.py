"""OpsSession -- conversational session manager for Scenario B.

Architecture:
  - Every user message goes through intent classification first.
  - Intent determines which sub-flow handler processes the message.
  - Cross-flow switching is handled transparently:
      * no pending confirmation -> silent switch
      * pending confirmation    -> ask user before switching
  - All agents: memory=None, no embedding, no Crew overhead.
  - asyncio.to_thread() wraps sync Agent.kickoff() calls.
"""

import logging
from typing import Any

from crewai import Agent
from pydantic import BaseModel, Field

from config import OPENAI_MODEL
from models.ops_models import ChatResponse, ConfirmAction, IntentClassification
from setup.schema_sync import get_schema_catalog

logger = logging.getLogger(__name__)

AVAILABLE_FLOWS = {
    "general_enquiry": "Ask questions about the data platform, tables, actions, concepts",
    "handler_execution": "Execute a registered handler (multi-table business workflow in handlers/ directory, e.g. create_party). Only for handler names listed under 'Handlers'.",
    "data_query": "Query data from platform tables (list, get_by_pk, count, exists)",
    "upsert": "Execute a single-table ACTION on a platform table. This includes when a user mentions a specific action name from a table's actions list (e.g. create_party_draft, activate_party, submit_order) or says they want to insert/update records.",
}


def _schema_summary() -> str:
    """Build a compact schema summary from the cached catalog for prompt injection."""
    catalog = get_schema_catalog()
    if not catalog:
        return "Schema catalog not available."

    lines: list[str] = []
    tables = catalog.get("tables", {})
    for tname, tinfo in tables.items():
        cols = [c.get("name", "") for c in tinfo.get("columns", [])]
        actions = [a.get("name", "") for a in tinfo.get("actions", [])]
        states = tinfo.get("states", [])
        lines.append(
            f"- {tname}: columns=[{', '.join(cols)}] "
            f"states=[{', '.join(states)}] "
            f"actions=[{', '.join(actions)}]"
        )

    handlers = catalog.get("handlers", [])
    if handlers:
        lines.append(f"\nHandlers: {', '.join(handlers)}")

    return "\n".join(lines)


class OpsSessionState(BaseModel):
    messages: list[dict[str, Any]] = Field(default_factory=list)
    current_flow: str = ""
    pending_action: ConfirmAction | None = None
    context: dict[str, Any] = Field(default_factory=dict)


class OpsSession:
    """Manages one user's conversational ops session."""

    def __init__(self) -> None:
        self.state = OpsSessionState()

    def handle_message(self, message: str) -> ChatResponse:
        """Main entry: classify intent, route, return structured response."""
        self.state.messages.append({"role": "user", "content": message})

        if self.state.pending_action:
            return self._handle_pending_confirmation(message)

        intent = self._classify_intent(message)

        if intent.intent == "unclear" or intent.confidence < 0.55:
            return self._ask_user_to_choose(intent.reason)

        if intent.intent == "continue" and self.state.current_flow:
            return self._dispatch(self.state.current_flow, message)

        switch = self._should_switch_flow(intent.intent)
        if switch == "ask_user":
            pending_desc = (
                self.state.pending_action.description
                if self.state.pending_action
                else "an operation in progress"
            )
            resp = ChatResponse(
                current_flow=self.state.current_flow,
                response_type="message",
                message=(
                    f"You have {pending_desc}. "
                    f"Should I proceed with it or switch to "
                    f"{intent.intent.replace('_', ' ')}?"
                ),
            )
            self._record_assistant(resp.message)
            return resp

        if switch == "switch":
            self.state.context = {}
            self.state.pending_action = None

        self.state.current_flow = intent.intent
        if intent.table_name:
            self.state.context["table"] = intent.table_name
        if intent.action_hint:
            self.state.context["action_hint"] = intent.action_hint

        return self._dispatch(intent.intent, message)

    def handle_confirm(self, confirmed: bool) -> ChatResponse:
        """User confirms or cancels a pending action."""
        if not self.state.pending_action:
            return ChatResponse(
                current_flow=self.state.current_flow,
                response_type="message",
                message="Nothing to confirm.",
            )

        if confirmed:
            return self._execute_confirmed(self.state.pending_action)
        else:
            self.state.pending_action = None
            resp = ChatResponse(
                current_flow=self.state.current_flow,
                response_type="message",
                message="Action cancelled. What would you like to do instead?",
            )
            self._record_assistant(resp.message)
            return resp

    # ------------------------------------------------------------------
    # Intent classification
    # ------------------------------------------------------------------

    def _classify_intent(self, message: str) -> IntentClassification:
        schema = _schema_summary()
        flow_descriptions = "\n".join(
            f"- {name}: {desc}" for name, desc in AVAILABLE_FLOWS.items()
        )
        current = self.state.current_flow

        history_ctx = ""
        recent = self.state.messages[-6:]
        if len(recent) > 1:
            history_ctx = "Recent conversation:\n" + "\n".join(
                f"  {m['role']}: {m['content'][:200]}" for m in recent[:-1]
            )

        agent = Agent(
            role="Intent Classifier",
            goal="Classify user messages into the correct operational flow",
            backstory=(
                "You classify user messages for a CRM data platform assistant. "
                "You are fast and precise. If the user is continuing a conversation "
                "in the current flow, return intent='continue'. If the message "
                "doesn't clearly match any flow, return intent='unclear'.\n\n"
                f"Available flows:\n{flow_descriptions}\n\n"
                "ROUTING RULES (important):\n"
                "- If user mentions a name that matches an ACTION in a table's actions list "
                "(e.g. 'create_party_draft', 'activate_party', 'submit_order'), "
                "classify as 'upsert' and set action_hint to that action name.\n"
                "- Only classify as 'handler_execution' when user mentions a name from "
                "the Handlers list (these are multi-table workflows, not single-table actions).\n"
                "- 'insert into X' or 'update X table' without a specific action name → 'upsert'.\n\n"
                f"Current active flow: {current or 'none'}\n\n"
                f"Platform schema:\n{schema}"
            ),
            tools=[],
            llm=OPENAI_MODEL,
            memory=None,
            verbose=False,
        )

        prompt = (
            f"{history_ctx}\n\n"
            f"User message: {message}\n\n"
            "Classify this message. If you can identify a table name, put it "
            "in table_name. If you can identify an action or operation hint, "
            "put it in action_hint."
        )

        result = agent.kickoff(prompt, response_format=IntentClassification)
        if result.pydantic and isinstance(result.pydantic, IntentClassification):
            return result.pydantic

        return IntentClassification(
            intent="unclear", confidence=0.0, reason="Classification failed"
        )

    def _should_switch_flow(self, new_intent: str) -> str:
        if not self.state.current_flow:
            return "switch"
        if new_intent == self.state.current_flow:
            return "continue"
        if self.state.pending_action:
            return "ask_user"
        return "switch"

    # ------------------------------------------------------------------
    # Dispatch to sub-flow handlers
    # ------------------------------------------------------------------

    def _dispatch(self, flow: str, message: str) -> ChatResponse:
        handlers = {
            "general_enquiry": self._run_general_enquiry,
            "data_query": self._run_data_query,
            "handler_execution": self._run_handler_execution,
            "upsert": self._run_upsert,
        }
        handler = handlers.get(flow)
        if not handler:
            return ChatResponse(
                current_flow=flow,
                response_type="error",
                message=f"Unknown flow: {flow}",
            )
        try:
            resp = handler(message)
            resp.current_flow = flow
            self._record_assistant(resp.message)
            return resp
        except Exception as e:
            logger.exception("Sub-flow %s failed", flow)
            return ChatResponse(
                current_flow=flow,
                response_type="error",
                message=f"An error occurred: {e}",
            )

    # ------------------------------------------------------------------
    # Sub-flow runners (delegate to business modules)
    # ------------------------------------------------------------------

    def _run_general_enquiry(self, message: str) -> ChatResponse:
        from flows.business.general_enquiry import handle_enquiry

        return handle_enquiry(message, self.state.messages)

    def _run_data_query(self, message: str) -> ChatResponse:
        from flows.business.data_query import handle_query

        return handle_query(message, self.state.messages, self.state.context)

    def _run_handler_execution(self, message: str) -> ChatResponse:
        from flows.business.handler_execution import handle_execution

        resp = handle_execution(message, self.state.messages, self.state.context)
        if resp.confirm_data:
            self.state.pending_action = resp.confirm_data
        return resp

    def _run_upsert(self, message: str) -> ChatResponse:
        from flows.business.upsert import handle_upsert

        resp = handle_upsert(message, self.state.messages, self.state.context)
        if resp.confirm_data:
            self.state.pending_action = resp.confirm_data
        return resp

    # ------------------------------------------------------------------
    # Execute a confirmed action
    # ------------------------------------------------------------------

    def _execute_confirmed(self, action: ConfirmAction) -> ChatResponse:
        try:
            if action.flow == "handler_execution":
                from flows.business.handler_execution import execute_confirmed

                resp = execute_confirmed(action)
            elif action.flow == "upsert":
                from flows.business.upsert import execute_confirmed

                resp = execute_confirmed(action)
            else:
                resp = ChatResponse(
                    response_type="error",
                    message=f"No executor for flow: {action.flow}",
                )
        except Exception as e:
            logger.exception("Confirmed action execution failed")
            resp = ChatResponse(
                response_type="error",
                message=f"Execution failed: {e}",
            )
        finally:
            self.state.pending_action = None

        resp.current_flow = self.state.current_flow
        self._record_assistant(resp.message)
        return resp

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _ask_user_to_choose(self, reason: str) -> ChatResponse:
        options = [
            {"name": k, "description": v} for k, v in AVAILABLE_FLOWS.items()
        ]
        msg = (
            "I'm not sure what you'd like to do. "
            "Please choose one of the following, or rephrase your request:\n\n"
            + "\n".join(f"- **{o['name']}**: {o['description']}" for o in options)
        )
        resp = ChatResponse(
            current_flow=self.state.current_flow,
            response_type="choose_flow",
            message=msg,
            flow_options=options,
        )
        self._record_assistant(resp.message)
        return resp

    def _handle_pending_confirmation(self, message: str) -> ChatResponse:
        lower = message.strip().lower()
        affirm = lower in (
            "yes", "y", "confirm", "ok", "proceed", "go", "do it",
            "sure", "yeah", "yep", "go ahead",
        )
        deny = lower in (
            "no", "n", "cancel", "stop", "abort", "nevermind", "nope",
        )

        if affirm:
            return self.handle_confirm(True)
        if deny:
            return self.handle_confirm(False)

        intent = self._classify_intent(message)
        if intent.intent != "continue" and intent.intent != self.state.current_flow:
            pending_desc = self.state.pending_action.description
            resp = ChatResponse(
                current_flow=self.state.current_flow,
                response_type="confirm",
                message=(
                    f"You have a pending action: {pending_desc}. "
                    f"Please confirm (yes) or cancel (no) before proceeding."
                ),
                confirm_data=self.state.pending_action,
            )
            self._record_assistant(resp.message)
            return resp

        return self._dispatch(self.state.current_flow, message)

    def _record_assistant(self, content: str) -> None:
        if content:
            self.state.messages.append({"role": "assistant", "content": content})
