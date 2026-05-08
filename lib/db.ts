/**
 * lib/db.ts
 *
 * Stores issue records in Vercel Blob as a single JSON file.
 * Simple, free, no extra accounts needed.
 */

import { put, head, getDownloadUrl } from "@vercel/blob";

export type IssueCategory =
  | "CLEANLINESS"
  | "GUEST REQUESTS"
  | "MAINTENANCE"
  | "RESERVATION CHANGES"
  | "SUPPLY"
  | "OTHER"
  | string;

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
  sms_sent: boolean;
  task_created: boolean;
  asana_task_id: string | null;
  asana_task_url: string | null;
  claude_reasoning: string;
  conversation_length: number;
  notified_contact: string | null;
}

const BLOB_FILENAME = "issues.json";

/** Read all issues from Blob */
async function readIssues(): Promise<IssueRecord[]> {
  try {
    // Try to fetch existing blob
    const url = `https://blob.vercel-storage.com/${BLOB_FILENAME}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Write all issues to Blob */
async function writeIssues(issues: IssueRecord[]): Promise<void> {
  await put(BLOB_FILENAME, JSON.stringify(issues), {
    access: "public",
    contentType: "application/json",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    allowOverwrite: true,
  });
}

/** Save a new issue record */
export async function saveIssue(record: IssueRecord): Promise<void> {
  try {
    const issues = await readIssues();
    issues.unshift(record); // newest first
    await writeIssues(issues);
    console.log(`[DB] Saved issue ${record.id}`);
  } catch (err) {
    console.error("[DB] Failed to save issue:", err);
  }
}

/** Get all issues */
export async function getAllIssues(): Promise<IssueRecord[]> {
  return readIssues();
}

/** Build summary metrics */
export function buildMetrics(issues: IssueRecord[]) {
  const total = issues.length;
  const visitRequested = issues.filter((i) => i.guest_requested_visit).length;
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

  return { total, visitRequested, smsSent, tasksCreated, byProperty, byCategory, byMonth };
}
