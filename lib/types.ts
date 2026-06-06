/**
 * lib/types.ts
 */

export interface HostbuddyActionItem {
  id: string;
  status: string;
  category: string;
  item: string;
  guest_name: string;
  reservation_id: string;
  conversation_id: string;
  property_name: string;
  property_alias: string;
  created_at_utc: string;
}

export interface HostbuddyPayload {
  hook_id: string;
  hook_timestamp: string;
  hook_type: string;
  user_id: string;
  action_items: HostbuddyActionItem[];
}

export interface HospitableMessage {
  id: string;
  body: string;
  author: "host" | "guest" | string;
  created_at: string;
  attachments: any[];
}

// ── Existing issue decision ───────────────────────────────────────────────────

export interface Decision {
  guest_requesting_visit: boolean;
  issue_needs_attention: boolean;
  corrected_category: string;
  send_sms: boolean;
  sms_to_key: string | null;
  sms_message: string;
  send_call: boolean;
  call_to_key: string | null;
  create_task: boolean;
  task_title: string;
  task_description: string;
  task_priority: "low" | "medium" | "high";
  task_assignee_key: string | null;
  task_type: "urgent" | "next_clean";
  reasoning: string;
}

// ── Check-in/out request (pending, processed via GitHub Action) ───────────────

export type CheckInOutType = "early_checkin" | "late_checkout";
export type CheckInOutStatus = "pending" | "processed" | "failed";

export interface PendingCheckInOut {
  id: string;
  created_at: string;
  process_after: string;         // ISO — when GitHub Action should process this
  status: CheckInOutStatus;
  type: CheckInOutType;
  reservation_id: string;
  property_id: string;
  property_alias: string;
  guest_name: string;
  guest_first_name: string;
  action_item: string;           // raw HostbuddyAI item text
}

// ── Results ───────────────────────────────────────────────────────────────────

export interface QuoSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface AsanaCreateResult {
  success: boolean;
  taskId?: string;
  taskUrl?: string;
  error?: string;
}

export interface PipelineResult {
  skipped?: boolean;
  skip_reason?: string;
  decision?: Decision;
  sms?: QuoSendResult;
  call?: QuoSendResult;
  task?: AsanaCreateResult;
}
