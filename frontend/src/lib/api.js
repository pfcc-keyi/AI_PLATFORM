const AI_API = import.meta.env.VITE_AI_API_URL || "";

async function post(base, path, body = {}) {
  const headers = { "Content-Type": "application/json" };
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(base, path) {
  const res = await fetch(`${base}${path}`);
  return res.json();
}

export const configApi = {
  analyze: (requirement, sessionId = "") =>
    post(AI_API, "/api/config/analyze", { requirement, session_id: sessionId }),
  answer: (sessionId, answers) =>
    post(AI_API, "/api/config/answer", { session_id: sessionId, answers }),
  confirm: (sessionId, confirmed = true, feedback = "") =>
    post(AI_API, "/api/config/confirm", { session_id: sessionId, confirmed, feedback }),
  review: (sessionId, approved, feedback = "") =>
    post(AI_API, "/api/config/review", { session_id: sessionId, approved, feedback }),
  deploy: (sessionId) =>
    post(AI_API, "/api/config/deploy", { session_id: sessionId, approved: true }),
  newOperation: (sessionId, requirement = "") =>
    post(AI_API, "/api/config/new-operation", { session_id: sessionId, requirement }),
  sessions: () => get(AI_API, "/api/config/sessions"),
};

export const opsApi = {
  chat: (sessionId, message) =>
    post(AI_API, "/api/ops/chat", { session_id: sessionId, message }),
  confirm: (sessionId, confirmed) =>
    post(AI_API, "/api/ops/confirm", { session_id: sessionId, confirmed }),
  flows: () => get(AI_API, "/api/ops/flows"),
};

export const healthApi = {
  check: () => get(AI_API, "/api/health"),
  schema: () => get(AI_API, "/api/schema"),
};
