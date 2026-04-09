import type { OpsResponse, TableData, ConfirmData, FlowOption } from './api'

export type UserMessage = {
  role: 'user'
  content: string
}

export type AssistantMessage = {
  role: 'assistant'
  response_type?: string
  message?: string
  table_data?: TableData
  confirm_data?: ConfirmData
  flow_options?: FlowOption[]
  _executionResult?: OpsResponse
}

export type ChatMessage = UserMessage | AssistantMessage

export type AppState = {
  sessionId: string
  messages: ChatMessage[]
  currentFlow: string
  loading: boolean
  dirty: boolean
}

export function createState(): AppState {
  return {
    sessionId: '',
    messages: [],
    currentFlow: '',
    loading: false,
    dirty: true,
  }
}

export function markDirty(state: AppState): void {
  state.dirty = true
}
