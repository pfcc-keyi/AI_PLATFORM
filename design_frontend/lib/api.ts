import type {
  DesignResponse,
  DesignSummary,
  FullDesign,
  HandlerSketch,
  DesignCritique
} from "./types";

const API_BASE = (process.env.NEXT_PUBLIC_AI_API_URL || "").replace(/\/$/, "");

function url(path: string) {
  return `${API_BASE}${path}`;
}

async function jsonOr<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const parsed = JSON.parse(text);
      msg = parsed.detail || parsed.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${msg}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function listDesigns(): Promise<DesignSummary[]> {
  const res = await fetch(url("/api/design/"), { cache: "no-store" });
  const data = await jsonOr<{ designs: DesignSummary[] }>(res);
  return data.designs ?? [];
}

export async function uploadDesign(file: File): Promise<DesignResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("filename", file.name);
  const res = await fetch(url("/api/design/upload"), {
    method: "POST",
    body: form
  });
  return jsonOr<DesignResponse>(res);
}

export async function getDesign(designId: string): Promise<DesignResponse & { design: FullDesign }> {
  const res = await fetch(url(`/api/design/${designId}`), { cache: "no-store" });
  return jsonOr(res);
}

export async function deleteDesign(designId: string): Promise<{ deleted: boolean }> {
  const res = await fetch(url(`/api/design/${designId}`), { method: "DELETE" });
  return jsonOr(res);
}

export async function answerDesign(
  designId: string,
  answers: Record<string, string>
): Promise<DesignResponse> {
  const res = await fetch(url(`/api/design/${designId}/answer`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers })
  });
  return jsonOr(res);
}

export async function reviewDesign(
  designId: string,
  action: "approved" | "revise" | "reject",
  feedback = ""
): Promise<DesignResponse> {
  const res = await fetch(url(`/api/design/${designId}/review`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, feedback })
  });
  return jsonOr(res);
}

export async function refineDesign(
  designId: string,
  body: { scope?: string; target?: string; request: string }
): Promise<DesignResponse> {
  const res = await fetch(url(`/api/design/${designId}/refine`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: body.scope || "global",
      target: body.target || "",
      request: body.request
    })
  });
  return jsonOr(res);
}

export async function applyRevision(designId: string, revisionId: string) {
  const res = await fetch(
    url(`/api/design/${designId}/revisions/${revisionId}/apply`),
    { method: "POST" }
  );
  return jsonOr<DesignResponse>(res);
}

export async function dropRevision(designId: string, revisionId: string) {
  const res = await fetch(
    url(`/api/design/${designId}/revisions/${revisionId}/drop`),
    { method: "POST" }
  );
  return jsonOr<DesignResponse>(res);
}

export async function restoreRevision(designId: string, revisionId: string) {
  const res = await fetch(
    url(`/api/design/${designId}/revisions/${revisionId}/restore`),
    { method: "POST" }
  );
  return jsonOr<DesignResponse>(res);
}

export async function listRevisions(designId: string) {
  const res = await fetch(url(`/api/design/${designId}/revisions`));
  return jsonOr<{ revisions: Array<Record<string, unknown>> }>(res);
}

export async function suggestHandlers(
  designId: string,
  body: { table: string; field: string; state: string }
): Promise<{ handlers: HandlerSketch[] }> {
  const res = await fetch(url(`/api/design/${designId}/suggest-handlers`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return jsonOr(res);
}

export async function editDesign(
  designId: string,
  body: { after: FullDesign; change_summary: string }
): Promise<DesignResponse> {
  const res = await fetch(url(`/api/design/${designId}/edit`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return jsonOr(res);
}

export async function critiqueDesign(designId: string, scope = "global") {
  const res = await fetch(url(`/api/design/${designId}/critique`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope })
  });
  return jsonOr<DesignResponse & { critique?: DesignCritique }>(res);
}

export function eventsUrl(designId: string): string {
  return url(`/api/design/${designId}/events`);
}
