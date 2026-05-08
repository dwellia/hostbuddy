/**
 * lib/claude.ts
 *
 * Sends the HostbuddyAI issue to Claude and gets back a structured
 * routing decision.
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildTeamContext, PROPERTIES } from "./team";
import type { Decision, HostbuddyPayload } from "./types";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an issue router for Dwellia, a premium family vacation rental company.

Your job: analyze a maintenance or guest issue from HostbuddyAI and decide how to route it.

There are two contacts:
- ryan: receives all alerts for Delta Dawn
- amanda: receives all alerts for LeGobi

Always route to whichever contact matches the property. Never route to the wrong property's contact.

ROUTING RULES:
- LOW severity → create Asana task only, no SMS
- MEDIUM severity → SMS the contact + create Asana task
- HIGH severity → SMS the contact + create urgent Asana task
- CRITICAL severity → SMS the contact + send urgent follow-up (send_call=true) + create critical Asana task
- Safety issues (gas, fire, injury, electrical hazard) → always SMS + urgent regardless of severity level

SMS MESSAGE RULES:
- Under 160 characters
- Warm and direct — like texting a colleague, not a corporate alert
- Include: what's wrong, property name, any relevant context
- Good: "Hot tub stuck at 62° at Delta Dawn. Guest here tonight. Heating element maybe?"
- Bad: "An aquatic heating malfunction has been detected requiring immediate investigation."

Respond ONLY with valid JSON, no markdown:
{
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
  payload: HostbuddyPayload
): Promise<Decision> {
  const property = PROPERTIES[payload.property_id];
  const teamContext = buildTeamContext();

  const userMessage = `${teamContext}

ISSUE:
  property_id: ${payload.property_id}
  property_name: ${property?.name ?? "Unknown"}
  issue_type: ${payload.issue_type}
  severity: ${payload.severity}
  guest_present: ${payload.guest_present}
  ${payload.guest_name ? `guest_name: ${payload.guest_name}` : ""}
  description: ${payload.description}
  reported_at: ${payload.timestamp}`;

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

  if (typeof decision.send_sms !== "boolean") {
    throw new Error("Claude decision missing required fields");
  }

  return decision;
}
