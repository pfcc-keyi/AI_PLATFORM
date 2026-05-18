// Mirrors the Pydantic models in ai_platform/models/design_models.py
// Only the fields the frontend uses are typed; extras are passed through.

export interface ParsedField {
  name: string;
  full_name?: string;
  definition?: string;
  data_type?: string;
  primary_key?: boolean;
  foreign_key?: string | null;
}

export interface ParsedTable {
  entity_name: string;
  fields: ParsedField[];
  source_sheet?: string;
}

export interface ParsedSchema {
  tables: ParsedTable[];
  sheet_count: number;
  fk_count: number;
}

export interface ClusterSpec {
  cluster_id: string;
  name: string;
  table_names: string[];
  rationale?: string;
}

export interface DomainAnalysis {
  domain_guess: string;
  sub_domains: string[];
  clusters: ClusterSpec[];
  questions: string[];
  assumptions: string[];
  reasoning?: string;
}

export interface TransitionDesign {
  from_state: string;
  to_state: string;
}

export interface ColumnDesign {
  name: string;
  pg_type: string;
  nullable?: boolean;
  check?: string | null;
  default_expr?: string | null;
  identity?: boolean;
  unique?: boolean;
}

export interface FKDesign {
  field: string;
  references_table: string;
  references_field: string;
  on_delete?: string;
  on_update?: string;
}

export interface ActionDesign {
  name: string;
  function_type: string;
  transition: TransitionDesign;
}

export interface SchemaDesign {
  table_name: string;
  table_category: string;
  pk_field: string;
  pk_strategy?: string;
  pk_generator_description?: string;
  states: string[];
  transitions: TransitionDesign[];
  columns: ColumnDesign[];
  actions: ActionDesign[];
  fk_definitions: FKDesign[];
  table_constraints: string[];
}

export interface HandlerStep {
  step_number: number;
  description: string;
  table_name?: string;
  action_name?: string;
  is_raw_query?: boolean;
  raw_query_description?: string;
  input_mapping?: string;
  output_key?: string;
}

export interface HandlerSketch {
  handler_name: string;
  mode: string;
  description: string;
  tables_used: string[];
  payload_fields?: Array<Record<string, unknown>>;
  steps: HandlerStep[];
  error_handling?: string;
  return_description?: string;
  trigger_state?: string;
  target_state?: string;
  fields_touched?: string[];
  reasoning?: string;
}

export interface TableLayout3D {
  table_name: string;
  x: number;
  y: number;
  z: number;
  cluster_id?: string;
}

export interface ErdEdge {
  from_table: string;
  to_table: string;
  from_field?: string;
  to_field?: string;
}

export interface ERDLayout {
  tables: TableLayout3D[];
  edges: ErdEdge[];
}

export type IssueSeverity = "info" | "warning" | "error";

export interface DesignIssue {
  severity: IssueSeverity;
  target: string;
  message: string;
  suggested_fix?: string;
}

export interface DesignCritique {
  summary: string;
  issues: DesignIssue[];
  open_questions?: string[];
}

export interface FullDesign {
  design_id: string;
  created_at?: string;
  parsed_schema: ParsedSchema;
  domain_analysis: DomainAnalysis;
  schema_designs: SchemaDesign[];
  handler_sketches: HandlerSketch[];
  layout: ERDLayout;
  critique?: DesignCritique | null;
  user_notes?: string;
}

export interface DesignRevision {
  revision_id: string;
  parent_revision_id?: string | null;
  actor: "user" | "agent";
  request?: string;
  change_summary: string;
  before?: FullDesign | null;
  after?: FullDesign | null;
  reasoning?: string;
  created_at?: string;
  applied?: boolean;
}

export interface DesignSummary {
  design_id: string;
  created_at?: string;
  table_count?: number;
  domain_guess?: string;
  filename?: string;
}

export interface DesignSessionState {
  design_id: string;
  phase: string;
  questions: string[];
  pending_revisions: Array<{
    revision_id: string;
    actor: string;
    change_summary: string;
    created_at?: string;
  }>;
  clarification_round?: number;
}

export interface DesignResponse extends DesignSessionState {
  design?: FullDesign;
  revision?: DesignRevision;
  error?: string;
  critique?: DesignCritique;
}

// Streamed event types from the SSE endpoint.
export type StreamEvent =
  | { type: "design_created"; design_id: string }
  | { type: "phase"; phase: string }
  | {
      type: "llm_chunk";
      content: string;
      agent_role?: string;
      task_name?: string;
    }
  | { type: "task_started"; agent_role?: string; task_name?: string }
  | { type: "task_completed"; agent_role?: string; task_name?: string }
  | { type: "crew_started"; crew_name?: string }
  | { type: "crew_completed"; crew_name?: string }
  | { type: "method_started"; flow_name?: string; method?: string }
  | { type: "method_finished"; flow_name?: string; method?: string }
  | { type: "flow_started"; flow_name?: string }
  | { type: "flow_finished"; flow_name?: string }
  | { type: "tool_started"; tool?: string }
  | { type: "tool_finished"; tool?: string }
  | { type: "revision_proposed"; revision_id: string; change_summary: string }
  | { type: "revision_applied"; revision_id: string }
  | { type: "revision_dropped"; revision_id: string }
  | { type: "revision_restored"; revision_id: string }
  | { type: "user_edit_applied"; revision_id: string; change_summary: string }
  | { type: "critique_updated"; issue_count: number }
  | { type: "review"; action: string; phase: string };
