/**
 * api/hostbuddy-webhook.ts
 *
 * Receives POST requests from HostbuddyAI action item webhooks.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { processWebhook } from "../lib/pipeline";
import type { HostbuddyPayload } from "../lib/types";

function validatePayload(body: unknown): body is HostbuddyPayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.hook_id === "string" &&
    typeof b.hook_type === "string" &&
    Array.isArray(b.action_items) &&
    b.action_items.length > 0
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
    console.error("[Webhook] Invalid payload:", JSON.stringify(payload).slice(0, 200));
    res.status(400).json({ error: "Invalid payload shape" });
    return;
  }

  try {
    const results = await processWebhook(payload);
    const acted = results.filter((r) => !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    console.log(`[Webhook] Done: ${acted} acted, ${skipped} skipped`);
    res.status(200).json({ status: "ok", acted, skipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Webhook] Error:", msg);
    res.status(200).json({ status: "error", message: msg });
  }
}
