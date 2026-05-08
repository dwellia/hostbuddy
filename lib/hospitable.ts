/**
 * lib/hospitable.ts
 *
 * Fetches conversation messages for a reservation from the Hospitable API.
 * Endpoint: GET https://public.api.hospitable.com/v2/reservations/{id}/messages
 * Auth: Bearer token
 */

import type { HospitableMessage } from "./types";

const HOSPITABLE_API = "https://public.api.hospitable.com/v2";

function hospitableHeaders(): HeadersInit {
  const key = process.env.HOSPITABLE_API_KEY;
  if (!key) throw new Error("HOSPITABLE_API_KEY environment variable is not set");
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
}

export async function getReservationMessages(
  reservationId: string
): Promise<HospitableMessage[]> {
  console.log(`[Hospitable] Fetching messages for reservation ${reservationId}`);

  const res = await fetch(
    `${HOSPITABLE_API}/reservations/${reservationId}/messages`,
    { headers: hospitableHeaders() }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hospitable API error ${res.status}: ${text}`);
  }

  const data = await res.json() as { data?: unknown[] };
  const raw = data?.data ?? [];

  // Normalize — Hospitable v2 wraps each message in { attributes: {...} }
  const messages: HospitableMessage[] = raw.map((m: any) => {
    const attrs = m.attributes ?? m;
    return {
      id: m.id ?? attrs.id ?? "",
      body: attrs.body ?? attrs.message ?? attrs.content ?? "",
      author: attrs.author ?? attrs.type ?? attrs.sender ?? "unknown",
      created_at: attrs.created_at ?? attrs.sent_at ?? "",
    };
  });

  console.log(`[Hospitable] Got ${messages.length} messages`);
  return messages;
}

/** Format messages into a readable string for Claude */
export function formatConversation(messages: HospitableMessage[]): string {
  if (!messages.length) return "No messages found.";
  return messages
    .map((m) => `[${m.author}] ${m.body}`)
    .join("\n");
}
