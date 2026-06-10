/**
 * lib/checkinout.ts
 *
 * Processes pending early check-in / late checkout requests.
 * Called by the GitHub Action every 5 minutes via /api/process-pending.
 * Also handles Ryan/Amanda reply via /api/quo-webhook.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  getReservationDetails,
  hasSameDayTurnover,
  sendGuestMessage,
  updateReservationTime,
} from "./hospitable";
import { sendSMS } from "./quo";
import { TEAM, PROPERTIES } from "./team";
import { resolvePropertyId } from "./pipeline";
import { markCheckInOutProcessed, updatePendingFee } from "./db";
import type { PendingCheckInOut } from "./types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BUSINESS_PHONE = "+18652811917";
const STANDARD_CHECKIN = "16:00";   // 4pm
const STANDARD_CHECKOUT = "10:00";  // 10am

// ── Main processor (called by GitHub Action) ──────────────────────────────────

export async function processCheckInOut(pending: PendingCheckInOut): Promise<void> {
  console.log(`[CheckInOut] Processing ${pending.type} for ${pending.guest_name} at ${pending.property_alias}`);

  const propertyId = resolvePropertyId(pending.property_alias, pending.property_id);
  const property = propertyId ? PROPERTIES[propertyId] : null;
  const housekeeper = property ? TEAM[property.contactKey] : null;

  const reservation = await getReservationDetails(pending.reservation_id);
  if (!reservation) {
    console.error(`[CheckInOut] Could not fetch reservation ${pending.reservation_id}`);
    return;
  }

  const checkDate = pending.type === "early_checkin" ? reservation.checkin : reservation.checkout;
  const sameDayTurnover = await hasSameDayTurnover(
    reservation.property_id || propertyId || "",
    checkDate,
    pending.type
  );

  console.log(`[CheckInOut] Same-day turnover: ${sameDayTurnover}`);

  if (pending.type === "early_checkin") {
    await handleEarlyCheckin(pending, reservation, sameDayTurnover, housekeeper, property);
  } else {
    await handleLateCheckout(pending, reservation, sameDayTurnover, housekeeper, property);
  }
}

// ── Early check-in ────────────────────────────────────────────────────────────

async function handleEarlyCheckin(
  pending: PendingCheckInOut,
  reservation: any,
  sameDayTurnover: boolean,
  housekeeper: any,
  property: any
): Promise<void> {
  if (sameDayTurnover) {
    // Message guest — can't guarantee but will try
    await sendGuestMessage(
      pending.reservation_id,
      `Hi ${pending.guest_first_name}! We do have a checkout that morning so we can't guarantee early access, but if our housekeeping team finishes ahead of schedule we'll get you in right away. We'll keep you posted!`
    );

    // SMS housekeeper
    if (housekeeper?.phone) {
      await sendSMS(
        housekeeper.phone,
        `*AI Msg* Hi! The guest at ${pending.property_alias} is requesting early check-in. We told them we have a same-day checkout and made no promises, but please let us know when you finish and we'll send them right in. Thank you!`
      );
    }

    // Mark as awaiting_cleaner so the reply webhook can find it
    await markCheckInOutProcessed(pending.id, "awaiting_cleaner" as any);
    console.log(`[CheckInOut] Same-day early check-in — awaiting cleaner reply`);
    return;
  }

  // No conflict — text cleaner immediately, store requested time and fee, await reply
  const claudeDecision = await getCheckInOutDecision(pending, "early_checkin");
  const { requestedTime, hoursEarly, fee } = claudeDecision;

  // Build cleaner SMS — include requested time if guest mentioned one
  const timeNote = requestedTime
    ? ` They mentioned hoping to arrive around ${formatTime(requestedTime)}.`
    : "";

  if (housekeeper?.phone) {
    await sendSMS(
      housekeeper.phone,
      `*AI Msg* Hi! ${pending.guest_name} at ${pending.property_alias} is requesting early check-in.${timeNote} Is the property ready now, or what time do you estimate it'll be ready? Please reply with a time or "ready now".`
    );
  }

  // Store the requested time and calculated fee so reply handler can use them
  if (requestedTime) {
    await updatePendingFee(pending.id, requestedTime, fee);
  }

  // Mark as awaiting_cleaner
  await markCheckInOutProcessed(pending.id, "awaiting_cleaner" as any);
  console.log(`[CheckInOut] Non-back-to-back early check-in — texted cleaner, awaiting reply`);
}

// ── Late checkout ─────────────────────────────────────────────────────────────

async function handleLateCheckout(
  pending: PendingCheckInOut,
  reservation: any,
  sameDayTurnover: boolean,
  housekeeper: any,
  property: any
): Promise<void> {
  if (sameDayTurnover) {
    await sendGuestMessage(
      pending.reservation_id,
      `Hi ${pending.guest_first_name}! Unfortunately we aren't able to accommodate a late checkout that day as we have guests checking in. We hope you had a wonderful stay and we'd love to host you again!`
    );
    console.log(`[CheckInOut] Late checkout declined — same-day check-in`);
    return;
  }

  const claudeDecision = await getCheckInOutDecision(pending, "late_checkout");
  const { requestedTime, hoursLate, fee } = claudeDecision;

  if (!requestedTime) {
    await sendGuestMessage(
      pending.reservation_id,
      `Hi ${pending.guest_first_name}! We'd love to let you stay a little longer — it's $25 per hour past 10am. What time were you hoping to check out?`
    );
    console.log(`[CheckInOut] Asked guest for requested checkout time`);
    return;
  }

  await updateReservationTime(pending.reservation_id, "checkout", requestedTime);

  await sendGuestMessage(
    pending.reservation_id,
    `Hi ${pending.guest_first_name}! You're all set for a ${formatTime(requestedTime)} checkout. The late checkout fee is $${fee} ($25/hr). We'll send a payment request shortly!`
  );

  if (housekeeper?.phone) {
    await sendSMS(housekeeper.phone, `*AI Msg* Heads up — ${pending.property_alias} checkout moved to ${formatTime(requestedTime)} (${pending.guest_name}).`);
  }

  await sendSMS(
    BUSINESS_PHONE,
    `*AI Msg* Late checkout approved for ${pending.guest_name} at ${pending.property_alias} — ${formatTime(requestedTime)} (${hoursLate}hr${hoursLate > 1 ? "s" : ""}, $${fee}). Send payment request: https://www.airbnb.com/hosting/stay/${pending.reservation_id}`
  );

  console.log(`[CheckInOut] Late checkout processed — ${requestedTime}, fee: $${fee}`);
}

// ── Cleaner reply handler (called by /api/quo-webhook) ───────────────────────

/**
 * Ryan or Amanda replied to the early check-in SMS.
 * Read their message to determine when the house is ready.
 * Update the reservation, message the guest, SMS business if fee applies.
 */
export async function handleCleanerReply(
  replyText: string,
  fromPhone: string,
  pending: PendingCheckInOut & { requested_time: string | null; fee: number }
): Promise<void> {
  console.log(`[CheckInOut] Cleaner reply received: "${replyText}"`);

  // Ask Claude to classify the reply and extract time if present
  const prompt = `A vacation rental housekeeper sent this reply about property readiness:
"${replyText}"

Current time (Eastern): ${getCurrentTimeET()}
Standard check-in time: 4:00pm

Classify this reply:
1. READY — property is ready now (e.g. "done", "ready", "finished", "all set", "good to go", "they can come")
2. ESTIMATE — giving an estimated ready time (e.g. "about 2pm", "another hour", "30 more minutes", "around 1:30")

If ESTIMATE, extract the estimated time in HH:MM 24hr format.
If READY, use the current time rounded down to nearest hour.

Then calculate:
- Early check-in is FREE if less than 1 full hour before 4pm (i.e. after 3pm)  
- $25 per full hour before 3pm (rounded down)
- Examples: ready at 2pm = 2 hours early = $50. Ready at 3:30pm = free. Ready at 1pm = 3 hours early = $75.

Respond ONLY with valid JSON:
{
  "classification": "READY or ESTIMATE",
  "readyTime": "HH:MM",
  "hoursEarly": number,
  "fee": number
}`;

  let classification = "READY";
  let readyTime = getCurrentTimeRoundedDown();
  let hoursEarly = 0;
  let fee = pending.fee ?? 0;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    classification = parsed.classification ?? "READY";
    readyTime = parsed.readyTime ?? readyTime;
    hoursEarly = parsed.hoursEarly ?? 0;
    fee = parsed.fee ?? fee;
  } catch (err) {
    console.error("[CheckInOut] Claude reply parse error:", err);
  }

  console.log(`[CheckInOut] Reply classified as ${classification}, time: ${readyTime}, fee: $${fee}`);

  if (classification === "ESTIMATE") {
    // Tell guest estimated time — don't update lock yet
    await sendGuestMessage(
      pending.reservation_id,
      `Hi ${pending.guest_first_name}! Our housekeeping team estimates the property will be ready around ${formatTime(readyTime)}. We'll send you a confirmation as soon as it's done!`
    );
    // Store the updated estimate — stay awaiting_cleaner for the next reply
    await updatePendingFee(pending.id, readyTime, fee);
    console.log(`[CheckInOut] Estimate sent to guest — still awaiting final ready confirmation`);
    return;
  }

  // READY — update reservation, message guest, SMS business if fee applies
  await updateReservationTime(pending.reservation_id, "checkin", readyTime);

  await sendGuestMessage(
    pending.reservation_id,
    `Hi ${pending.guest_first_name}! Great news, the housekeeping team is finished — you're welcome to head over whenever you're ready!`
  );

  if (fee > 0) {
    const reservationDetails = await import("./hospitable").then(h => h.getReservationDetails(pending.reservation_id));
    const airbnbCode = reservationDetails?.airbnb_code ?? pending.reservation_id;
    await sendSMS(
      BUSINESS_PHONE,
      `*AI Msg* Early check-in fee due for ${pending.guest_name} at ${pending.property_alias} — checked in at ${formatTime(readyTime)} (${hoursEarly}hr${hoursEarly > 1 ? "s" : ""}, $${fee}). Send payment request: https://www.airbnb.com/hosting/stay/${airbnbCode}`
    );
  }

  await markCheckInOutProcessed(pending.id, "processed");
  console.log(`[CheckInOut] Cleaner confirmed ready — guest notified, reservation updated, fee: $${fee}`);
}

// ── Claude time extraction ────────────────────────────────────────────────────

async function getCheckInOutDecision(
  pending: PendingCheckInOut,
  type: "early_checkin" | "late_checkout"
): Promise<{ requestedTime: string | null; hoursEarly: number; hoursLate: number; fee: number }> {
  const prompt = `A guest at a vacation rental has requested ${type === "early_checkin" ? "early check-in" : "late checkout"}.
Standard ${type === "early_checkin" ? "check-in" : "checkout"} time is ${type === "early_checkin" ? "4:00pm" : "10:00am"}.

Guest request text: "${pending.action_item}"

Did the guest specify a specific time? If yes, extract it. If no, return null.

Rules:
- Early check-in: free if less than 1 hour before 4pm. $25/hr rounded down for each full hour before 3pm.
- Late checkout: $25/hr for any full hour past 10am, rounded down.
- Times in HH:MM 24hr format.

Respond ONLY with valid JSON:
{
  "requestedTime": "HH:MM or null",
  "hoursEarly": number,
  "hoursLate": number,
  "fee": number
}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { requestedTime: null, hoursEarly: 0, hoursLate: 0, fee: 0 };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")}${period}`;
}

function getCurrentTimeET(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getCurrentTimeRoundedDown(): string {
  const now = new Date();
  const etHour = parseInt(
    now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })
  );
  return `${etHour.toString().padStart(2, "0")}:00`;
}
