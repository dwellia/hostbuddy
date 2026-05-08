/**
 * api/debug-blob.ts
 * Temporary debug endpoint — delete after fixing
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { list } from "@vercel/blob";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  try {
    const result = await list({ token: process.env.BLOB_READ_WRITE_TOKEN });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
