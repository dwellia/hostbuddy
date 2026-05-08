/**
 * lib/types.ts
 *
 * Shared types for the HostbuddyAI → Claude → Quo/Asana pipeline.
 */

// ── HostbuddyAI webhook payload ───────────────────────────────────────────────

export type Severity = "low" | "medium" | "high" | "critical";

export interface HostbuddyPayload {
  issue_type: string;       // e.g. "hvac", "pool_equipment", "wifi"
  severity: Severity;
  property_id: string;      // e.g. "delta-dawn" or "legobii"
  description: string;      // human-readable description from HostbuddyAI
  guest_present: boolean;   // is a guest currently checked in?
  guest_name?: string;      // guest name if present
  timestamp: string;        // ISO 8601
}

// ── Claude's routing decision ─────────────────────────────────────────────────

export interface Decision {
  // SMS fields
  send_sms: boolean;
  sms_to_key: string | null;   // key from TEAM (e.g. "john", "mike")
  sms_message: string;         // ≤160 chars, warm + direct

  // Call fields (critical only)
  send_call: boolean;
  call_to_key: string | null;  // key from TEAM

  // Asana task fields
  create_task: boolean;
  task_title: string;
  task_description: string;
  task_priority: "low" | "medium" | "high";
  task_assignee_key: string | null; // key from TEAM

  // Internal reasoning (not used in action, helps with debugging)
  reasoning: string;
}

// ── Quo API ───────────────────────────────────────────────────────────────────

export interface QuoSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ── Asana API ─────────────────────────────────────────────────────────────────

export interface AsanaCreateResult {
  success: boolean;
  taskId?: string;
  taskUrl?: string;
  error?: string;
}

// ── Pipeline result (returned from processIssue) ──────────────────────────────

export interface PipelineResult {
  decision: Decision;
  sms?: QuoSendResult;
  call?: QuoSendResult;
  task?: AsanaCreateResult;
}
