/**
 * api/summarize-issues.ts
 *
 * Called by the dashboard to summarize issue clusters using Claude.
 * POST { groups: string[][] } → { labels: string[] }
 */

import Anthropic from "@anthropic-ai/sdk";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { groups } = req.body as { groups: string[][] };

  if (!groups || !groups.length) {
    res.status(400).json({ error: "Missing groups" });
    return;
  }

  const prompt = `You are summarizing vacation rental guest issues for an operations dashboard.

For each group of related issues below, write a clear 4-7 word summary that describes the problem pattern in plain English. Be specific and useful — not generic.

Good examples:
- "Hot tub not reaching temperature"
- "Insufficient towels for group size"  
- "Arcade game controls not working"
- "WiFi connectivity dropping intermittently"
- "Master bathroom cleanliness concerns"

Bad examples (too vague):
- "Guest reported issue"
- "Maintenance needed"
- "Supply problem"

Groups:
${groups.map(function(g, i) { return (i + 1) + '. ' + g.join(' | '); }).join('\n')}

Respond ONLY with a JSON array of strings, one per group, no explanation, no markdown.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "[]";
    const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
    const labels = JSON.parse(cleaned);

    res.status(200).json({ labels });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Summarize] Error:", msg);
    res.status(500).json({ error: msg });
  }
}
