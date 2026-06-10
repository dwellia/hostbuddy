/**
 * lib/db.ts
 *
 * Stores issue records in Neon Postgres.
 * Table is created automatically on first run.
 */

import { neon } from "@neondatabase/serverless";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is not set");
  return neon(url);
}

export type IssueCategory =
  | "CLEANLINESS" | "GUEST REQUESTS" | "MAINTENANCE"
  | "RESERVATION CHANGES" | "SUPPLY" | "OTHER" | string;

export interface IssueRecord {
  id: string;
  timestamp: string;
  property: string;
  property_id: string;
  guest_name: string;
  reservation_id: string;
  category: IssueCategory;
  action_item: string;
  guest_requested_visit: boolean;
  task_type: "urgent" | "next_clean" | "none";
  sms_sent: boolean;
  task_created: boolean;
  asana_task_id: string | null;
  asana_task_url: string | null;
  claude_reasoning: string;
  conversation_length: number;
  notified_contact: string | null;
}

/** Create table if it doesn't exist */
async function ensureTable(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL,
      property TEXT NOT NULL,
      property_id TEXT NOT NULL,
      guest_name TEXT,
      reservation_id TEXT,
      category TEXT,
      action_item TEXT,
      guest_requested_visit BOOLEAN DEFAULT FALSE,
      task_type TEXT DEFAULT 'none',
      sms_sent BOOLEAN DEFAULT FALSE,
      task_created BOOLEAN DEFAULT FALSE,
      asana_task_id TEXT,
      asana_task_url TEXT,
      claude_reasoning TEXT,
      conversation_length INTEGER DEFAULT 0,
      notified_contact TEXT
    )
  `;
}

/** Save a new issue record */
export async function saveIssue(record: IssueRecord): Promise<void> {
  try {
    await ensureTable();
    const db = sql();
    await db`
      INSERT INTO issues (
        id, timestamp, property, property_id, guest_name, reservation_id,
        category, action_item, guest_requested_visit, task_type,
        sms_sent, task_created, asana_task_id, asana_task_url,
        claude_reasoning, conversation_length, notified_contact
      ) VALUES (
        ${record.id},
        ${record.timestamp},
        ${record.property},
        ${record.property_id},
        ${record.guest_name},
        ${record.reservation_id},
        ${record.category},
        ${record.action_item},
        ${record.guest_requested_visit},
        ${record.task_type},
        ${record.sms_sent},
        ${record.task_created},
        ${record.asana_task_id},
        ${record.asana_task_url},
        ${record.claude_reasoning},
        ${record.conversation_length},
        ${record.notified_contact}
      )
    `;
    console.log(`[DB] Saved issue ${record.id}`);
  } catch (err) {
    console.error("[DB] Failed to save issue:", err);
  }
}

/** Get all issues, newest first */
export async function getAllIssues(): Promise<IssueRecord[]> {
  try {
    await ensureTable();
    const db = sql();
    const rows = await db`
      SELECT * FROM issues ORDER BY timestamp DESC
    `;
    return rows.map(rowToRecord);
  } catch (err) {
    console.error("[DB] Failed to get issues:", err);
    return [];
  }
}

/** Delete a single issue by ID */
export async function deleteIssue(id: string): Promise<boolean> {
  try {
    await ensureTable();
    const db = sql();
    await db`DELETE FROM issues WHERE id = ${id}`;
    console.log(`[DB] Deleted issue ${id}`);
    return true;
  } catch (err) {
    console.error("[DB] Failed to delete issue:", err);
    return false;
  }
}

function rowToRecord(row: any): IssueRecord {
  return {
    id: row.id,
    timestamp: row.timestamp instanceof Date
      ? row.timestamp.toISOString()
      : row.timestamp,
    property: row.property,
    property_id: row.property_id,
    guest_name: row.guest_name,
    reservation_id: row.reservation_id,
    category: row.category,
    action_item: row.action_item,
    guest_requested_visit: row.guest_requested_visit,
    task_type: row.task_type,
    sms_sent: row.sms_sent,
    task_created: row.task_created,
    asana_task_id: row.asana_task_id,
    asana_task_url: row.asana_task_url,
    claude_reasoning: row.claude_reasoning,
    conversation_length: row.conversation_length,
    notified_contact: row.notified_contact,
  };
}

/** Build summary metrics */
export function buildMetrics(issues: IssueRecord[]) {
  const total = issues.length;
  const urgent = issues.filter((i) => i.task_type === "urgent").length;
  const nextClean = issues.filter((i) => i.task_type === "next_clean").length;
  const smsSent = issues.filter((i) => i.sms_sent).length;
  const tasksCreated = issues.filter((i) => i.task_created).length;

  const byProperty: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byMonth: Record<string, number> = {};

  for (const issue of issues) {
    byProperty[issue.property] = (byProperty[issue.property] || 0) + 1;
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
    const month = issue.timestamp.slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + 1;
  }

  return { total, urgent, nextClean, smsSent, tasksCreated, byProperty, byCategory, byMonth };
}

// ── Pending check-in/out requests ─────────────────────────────────────────────

async function ensurePendingTable(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS pending_checkinout (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      process_after TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'pending',
      type TEXT NOT NULL,
      reservation_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      property_alias TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      guest_first_name TEXT NOT NULL,
      action_item TEXT NOT NULL,
      requested_time TEXT,
      fee INTEGER DEFAULT 0
    )
  `;
  // Add columns if they don't exist (for existing tables)
  try { await db`ALTER TABLE pending_checkinout ADD COLUMN IF NOT EXISTS requested_time TEXT`; } catch {}
  try { await db`ALTER TABLE pending_checkinout ADD COLUMN IF NOT EXISTS fee INTEGER DEFAULT 0`; } catch {}
}

export async function savePendingCheckInOut(record: import("./types").PendingCheckInOut): Promise<void> {
  await ensurePendingTable();
  const db = sql();
  await db`
    INSERT INTO pending_checkinout (
      id, created_at, process_after, status, type,
      reservation_id, property_id, property_alias,
      guest_name, guest_first_name, action_item
    ) VALUES (
      ${record.id}, ${record.created_at}, ${record.process_after}, ${record.status},
      ${record.type}, ${record.reservation_id}, ${record.property_id},
      ${record.property_alias}, ${record.guest_name}, ${record.guest_first_name},
      ${record.action_item}
    )
  `;
  console.log(`[DB] Saved pending check-in/out ${record.id}`);
}

export async function getPendingCheckInOuts(): Promise<import("./types").PendingCheckInOut[]> {
  await ensurePendingTable();
  const db = sql();
  const rows = await db`
    SELECT * FROM pending_checkinout
    WHERE status = 'pending'
    AND process_after <= NOW()
    ORDER BY created_at ASC
  `;
  return rows.map((r: any) => ({
    id: r.id,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    process_after: r.process_after instanceof Date ? r.process_after.toISOString() : r.process_after,
    status: r.status,
    type: r.type,
    reservation_id: r.reservation_id,
    property_id: r.property_id,
    property_alias: r.property_alias,
    guest_name: r.guest_name,
    guest_first_name: r.guest_first_name,
    action_item: r.action_item,
  }));
}

export async function markCheckInOutProcessed(id: string, status: "processed" | "failed" | "awaiting_cleaner"): Promise<void> {
  const db = sql();
  await db`UPDATE pending_checkinout SET status = ${status} WHERE id = ${id}`;
}

export async function updatePendingFee(id: string, requestedTime: string, fee: number): Promise<void> {
  const db = sql();
  await db`UPDATE pending_checkinout SET requested_time = ${requestedTime}, fee = ${fee} WHERE id = ${id}`;
}

/** Find an open early check-in waiting for cleaner reply for a given property */
export async function getOpenSameDayCheckin(propertyId: string): Promise<(import("./types").PendingCheckInOut & { requested_time: string | null; fee: number }) | null> {
  try {
    await ensurePendingTable();
    const db = sql();
    const rows = await db`
      SELECT * FROM pending_checkinout
      WHERE status = 'awaiting_cleaner'
      AND property_id = ${propertyId}
      AND type = 'early_checkin'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      process_after: r.process_after instanceof Date ? r.process_after.toISOString() : r.process_after,
      status: r.status,
      type: r.type,
      reservation_id: r.reservation_id,
      property_id: r.property_id,
      property_alias: r.property_alias,
      guest_name: r.guest_name,
      guest_first_name: r.guest_first_name,
      action_item: r.action_item,
      requested_time: r.requested_time ?? null,
      fee: r.fee ?? 0,
    };
  } catch (err) {
    console.error("[DB] getOpenSameDayCheckin error:", err);
    return null;
  }
}
