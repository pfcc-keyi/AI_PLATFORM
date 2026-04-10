import React, { useState, useRef, useEffect } from "react";
import { configApi } from "../lib/api";

const styles = {
  container: { maxWidth: 960, margin: "0 auto" },
  heading: { fontSize: "1.5rem", fontWeight: 700, margin: 0 },
  textarea: {
    width: "100%", minHeight: 100, padding: "0.75rem", borderRadius: 8,
    border: "1px solid #333", background: "#1a1a1a", color: "#e5e5e5",
    fontSize: "0.9rem", resize: "vertical", fontFamily: "inherit",
  },
  button: {
    padding: "0.55rem 1.4rem", borderRadius: 6, border: "none",
    background: "#2563eb", color: "#fff", fontWeight: 600,
    cursor: "pointer", fontSize: "0.875rem",
  },
  buttonOutline: {
    padding: "0.55rem 1.4rem", borderRadius: 6,
    border: "1px solid #444", background: "transparent", color: "#ccc",
    fontWeight: 500, cursor: "pointer", fontSize: "0.875rem",
  },
  buttonGreen: {
    padding: "0.55rem 1.4rem", borderRadius: 6, border: "none",
    background: "#16a34a", color: "#fff", fontWeight: 600,
    cursor: "pointer", fontSize: "0.875rem",
  },
  buttonRed: {
    padding: "0.55rem 1.4rem", borderRadius: 6, border: "none",
    background: "#dc2626", color: "#fff", fontWeight: 600,
    cursor: "pointer", fontSize: "0.875rem",
  },
  buttonSmall: {
    padding: "0.35rem 0.8rem", borderRadius: 5,
    border: "1px solid #444", background: "transparent", color: "#aaa",
    cursor: "pointer", fontSize: "0.78rem",
  },
  codeBlock: {
    background: "#111", border: "1px solid #333", borderRadius: 8,
    padding: "1rem", fontFamily: "monospace", fontSize: "0.82rem",
    whiteSpace: "pre-wrap", overflowX: "auto", marginTop: "0.75rem",
    color: "#a5d6a7", maxHeight: 500, overflowY: "auto",
  },
  section: {
    marginTop: "1.5rem", background: "#141418", border: "1px solid #262630",
    borderRadius: 10, padding: "1.25rem",
  },
  sectionTitle: {
    fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.75rem", color: "#e5e5e5",
    display: "flex", alignItems: "center", gap: "0.5rem",
  },
  label: { display: "block", marginBottom: "0.4rem", color: "#888", fontSize: "0.82rem" },
  questionBox: {
    background: "#1a1a1a", border: "1px solid #333", borderRadius: 8,
    padding: "0.85rem", marginTop: "0.5rem",
  },
  input: {
    width: "100%", padding: "0.5rem", borderRadius: 6,
    border: "1px solid #333", background: "#111", color: "#e5e5e5",
    fontSize: "0.9rem",
  },
  badge: {
    display: "inline-block", padding: "0.12rem 0.45rem", borderRadius: 4,
    fontSize: "0.72rem", fontWeight: 600, marginLeft: "0.5rem",
  },
  table: {
    width: "100%", borderCollapse: "collapse", marginTop: "0.5rem", fontSize: "0.82rem",
  },
  th: {
    textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid #333",
    color: "#888", fontWeight: 500,
  },
  td: {
    padding: "0.4rem 0.6rem", borderBottom: "1px solid #222", color: "#ccc",
  },
  card: {
    background: "#1a1a1a", border: "1px solid #333", borderRadius: 8,
    padding: "1rem",
  },
  tabRow: {
    display: "flex", gap: 0, borderBottom: "1px solid #333", marginBottom: "0.75rem",
  },
  tab: (active) => ({
    padding: "0.4rem 1rem", fontSize: "0.8rem", fontWeight: 500, cursor: "pointer",
    border: "none", borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
    background: "transparent", color: active ? "#e5e5e5" : "#666",
  }),
  banner: (type) => ({
    padding: "1rem 1.25rem", borderRadius: 8, marginTop: "1rem",
    fontSize: "0.9rem", fontWeight: 500,
    ...(type === "success" ? { background: "#052e16", border: "1px solid #16a34a", color: "#4ade80" } :
        type === "error" ? { background: "#2a0a0a", border: "1px solid #dc2626", color: "#f87171" } :
        { background: "#1a1a2e", border: "1px solid #2563eb", color: "#93c5fd" }),
  }),
  progressBar: {
    height: 3, background: "#1a1a2e", borderRadius: 2, overflow: "hidden", marginTop: "0.75rem",
  },
  progressFill: {
    height: "100%", background: "#3b82f6", borderRadius: 2,
    animation: "pulse 1.5s ease-in-out infinite",
  },
};

function StateDiagram({ transitions, states }) {
  const ordered = ["init", ...(states || []), "deleted"];
  const uniqueStates = [...new Set(ordered)];
  const selfLoops = new Set();
  (transitions || []).forEach((t) => {
    if (t.from === t.to) selfLoops.add(t.from);
  });
  const nodeStyle = (s) => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "0.25rem 0.6rem", borderRadius: 6, fontSize: "0.78rem",
    fontFamily: "monospace", fontWeight: 600, minWidth: 50, textAlign: "center",
    border: s === "init" ? "1.5px dashed #555" : s === "deleted" ? "1.5px solid #ef4444" : "1.5px solid #4b5563",
    color: s === "init" ? "#888" : s === "deleted" ? "#ef4444" : "#e5e5e5",
    background: s === "init" ? "transparent" : s === "deleted" ? "rgba(239,68,68,0.08)" : "#1f2937",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
      {uniqueStates.map((s, i) => (
        <React.Fragment key={s}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={nodeStyle(s)}>{s}</div>
            {selfLoops.has(s) && <span style={{ fontSize: "0.6rem", color: "#6b7280" }}>&#x21bb;</span>}
          </div>
          {i < uniqueStates.length - 1 && (
            <span style={{ color: "#4b5563", fontSize: "1rem", margin: "0 0.1rem" }}>&rarr;</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function ReviewSummary({ summary, defaultView = "table" }) {
  const [view, setView] = useState(defaultView);
  const [copied, setCopied] = useState(false);

  if (!summary) return null;

  const isHandler = summary.table_category === "handler";
  const categoryColor = summary.table_category === "lookup" ? "#f59e0b" : isHandler ? "#8b5cf6" : "#3b82f6";
  const strategyColors = { uuid4: "#8b5cf6", custom: "#f59e0b", sequence: "#06b6d4", sync: "#16a34a", async: "#f59e0b" };
  const strategyColor = strategyColors[summary.pk_strategy] || "#6b7280";
  const pkDesc = summary.pk_generator_description;
  let pkDetail = "";
  if (isHandler && pkDesc) pkDetail = pkDesc;
  else if (summary.pk_strategy === "uuid4") pkDetail = "auto-generated UUID";
  else if (summary.pk_strategy === "sequence") pkDetail = "DB auto-increment";
  else if (summary.pk_strategy === "custom" && pkDesc) pkDetail = pkDesc;
  else if (summary.pk_strategy === "custom") pkDetail = "user-provided value";

  const jsonText = JSON.stringify(summary, null, 2);

  function handleCopy() {
    navigator.clipboard.writeText(jsonText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          {summary.table_name}
          <span style={{ ...styles.badge, background: categoryColor, color: "#fff" }}>
            {summary.table_category}
          </span>
        </h3>
        <div style={styles.tabRow}>
          <button style={styles.tab(view === "table")} onClick={() => setView("table")}>Table View</button>
          <button style={styles.tab(view === "json")} onClick={() => setView("json")}>JSON</button>
        </div>
      </div>

      {view === "json" ? (
        <div style={{ position: "relative", marginTop: "0.5rem" }}>
          <button
            style={{ ...styles.buttonSmall, position: "absolute", top: 8, right: 8, zIndex: 1 }}
            onClick={handleCopy}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <pre style={{
            background: "#111", border: "1px solid #333", borderRadius: 8,
            padding: "1rem", fontFamily: "monospace", fontSize: "0.78rem",
            whiteSpace: "pre-wrap", overflowX: "auto", color: "#93c5fd",
            maxHeight: 500, overflowY: "auto", margin: 0,
          }}>
            {jsonText}
          </pre>
        </div>
      ) : (
        <>
          <div style={{ marginTop: "0.75rem" }}>
            <span style={styles.label}>{isHandler ? "Mode" : "Primary Key"}</span>
            <span style={{ color: "#e5e5e5" }}>
              {isHandler ? "" : summary.pk_field}
              <span style={{ ...styles.badge, background: strategyColor, color: "#fff" }}>
                {summary.pk_strategy}
              </span>
            </span>
            {pkDetail && (
              <span style={{ color: "#888", fontSize: "0.78rem", marginLeft: "0.5rem" }}>— {pkDetail}</span>
            )}
          </div>

          {!isHandler && (
          <div style={{ marginTop: "0.75rem" }}>
            <span style={styles.label}>State Transitions</span>
            <StateDiagram transitions={summary.transitions} states={summary.states} />
          </div>
          )}

          <div style={{ marginTop: "0.75rem" }}>
            <span style={styles.label}>{isHandler ? "Payload Fields" : "Columns"}</span>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{isHandler ? "Field" : "Name"}</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>{isHandler ? "Required" : "Nullable"}</th>
                  <th style={styles.th}>{isHandler ? "Notes" : "Constraints"}</th>
                </tr>
              </thead>
              <tbody>
                {(summary.columns || []).map((c, i) => {
                  const constraints = [];
                  if (c.check) constraints.push(isHandler ? c.check : `check: ${c.check}`);
                  if (c.default_expr) constraints.push(`default: ${c.default_expr}`);
                  if (c.unique) constraints.push("unique");
                  return (
                    <tr key={i}>
                      <td style={styles.td}>{c.name}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace" }}>{c.type}</td>
                      <td style={styles.td}>{isHandler ? (c.nullable ? "optional" : "required") : (c.nullable ? "yes" : "no")}</td>
                      <td style={{ ...styles.td, fontSize: "0.78rem", color: "#999" }}>
                        {constraints.length > 0 ? constraints.join(", ") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "0.75rem" }}>
            <span style={styles.label}>{isHandler ? "Handler Steps" : "Actions"}</span>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{isHandler ? "Step" : "Name"}</th>
                  <th style={styles.th}>{isHandler ? "Operation" : "Type"}</th>
                  <th style={styles.th}>{isHandler ? "Output" : "Transition"}</th>
                </tr>
              </thead>
              <tbody>
                {(summary.actions || []).map((a, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{a.name}</td>
                    <td style={{ ...styles.td, fontFamily: "monospace" }}>{a.type}</td>
                    <td style={{ ...styles.td, fontFamily: "monospace" }}>{a.transition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {summary.fk_definitions?.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <span style={styles.label}>{isHandler ? "Tables Used" : "Foreign Keys"}</span>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>{isHandler ? "Relation" : "Field"}</th>
                    <th style={styles.th}>{isHandler ? "Table" : "References"}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.fk_definitions.map((fk, i) => (
                    <tr key={i}>
                      <td style={styles.td}>{fk.field}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace" }}>
                        {isHandler ? fk.references_table : `${fk.references_table}.${fk.references_field}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isHandler && summary.table_constraints?.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <span style={styles.label}>Table Constraints</span>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>SQL Expression</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.table_constraints.map((expr, i) => (
                    <tr key={i}>
                      <td style={{ ...styles.td, width: 48 }}>{i + 1}</td>
                      <td style={{ ...styles.td, fontFamily: "monospace" }}>{expr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ConfigPanel() {
  const [requirement, setRequirement] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [phase, setPhase] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [reviewSummary, setReviewSummary] = useState(null);
  const [generatedCode, setGeneratedCode] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [answers, setAnswers] = useState({});
  const [deployed, setDeployed] = useState(false);
  const [status, setStatus] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [operationHistory, setOperationHistory] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [editFeedback, setEditFeedback] = useState("");
  const [flowError, setFlowError] = useState("");
  const [deployResult, setDeployResult] = useState(null);

  useEffect(() => {
    if (loading) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => timerRef.current && clearInterval(timerRef.current);
  }, [loading]);

  function applyResponse(res) {
    if (res.session_id) setSessionId(res.session_id);
    if (res.phase !== undefined) setPhase(res.phase || "");
    if (res.analysis !== undefined) setAnalysis(res.analysis);
    if (res.review_summary !== undefined) setReviewSummary(res.review_summary);
    if (res.generated_code !== undefined) setGeneratedCode(res.generated_code);
    if (res.validation_result !== undefined) setValidationResult(res.validation_result);
    if (res.operation_history) setOperationHistory(res.operation_history);
    if (res.deployed !== undefined) setDeployed(res.deployed);
    setFlowError(res.error || "");
  }

  const hasActiveFlow = sessionId && phase && phase !== "";
  const inProgress = phase === "confirm_needed" || phase === "review_needed";

  async function handleAnalyze() {
    setLoading(true);
    setStatus("Analyzing requirement...");
    setFlowError("");
    setDeployResult(null);
    try {
      const sid = inProgress ? "" : (sessionId || "");
      const res = await configApi.analyze(requirement, sid);
      applyResponse(res);
      if (res.analysis?.missing_info) {
        setStatus("Clarification needed");
      } else if (res.phase === "confirm_needed") {
        setStatus("Review the design below");
      } else {
        setStatus("");
      }
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  }

  async function handleAnswer() {
    if (!sessionId) return;
    setLoading(true);
    setStatus("Processing answers...");
    setFlowError("");
    const answerList = Object.entries(answers).map(([question, answer]) => ({ question, answer }));
    try {
      const res = await configApi.answer(sessionId, answerList);
      applyResponse(res);
      setAnswers({});
      if (res.analysis?.missing_info) {
        setStatus("More clarification needed");
      } else if (res.phase === "confirm_needed") {
        setStatus("Review the design below");
      } else {
        setStatus("");
      }
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  }

  async function handleConfirm() {
    if (!sessionId) return;
    setLoading(true);
    const fb = editing ? editFeedback.trim() : "";
    setStatus(fb ? "Revising design and generating code..." : "Generating code...");
    try {
      const res = await configApi.confirm(sessionId, true, fb);
      applyResponse(res);
      setEditing(false);
      setEditFeedback("");
      if (res.phase === "review_needed") {
        setStatus("");
      } else {
        setStatus(res.error || "");
      }
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  }

  async function handleReviseDesign() {
    if (!sessionId || !editFeedback.trim()) return;
    setLoading(true);
    setStatus("Revising design...");
    try {
      const res = await configApi.confirm(sessionId, false, editFeedback.trim());
      applyResponse(res);
      setEditing(false);
      setEditFeedback("");
      setStatus("Design revised");
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  }

  async function handleApprove() {
    if (!sessionId) return;
    setLoading(true);
    setStatus("Deploying...");
    setDeployResult(null);
    try {
      await configApi.review(sessionId, true);
      const res = await configApi.deploy(sessionId);
      if (res.deployed) {
        setDeployed(true);
        setDeployResult({ success: true, message: `${generatedCode?.filename || "File"} deployed and hot-reloaded successfully.` });
        setStatus("");
      } else {
        setDeployed(false);
        const errMsg = res.error || "Deploy failed — check Data Platform logs";
        setDeployResult({ success: false, message: errMsg });
        setStatus("");
      }
    } catch (e) {
      setDeployResult({ success: false, message: `Deploy error: ${e.message}` });
      setStatus("");
    }
    setLoading(false);
  }

  async function handleRequestChanges() {
    if (!sessionId || !feedback.trim()) return;
    setLoading(true);
    setStatus("Regenerating code with feedback...");
    setDeployResult(null);
    try {
      const res = await configApi.review(sessionId, false, feedback);
      applyResponse(res);
      setFeedback("");
      setStatus(res.phase === "review_needed" ? "" : (res.error || ""));
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  }

  async function handleNewOperation() {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await configApi.newOperation(sessionId);
      applyResponse(res);
      setRequirement("");
      setAnswers({});
      setShowCode(false);
      setFeedback("");
      setDeployed(false);
      setPhase("");
      setEditing(false);
      setEditFeedback("");
      setFlowError("");
      setReviewSummary(null);
      setGeneratedCode(null);
      setValidationResult(null);
      setAnalysis(null);
      setDeployResult(null);
      setStatus("");
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  }

  const hasValidationErrors = validationResult && (validationResult.valid === false || validationResult.success === false);
  const showRequirementSection = !inProgress || !hasActiveFlow;

  return (
    <div style={styles.container}>
      <style>{`@keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={styles.heading}>Configuration Panel</h1>
          <p style={{ color: "#666", fontSize: "0.82rem", margin: "0.25rem 0 0" }}>
            Describe what you want to add to the data platform
          </p>
        </div>
        {sessionId && (
          <button style={styles.buttonOutline} onClick={handleNewOperation} disabled={loading}>
            New Operation
          </button>
        )}
      </div>

      {/* ── Loading bar ── */}
      {loading && (
        <div style={styles.progressBar}>
          <div style={styles.progressFill} />
        </div>
      )}

      {/* ── Requirement input ── */}
      <div style={{ opacity: inProgress ? 0.5 : 1, pointerEvents: inProgress && !loading ? "auto" : undefined }}>
        <label style={styles.label}>Requirement</label>
        <textarea
          style={styles.textarea}
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          placeholder='e.g. "Add a new PartyContact table, ContactId is PK, PartyId is FK to party, Name is NOT NULL and > 2 chars"'
          disabled={loading}
        />
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.6rem" }}>
          <button
            style={styles.button}
            onClick={handleAnalyze}
            disabled={loading || !requirement.trim()}
          >
            {loading && !inProgress ? `Analyzing... (${elapsed}s)` : inProgress ? "Start New Analysis" : "Analyze"}
          </button>
          {inProgress && !loading && (
            <span style={{ color: "#666", fontSize: "0.78rem" }}>
              Current flow is active — this will start a new session
            </span>
          )}
        </div>
      </div>

      {/* ── Status line ── */}
      {status && !loading && (
        <div style={{ color: "#888", fontSize: "0.82rem", marginTop: "0.5rem" }}>{status}</div>
      )}
      {loading && status && (
        <div style={{ color: "#93c5fd", fontSize: "0.82rem", marginTop: "0.5rem" }}>
          {status} <span style={{ color: "#555" }}>({elapsed}s)</span>
        </div>
      )}

      {/* ── Flow Error ── */}
      {flowError && (
        <div style={styles.banner("error")}>
          <strong>Error: </strong>{flowError}
        </div>
      )}

      {/* ── Clarification Questions ── */}
      {analysis && analysis.missing_info && analysis.questions?.length > 0 &&
       phase !== "confirm_needed" && phase !== "review_needed" && !flowError && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            <span style={{ color: "#eab308" }}>?</span> Clarification Needed
          </div>
          <p style={{ color: "#999", fontSize: "0.82rem", marginBottom: "0.75rem" }}>
            {analysis.summary}
          </p>
          {analysis.questions.map((q, i) => (
            <div key={i} style={styles.questionBox}>
              <label style={{ ...styles.label, color: "#ccc", fontWeight: 500 }}>{q}</label>
              <input
                style={styles.input}
                value={answers[q] || ""}
                onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
                placeholder="Your answer..."
                disabled={loading}
              />
            </div>
          ))}
          <div style={{ marginTop: "0.75rem" }}>
            <button style={styles.button} onClick={handleAnswer} disabled={loading}>
              {loading ? `Submitting... (${elapsed}s)` : "Submit Answers"}
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: Confirm Design ── */}
      {phase === "confirm_needed" && reviewSummary && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            <span style={{ fontSize: "1.1rem" }}>1</span> Confirm Design
          </div>
          <p style={{ color: "#888", fontSize: "0.82rem", marginBottom: "0.75rem" }}>
            Review the design. Edit if needed, then confirm to generate code.
          </p>

          <ReviewSummary summary={reviewSummary} />

          {/* Edit design area */}
          {editing ? (
            <div style={{ marginTop: "1rem", background: "#111", border: "1px solid #333", borderRadius: 8, padding: "1rem" }}>
              <span style={{ ...styles.label, color: "#ccc" }}>Describe what to change</span>
              <textarea
                style={{ ...styles.textarea, minHeight: 80, marginTop: "0.25rem" }}
                value={editFeedback}
                onChange={(e) => setEditFeedback(e.target.value)}
                placeholder='e.g. "change on_delete to CASCADE", "add a bulk_update action", "remove the department column"'
                disabled={loading}
              />
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
                <button style={styles.button} onClick={handleReviseDesign} disabled={loading || !editFeedback.trim()}>
                  {loading ? "Revising..." : "Apply Changes"}
                </button>
                <button style={styles.buttonOutline} onClick={() => { setEditing(false); setEditFeedback(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
            <button style={styles.buttonGreen} onClick={handleConfirm} disabled={loading}>
              {loading ? `Generating... (${elapsed}s)` : "Confirm & Generate Code"}
            </button>
            {!editing && (
              <button style={styles.buttonOutline} onClick={() => setEditing(true)} disabled={loading}>
                Edit Design
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Phase: Code Review (includes validation errors if any) ── */}
      {phase === "review_needed" && reviewSummary && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            <span style={{ fontSize: "1.1rem" }}>2</span> Code Review
          </div>

          <ReviewSummary summary={reviewSummary} />

          {/* Generated code toggle */}
          {generatedCode && (
            <div style={{ marginTop: "0.75rem" }}>
              <button style={styles.buttonSmall} onClick={() => setShowCode(!showCode)}>
                {showCode ? "Hide Code" : "Show Generated Code"}
              </button>
              {showCode && (
                <div style={{ position: "relative" }}>
                  <button
                    style={{ ...styles.buttonSmall, position: "absolute", top: 16, right: 12, zIndex: 1 }}
                    onClick={() => {
                      navigator.clipboard.writeText(generatedCode.content);
                    }}
                  >
                    Copy
                  </button>
                  <pre style={styles.codeBlock}>{generatedCode.content}</pre>
                </div>
              )}
            </div>
          )}

          {/* ── Validation Errors ── */}
          {hasValidationErrors && (
            <div style={{ marginTop: "1rem", background: "#1a0a0a", border: "1px solid #442222", borderRadius: 8, padding: "1rem" }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#f87171", marginBottom: "0.6rem" }}>
                Validation Failed
              </div>
              {Array.isArray(validationResult.errors) ? (
                validationResult.errors.map((e, i) => (
                  <div key={i} style={{ ...styles.questionBox, borderColor: "#442222", marginTop: i > 0 ? "0.4rem" : 0 }}>
                    <strong style={{ color: "#f87171" }}>[{e.code}]</strong>{" "}
                    <span style={{ color: "#ccc" }}>{e.message}</span>
                    {e.suggestion && <div style={{ color: "#888", marginTop: "0.25rem", fontSize: "0.82rem" }}>{e.suggestion}</div>}
                  </div>
                ))
              ) : (
                <div style={styles.questionBox}>
                  {validationResult.error || validationResult.message || "Validation failed"}
                </div>
              )}
              <p style={{ color: "#888", fontSize: "0.82rem", marginTop: "0.75rem", marginBottom: 0 }}>
                Use "Request Changes" below to describe how to fix these errors, or go back to edit the design.
              </p>
            </div>
          )}

          {/* ── Deploy section (only when validation passed) ── */}
          {!deployed && !deployResult && !hasValidationErrors && validationResult?.valid === true && (
            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #262630" }}>
              <button style={styles.buttonGreen} onClick={handleApprove} disabled={loading}>
                {loading ? `Deploying... (${elapsed}s)` : "Approve & Deploy"}
              </button>
            </div>
          )}

          {/* ── Deploy result banner ── */}
          {deployResult && (
            <div style={styles.banner(deployResult.success ? "success" : "error")}>
              <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                {deployResult.success ? "Deploy Successful" : "Deploy Failed"}
              </div>
              <div style={{ fontSize: "0.85rem", opacity: 0.9, whiteSpace: "pre-wrap" }}>
                {deployResult.message}
              </div>
              {deployResult.success && (
                <div style={{ marginTop: "0.75rem" }}>
                  <button style={styles.buttonOutline} onClick={handleNewOperation} disabled={loading}>
                    Start New Operation
                  </button>
                </div>
              )}
              {!deployResult.success && (
                <div style={{ marginTop: "0.75rem" }}>
                  <button style={styles.buttonOutline} onClick={handleApprove} disabled={loading}>
                    Retry Deploy
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Request Changes section ── */}
          {!deployed && (
            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #262630" }}>
              <span style={{ ...styles.label, marginBottom: "0.5rem" }}>
                {hasValidationErrors ? "Fix Validation Errors" : "Request Changes to Generated Code"}
              </span>
              <textarea
                style={{ ...styles.textarea, minHeight: 70 }}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={hasValidationErrors
                  ? 'Describe how to fix the errors, e.g. "rename table to party_contact_v2" or "remove the duplicate state column"'
                  : 'e.g. "use secrets instead of random for PK generation", "remove the unique constraint on contact_id"'}
                disabled={loading}
              />
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                <button
                  style={styles.button}
                  onClick={handleRequestChanges}
                  disabled={loading || !feedback.trim()}
                >
                  {loading ? `Regenerating... (${elapsed}s)` : "Submit Code Feedback"}
                </button>
                <button
                  style={styles.buttonOutline}
                  onClick={() => { setPhase("confirm_needed"); setValidationResult(null); }}
                  disabled={loading}
                >
                  Back to Design
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Operation History ── */}
      {operationHistory.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <span style={styles.label}>Completed Operations</span>
          {operationHistory.map((op, i) => (
            <div key={i} style={{ color: "#4ade80", fontSize: "0.82rem", marginTop: "0.15rem" }}>
              {op.sub_flow}: {op.filename} ({op.file_type})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
