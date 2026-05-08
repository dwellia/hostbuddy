/**
 * lib/claude.ts
 *
 * Sends the HostbuddyAI issue to Claude and gets back a structured
 * routing decision: who to SMS, whether to call, and what task to create.
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildTeamContext, getOwner, PROPERTIES } from "./team";
import type { Decision, HostbuddyPayload } from "./types";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an issue router for Dwellia, a premium family vacation rental company.

Your job: analyze a maintenance or guest issue from HostbuddyAI and decide exactly how to route it — who to SMS, whether to call, and what Asana task to create.

ROUTING RULES:
- LOW severity → create Asana task only, no SMS, no call
- MEDIUM severity → SMS the best specialist + create Asana task
- HIGH severity → SMS the property owner + SMS the relevant specialist + create urgent Asana task
- CRITICAL severity → SMS owner + call owner + create critical Asana task
- Safety issues (gas, electrical hazard, fire, injury) → always escalate to owner regardless of severity

SPECIALIST MATCHING:
- hvac, pool_equipment, plumbing, appliances → mike
- electrical, wifi, entertainment_system → carlos
- guest_complaint, safety_alert, general → owner

SMS MESSAGE RULES:
- Under 160 characters (SMS limit)
- Warm and direct — like texting a friend, not writing a policy document
- Include: what's wrong, where, any relevant context
- Good: "AC stuck at 72° at Delta Dawn. Guest here. Filter maybe? Can you check?"
- Bad: "A cooling system malfunction has been detected requiring immediate investigation."

CALL RULES:
- Only for critical/safety emergencies
- send_call=true means Quo will initiate a call; the call_to_key is who gets called
- Only call the owner, never tech staff

TASK RULES:
- task_title: short and specific, e.g. "Delta Dawn: Hot tub not heating (62°F)"
- task_description: full context — issue type, severity, guest impact, what was reported
- task_priority matches severity: low→low, medium→medium, high/critical→high
- task_assignee_key: best person to own resolution

Respond ONLY with valid JSON matching this exact shape — no markdown, no explanation:
{
  "send_sms": boolean,
  "sms_to_key": "team member key or null",
  "sms_message": "message text",
  "send_call": boolean,
  "call_to_key": "team member key or null",
  "create_task": boolean,
  "task_title": "short title",
  "task_description": "full description",
  "task_priority": "low|medium|high",
  "task_assignee_key": "team member key or null",
  "reasoning": "one sentence explaining your decision"
}`;

export async function getRoutingDecision(
  payload: HostbuddyPayload
): Promise<Decision> {
  const property = PROPERTIES[payload.property_id];
  const owner = getOwner(payload.property_id);
  const teamContext = buildTeamContext();

  const userMessage = `${teamContext}

ISSUE TO ROUTE:
  property_id: ${payload.property_id}
  property_name: ${property?.name ?? "Unknown"}
  property_owner: ${owner?.name ?? "Unknown"}
  issue_type: ${payload.issue_type}
  severity: ${payload.severity}
  guest_present: ${payload.guest_present}
  ${payload.guest_name ? `guest_name: ${payload.guest_name}` : ""}
  description: ${payload.description}
  reported_at: ${payload.timestamp}

Decide how to route this issue.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const raw =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Strip markdown fences if model wraps in them
  const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  let decision: Decision;
  try {
    decision = JSON.parse(cleaned) as Decision;
  } catch {
    console.error("[Claude] Failed to parse response:", raw);
    throw new Error(`Claude returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  // Validate required fields exist
  if (typeof decision.send_sms !== "boolean") {
    throw new Error("Claude decision missing required fields");
  }

  return decision;
}
