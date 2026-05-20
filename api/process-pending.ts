/**
 * api/process-pending.ts
 *
 * Called by GitHub Action every 5 minutes.
 * Processes any pending check-in/out requests that are ready.
 *
 * Protected by a simple shared secret to prevent unauthorized calls.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPendingCheckInOuts, markCheckInOutProcessed } from "../lib/db";
import { processCheckInOut } from "../lib/checkinout";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Simple secret to prevent unauthorized calls
  const secret = req.headers["x-cron-secret"];
  if (secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const pending = await getPendingCheckInOuts();
    console.log(`[ProcessPending] Found ${pending.length} pending check-in/out requests`);

    let processed = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        await processCheckInOut(item);
        await markCheckInOutProcessed(item.id, "processed");
        processed++;
      } catch (err) {
        console.error(`[ProcessPending] Failed to process ${item.id}:`, err);
        await markCheckInOutProcessed(item.id, "failed");
        failed++;
      }
    }

    console.log(`[ProcessPending] Done: ${processed} processed, ${failed} failed`);
    res.status(200).json({ status: "ok", processed, failed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ProcessPending] Error:", msg);
    res.status(500).json({ error: msg });
  }
}
