/**
 * api/hostbuddy-webhook.ts
 *
 * Receives POST requests from HostbuddyAI.
 * Returns HTTP 200 immediately, runs pipeline async.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { processIssue } from "../lib/pipeline";
import type { HostbuddyPayload } from "../lib/types";

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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let payload: unknown;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  if (!validatePayload(payload)) {
    console.error("[Webhook] Invalid payload:", payload);
    res.status(400).json({ error: "Missing required fields in payload" });
    return;
  }

  // Return 200 immediately so HostbuddyAI doesn't retry
  res.status(200).json({ status: "queued" });

  // Run pipeline async
  processIssue(payload).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Webhook] Pipeline error:", msg);

    // Fallback: SMS Ryan if pipeline fails
    import("../lib/quo").then(({ sendSMS }) => {
      const phone = process.env.RYAN_PHONE;
      if (phone) {
        sendSMS(phone, `HostbuddyAI alert failed to process: ${payload.issue_type} at ${payload.property_id}. Check system.`).catch(() => {});
      }
    }).catch(() => {});
  });
}
