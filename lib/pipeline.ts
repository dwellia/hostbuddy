/**
 * lib/pipeline.ts
 */

import { getRoutingDecision } from "./claude";
import { getReservationMessages, getCheckoutDate, getReservationDetails, getPaymentRequestUrl } from "./hospitable";
import { sendSMS, sendUrgentCallSMS } from "./quo";
import { createTask } from "./asana";
import { saveIssue, savePendingCheckInOut } from "./db";
import { TEAM, PROPERTIES, STR_TASKS_PROJECT_GID, STR_TASKS_JORDAN_SECTION_GID, JORDAN_USER_GID } from "./team";
import type { HostbuddyActionItem, HostbuddyPayload, PipelineResult } from "./types";
import { randomUUID } from "crypto";

// Categories that should SMS Ryan/Amanda
const HOUSEKEEPER_SMS_CATEGORIES = ["MAINTENANCE", "SUPPLY", "CLEANLINESS"];

// Business number for payment request reminders
const BUSINESS_PHONE = "+18652811917";

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

  // ── Check-in/out requests: save as pending, GitHub Action processes after delay
  const isCheckInOut = isCheckInOutRequest(actionItem.item);
  if (isCheckInOut) {
    return await handleCheckInOutRequest(actionItem, isCheckInOut);
  }

  // ── Pet fee detection — check before skipping reservation changes
  if (isPetFeeRequest(actionItem.item)) {
    return await handlePetFeeRequest(actionItem);
  }

  // ── Skip other reservation changes
  const SKIP_CATEGORIES = ["RESERVATION CHANGES"];
  if (SKIP_CATEGORIES.includes(actionItem.category)) {
    console.log(`[Pipeline] Skipping category: ${actionItem.category}`);
    return { skipped: true, skip_reason: `Category "${actionItem.category}" is excluded`, decision: undefined };
  }

  // ── Standard issue pipeline ──────────────────────────────────────────────────

  let messages = [];
  let checkoutDate: string | null = null;

  try {
    [messages, checkoutDate] = await Promise.all([
      getReservationMessages(actionItem.reservation_id),
      getCheckoutDate(actionItem.reservation_id),
    ]);
  } catch (err) {
    console.error(`[Pipeline] Hospitable fetch failed: ${err instanceof Error ? err.message : err}`);
  }

  const decision = await getRoutingDecision(actionItem, messages);
  console.log(`[Pipeline] Decision: ${decision.reasoning} | type: ${decision.task_type}`);

  const propertyId = resolvePropertyId(actionItem.property_alias, actionItem.property_name);
  const property = propertyId ? PROPERTIES[propertyId] : null;
  const result: PipelineResult = { decision };

  if (!decision.guest_requesting_visit && !decision.issue_needs_attention) {
    console.log("[Pipeline] No action needed — skipping");
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
      task_type: "none",
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

  const today = new Date().toISOString().slice(0, 10);
  const dueDate = decision.task_type === "next_clean" && checkoutDate
    ? checkoutDate
    : today;

  console.log(`[Pipeline] Task type: ${decision.task_type}, due: ${dueDate}`);

  let taskId: string | null = null;
  let taskUrl: string | null = null;
  let taskCreated = false;

  if (decision.create_task) {
    // Use Claude's corrected category for routing — it may fix HostbuddyAI misclassifications
    const effectiveCategory = decision.corrected_category || actionItem.category;

    // Housekeeper categories → property Asana project (Ryan/Amanda)
    // Everything else → STR Tasks → Jordan section
    const isHousekeeperTask = HOUSEKEEPER_SMS_CATEGORIES.includes(effectiveCategory);

    const projectGid = isHousekeeperTask
      ? property?.asanaProjectId || ""
      : STR_TASKS_PROJECT_GID;

    const sectionGid = isHousekeeperTask
      ? property?.asanaSectionId || null
      : STR_TASKS_JORDAN_SECTION_GID;

    const assignee = isHousekeeperTask
      ? (decision.task_assignee_key ? TEAM[decision.task_assignee_key] : null)
      : null; // Jordan is assigned via section, not by user GID

    if (projectGid) {
      result.task = await createTask({
        title: decision.task_title,
        description: [
          decision.task_description,
          "",
          `Guest: ${actionItem.guest_name}`,
          `Reservation: ${actionItem.reservation_id}`,
          `Property: ${actionItem.property_alias}`,
          `Task Type: ${decision.task_type === "urgent" ? "URGENT — visit required" : "NEXT CLEAN — address at turnover"}`,
          `Source: HostbuddyAI`,
        ].join("\n"),
        priority: decision.task_priority,
        assigneeGid: assignee?.asanaUserId || null,
        projectGid,
        sectionGid,
        dueDate,
      });
      taskCreated = result.task.success;
      taskId = result.task.taskId ?? null;
      taskUrl = result.task.taskUrl ?? null;
    }
  }

  let smsSent = false;
  let notifiedContact: string | null = null;

  // Use Claude's corrected category for SMS routing
  const effectiveCategoryForSms = decision.corrected_category || actionItem.category;
  const shouldSmsHousekeeper = HOUSEKEEPER_SMS_CATEGORIES.includes(effectiveCategoryForSms);

  if (shouldSmsHousekeeper && decision.send_sms && decision.sms_to_key) {
    const recipient = TEAM[decision.sms_to_key];
    if (recipient?.phone) {
      const fullMessage = taskUrl
        ? `${decision.sms_message}\n${taskUrl}`
        : decision.sms_message;
      result.sms = await sendSMS(recipient.phone, fullMessage);
      smsSent = result.sms.success;
      notifiedContact = recipient.name;
    }
  }

  if (decision.send_call && decision.call_to_key) {
    const recipient = TEAM[decision.call_to_key];
    if (recipient?.phone) {
      const context = `${actionItem.category} at ${actionItem.property_alias}.`;
      result.call = await sendUrgentCallSMS(recipient.phone, context);
    }
  }

  await saveIssue({
    id: randomUUID(),
    timestamp: actionItem.created_at_utc || new Date().toISOString(),
    property: actionItem.property_alias,
    property_id: propertyId ?? "unknown",
    guest_name: actionItem.guest_name,
    reservation_id: actionItem.reservation_id,
    category: actionItem.category,
    action_item: actionItem.item,
    guest_requested_visit: decision.guest_requesting_visit,
    task_type: decision.task_type,
    sms_sent: smsSent,
    task_created: taskCreated,
    asana_task_id: taskId,
    asana_task_url: taskUrl,
    claude_reasoning: decision.reasoning,
    conversation_length: messages.length,
    notified_contact: notifiedContact,
  });

  console.log("[Pipeline] Done:", {
    type: decision.task_type,
    dueDate,
    sms: result.sms?.success ?? "skipped",
    task: result.task?.success ?? "skipped",
  });

  return result;
}

/** Detect if an action item is an early check-in or late checkout request */
function isCheckInOutRequest(
  item: string
): "early_checkin" | "late_checkout" | null {
  const lower = item.toLowerCase();

  if (
    lower.includes("early check") ||
    lower.includes("check in early") ||
    lower.includes("check-in early") ||
    lower.includes("early arrival") ||
    lower.includes("arrive early") ||
    lower.includes("drop our bag") ||
    lower.includes("drop bags") ||
    lower.includes("drop luggage") ||
    lower.includes("drop our stuff") ||
    lower.includes("drop our things") ||
    lower.includes("already here") ||
    lower.includes("already in town") ||
    lower.includes("already arrived") ||
    lower.includes("just arrived") ||
    lower.includes("just got here") ||
    lower.includes("head over early") ||
    lower.includes("get in early") ||
    lower.includes("come early") ||
    lower.includes("check inn") ||
    lower.includes("see if we could check") ||
    lower.includes("in before") ||
    lower.includes("in earlier") ||
    lower.includes("available early") ||
    lower.includes("ready early")
  ) {
    return "early_checkin";
  }

  if (
    lower.includes("late check") ||
    lower.includes("check out late") ||
    lower.includes("check-out late") ||
    lower.includes("late departure") ||
    lower.includes("stay later") ||
    lower.includes("leave late") ||
    lower.includes("late checkout") ||
    lower.includes("later checkout") ||
    lower.includes("stay a bit longer") ||
    lower.includes("stay longer") ||
    lower.includes("few extra hours") ||
    lower.includes("extra hour") ||
    lower.includes("out later") ||
    lower.includes("leave later") ||
    lower.includes("check out a little") ||
    lower.includes("push checkout") ||
    lower.includes("extend checkout") ||
    lower.includes("extend our stay")
  ) {
    return "late_checkout";
  }

  return null;
}

/** Detect if an action item mentions a pet fee */
function isPetFeeRequest(item: string): boolean {
  const lower = item.toLowerCase();
  return (
    (lower.includes("pet") || lower.includes("dog") || lower.includes("cat") ||
     lower.includes("animal")) &&
    (lower.includes("fee") || lower.includes("charge") || lower.includes("pay") ||
     lower.includes("cost") || lower.includes("bring") || lower.includes("staying") ||
     lower.includes("with us") || lower.includes("coming"))
  );
}

/** Handle pet fee — alert business with platform-specific payment link */
async function handlePetFeeRequest(
  actionItem: HostbuddyActionItem
): Promise<PipelineResult> {
  console.log(`[Pipeline] Pet fee request detected`);

  // Fetch reservation to get platform
  let paymentUrl = `https://app.hospitable.com/conversations/${actionItem.reservation_id}`;
  let platformLabel = "hosting platform";

  try {
    const reservation = await getReservationDetails(actionItem.reservation_id);
    if (reservation) {
      paymentUrl = getPaymentRequestUrl(
        actionItem.reservation_id,
        reservation.platform,
        reservation.airbnb_code,
        reservation.platform_reservation_id
      );
      platformLabel = reservation.platform === "unknown" ? "hosting platform" : reservation.platform;
    }
  } catch (err) {
    console.error(`[Pipeline] Failed to fetch reservation for pet fee:`, err);
  }

  // SMS business number with payment link
  const propertyId = resolvePropertyId(actionItem.property_alias, actionItem.property_name);
  await sendSMS(
    BUSINESS_PHONE,
    `*AI Msg* Pet fee needed for ${actionItem.guest_name} at ${actionItem.property_alias} ($150). Send payment request on ${platformLabel}: ${paymentUrl}`
  );

  console.log(`[Pipeline] Pet fee alert sent to business number`);
  return { skipped: false, skip_reason: undefined, decision: undefined };
}

/** Save check-in/out request as pending for delayed processing */
async function handleCheckInOutRequest(
  actionItem: HostbuddyActionItem,
  type: "early_checkin" | "late_checkout"
): Promise<PipelineResult> {
  console.log(`[Pipeline] Check-in/out request detected: ${type}`);

  const propertyId = resolvePropertyId(actionItem.property_alias, actionItem.property_name);
  const firstName = actionItem.guest_name.split(" ")[0];

  // Process after 7 minutes
  const processAfter = new Date(Date.now() + 7 * 60 * 1000).toISOString();

  await savePendingCheckInOut({
    id: randomUUID(),
    created_at: new Date().toISOString(),
    process_after: processAfter,
    status: "pending",
    type,
    reservation_id: actionItem.reservation_id,
    property_id: propertyId ?? "unknown",
    property_alias: actionItem.property_alias,
    guest_name: actionItem.guest_name,
    guest_first_name: firstName,
    action_item: actionItem.item,
  });

  console.log(`[Pipeline] Saved pending ${type} for processing after ${processAfter}`);
  return { skipped: true, skip_reason: `Check-in/out request queued for delayed processing`, decision: undefined };
}

export function resolvePropertyId(alias: string, name: string): string | null {
  const combined = `${alias} ${name}`.toLowerCase();
  if (combined.includes("delta") || combined.includes("dawn")) return "delta-dawn";
  if (combined.includes("legob") || combined.includes("lego")) return "legobii";
  return null;
}
