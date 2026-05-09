/**
 * lib/claude.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildTeamContext, PROPERTIES } from "./team";
import type { Decision, HostbuddyActionItem, HospitableMessage } from "./types";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an issue router for Dwellia, a premium family vacation rental company.

HostbuddyAI has flagged an action item from a guest conversation. Read the conversation and classify the issue into one of three outcomes:

1. URGENT VISIT — guest explicitly asked for someone to come out physically
2. NEXT CLEAN — guest reported an issue but did NOT ask for anyone to come out (fix at next clean/turnover)
3. NO ACTION — not a real issue (e.g. question answered, early check-in, info request)

URGENT VISIT examples:
- "Can someone come fix this?" → URGENT
- "Is there someone who can look at this?" → URGENT

NEXT CLEAN examples:
- "The bathroom light bulb is out" (no visit request) → NEXT CLEAN
- "One of the arcade games isn't working" (no visit request) → NEXT CLEAN
- "The cabinet hinge is loose" → NEXT CLEAN

NO ACTION examples:
- Early check-in request → NO ACTION
- Question that just needs a text answer → NO ACTION
- Complaint already resolved → NO ACTION

If the action item contains "**TEST**" treat it as URGENT for testing purposes.

Two contacts:
- ryan: handles Delta Dawn
- amanda: handles LeGobi

Always route to the contact matching the property.

SMS RULES — URGENT:
- Start with: *AI Msg*
- Use guest FIRST NAME ONLY (e.g. "Sarah" not "Sarah Thompson")
- Under 100 chars (URL appended separately)
- Example: "*AI Msg* Sarah at Delta Dawn asking if someone can come look at the hot tub."

SMS RULES — NEXT CLEAN:
- Start with: *AI Msg* Next clean task:
- No guest name
- Under 100 chars (URL appended separately)  
- Example: "*AI Msg* Next clean task: Delta Dawn guest reported a loose cabinet hinge. No visit needed."

TASK DESCRIPTION RULES:
- Include ALL relevant details from the conversation
- Quote the guest's exact words where useful
- List any photo URLs the guest sent
- Include: what's wrong, how long it's been an issue, urgency, anything already tried
- Clearly label as URGENT or NEXT CLEAN at the top

If action item contains "**TEST**", start task title with "**TEST**"

Respond ONLY with valid JSON, no markdown:
{
  "guest_requesting_visit": boolean,
  "issue_needs_attention": boolean,
  "send_sms": boolean,
  "sms_to_key": "ryan or amanda or null",
  "sms_message": "message text under 100 chars",
  "send_call": boolean,
  "call_to_key": "ryan or amanda or null",
  "create_task": boolean,
  "task_title": "short title",
  "task_description": "full rich description",
  "task_priority": "low|medium|high",
  "task_assignee_key": "ryan or amanda or null",
  "task_type": "urgent|next_clean",
  "reasoning": "one sentence"
}`;

export async function getRoutingDecision(
  actionItem: HostbuddyActionItem,
  messages: HospitableMessage[]
): Promise<Decision> {
  const teamContext = buildTeamContext();

  const conversation = messages.length
    ? messages.map((m) => {
        let line = `[${m.author}]: ${m.body}`;
        if (m.attachments && m.attachments.length) {
          line += '\n  Photos: ' + m.attachments.map((a: any) => a.url || a).join(', ');
        }
        return line;
      }).join("\n")
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

Classify this issue and route accordingly. Use guest FIRST NAME ONLY in urgent SMS.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1000,
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
