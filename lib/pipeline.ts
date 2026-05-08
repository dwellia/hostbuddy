/**
 * lib/pipeline.ts
 *
 * Orchestrates the full issue-routing pipeline:
 *   1. Claude decides what to do
 *   2. Send SMS via Quo (if needed)
 *   3. Send urgent SMS via Quo (if critical)
 *   4. Create Asana task (if needed)
 */

import { getRoutingDecision } from "./claude";
import { sendSMS, sendUrgentCallSMS } from "./quo";
import { createTask } from "./asana";
import { TEAM, PROPERTIES, getContact } from "./team";
import type { HostbuddyPayload, PipelineResult } from "./types";

export async function processIssue(
  payload: HostbuddyPayload
): Promise<PipelineResult> {
  console.log(
    `[Pipeline] Processing: ${payload.issue_type} @ ${payload.property_id} (${payload.severity})`
  );

  const decision = await getRoutingDecision(payload);
  console.log(`[Pipeline] Decision: ${decision.reasoning}`);

  const result: PipelineResult = { decision };

  // ── SMS ───────────────────────────────────────────────────────────────────
  if (decision.send_sms && decision.sms_to_key) {
    const recipient = TEAM[decision.sms_to_key];
    if (!recipient?.phone) {
      console.warn(`[Pipeline] SMS skipped — no phone for key="${decision.sms_to_key}"`);
    } else {
      result.sms = await sendSMS(recipient.phone, decision.sms_message);
    }
  }

  // ── Urgent SMS for critical issues ────────────────────────────────────────
  if (decision.send_call && decision.call_to_key) {
    const recipient = TEAM[decision.call_to_key];
    if (!recipient?.phone) {
      console.warn(`[Pipeline] Urgent SMS skipped — no phone for key="${decision.call_to_key}"`);
    } else {
      const property = PROPERTIES[payload.property_id];
      const context = `${payload.issue_type} at ${property?.name ?? payload.property_id}.`;
      result.call = await sendUrgentCallSMS(recipient.phone, context);
    }
  }

  // ── Asana task ────────────────────────────────────────────────────────────
  if (decision.create_task) {
    const property = PROPERTIES[payload.property_id];
    if (!property?.asanaProjectId) {
      console.warn(`[Pipeline] Task skipped — no Asana project for "${payload.property_id}"`);
      result.task = { success: false, error: "No Asana project configured" };
    } else {
      const assignee = decision.task_assignee_key
        ? TEAM[decision.task_assignee_key]
        : null;

      result.task = await createTask({
        title: decision.task_title,
        description: decision.task_description,
        priority: decision.task_priority,
        assigneeGid: assignee?.asanaUserId || null,
        projectGid: property.asanaProjectId,
      });
    }
  }

  console.log("[Pipeline] Done:", {
    sms: result.sms?.success ?? "skipped",
    call: result.call?.success ?? "skipped",
    task: result.task?.success ?? "skipped",
  });

  return result;
}
