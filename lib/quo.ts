/**
 * lib/quo.ts
 *
 * Sends SMS messages and initiates calls via the Quo API.
 *
 * Auth note: Quo uses the API key directly in the Authorization header
 * with NO "Bearer" prefix. e.g. Authorization: sk-quo-xxxxxxx
 *
 * SMS endpoint: POST https://api.openphone.com/v1/messages
 * Required fields: from, to (array), content
 * Optional: userId (sends as a specific workspace member)
 */

import type { QuoSendResult } from "./types";

const QUO_API_BASE = "https://api.openphone.com/v1";

function quoHeaders(): HeadersInit {
  const key = process.env.QUO_API_KEY;
  if (!key) throw new Error("QUO_API_KEY environment variable is not set");
  return {
    Authorization: key,          // Quo: no "Bearer" prefix
    "Content-Type": "application/json",
  };
}

function fromNumber(): string {
  const num = process.env.QUO_FROM_NUMBER;
  if (!num) throw new Error("QUO_FROM_NUMBER environment variable is not set");
  return num;
}

// ── SMS ───────────────────────────────────────────────────────────────────────

export async function sendSMS(
  toPhone: string,
  message: string
): Promise<QuoSendResult> {
  try {
    console.log(`[Quo SMS] → ${toPhone}: "${message.slice(0, 60)}..."`);

    const body = {
      from: fromNumber(),
      to: [toPhone],
      content: message,
    };

    const res = await fetch(`${QUO_API_BASE}/messages`, {
      method: "POST",
      headers: quoHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Quo SMS] HTTP ${res.status}: ${errorText}`);
      return { success: false, error: `HTTP ${res.status}: ${errorText}` };
    }

    const data = await res.json() as { data?: { id?: string } };
    const messageId = data?.data?.id;
    console.log(`[Quo SMS] ✓ sent, id=${messageId}`);
    return { success: true, messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Quo SMS] Error:", msg);
    return { success: false, error: msg };
  }
}

// ── Call ──────────────────────────────────────────────────────────────────────
//
// The Quo API currently supports reading call data but does not expose an
// endpoint to programmatically *initiate* an outbound call. The workaround
// is to send a clearly marked URGENT SMS that prompts the recipient to call
// back immediately, which is more reliable for emergencies anyway.

export async function sendUrgentCallSMS(
  toPhone: string,
  context: string
): Promise<QuoSendResult> {
  // Keep under 160 chars — split into two SMS if needed
  const urgentMessage = `🚨 URGENT — ${context} Call Dwellia back immediately.`;

  console.log(`[Quo Call→SMS] Sending urgent SMS to ${toPhone}`);
  return sendSMS(toPhone, urgentMessage.slice(0, 160));
}
