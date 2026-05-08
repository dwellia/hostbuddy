/**
 * lib/pipeline.ts
 */

import { getRoutingDecision } from "./claude";
import { getReservationMessages } from "./hospitable";
import { sendSMS, sendUrgentCallSMS } from "./quo";
import { createTask } from "./asana";
import { saveIssue } from "./db";
import { TEAM, PROPERTIES } from "./team";
import type { HostbuddyActionItem, HostbuddyPayload, PipelineResult } from "./types";
import { randomUUID } from "crypto";

export async function processWebhook(
  payload: HostbuddyPayload
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];
  for (const actionItem of payload.action_items) {
    const result = await processActionItem(actionItem);
    results.push(result);
  }
  return results;
}

async function processActionItem(
  actionItem: HostbuddyActionItem
): Promise<PipelineResult> {
  console.log(`[Pipeline] Action item: "${actionItem.item.slice(0, 80)}"`);

  // Step 1: Fetch conversation from Hospitable
  let messages = [];
  try {
    messages = await getReservationMessages(actionItem.reservation_id);
  } catch (err) {
    console.error(`[Pipeline] Hospitable fetch failed: ${err instanceof Error ? err.message : err}`);
  }

  // Step 2: Claude reads conversation and decides
  const decision = await getRoutingDecision(actionItem, messages);
  console.log(`[Pipeline] Decision: ${decision.reasoning}`);

  // Step 3: Resolve property
  const propertyId = resolvePropertyId(actionItem.property_alias, actionItem.property_name);
  const property = propertyId ? PROPERTIES[propertyId] : null;

  const result: PipelineResult = { decision };

  // Step 4: If guest not requesting visit, save record and skip
  if (!decision.guest_requesting_visit) {
    console.log("[Pipeline] Guest not requesting visit — skipping SMS and task");

    await saveIssue({
      id: randomUUID(),
      timestamp: actionItem.created_at_utc || new Date().toISOString(),
      property: actionItem.property_alias,
      property_id: propertyId ?? "unknown",
      guest_name: actionItem.guest_name,
      reservation_id: actionItem.reservation_id,
      category: actionItem.category,
      action_item: actionItem.item,
      guest_requested_visit: false,
      sms_sent: false,
      task_created: false,
      asana_task_id: null,
      asana_task_url: null,
      claude_reasoning: decision.reasoning,
      conversation_length: messages.length,
      notified_contact: null,
    });

    return { skipped: true, skip_reason: decision.reasoning, decision };
  }

  // Step 5: Send SMS
  let smsSent = false;
  let notifiedContact: string | null = null;

  if (decision.send_sms && decision.sms_to_key) {
    const recipient = TEAM[decision.sms_to_key];
    if (recipient?.phone) {
      result.sms = await sendSMS(recipient.phone, decision.sms_message);
      smsSent = result.sms.success;
      notifiedContact = recipient.name;
    }
  }

  // Step 6: Urgent SMS for critical
  if (decision.send_call && decision.call_to_key) {
    const recipient = TEAM[decision.call_to_key];
    if (recipient?.phone) {
      const context = `${actionItem.category} at ${actionItem.property_alias}.`;
      result.call = await sendUrgentCallSMS(recipient.phone, context);
    }
  }

  // Step 7: Create Asana task
  let taskId: string | null = null;
  let taskUrl: string | null = null;
  let taskCreated = false;

  if (decision.create_task && property?.asanaProjectId) {
    const assignee = decision.task_assignee_key ? TEAM[decision.task_assignee_key] : null;
    result.task = await createTask({
      title: decision.task_title,
      description: [
        decision.task_description,
        "",
        `Guest: ${actionItem.guest_name}`,
        `Reservation: ${actionItem.reservation_id}`,
        `Source: HostbuddyAI`,
      ].join("\n"),
      priority: decision.task_priority,
      assigneeGid: assignee?.asanaUserId || null,
      projectGid: property.asanaProjectId,
    });
    taskCreated = result.task.success;
    taskId = result.task.taskId ?? null;
    taskUrl = result.task.taskUrl ?? null;
  }

  // Step 8: Save to DB
  await saveIssue({
    id: randomUUID(),
    timestamp: actionItem.created_at_utc || new Date().toISOString(),
    property: actionItem.property_alias,
    property_id: propertyId ?? "unknown",
    guest_name: actionItem.guest_name,
    reservation_id: actionItem.reservation_id,
    category: actionItem.category,
    action_item: actionItem.item,
    guest_requested_visit: true,
    sms_sent: smsSent,
    task_created: taskCreated,
    asana_task_id: taskId,
    asana_task_url: taskUrl,
    claude_reasoning: decision.reasoning,
    conversation_length: messages.length,
    notified_contact: notifiedContact,
  });

  console.log("[Pipeline] Done:", {
    sms: result.sms?.success ?? "skipped",
    task: result.task?.success ?? "skipped",
  });

  return result;
}

function resolvePropertyId(alias: string, name: string): string | null {
  const combined = `${alias} ${name}`.toLowerCase();
  if (combined.includes("delta") || combined.includes("dawn")) return "delta-dawn";
  if (combined.includes("legob") || combined.includes("lego")) return "legobii";
  return null;
}
