/**
 * lib/asana.ts
 *
 * Creates tasks in Asana via the REST API.
 * Docs: https://developers.asana.com/docs/create-a-task
 *
 * Auth: Personal Access Token in Authorization: Bearer <token>
 */

import type { AsanaCreateResult } from "./types";

const ASANA_API_BASE = "https://app.asana.com/api/1.0";

function asanaHeaders(): HeadersInit {
  const key = process.env.ASANA_API_KEY;
  if (!key) throw new Error("ASANA_API_KEY environment variable is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

const PRIORITY_TO_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export async function createTask(options: {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  assigneeGid: string | null;
  projectGid: string;
}): Promise<AsanaCreateResult> {
  try {
    if (!options.projectGid) {
      return { success: false, error: "No Asana project GID configured for this property" };
    }

    console.log(`[Asana] Creating task: "${options.title}"`);

    // Build the task body.
    // Notes is plain text — Asana will display it nicely.
    const taskBody: Record<string, unknown> = {
      name: options.title,
      notes: [
        options.description,
        "",
        `Priority: ${PRIORITY_TO_LABEL[options.priority] ?? options.priority}`,
        `Source: HostbuddyAI → Dwellia Alert System`,
      ].join("\n"),
      projects: [options.projectGid],
    };

    if (options.assigneeGid) {
      taskBody.assignee = options.assigneeGid;
    }

    const res = await fetch(`${ASANA_API_BASE}/tasks`, {
      method: "POST",
      headers: asanaHeaders(),
      body: JSON.stringify({ data: taskBody }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Asana] HTTP ${res.status}: ${errorText}`);
      return { success: false, error: `HTTP ${res.status}: ${errorText}` };
    }

    const data = await res.json() as { data?: { gid?: string } };
    const taskId = data?.data?.gid;
    const taskUrl = taskId
      ? `https://app.asana.com/0/${options.projectGid}/${taskId}`
      : undefined;

    console.log(`[Asana] ✓ created task ${taskId}`);
    return { success: true, taskId, taskUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Asana] Error:", msg);
    return { success: false, error: msg };
  }
}
