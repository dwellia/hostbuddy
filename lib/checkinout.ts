/**
 * lib/checkinout.ts
 *
 * Processes pending early check-in / late checkout requests.
 * Called by the GitHub Action every 5 minutes via /api/process-pending.
 *
 * Logic:
 * - Fetch reservation details from Hospitable
 * - Check for same-day turnover
 * - Send appropriate guest message via Hospitable
 * - SMS Ryan/Amanda (housekeeper)
 * - SMS business number if payment needed
 * - Update reservation time in Hospitable (updates smart lock automatically)
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
import type { PendingCheckInOut } from "./types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Business number that receives payment request reminders
const BUSINESS_PHONE = "+18652811917";

// Standard times
const STANDARD_CHECKIN = "16:00";   // 4pm
const STANDARD_CHECKOUT = "10:00";  // 10am

export async function processCheckInOut(pending: PendingCheckInOut): Promise<void> {
  console.log(`[CheckInOut] Processing ${pending.type} for ${pending.guest_name} at ${pending.property_alias}`);

  const propertyId = resolvePropertyId(pending.property_alias, pending.property_id);
  const property = propertyId ? PROPERTIES[propertyId] : null;
  const housekeeper = property ? TEAM[property.contactKey] : null;

  // Get reservation details
  const reservation = await getReservationDetails(pending.reservation_id);
  if (!reservation) {
    console.error(`[CheckInOut] Could not fetch reservation ${pending.reservation_id}`);
    return;
  }

  // Check for same-day turnover
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

async function handleEarlyCheckin(
  pending: PendingCheckInOut,
  reservation: any,
  sameDayTurnover: boolean,
  housekeeper: any,
  property: any
): Promise<void> {
  if (sameDayTurnover) {
    // ── Same-day checkout: can't guarantee, notify housekeeper ──────────────

    // Message to guest
    await sendGuestMessage(
      pending.reservation_id,
      `Hi ${pending.guest_first_name}! We do have a checkout that morning so we can't guarantee early access, but if our housekeeping team finishes ahead of schedule we'll get you in right away. We'll keep you posted!`
    );

    // SMS to housekeeper
    if (housekeeper?.phone) {
      await sendSMS(
        housekeeper.phone,
        `*AI Msg* Hi! The guest at ${pending.property_alias} is requesting early check-in. We told them we have a same-day checkout and made no promises, but please let us know when you finish and we'll send them right in. Thank you!`
      );
    }

    console.log(`[CheckInOut] Same-day early check-in handled for ${pending.guest_name}`);
    return;
  }

  // ── No same-day conflict: use Claude to determine requested time and fee ──

  const claudeDecision = await getCheckInOutDecision(pending, "early_checkin");
  const { requestedTime, hoursEarly, fee } = claudeDecision;

  if (!requestedTime) {
    // Guest didn't specify a time yet — ask them
    await sendGuestMessage(
      pending.reservation_id,
      `Hi ${pending.guest_first_name}! We'd love to get you in early — check-ins up to 1 hour before 4pm are complimentary, and after that it's $25 per hour. What time were you hoping to check in?`
    );
    console.log(`[CheckInOut] Asked guest for requested time`);
    return;
  }

  // Update reservation time in Hospitable (smart lock updates automatically)
  await updateReservationTime(pending.reservation_id, "checkin", requestedTime);

  if (fee === 0) {
    // Free — confirm with guest, notify housekeeper
    await sendGuestMessage(
      pending.reservation_id,
      `Hi ${pending.guest_first_name}! Great news — we've got you set for a ${formatTime(requestedTime)} check-in, complimentary. See you then!`
    );

    if (housekeeper?.phone) {
      await sendSMS(
        housekeeper.phone,
        `*AI Msg* Heads up — ${pending.property_alias} check-in moved to ${formatTime(requestedTime)} (${pending.guest_name}).`
      );
    }
  } else {
    // Fee applies — confirm time, notify housekeeper, alert business for payment
    await sendGuestMessage(
      pending.reservation_id,
      `Hi ${pending.guest_first_name}! We've got you set for a ${formatTime(requestedTime)} check-in. The early check-in fee is $${fee} ($25/hr). We'll send a payment request shortly!`
    );

    if (housekeeper?.phone) {
      await sendSMS(
        housekeeper.phone,
        `*AI Msg* Heads up — ${pending.property_alias} check-in moved to ${formatTime(requestedTime)} (${pending.guest_name}).`
      );
    }

    // Alert business to send payment request
    const airbnbUrl = `https://www.airbnb.com/hosting/stay/${pending.reservation_id}`;
    await sendSMS(
      BUSINESS_PHONE,
      `*AI Msg* Early check-in approved for ${pending.guest_name} at ${pending.property_alias} — ${formatTime(requestedTime)} (${hoursEarly}hr${hoursEarly > 1 ? "s" : ""}, $${fee}). Send payment request: ${airbnbUrl}`
    );
  }

  console.log(`[CheckInOut] Early check-in processed — ${requestedTime}, fee: $${fee}`);
}

async function handleLateCheckout(
  pending: PendingCheckInOut,
  reservation: any,
  sameDayTurnover: boolean,
  housekeeper: any,
  property: any
): Promise<void> {
  if (sameDayTurnover) {
    // ── Same-day check-in: cannot accommodate late checkout ──────────────────
    await sendGuestMessage(
      pending.reservation_id,
      `Hi ${pending.guest_first_name}! Unfortunately we aren't able to accommodate a late checkout that day as we have guests checking in. We hope you had a wonderful stay and we'd love to host you again!`
    );
    console.log(`[CheckInOut] Late checkout declined — same-day check-in`);
    return;
  }

  // ── No same-day conflict: use Claude to determine requested time and fee ──

  const claudeDecision = await getCheckInOutDecision(pending, "late_checkout");
  const { requestedTime, hoursLate, fee } = claudeDecision;

  if (!requestedTime) {
    // Guest didn't specify a time yet — ask them
    await sendGuestMessage(
      pending.reservation_id,
      `Hi ${pending.guest_first_name}! We'd love to let you stay a little longer — it's $25 per hour past 10am. What time were you hoping to check out?`
    );
    console.log(`[CheckInOut] Asked guest for requested checkout time`);
    return;
  }

  // Update reservation time in Hospitable (smart lock updates automatically)
  await updateReservationTime(pending.reservation_id, "checkout", requestedTime);

  // Confirm with guest, notify housekeeper, alert business for payment
  await sendGuestMessage(
    pending.reservation_id,
    `Hi ${pending.guest_first_name}! You're all set for a ${formatTime(requestedTime)} checkout. The late checkout fee is $${fee} ($25/hr). We'll send a payment request shortly!`
  );

  if (housekeeper?.phone) {
    await sendSMS(
      housekeeper.phone,
      `*AI Msg* Heads up — ${pending.property_alias} checkout moved to ${formatTime(requestedTime)} (${pending.guest_name}).`
    );
  }

  // Alert business to send payment request
  const airbnbUrl = `https://www.airbnb.com/hosting/stay/${pending.reservation_id}`;
  await sendSMS(
    BUSINESS_PHONE,
    `*AI Msg* Late checkout approved for ${pending.guest_name} at ${pending.property_alias} — ${formatTime(requestedTime)} (${hoursLate}hr${hoursLate > 1 ? "s" : ""}, $${fee}). Send payment request: ${airbnbUrl}`
  );

  console.log(`[CheckInOut] Late checkout processed — ${requestedTime}, fee: $${fee}`);
}

/** Use Claude to extract the requested time from the action item text */
async function getCheckInOutDecision(
  pending: PendingCheckInOut,
  type: "early_checkin" | "late_checkout"
): Promise<{ requestedTime: string | null; hoursEarly: number; hoursLate: number; fee: number }> {
  const standardTime = type === "early_checkin" ? STANDARD_CHECKIN : STANDARD_CHECKOUT;
  const direction = type === "early_checkin" ? "early" : "late";

  const prompt = `A guest at a vacation rental has requested a ${type === "early_checkin" ? "early check-in" : "late checkout"}.
Standard ${type === "early_checkin" ? "check-in" : "checkout"} time is ${formatTime(standardTime)}.

Guest request text: "${pending.action_item}"

Did the guest specify a specific time they want to ${type === "early_checkin" ? "check in" : "check out"}?
If yes, extract it. If no, return null.

Rules:
- Early check-in: free if less than 1 hour before 4pm. $25/hr after that.
- Late checkout: $25/hr for any time past 10am. No free window.
- Times should be in HH:MM 24hr format

Respond with ONLY valid JSON:
{
  "requestedTime": "HH:MM or null",
  "hoursEarly": number (0 if not early checkin),
  "hoursLate": number (0 if not late checkout),
  "fee": number (total dollar amount)
}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { requestedTime: null, hoursEarly: 0, hoursLate: 0, fee: 0 };
  }
}

function formatTime(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")}${period}`;
}
