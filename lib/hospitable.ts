/**
 * lib/hospitable.ts
 *
 * Fetches conversation messages and reservation details from Hospitable API.
 * Auth: Bearer token, scope: message:read
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

  const messages: HospitableMessage[] = raw.map((m: any) => {
    const attrs = m.attributes ?? m;
    const attachments =
      attrs.attachments ?? attrs.images ?? attrs.media ?? attrs.photos ?? [];
    return {
      id: m.id ?? attrs.id ?? "",
      body: attrs.body ?? attrs.message ?? attrs.content ?? "",
      author: attrs.author ?? attrs.type ?? attrs.sender ?? "unknown",
      created_at: attrs.created_at ?? attrs.sent_at ?? "",
      attachments: Array.isArray(attachments) ? attachments : [],
    };
  });

  console.log(`[Hospitable] Got ${messages.length} messages`);
  return messages;
}

/** Fetch checkout date for a reservation. Returns YYYY-MM-DD or null. */
export async function getCheckoutDate(
  reservationId: string
): Promise<string | null> {
  console.log(`[Hospitable] Fetching checkout date for reservation ${reservationId}`);

  try {
    const res = await fetch(
      `${HOSPITABLE_API}/reservations/${reservationId}`,
      { headers: hospitableHeaders() }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`[Hospitable] Reservation fetch error ${res.status}: ${text}`);
      return null;
    }

    const data = await res.json() as { data?: any };
    const attrs = data?.data?.attributes ?? data?.data ?? {};

    // Hospitable may use different field names
    const checkout =
      attrs.end_date ??
      attrs.check_out ??
      attrs.checkout_date ??
      attrs.checkout ??
      attrs.end ??
      null;

    if (checkout) {
      // Normalize to YYYY-MM-DD
      const normalized = checkout.slice(0, 10);
      console.log(`[Hospitable] Checkout date: ${normalized}`);
      return normalized;
    }

    console.warn(`[Hospitable] No checkout date found in reservation data`);
    return null;
  } catch (err) {
    console.error(`[Hospitable] Error fetching checkout date:`, err);
    return null;
  }
}
