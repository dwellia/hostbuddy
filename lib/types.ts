/**
 * lib/types.ts
 */

// ── HostbuddyAI webhook payload ───────────────────────────────────────────────

export interface HostbuddyActionItem {
  id: string;
  status: string;
  category: string;
  item: string;                // the action item description
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

// ── Hospitable message ────────────────────────────────────────────────────────

export interface HospitableMessage {
  id: string;
  body: string;
  author: "host" | "guest" | string;
  created_at: string;
}

// ── Claude's routing decision ─────────────────────────────────────────────────

export interface Decision {
  guest_requesting_visit: boolean;  // did guest actually ask for someone to come out?
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
  reasoning: string;
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
