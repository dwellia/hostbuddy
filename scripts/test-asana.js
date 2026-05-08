#!/usr/bin/env node
/**
 * scripts/test-asana.js
 *
 * Lists your Asana workspaces, projects, and users
 * so you can find the GIDs to put in .env.local
 *
 * Usage: node scripts/test-asana.js
 */

require("dotenv").config({ path: ".env.local" });

const API_BASE = "https://app.asana.com/api/1.0";
const API_KEY = process.env.ASANA_API_KEY;

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  Accept: "application/json",
};

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function run() {
  if (!API_KEY) {
    console.error("✗ ASANA_API_KEY not set in .env.local");
    process.exit(1);
  }

  console.log("── Asana API Test ────────────────────────────\n");

  // 1. Get current user
  const me = await get("/users/me");
  console.log(`✓ Logged in as: ${me.data.name} (GID: ${me.data.gid})`);

  // 2. List workspaces
  const workspaces = await get("/workspaces");
  console.log(`\nWorkspaces (${workspaces.data.length}):`);
  for (const ws of workspaces.data) {
    console.log(`  ${ws.name} — GID: ${ws.gid}`);
  }

  if (!workspaces.data.length) {
    console.log("No workspaces found.");
    return;
  }

  const wsGid = workspaces.data[0].gid;

  // 3. List projects in first workspace
  const projects = await get(`/workspaces/${wsGid}/projects`);
  console.log(`\nProjects in "${workspaces.data[0].name}" (${projects.data.length}):`);
  for (const p of projects.data) {
    console.log(`  ${p.name}`);
    console.log(`    GID: ${p.gid}`);
    console.log(`    → Use in .env.local: ASANA_PROJECT_DELTA_DAWN=${p.gid}  (or LEGOBII)`);
  }

  // 4. List users in workspace
  const users = await get(`/workspaces/${wsGid}/users`);
  console.log(`\nUsers in workspace (${users.data.length}):`);
  for (const u of users.data) {
    console.log(`  ${u.name} — GID: ${u.gid}`);
    console.log(`    → Use in .env.local: ASANA_USER_JOHN=${u.gid}  (or SARAH, MIKE, CARLOS)`);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log("Copy the GIDs above into your .env.local file.");
}

run().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
