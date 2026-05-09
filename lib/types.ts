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

export interface Decision {
  guest_requesting_visit: boolean;
  issue_needs_attention: boolean; // true = next clean task, false = no action
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
