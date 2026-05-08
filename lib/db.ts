/**
 * lib/db.ts
 *
 * Stores issue records in Vercel KV.
 * Each issue is keyed by a unique ID and indexed by property.
 *
 * Setup: Vercel Dashboard → Storage → Create KV Database → link to project
 * Env vars added automatically: KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN
 */

import { kv } from "@vercel/kv";

export type IssueCategory =
  | "CLEANLINESS"
  | "GUEST REQUESTS"
  | "MAINTENANCE"
  | "RESERVATION CHANGES"
  | "SUPPLY"
  | "OTHER"
  | string; // allow custom categories

export interface IssueRecord {
  id: string;                      // unique ID for this record
  timestamp: string;               // ISO 8601 — when webhook was received
  property: string;                // "Delta Dawn" or "LeGobi Villa"
  property_id: string;             // "delta-dawn" or "legobii"
  guest_name: string;
  reservation_id: string;
  category: IssueCategory;
  action_item: string;             // raw text from HostbuddyAI
  guest_requested_visit: boolean;  // did guest ask for someone to come out?
  sms_sent: boolean;
  task_created: boolean;
  asana_task_id: string | null;
  asana_task_url: string | null;
  claude_reasoning: string;        // Claude's one-sentence explanation
  conversation_length: number;     // number of messages in conversation
  notified_contact: string | null; // "Ryan" or "Amanda"
}

const ISSUES_INDEX_KEY = "issues:index";        // sorted set of all issue IDs by timestamp
const ISSUE_KEY = (id: string) => `issue:${id}`;

/** Save a new issue record */
export async function saveIssue(record: IssueRecord): Promise<void> {
  try {
    // Store the full record
    await kv.set(ISSUE_KEY(record.id), record);
    // Add to sorted index (score = unix timestamp for time-ordering)
    await kv.zadd(ISSUES_INDEX_KEY, {
      score: new Date(record.timestamp).getTime(),
      member: record.id,
    });
    console.log(`[DB] Saved issue ${record.id}`);
  } catch (err) {
    console.error("[DB] Failed to save issue:", err);
  }
}

/** Get all issues, newest first */
export async function getAllIssues(): Promise<IssueRecord[]> {
  try {
    // Get all IDs sorted by timestamp descending
    const ids = await kv.zrange(ISSUES_INDEX_KEY, 0, -1, { rev: true }) as string[];
    if (!ids.length) return [];

    // Fetch all records in parallel
    const records = await Promise.all(
      ids.map((id) => kv.get<IssueRecord>(ISSUE_KEY(id)))
    );

    return records.filter((r): r is IssueRecord => r !== null);
  } catch (err) {
    console.error("[DB] Failed to get issues:", err);
    return [];
  }
}

/** Get issues for a specific property */
export async function getIssuesByProperty(propertyId: string): Promise<IssueRecord[]> {
  const all = await getAllIssues();
  return all.filter((r) => r.property_id === propertyId);
}

/** Build summary metrics from all issues */
export function buildMetrics(issues: IssueRecord[]) {
  const total = issues.length;
  const visitRequested = issues.filter((i) => i.guest_requested_visit).length;
  const smsSent = issues.filter((i) => i.sms_sent).length;
  const tasksCreated = issues.filter((i) => i.task_created).length;

  // By property
  const byProperty: Record<string, number> = {};
  for (const issue of issues) {
    byProperty[issue.property] = (byProperty[issue.property] || 0) + 1;
  }

  // By category
  const byCategory: Record<string, number> = {};
  for (const issue of issues) {
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
  }

  // By month
  const byMonth: Record<string, number> = {};
  for (const issue of issues) {
    const month = issue.timestamp.slice(0, 7); // "2026-05"
    byMonth[month] = (byMonth[month] || 0) + 1;
  }

  // Visit requested by property
  const visitByProperty: Record<string, number> = {};
  for (const issue of issues.filter((i) => i.guest_requested_visit)) {
    visitByProperty[issue.property] = (visitByProperty[issue.property] || 0) + 1;
  }

  return {
    total,
    visitRequested,
    smsSent,
    tasksCreated,
    byProperty,
    byCategory,
    byMonth,
    visitByProperty,
  };
}
