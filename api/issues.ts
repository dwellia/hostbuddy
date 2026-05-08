/**
 * api/issues.ts
 *
 * Returns all issue records + metrics as JSON.
 * Used by the dashboard page.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAllIssues, buildMetrics } from "../lib/db";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const issues = await getAllIssues();
    const metrics = buildMetrics(issues);
    res.status(200).json({ metrics, issues });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Issues API] Error:", msg);
    res.status(500).json({ error: msg });
  }
}
