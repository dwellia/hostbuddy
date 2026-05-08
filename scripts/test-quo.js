#!/usr/bin/env node
/**
 * scripts/test-quo.js
 *
 * Verifies your Quo API key by listing phone numbers,
 * then sends a real test SMS to confirm everything works.
 *
 * Usage: node scripts/test-quo.js
 *
 * Edit TO_PHONE below to send to your own number.
 */

require("dotenv").config({ path: ".env.local" });

const API_BASE = "https://api.openphone.com/v1";
const API_KEY = process.env.QUO_API_KEY;
const FROM = process.env.QUO_FROM_NUMBER;

// Edit this to your own phone to receive a test SMS
const TO_PHONE = process.env.OWNER_JOHN_PHONE || process.env.OWNER_SARAH_PHONE;

const headers = {
  Authorization: API_KEY, // Quo: no "Bearer" prefix
  "Content-Type": "application/json",
};

async function run() {
  if (!API_KEY) {
    console.error("✗ QUO_API_KEY not set in .env.local");
    process.exit(1);
  }
  if (!FROM) {
    console.error("✗ QUO_FROM_NUMBER not set in .env.local");
    process.exit(1);
  }
  if (!TO_PHONE) {
    console.error("✗ No recipient phone — set OWNER_JOHN_PHONE or OWNER_SARAH_PHONE in .env.local");
    process.exit(1);
  }

  console.log("── Quo API Test ──────────────────────────────");
  console.log(`FROM: ${FROM}`);
  console.log(`TO:   ${TO_PHONE}`);

  // Step 1: List phone numbers (verifies API key)
  console.log("\n[1] Fetching phone numbers to verify API key...");
  const numbersRes = await fetch(`${API_BASE}/phone-numbers`, { headers });
  if (!numbersRes.ok) {
    const text = await numbersRes.text();
    console.error(`✗ Auth failed: HTTP ${numbersRes.status}: ${text}`);
    process.exit(1);
  }
  const numbersData = await numbersRes.json();
  const numbers = numbersData?.data || [];
  console.log(`✓ API key valid. ${numbers.length} phone number(s) in workspace:`);
  numbers.forEach((n) => console.log(`   ${n.number} (${n.name || "no name"})`));

  // Step 2: Send test SMS
  console.log("\n[2] Sending test SMS...");
  const smsBody = {
    from: FROM,
    to: [TO_PHONE],
    content: "Dwellia alert system test — if you got this, Quo is working! 🎉",
  };

  const smsRes = await fetch(`${API_BASE}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(smsBody),
  });

  if (!smsRes.ok) {
    const text = await smsRes.text();
    console.error(`✗ SMS failed: HTTP ${smsRes.status}: ${text}`);
    process.exit(1);
  }

  const smsData = await smsRes.json();
  console.log(`✓ SMS sent! Message ID: ${smsData?.data?.id}`);
  console.log(`\nCheck ${TO_PHONE} for the test message.`);
}

run().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
