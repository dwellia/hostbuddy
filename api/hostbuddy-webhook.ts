/**
 * api/hostbuddy-webhook.ts
 *
 * Receives POST requests from HostbuddyAI.
 * Runs pipeline first, then returns 200.
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

  // Run pipeline first, then respond
  try {
    await processIssue(payload);
    res.status(200).json({ status: "ok" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Webhook] Pipeline error:", msg);
    res.status(200).json({ status: "error", message: msg });
  }
}
