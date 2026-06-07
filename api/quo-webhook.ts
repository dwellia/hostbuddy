/**
 * api/quo-webhook.ts
 *
 * Receives incoming SMS messages from Quo (OpenPhone).
 * Handles Ryan/Amanda replies to early check-in SMS — sends guest all-clear.
 *
 * POST /api/quo-webhook
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TEAM, PROPERTIES } from "../lib/team";
import { getOpenSameDayCheckin } from "../lib/db";
import { handleCleanerReply } from "../lib/checkinout";

// Keywords that indicate the house is ready
const READY_KEYWORDS = [
  "done", "ready", "finished", "complete", "all set", "good to go",
  "they can come", "send them", "clean", "wrapped up", "just finished",
  "all done", "we're done", "we are done"
];

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body as any;
    console.log("[QuoWebhook] Incoming:", JSON.stringify(body).slice(0, 300));

    // Quo sends different payload shapes — handle both
    const messageData = body?.data ?? body;
    const fromPhone = messageData?.from ?? messageData?.phoneNumber ?? "";
    const messageText = (messageData?.body ?? messageData?.text ?? messageData?.content ?? "").toLowerCase().trim();
    const direction = messageData?.direction ?? "incoming";

    // Only process incoming messages
    if (direction !== "incoming") {
      res.status(200).json({ status: "ignored", reason: "outgoing message" });
      return;
    }

    console.log(`[QuoWebhook] From: ${fromPhone}, Text: "${messageText}"`);

    // Check if this is from Ryan or Amanda
    const ryanPhone = (process.env.RYAN_PHONE || "").replace(/\D/g, "");
    const amandaPhone = (process.env.AMANDA_PHONE || "").replace(/\D/g, "");
    const fromClean = fromPhone.replace(/\D/g, "");

    let contactKey: string | null = null;
    let propertyId: string | null = null;

    if (fromClean.endsWith(ryanPhone) || ryanPhone.endsWith(fromClean)) {
      contactKey = "ryan";
      propertyId = "delta-dawn";
    } else if (fromClean.endsWith(amandaPhone) || amandaPhone.endsWith(fromClean)) {
      contactKey = "amanda";
      propertyId = "legobii";
    }

    if (!contactKey || !propertyId) {
      console.log("[QuoWebhook] Message not from Ryan or Amanda — ignoring");
      res.status(200).json({ status: "ignored", reason: "unknown sender" });
      return;
    }

    // Check if message contains a ready keyword
    const isReadyMessage = READY_KEYWORDS.some((kw) => messageText.includes(kw));

    if (!isReadyMessage) {
      console.log("[QuoWebhook] Message doesn't indicate readiness — ignoring");
      res.status(200).json({ status: "ignored", reason: "not a ready message" });
      return;
    }

    // Find the open same-day early check-in for their property
    const pending = await getOpenSameDayCheckin(propertyId);

    if (!pending) {
      console.log(`[QuoWebhook] No open same-day check-in found for ${propertyId}`);
      res.status(200).json({ status: "ignored", reason: "no open check-in found" });
      return;
    }

    console.log(`[QuoWebhook] Found open check-in for ${pending.guest_name} — processing reply`);

    // Handle the reply — update lock, message guest, SMS business if fee
    await handleCleanerReply(messageText, fromPhone, pending);

    res.status(200).json({ status: "ok", handled: pending.guest_name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[QuoWebhook] Error:", msg);
    res.status(500).json({ error: msg });
  }
}
