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

// ── Reservation details ────────────────────────────────────────────────────────

export type BookingPlatform = "airbnb" | "vrbo" | "booking.com" | "direct" | "unknown";

export interface ReservationDetails {
  id: string;
  checkin: string;        // YYYY-MM-DD
  checkout: string;       // YYYY-MM-DD
  checkin_time: string;   // HH:MM
  checkout_time: string;  // HH:MM
  guest_name: string;
  property_id: string;
  platform: BookingPlatform;
  airbnb_code: string | null;            // Hospitable `code` field e.g. "HMXZTQ5E3Z"
  platform_reservation_id: string | null;
}

export async function getReservationDetails(
  reservationId: string
): Promise<ReservationDetails | null> {
  try {
    const res = await fetch(
      `${HOSPITABLE_API}/reservations/${reservationId}`,
      { headers: hospitableHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json() as { data?: any };
    const attrs = data?.data?.attributes ?? data?.data ?? {};

    // Hospitable returns platform at data.platform (e.g. "airbnb", "vrbo", "booking.com")
    const source = (
      data?.data?.platform ??
      attrs.source ?? attrs.platform ?? attrs.channel ??
      attrs.booking_source ?? attrs.origin ?? ""
    ).toLowerCase();

    let platform: BookingPlatform = "unknown";
    if (source.includes("airbnb")) platform = "airbnb";
    else if (source.includes("vrbo") || source.includes("homeaway")) platform = "vrbo";
    else if (source.includes("booking")) platform = "booking.com";
    else if (source.includes("direct") || source.includes("hospitable")) platform = "direct";

    // OTA-specific reservation ID if available
    const platformReservationId =
      attrs.airbnb_thread_id ?? attrs.platform_reservation_id ??
      attrs.external_id ?? attrs.ota_reservation_id ?? null;

    // Hospitable stores the OTA confirmation code at data.reservation.code
    // e.g. "HMTWH9F4MZ" for Airbnb, same pattern for VRBO and Booking.com
    const airbnbCode = data?.data?.reservation?.code ?? attrs.code ?? null;

    return {
      id: reservationId,
      checkin: (attrs.start_date ?? attrs.check_in ?? "").slice(0, 10),
      checkout: (attrs.end_date ?? attrs.check_out ?? attrs.checkout_date ?? "").slice(0, 10),
      checkin_time: attrs.check_in_time ?? attrs.checkin_time ?? "16:00",
      checkout_time: attrs.check_out_time ?? attrs.checkout_time ?? "10:00",
      guest_name: attrs.guest?.name ?? attrs.guest_name ?? "",
      property_id: attrs.property_id ?? data?.data?.relationships?.property?.data?.id ?? "",
      platform,
      airbnb_code: airbnbCode,
      platform_reservation_id: platformReservationId,
    };
  } catch (err) {
    console.error("[Hospitable] getReservationDetails error:", err);
    return null;
  }
}

/** Check if a property has a same-day checkout (for early check-in) or same-day check-in (for late checkout) */
export async function hasSameDayTurnover(
  propertyId: string,
  date: string,   // YYYY-MM-DD
  type: "early_checkin" | "late_checkout"
): Promise<boolean> {
  try {
    // Fetch reservations for the property around that date
    const res = await fetch(
      `${HOSPITABLE_API}/reservations?property_id=${propertyId}&start_date=${date}&end_date=${date}`,
      { headers: hospitableHeaders() }
    );
    if (!res.ok) return false;
    const data = await res.json() as { data?: any[] };
    const reservations = data?.data ?? [];

    for (const r of reservations) {
      const attrs = r.attributes ?? r;
      const checkout = (attrs.end_date ?? attrs.check_out ?? "").slice(0, 10);
      const checkin = (attrs.start_date ?? attrs.check_in ?? "").slice(0, 10);

      if (type === "early_checkin" && checkout === date) return true;
      if (type === "late_checkout" && checkin === date) return true;
    }
    return false;
  } catch (err) {
    console.error("[Hospitable] hasSameDayTurnover error:", err);
    return false; // default to no same-day (safer for guest experience)
  }
}

/** Send a message to a guest via Hospitable */
export async function sendGuestMessage(
  reservationId: string,
  message: string
): Promise<boolean> {
  try {
    console.log(`[Hospitable] Sending message to reservation ${reservationId}`);
    const res = await fetch(
      `${HOSPITABLE_API}/reservations/${reservationId}/messages`,
      {
        method: "POST",
        headers: {
          ...hospitableHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: { attributes: { body: message } } }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      console.error(`[Hospitable] sendGuestMessage error ${res.status}: ${text}`);
      return false;
    }
    console.log("[Hospitable] ✓ Message sent to guest");
    return true;
  } catch (err) {
    console.error("[Hospitable] sendGuestMessage error:", err);
    return false;
  }
}

/** Update reservation check-in or check-out time in Hospitable (also updates smart lock) */
export async function updateReservationTime(
  reservationId: string,
  type: "checkin" | "checkout",
  newTime: string  // HH:MM format e.g. "14:00"
): Promise<boolean> {
  try {
    console.log(`[Hospitable] Updating ${type} time to ${newTime} for reservation ${reservationId}`);
    const field = type === "checkin" ? "check_in_time" : "check_out_time";
    const res = await fetch(
      `${HOSPITABLE_API}/reservations/${reservationId}`,
      {
        method: "PATCH",
        headers: {
          ...hospitableHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: { attributes: { [field]: newTime } } }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      console.error(`[Hospitable] updateReservationTime error ${res.status}: ${text}`);
      return false;
    }
    console.log(`[Hospitable] ✓ ${type} time updated to ${newTime}`);
    return true;
  } catch (err) {
    console.error("[Hospitable] updateReservationTime error:", err);
    return false;
  }
}

/** Build the correct payment request URL for a reservation based on its platform */
export function getPaymentRequestUrl(
  reservationId: string,
  platform: BookingPlatform,
  reservationCode: string | null,
  platformReservationId: string | null
): string {
  const code = reservationCode ?? platformReservationId;
  switch (platform) {
    case "airbnb":
      return code
        ? `https://www.airbnb.com/hosting/stay/${code}`
        : `https://www.airbnb.com/resolutions`;
    case "vrbo":
      return code
        ? `https://www.vrbo.com/rm/propertymanager/reservation/${code}`
        : `https://www.vrbo.com/rm/propertymanager/reservations`;
    case "booking.com":
      return `https://admin.booking.com/hotel/hoteladmin/reservations.html`;
    case "direct":
      return `https://app.hospitable.com/conversations/${reservationId}`;
    default:
      return `https://app.hospitable.com/conversations/${reservationId}`;
  }
}
