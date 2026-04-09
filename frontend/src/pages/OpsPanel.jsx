import React, { useState, useRef, useEffect } from "react";
import { opsApi } from "../lib/api";

const s = {
  wrap: {
    maxWidth: 840,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    height: "calc(100vh - 130px)",
    minHeight: 0,
  },
  header: {
    fontSize: "1.25rem",
    fontWeight: 700,
    paddingBottom: "0.5rem",
    flexShrink: 0,
  },
  flowBadge: {
    display: "inline-block",
    fontSize: "0.7rem",
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 4,
    background: "#1e3a5f",
    color: "#60a5fa",
    marginLeft: 8,
    verticalAlign: "middle",
  },
  messages: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.75rem",
    scrollbarWidth: "thin",
    scrollbarColor: "transparent transparent",
  },
  userMsg: {
    alignSelf: "flex-end",
    background: "#2563eb",
    color: "#fff",
    padding: "0.6rem 1rem",
    borderRadius: "14px 14px 4px 14px",
    maxWidth: "75%",
    fontSize: "0.9rem",
    lineHeight: 1.5,
    wordBreak: "break-word",
  },
  assistantMsg: {
    alignSelf: "flex-start",
    background: "#1e1e1e",
    border: "1px solid #333",
    color: "#e5e5e5",
    padding: "0.75rem 1rem",
    borderRadius: "14px 14px 14px 4px",
    maxWidth: "85%",
    fontSize: "0.9rem",
    lineHeight: 1.6,
    wordBreak: "break-word",
  },
  inputRow: {
    display: "flex",
    gap: "0.5rem",
    flexShrink: 0,
    padding: "0.6rem 0 0.25rem",
    borderTop: "1px solid #222",
  },
  input: {
    flex: 1,
    padding: "0.7rem 1rem",
    borderRadius: 8,
    border: "1px solid #333",
    background: "#1a1a1a",
    color: "#e5e5e5",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    outline: "none",
  },
  sendBtn: {
    padding: "0.7rem 1.25rem",
    borderRadius: 8,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.9rem",
    whiteSpace: "nowrap",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.82rem",
    marginTop: "0.5rem",
  },
  th: {
    textAlign: "left",
    padding: "6px 10px",
    borderBottom: "2px solid #444",
    color: "#93c5fd",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "5px 10px",
    borderBottom: "1px solid #2a2a2a",
    color: "#ccc",
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  confirmCard: {
    background: "#1a1a2e",
    border: "1px solid #334",
    borderRadius: 10,
    padding: "1rem",
    marginTop: "0.5rem",
  },
  confirmBtns: {
    display: "flex",
    gap: "0.5rem",
    marginTop: "0.75rem",
  },
  confirmBtn: {
    padding: "0.5rem 1.25rem",
    borderRadius: 6,
    border: "none",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.85rem",
  },
  flowCard: {
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 8,
    padding: "0.75rem 1rem",
    cursor: "pointer",
    transition: "border-color 0.15s",
    marginBottom: "0.4rem",
  },
  resultCard: {
    background: "#0a1a0a",
    border: "1px solid #2a4a2a",
    borderRadius: 8,
    padding: "0.75rem 1rem",
    marginTop: "0.5rem",
    fontSize: "0.85rem",
    whiteSpace: "pre-wrap",
  },
  errorCard: {
    background: "#1a0a0a",
    border: "1px solid #4a2a2a",
    borderRadius: 8,
    padding: "0.75rem 1rem",
    marginTop: "0.5rem",
    color: "#f87171",
    fontSize: "0.85rem",
  },
  kvGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    marginTop: 4,
  },
};

function isObjectLike(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function formatScalar(v) {
  if (v === null || v === undefined) return "\u2014";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatTableCell(v) {
  if (v === null || v === undefined) return "\u2014";
  if (isObjectLike(v) || Array.isArray(v)) {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/* ------------------------------------------------------------------ */
/*  Sub-renderers                                                      */
/* ------------------------------------------------------------------ */

function SingleTable({ columns, rows, name }) {
  return (
    <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
      {name && (
        <div style={{ color: "#93c5fd", fontWeight: 600, fontSize: "0.8rem", marginBottom: 4 }}>
          {name}
        </div>
      )}
      <table style={s.table}>
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i} style={s.th}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const shown = formatTableCell(cell);
                return (
                <td key={ci} style={s.td} title={shown}>
                  {shown}
                </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableRenderer({ data }) {
  if (!data) return null;
  if (data.tables) {
    return data.tables.map((t, i) => (
      <SingleTable key={i} columns={t.columns} rows={t.rows} name={t.name} />
    ));
  }
  if (data.columns && data.rows) {
    return <SingleTable columns={data.columns} rows={data.rows} />;
  }
  return null;
}

function ConfirmRenderer({ data, onConfirm, loading, executionResult }) {
  if (!data) return null;
  const d = data.details || {};
  const isDone = !!executionResult;
  const [showResult, setShowResult] = useState(true);

  let resultParsed = null;
  let resultIsSuccess = false;
  let resultText = "";
  if (executionResult) {
    resultParsed = parseResultJson(executionResult.message);
    resultIsSuccess = resultParsed?.success === true || executionResult.message?.toLowerCase().includes("successfully");
    resultText = executionResult.message?.replace(/```(?:json)?\s*[\s\S]*?```/g, "").trim() || "";
  }

  return (
    <div style={s.confirmCard}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ color: isDone ? (resultIsSuccess ? "#4ade80" : "#fbbf24") : "#93c5fd", fontWeight: 600, fontSize: "0.9rem" }}>
          {isDone ? (resultIsSuccess ? "Executed" : "Failed") : "Confirm Action"}
        </span>
        {isDone && (
          <span style={{
            fontSize: "0.7rem", padding: "1px 6px", borderRadius: 3,
            background: resultIsSuccess ? "#16a34a22" : "#f8717122",
            color: resultIsSuccess ? "#4ade80" : "#f87171",
          }}>
            {resultIsSuccess ? "success" : "error"}
          </span>
        )}
      </div>
      <div style={s.kvGrid}>
        {d.table_name && <KVRow label="Table" value={d.table_name} />}
        {d.action_name && <KVRow label="Action" value={d.action_name} />}
        {d.handler_name && <KVRow label="Handler" value={d.handler_name} />}
        {d.pk && <KVRow label="PK" value={d.pk} />}
        {d.payload?.pk && !d.pk && <KVRow label="PK" value={d.payload.pk} />}
        {d.payload && <ValueNode label="payload" value={d.payload} defaultOpen />}
        {Object.entries(d)
          .filter(([k]) => !["table_name", "action_name", "handler_name", "pk", "payload"].includes(k))
          .map(([k, v]) => (
            <ValueNode key={k} label={k} value={v} />
          ))}
      </div>

      {!isDone && (
        <div style={s.confirmBtns}>
          <button
            style={{ ...s.confirmBtn, background: "#16a34a", color: "#fff" }}
            onClick={() => onConfirm(true)}
            disabled={loading}
          >
            {loading ? "..." : "Confirm"}
          </button>
          <button
            style={{ ...s.confirmBtn, background: "#333", color: "#ccc" }}
            onClick={() => onConfirm(false)}
            disabled={loading}
          >
            Cancel
          </button>
        </div>
      )}

      {isDone && (
        <div style={{ marginTop: 8, borderTop: "1px solid #2a3a4a", paddingTop: 6 }}>
          <div
            onClick={() => setShowResult(!showResult)}
            style={{ cursor: "pointer", color: "#93c5fd", fontSize: "0.8rem", fontWeight: 600, userSelect: "none" }}
          >
            {showResult ? "\u25BE" : "\u25B8"} Execution Result
          </div>
          {showResult && (
            <div style={{ marginTop: 4 }}>
              {resultText && (
                <div style={{ color: resultIsSuccess ? "#4ade80" : "#fbbf24", fontSize: "0.82rem", marginBottom: 4 }}>
                  {resultText}
                </div>
              )}
              {resultParsed && <ResultDetails parsed={resultParsed} />}
              {!resultParsed && executionResult.message && (
                <pre style={{ color: "#999", fontSize: "0.78rem", whiteSpace: "pre-wrap", margin: 0 }}>
                  {executionResult.message}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KVRow({ label, value, isCode }) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: "0.82rem", lineHeight: 1.5 }}>
      <span style={{ color: "#888", minWidth: 70, flexShrink: 0 }}>{label}</span>
      {isCode ? (
        <code style={{ color: "#a5d6ff", background: "#1a2332", padding: "1px 6px", borderRadius: 3, fontSize: "0.8rem", wordBreak: "break-all" }}>
          {value}
        </code>
      ) : (
        <span style={{ color: "#e5e5e5", wordBreak: "break-all" }}>{value}</span>
      )}
    </div>
  );
}

function ValueNode({ label, value, defaultOpen = false }) {
  if (Array.isArray(value)) {
    return <ArrayBlock label={label} items={value} defaultOpen={defaultOpen} />;
  }
  if (isObjectLike(value)) {
    return <ObjectBlock label={label} obj={value} defaultOpen={defaultOpen} />;
  }
  return <KVRow label={label} value={formatScalar(value)} />;
}

function ObjectBlock({ label, obj, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!isObjectLike(obj)) return null;
  const entries = Object.entries(obj);
  return (
    <div style={{ marginTop: 4 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ cursor: "pointer", color: "#93c5fd", fontSize: "0.82rem", fontWeight: 600, userSelect: "none" }}
      >
        {open ? "\u25BE" : "\u25B8"} {label}
        <span style={{ color: "#666", fontWeight: 400, marginLeft: 6 }}>
          ({entries.length} field{entries.length !== 1 ? "s" : ""})
        </span>
      </div>
      {open && (
        <div style={{ paddingLeft: 14, borderLeft: "2px solid #2a3a4a", marginLeft: 4, marginTop: 2 }}>
          {entries.map(([k, v]) => (
            <ValueNode key={k} label={k} value={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArrayBlock({ label, items, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 4 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ cursor: "pointer", color: "#93c5fd", fontSize: "0.82rem", fontWeight: 600, userSelect: "none" }}
      >
        {open ? "\u25BE" : "\u25B8"} {label}
        <span style={{ color: "#666", fontWeight: 400, marginLeft: 6 }}>
          ({items.length} item{items.length !== 1 ? "s" : ""})
        </span>
      </div>
      {open && (
        <div style={{ paddingLeft: 14, borderLeft: "2px solid #2a3a4a", marginLeft: 4, marginTop: 2 }}>
          {items.map((item, idx) => (
            <ValueNode key={`${label}-${idx}`} label={`[${idx}]`} value={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function parseResultJson(message) {
  if (!message) return null;
  const jsonMatch = message.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!jsonMatch) return null;
  try { return JSON.parse(jsonMatch[1].trim()); } catch { return null; }
}

function ResultCard({ message }) {
  const parsed = parseResultJson(message);
  const textBefore = message?.replace(/```(?:json)?\s*[\s\S]*?```/g, "").trim();
  const isSuccess = parsed?.success === true || message?.toLowerCase().includes("successfully");

  return (
    <div style={{
      ...s.resultCard,
      borderColor: isSuccess ? "#2a4a2a" : "#4a3a2a",
      background: isSuccess ? "#0a1a0a" : "#1a1a0a",
    }}>
      {textBefore && (
        <div style={{ color: isSuccess ? "#4ade80" : "#fbbf24", fontWeight: 600, marginBottom: 6, fontSize: "0.85rem" }}>
          {textBefore}
        </div>
      )}
      {parsed && <ResultDetails parsed={parsed} />}
      {!parsed && message && (
        <pre style={{ color: "#999", fontSize: "0.78rem", whiteSpace: "pre-wrap", margin: 0 }}>
          {message}
        </pre>
      )}
    </div>
  );
}

function ResultDetails({ parsed }) {
  if (!parsed) return null;
  const rows = [];

  if (parsed.success !== undefined) {
    rows.push(<KVRow key="__status" label="Status" value={parsed.success ? "Success" : "Failed"} />);
  }
  if ("error" in parsed && parsed.error !== undefined && parsed.error !== null) {
    rows.push(<ValueNode key="__error" label="Error" value={parsed.error} defaultOpen />);
  }
  if ("message" in parsed && parsed.message !== undefined && parsed.message !== null) {
    rows.push(<ValueNode key="__message" label="Message" value={parsed.message} />);
  }

  if ("data" in parsed) {
    if (isObjectLike(parsed.data)) {
      for (const [k, v] of Object.entries(parsed.data)) {
        rows.push(<ValueNode key={`data-${k}`} label={k} value={v} />);
      }
    } else if (Array.isArray(parsed.data)) {
      rows.push(<ValueNode key="data-array" label="data" value={parsed.data} />);
    } else {
      rows.push(<KVRow key="data-scalar" label="data" value={formatScalar(parsed.data)} />);
    }
  }

  for (const [k, v] of Object.entries(parsed)) {
    if (["success", "error", "message", "data"].includes(k)) continue;
    rows.push(<ValueNode key={`extra-${k}`} label={k} value={v} />);
  }

  return (
    <div style={s.kvGrid}>
      {rows}
    </div>
  );
}

function FlowOptionsRenderer({ options, onChoose }) {
  if (!options) return null;
  return (
    <div>
      {options.map((opt) => (
        <div
          key={opt.name}
          style={s.flowCard}
          onClick={() => onChoose(opt.name)}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#2563eb")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#333")}
        >
          <span style={{ fontWeight: 600 }}>{opt.name.replace(/_/g, " ")}</span>
          <span style={{ color: "#888", marginLeft: 8, fontSize: "0.82rem" }}>
            {opt.description}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Markdown renderer                                                  */
/* ------------------------------------------------------------------ */

function inlineMarkdown(text, keyPrefix) {
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
  let last = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) {
      parts.push(<strong key={`${keyPrefix}-${match.index}`}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(
        <code
          key={`${keyPrefix}-${match.index}`}
          style={{ background: "#2a2a2a", padding: "1px 5px", borderRadius: 3, fontSize: "0.85em" }}
        >
          {match[3]}
        </code>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}

function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, li) => {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes = { 1: "1.2em", 2: "1.05em", 3: "0.95em", 4: "0.9em" };
      return (
        <div key={li} style={{ fontWeight: 700, fontSize: sizes[level] || "0.9em", margin: "0.5em 0 0.2em" }}>
          {inlineMarkdown(headingMatch[2], li)}
        </div>
      );
    }

    const listMatch = line.match(/^(\s*)-\s+(.+)$/);
    if (listMatch) {
      const indent = Math.floor((listMatch[1] || "").length / 2);
      return (
        <div key={li} style={{ paddingLeft: `${1 + indent * 1.2}em`, position: "relative", lineHeight: 1.6 }}>
          <span style={{ position: "absolute", left: `${indent * 1.2}em` }}>{"\u2022"}</span>
          {inlineMarkdown(listMatch[2], li)}
        </div>
      );
    }

    const numMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (numMatch) {
      const num = line.match(/^(\s*)(\d+)\./);
      const indent = Math.floor((numMatch[1] || "").length / 2);
      return (
        <div key={li} style={{ paddingLeft: `${1 + indent * 1.2}em`, position: "relative", lineHeight: 1.6 }}>
          <span style={{ position: "absolute", left: `${indent * 1.2}em`, color: "#888" }}>{num[2]}.</span>
          {inlineMarkdown(numMatch[2], li)}
        </div>
      );
    }

    if (line.trim() === "") {
      return <div key={li} style={{ height: "0.4em" }} />;
    }

    return (
      <React.Fragment key={li}>
        {inlineMarkdown(line, li)}
        {li < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

/* ------------------------------------------------------------------ */
/*  Message bubble                                                     */
/* ------------------------------------------------------------------ */

function stripJsonFromText(text) {
  if (!text) return "";
  const cleaned = text
    .replace(/```(?:json)?\s*[\s\S]*?```/gi, "")
    .replace(/\{[\s\S]*?"confirm_action"[\s\S]*?\}/g, "")
    .replace(/\{[\s\S]*?"confirm_payload"[\s\S]*?\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned && (cleaned.startsWith("{") || cleaned.startsWith("["))) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object") return "";
    } catch {
      // Keep non-JSON strings as-is.
    }
  }
  return cleaned;
}

function AssistantMessage({ msg, onConfirm, onChooseFlow, loading }) {
  const { response_type, message, table_data, confirm_data, flow_options, _executionResult } = msg;

  const isResult = response_type === "result";
  const isError = response_type === "error";
  const isConfirm = response_type === "confirm";
  const hasJsonBlock = message && /```(?:json)?/.test(message);

  const displayMessage =
    isConfirm || response_type === "table" ? stripJsonFromText(message) : message;

  return (
    <div style={s.assistantMsg}>
      {isResult && message && hasJsonBlock && (
        <ResultCard message={message} />
      )}
      {displayMessage && !(isResult && hasJsonBlock) && !isError && (
        <div>{renderMarkdown(displayMessage)}</div>
      )}
      {response_type === "table" && <TableRenderer data={table_data} />}
      {isConfirm && (
        <ConfirmRenderer
          data={confirm_data}
          onConfirm={onConfirm}
          loading={loading}
          executionResult={_executionResult}
        />
      )}
      {response_type === "choose_flow" && (
        <FlowOptionsRenderer options={flow_options} onChoose={onChooseFlow} />
      )}
      {isResult && !message && (
        <div style={s.resultCard}>Operation completed.</div>
      )}
      {isError && !message && (
        <div style={s.errorCard}>An error occurred.</div>
      )}
      {isError && message && (
        <div style={s.errorCard}>{message}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

const OPS_PANEL_STYLES = `
.ops-messages::-webkit-scrollbar { width: 5px; }
.ops-messages::-webkit-scrollbar-track { background: transparent; }
.ops-messages::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; }
.ops-messages:hover::-webkit-scrollbar-thumb { background: #444; }
.ops-messages:hover { scrollbar-color: #444 transparent; }
@keyframes ops-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
  40% { transform: translateY(-5px); opacity: 1; }
}
.ops-waiting-dots {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 2px 0;
  vertical-align: middle;
}
.ops-waiting-dots span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
  animation: ops-dot-bounce 1.15s ease-in-out infinite;
}
.ops-waiting-dots span:nth-child(1) { animation-delay: 0ms; }
.ops-waiting-dots span:nth-child(2) { animation-delay: 160ms; }
.ops-waiting-dots span:nth-child(3) { animation-delay: 320ms; }
`;

function OpsWaitingBubble() {
  return (
    <div
      style={s.assistantMsg}
      aria-busy="true"
      aria-label="Assistant is replying"
    >
      <span className="ops-waiting-dots">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

export default function OpsPanel() {
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentFlow, setCurrentFlow] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    const id = "ops-scrollbar-style";
    if (!document.getElementById(id)) {
      const tag = document.createElement("style");
      tag.id = id;
      tag.textContent = OPS_PANEL_STYLES;
      document.head.appendChild(tag);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleClear() {
    setSessionId("");
    setMessages([]);
    setCurrentFlow("");
    setInput("");
    setLoading(false);
  }

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await opsApi.chat(sessionId, text);
      if (res.session_id) setSessionId(res.session_id);
      if (res.current_flow) setCurrentFlow(res.current_flow);
      setMessages((prev) => [...prev, { role: "assistant", ...res }]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", response_type: "error", message: e.message },
      ]);
    }
    setLoading(false);
  }

  async function handleConfirm(confirmed) {
    setLoading(true);
    try {
      const res = await opsApi.confirm(sessionId, confirmed);
      if (res.current_flow) setCurrentFlow(res.current_flow);
      const isExecResult = res.response_type === "result" || res.response_type === "error";
      if (isExecResult) {
        setMessages((prev) => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "assistant" && updated[i].response_type === "confirm") {
              updated[i] = { ...updated[i], _executionResult: res };
              return updated;
            }
          }
          return [...prev, { role: "assistant", ...res }];
        });
      } else {
        setMessages((prev) => [...prev, { role: "assistant", ...res }]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", response_type: "error", message: e.message },
      ]);
    }
    setLoading(false);
  }

  const flowGreetings = {
    general_enquiry: "I have a question about the data platform",
    party_onboarding: "I want to create a new party",
    data_query: "I want to query some data",
    upsert: "I want to insert or update some records",
  };

  function handleChooseFlow(flowName) {
    sendMessage(flowGreetings[flowName] || `I want to use ${flowName.replace(/_/g, " ")}`);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div style={s.wrap}>
      <div style={{ ...s.header, display: "flex", alignItems: "center" }}>
        <span>Operations</span>
        {currentFlow && (
          <span style={s.flowBadge}>{currentFlow.replace(/_/g, " ")}</span>
        )}
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            style={{
              marginLeft: "auto",
              padding: "4px 12px",
              borderRadius: 5,
              border: "1px solid #444",
              background: "transparent",
              color: "#999",
              fontSize: "0.75rem",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="ops-messages" style={s.messages}>
        {messages.length === 0 && (
          <div style={{ color: "#666", textAlign: "center", margin: "auto 0", padding: "2rem 1rem" }}>
            Ask a question about your data, create a party, query records, or
            insert/update data.
          </div>
        )}
        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div key={i} style={s.userMsg}>{msg.content}</div>
          ) : (
            <AssistantMessage
              key={i}
              msg={msg}
              onConfirm={handleConfirm}
              onChooseFlow={handleChooseFlow}
              loading={loading}
            />
          )
        )}
        {loading && <OpsWaitingBubble />}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputRow}>
        <input
          style={s.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={loading}
        />
        <button
          style={{
            ...s.sendBtn,
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
        >
          {loading ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
