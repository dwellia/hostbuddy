/**
 * api/delete-issue.ts
 * DELETE /api/delete-issue?id=xxx
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { deleteIssue } from "../lib/db";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "DELETE") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const id = req.query.id as string;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }

  try {
    const ok = await deleteIssue(id);
    if (ok) {
      res.status(200).json({ status: "ok", deleted: id });
    } else {
      res.status(404).json({ error: "Issue not found or delete failed" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Delete] Error:", msg);
    res.status(500).json({ error: msg });
  }
}
