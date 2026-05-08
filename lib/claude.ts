/**
 * lib/claude.ts
 *
 * Sends the action item + full conversation to Claude.
 * Claude decides: did the guest actually ask for someone to come out?
 * If yes, routes to SMS + Asana. If no, does nothing.
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildTeamContext, PROPERTIES } from "./team";
import type { Decision, HostbuddyActionItem, HospitableMessage } from "./types";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an issue router for Dwellia, a premium family vacation rental company.

HostbuddyAI has flagged an action item from a guest conversation. Your job is to read the full conversation and decide whether the guest has actually and explicitly asked for someone to physically come to the property.

IMPORTANT — only trigger if the guest clearly wants a visit:
- "Can someone come fix this?" → YES
- "Is there someone who can come look at this?" → YES
- "The AC is broken" (no request for visit) → NO
- "This is annoying" → NO
- Early check-in requests → NO (no physical visit needed)
- Questions that just need a text answer → NO

Two contacts:
- ryan: handles Delta Dawn
- amanda: handles LeGobi

Always route to the contact matching the property.

SMS MESSAGE RULES:
- Under 160 characters
- Warm and direct, like texting a colleague
- Include: what the guest needs, property name
- Good: "Guest at Delta Dawn asking for someone to check the AC. Says it's not cooling."
- Bad: "A guest service request requires your immediate attention."

Respond ONLY with valid JSON, no markdown:
{
  "guest_requesting_visit": boolean,
  "send_sms": boolean,
  "sms_to_key": "ryan or amanda or null",
  "sms_message": "message text",
  "send_call": boolean,
  "call_to_key": "ryan or amanda or null",
  "create_task": boolean,
  "task_title": "short title",
  "task_description": "full description",
  "task_priority": "low|medium|high",
  "task_assignee_key": "ryan or amanda or null",
  "reasoning": "one sentence"
}`;

export async function getRoutingDecision(
  actionItem: HostbuddyActionItem,
  messages: HospitableMessage[]
): Promise<Decision> {
  const teamContext = buildTeamContext();

  // Format conversation for Claude
  const conversation = messages.length
    ? messages.map((m) => `[${m.author}]: ${m.body}`).join("\n")
    : "No conversation messages available.";

  const userMessage = `${teamContext}

ACTION ITEM FROM HOSTBUDDYAI:
  property: ${actionItem.property_alias} (${actionItem.property_name})
  guest: ${actionItem.guest_name}
  category: ${actionItem.category}
  item: ${actionItem.item}
  created_at: ${actionItem.created_at_utc}

FULL CONVERSATION FROM HOSPITABLE:
${conversation}

Based on the conversation above, did the guest explicitly ask for someone to physically come to the property? Route accordingly.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const raw =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  let decision: Decision;
  try {
    decision = JSON.parse(cleaned) as Decision;
  } catch {
    console.error("[Claude] Failed to parse response:", raw);
    throw new Error(`Claude returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  if (typeof decision.guest_requesting_visit !== "boolean") {
    throw new Error("Claude decision missing required fields");
  }

  return decision;
}
