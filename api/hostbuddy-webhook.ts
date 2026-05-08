/**
 * api/hostbuddy-webhook.ts
 *
 * Receives POST requests from HostbuddyAI.
 * Returns HTTP 200 immediately (so HostbuddyAI doesn't retry).
 * Runs the Claude → Quo → Asana pipeline asynchronously.
 *
 * Webhook URL to paste into HostbuddyAI:
 *   https://your-vercel-domain.vercel.app/api/hostbuddy-webhook
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { processIssue } from "../lib/pipeline";
import type { HostbuddyPayload } from "../lib/types";

// ── Signature verification ────────────────────────────────────────────────────
//
// HostbuddyAI signs each webhook with HMAC-SHA256 using your shared secret.
// We verify before doing anything else.
// If HOSTBUDDY_WEBHOOK_SECRET is not set, verification is skipped
// (useful for local testing, not for production).

function verifySignature(rawBody: string, signature: string): boolean {
  const secret = process.env.HOSTBUDDY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[Webhook] HOSTBUDDY_WEBHOOK_SECRET not set — skipping verification");
    return true;
  }

  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Payload validation ────────────────────────────────────────────────────────

function validatePayload(body: unknown): body is HostbuddyPayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.issue_type === "string" &&
    typeof b.severity === "string" &&
    ["low", "medium", "high", "critical"].includes(b.severity) &&
    typeof b.property_id === "string" &&
    typeof b.description === "string" &&
    typeof b.guest_present === "boolean" &&
    typeof b.timestamp === "string"
  );
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only accept POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Get raw body string for signature verification
  const rawBody =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body);

  // Verify signature
  const signature =
    (req.headers["x-hostbuddy-signature"] as string) || "";
  if (!verifySignature(rawBody, signature)) {
    console.error("[Webhook] Signature mismatch — rejecting request");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Parse body
  let payload: unknown;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  // Validate shape
  if (!validatePayload(payload)) {
    console.error("[Webhook] Invalid payload shape:", payload);
    res.status(400).json({ error: "Missing required fields in payload" });
    return;
  }

  // Return 200 immediately — HostbuddyAI won't retry
  res.status(200).json({ status: "queued" });

  // Run pipeline async (fire and forget — Vercel keeps function alive for maxDuration)
  processIssue(payload).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Webhook] Pipeline error:", msg);

    // Fallback: try to SMS the owner so nothing goes completely silent
    import("../lib/quo").then(({ sendSMS }) => {
      const ownerPhone =
        process.env.OWNER_JOHN_PHONE || process.env.OWNER_SARAH_PHONE;
      if (ownerPhone) {
        sendSMS(
          ownerPhone,
          `HostbuddyAI alert failed to process: ${payload.issue_type} at ${payload.property_id}. Check system.`
        ).catch(() => {});
      }
    }).catch(() => {});
  });
}
