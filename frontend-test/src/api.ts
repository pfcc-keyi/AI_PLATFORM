const AI_API = ''

async function post<T = unknown>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${AI_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json() as Promise<T>
}

export type OpsResponse = {
  session_id?: string
  current_flow?: string
  response_type?: 'table' | 'confirm' | 'result' | 'error' | 'choose_flow' | 'message'
  message?: string
  table_data?: TableData
  confirm_data?: ConfirmData
  flow_options?: FlowOption[]
}

export type TableData = {
  columns?: string[]
  rows?: unknown[][]
  tables?: { name?: string; columns: string[]; rows: unknown[][] }[]
}

export type ConfirmData = {
  action_type?: string
  details?: Record<string, unknown>
}

export type FlowOption = {
  name: string
  description?: string
}

export const opsApi = {
  chat: (sessionId: string, message: string) =>
    post<OpsResponse>('/api/ops/chat', { session_id: sessionId, message }),
  confirm: (sessionId: string, confirmed: boolean) =>
    post<OpsResponse>('/api/ops/confirm', { session_id: sessionId, confirmed }),
}
