#!/usr/bin/env node
/**
 * scripts/test-webhook.js
 *
 * Fires a test HostbuddyAI webhook at your local or deployed endpoint.
 * Edit SCENARIO below to test different severity levels.
 *
 * Usage:
 *   node scripts/test-webhook.js                    # hits localhost:3000
 *   node scripts/test-webhook.js https://your.vercel.app   # hits deployed URL
 *
 * Requires: HOSTBUDDY_WEBHOOK_SECRET in your environment (or .env.local).
 */

const { createHmac } = require("crypto");
require("dotenv").config({ path: ".env.local" });

const BASE_URL = process.argv[2] || "http://localhost:3000";
const ENDPOINT = `${BASE_URL}/api/hostbuddy-webhook`;
const SECRET = process.env.HOSTBUDDY_WEBHOOK_SECRET || "";

// ── Pick a scenario ───────────────────────────────────────────────────────────
// Change SCENARIO to test different routing paths.

const SCENARIOS = {
  low: {
    issue_type: "appliances",
    severity: "low",
    property_id: "delta-dawn",
    description: "Guest reported the microwave display is flickering. Not urgent.",
    guest_present: true,
    guest_name: "Smith Family",
    timestamp: new Date().toISOString(),
  },
  medium: {
    issue_type: "hvac",
    severity: "medium",
    property_id: "delta-dawn",
    description: "AC running but not cooling below 74°F. Thermostat set to 68. Guest says bedroom is uncomfortable.",
    guest_present: true,
    guest_name: "Johnson Family",
    timestamp: new Date().toISOString(),
  },
  high: {
    issue_type: "wifi",
    severity: "high",
    property_id: "legobii",
    description: "WiFi router completely down. All guests offline. Kids can't use streaming services.",
    guest_present: true,
    guest_name: "Garcia Family",
    timestamp: new Date().toISOString(),
  },
  critical: {
    issue_type: "safety_alert",
    severity: "critical",
    property_id: "delta-dawn",
    description: "Carbon monoxide sensor triggered. Alarm going off. Guests may need to evacuate.",
    guest_present: true,
    guest_name: "Williams Family",
    timestamp: new Date().toISOString(),
  },
};

const SCENARIO = process.env.SCENARIO || "medium";
const payload = SCENARIOS[SCENARIO];

if (!payload) {
  console.error(`Unknown scenario "${SCENARIO}". Choose: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}

async function run() {
  const body = JSON.stringify(payload);
  const signature = SECRET
    ? createHmac("sha256", SECRET).update(body).digest("hex")
    : "no-secret-configured";

  console.log("──────────────────────────────────────────────");
  console.log(`Sending scenario: ${SCENARIO.toUpperCase()}`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Payload: ${JSON.stringify(payload, null, 2)}`);
  console.log("──────────────────────────────────────────────");

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hostbuddy-signature": signature,
      },
      body,
    });

    const text = await res.text();
    console.log(`\nHTTP ${res.status}: ${text}`);

    if (res.ok) {
      console.log("\n✓ Webhook accepted. Check Vercel logs for pipeline output.");
    } else {
      console.log("\n✗ Webhook rejected. Check your secret and payload shape.");
    }
  } catch (err) {
    console.error("\nRequest failed:", err.message);
    console.log("Is the server running? Try: vercel dev");
  }
}

run();
