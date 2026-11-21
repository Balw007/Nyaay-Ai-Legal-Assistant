// Shapes returned by the FastAPI backend (app/serializers.py and routes). Keep in sync with the backend.

export type Role = "owner" | "admin" | "advocate" | "clerk";

export interface User {
  id: number; email: string; name: string; role: Role; firm_id: number;
  phone: string | null; enrolment_no: string | null; whatsapp_brief: boolean; telegram_chat_id?: string | null; telegram_brief?: boolean; active: boolean; last_login: string | null;
}
export interface FirmSettings {
  ai_enabled: boolean; redact_pii: boolean; monthly_token_budget: number; rerank: boolean;
  closed_saturdays: string; require_review: boolean;
}
export interface Me { user: User; firm: { id: number; name: string; settings: FirmSettings } }

export interface Corpus {
  judgments: number; real_judgments: number; paragraphs: number; fixture_only: boolean;
  year_min: number | null; year_max: number | null; courts: { court: string; count: number }[]; llm?: string;
}

export interface Treatment { negative: number; caution: number; positive: number; cited: number }

export interface SearchResult {
  id: string; title: string; court: string; decision_date: string; year: number; citation: string;
  hits: { no: number; snippet: string }[]; treatment: Treatment;
}
export interface SearchResponse { query: string; match: string; total: number; offset: number; results: SearchResult[] }

export interface AskSource {
  sid: number; jid: string; title: string; court: string; decision_date: string; citation: string;
  para_no: number; text: string; treatment: string;
}
export interface AskResponse {
  question: string; mode: "answer" | "retrieval_only" | "no_results" | string; answer: string | null;
  sources: AskSource[]; message?: string; cached?: boolean; warnings?: string[]; uncited?: string[];
}

export interface Paragraph { no: number; text: string }
export interface Judgment {
  id: string; title: string; court: string; decision_date: string; year: number; citations: string[];
  bench: string; disposal: string; source: string; source_url: string; n_paras: number; paragraphs: Paragraph[];
}
export interface LinkRef { jid?: string; id?: string; title: string; citation?: string; court?: string; year?: number; treatment?: string; para_no?: number; paras?: number[] }
export interface Links { cites: LinkRef[]; cited_by: LinkRef[]; treatment: Treatment; citations_in_text: number; not_in_corpus: number }
export interface Summary { mode: string; message?: string; summary?: Record<string, unknown> | string; headnote?: string; held?: string[]; issues?: string[] }

export type CheckStatus = "VERIFIED" | "EXISTS_UNCHECKED" | "NOT_SUPPORTED" | "NOT_IN_LIBRARY" | "FOUND_EXTERNALLY" | "NOT_FOUND" | "OVERRULED" | string;
export interface CheckItem {
  index: number; citation: string; normalized: string; kind: string; case_name: string; proposition: string;
  status: CheckStatus; judgment_id: string | null; judgment_title: string | null; court: string | null;
  paragraphs: { no: number; text: string; score: number }[]; overlap: number;
  support: { verdict: string; method: string; reason: string }; message: string; advocate_confirmed: boolean; search_url: string;
  confirmed_by?: string; enrolment?: string;
}
export interface CitationCheck {
  id: number; matter_id: number | null; method: string; items: CheckItem[];
  summary: { total: number; counts: Record<string, number>; can_export: boolean; blockers: { index: number; citation: string; status: string }[]; note: string };
  created_at: string;
}

export interface Matter {
  id: number; title: string; case_type: string; court: string | null; case_number: string | null; cnr: string | null;
  client_name: string | null; goal: string | null; current_stage: string | null; facts: Record<string, string>;
  details: Record<string, string>; next_date: string | null; status: string; created_at: string;
  synced_at: string | null; sync_status: string | null;
}
export interface Stage { id: string; name: string; state: "done" | "current" | "upcoming" }
export interface Plan {
  playbook_status: string; current_stage_name: string; progress: number; stages: Stage[];
  current_actions: string[]; current_drafts: string[]; next_stage: string | null; next_stage_actions: string[];
}
export interface Deadline {
  id: number; matter_id: number; rule_id: string; label: string; authority: string; due_date: string | null;
  status: string; needs_confirmation: boolean; alert_days_before: number[]; note: string; original_due_date: string | null;
}
export interface Order {
  id: number; matter_id: number; filename: string | null; order_date: string | null; next_date: string | null;
  summary: string | null; directions: string[]; detected_stage: string | null; stage_confidence: number | null;
  extraction_method: string; needs_review: string[]; client_message: string | null; source: string; created_at: string; text?: string;
}
export interface Task {
  id: number; matter_id: number | null; title: string; detail: string; due_date: string | null; source: string;
  status: "proposed" | "approved" | "rejected" | "done" | "open" | string; action: string | null;
  payload: Record<string, unknown>; decided_by: string | null; decided_at: string | null; created_at: string;
}
export interface Note { id: number; matter_id: number; body: string; author: string; created_at: string }
export interface Bookmark { id: number; matter_id: number | null; jid: string; title: string; citation: string; para_no: number | null; excerpt: string; note: string; created_at: string }
export interface DraftListItem { id: number; matter_id: number | null; template: string; title: string; status: string; created_at: string; updated_at: string; matter?: string; placeholders?: number }
export interface Draft extends Omit<DraftListItem, "placeholders"> { body: string; placeholders: string[]; template_review?: string }
export interface Template { id: string; name: string; group: string; fields: string[]; dates: string[] }
export interface Templates { fields: Record<string, string>; templates: Template[] }

export interface MatterDetail {
  matter: Matter; plan: Plan; deadlines: Deadline[]; orders?: Order[]; tasks?: Task[]; drafts?: DraftListItem[];
  notes?: Note[]; bookmarks?: Bookmark[]; checks?: CitationCheck[]; [k: string]: unknown;
}

export interface Hearing { matter_id: number; title: string; court: string; case_number: string | null; date: string; stage: string; prepare: string[]; client: string }
export interface DashDeadline { matter_id: number; matter: string; label: string; authority: string; due_date: string; days_left: number; overdue?: boolean; needs_confirmation?: boolean }
export interface Activity { id: number; actor: string; action: string; text: string; matter_id: number | null; matter: string | null; at: string }
export interface Dashboard {
  date: string;
  counts: { active_matters: number; hearings_today: number; hearings_week: number; deadlines_week: number; overdue: number; pending_approvals: number; open_tasks: number; drafts: number; saved_judgments: number };
  hearings: Hearing[]; deadlines: DashDeadline[]; stages: { stage: string; count: number }[];
  activity: Activity[]; recent_searches: string[]; corpus: Corpus;
}

export interface CalEvent { date: string; type: "hearing" | "deadline" | "task" | string; title: string; matter_id: number | null; detail: string }
export interface Client { name: string; matters: { id: number; title: string; status: string; next_date: string | null }[]; active: number; next_date: string | null }

export interface AiStatus { provider: string; ready: boolean; model?: string | null; model_fast?: string | null; missing?: string[]; message: string }
export interface LibraryJob { state: "idle" | "running" | "done" | "stopped" | "failed"; kind: string | null; label: string; started_at: string | null; finished_at: string | null; added: number; failed: number; error: string | null; log: string[] }
export interface LibraryStatus { corpus: Corpus; job: LibraryJob; ai: AiStatus; semantic: { ready: boolean; vectors: number; paragraphs: number; model: string | null } }

export interface Review { kind: string; ref: string; label: string; group: string; detail: string; version: string; status: string; reviewer: string | null; enrolment: string | null; at: string | null; comment: string }
export interface GlobalSearch { matters: { id: number; title: string; sub?: string }[]; drafts: { id: number; title: string; sub?: string }[]; judgments: { id: string; title: string; sub: string }[] }

/* ---- section converter, matter tools, approvals queue, telegram ---- */
export interface SectionRef { code: string; name: string; section: string }
export interface ConvertResult {
  matched: "old" | "new"; old: SectionRef; new: SectionRef; title: string; note: string | null; tags: string[]; source: string;
}
export interface ConvertResponse {
  query: string; parsed: { act: string | null; section: string | null } | null; results: ConvertResult[];
  omitted: { old: SectionRef; title: string; note: string; source: string }[];
  new_provisions: { new: SectionRef; title: string; note: string; source: string }[];
  unchanged: { act: string; note: string }[]; notice: string; message: string | null;
}
export interface OpposingResult {
  mode: "retrieval_only" | "answer"; position: string; answer: string | null; message: string; limitations?: string;
  saved_authorities: number;
  adverse_treatment: { jid: string; title: string; citation: string; worst: string; citing: { id: string; title: string; court: string; year: number; treatment: string; paras: number[] }[] }[];
  contrary_sources: { sid: number; jid: string; title: string; court: string; citation: string; para_no: number; text: string; treatment: string; why: string }[];
  checks: { invalid_markers_removed: number[]; uncited_sentences: string[]; cited_sources: number[] } | null;
}
export interface QueueTask extends Task { kind: string; safe: boolean; conflict: string | null }
export interface ApprovalQueue {
  total: number; summary: string; safe_ids: number[];
  groups: { matter: { id: number; title: string; client_name: string | null; next_date: string | null }; tasks: QueueTask[] }[];
}
export interface BatchResult { decision: string; done: Task[]; skipped: { id: number; reason: string }[] }
export interface LogEntry { id: number; at: string; actor: string; action: string; task_id: number | null; title: string | null; matter: string | null; count: number | null }
export interface RouteOption {
  id: string; name: string; summary: string; steps: string[]; consider: string[]; risks: string[]; authority: string;
  what_if_inputs: string[]; review: string; draft: boolean;
  deadlines: { rule_id: string; label: string; authority: string; due_date: string | null; saved_due_date: string | null; days_left: number | null; changed_by_what_if: boolean; note: string }[];
}
export interface RoutesResponse {
  goal: string | null; route_id: string | null; note: string; what_if: Record<string, string>;
  inputs: { name: string; label: string; saved: string | null }[]; routes: RouteOption[];
}
export interface TelegramStatus { configured: boolean; source: string | null; token_hint: string | null; bot_username: string | null; chat_id: string | null; brief: boolean; error?: string }
