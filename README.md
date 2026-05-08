# Dwellia HostbuddyAI Alert System

Receives webhooks from HostbuddyAI, uses Claude to analyze the issue, then routes via **Quo SMS/call** and **Asana tasks** — automatically, at zero extra cost.

```
HostbuddyAI detects issue
        ↓  webhook POST
Vercel endpoint (validates, returns 200)
        ↓  async
Claude analyzes severity + issue type
        ↓  decision
  ├─ Quo SMS → right team member
  ├─ Quo urgent SMS → owner (for critical)
  └─ Asana task → right project + assignee
```

---

## Stack

| Tool | Purpose | Cost |
|------|---------|------|
| Vercel | Hosts webhook endpoint | Free tier |
| Claude Sonnet | Analyzes issues, decides routing | Usage-based (already have) |
| Quo | Sends SMS/calls to team | Prepaid credits (already have) |
| Asana | Creates tasks for tracking | Already have |

**No new subscriptions needed.**

---

## Setup (one time, ~30 minutes)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_ORG/dwellia-hostbuddy-alert.git
cd dwellia-hostbuddy-alert
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:

| Variable | Where to find it |
|----------|-----------------|
| `HOSTBUDDY_WEBHOOK_SECRET` | HostbuddyAI → Settings → Webhooks → create new → copy secret |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `QUO_API_KEY` | Quo → Settings → API tab (Owner/Admin only) |
| `QUO_FROM_NUMBER` | Quo → Phone Numbers (E.164 format: +15551234567) |
| `OWNER_JOHN_PHONE` etc. | Team member phone numbers (E.164 format) |
| `ASANA_API_KEY` | asana.com → Settings → Apps → Developer Apps |
| `ASANA_PROJECT_*` | Run `npm run test:asana` — it lists all GIDs |
| `ASANA_USER_*` | Run `npm run test:asana` — it lists all GIDs |

### 3. Find your Asana GIDs

```bash
node scripts/test-asana.js
```

This lists all your projects and users with their GIDs. Copy the right ones into `.env.local`.

### 4. Test Quo

```bash
node scripts/test-quo.js
```

Verifies your API key and sends a real test SMS to `OWNER_JOHN_PHONE`. Check your phone.

### 5. Deploy to Vercel

```bash
npx vercel deploy --prod
```

When prompted, link to your Vercel project (or create a new one).

Then add env vars to Vercel:

```bash
# Either use the CLI:
npx vercel env add ANTHROPIC_API_KEY
npx vercel env add QUO_API_KEY
# ... (repeat for each variable)

# Or paste them all at once in Vercel Dashboard:
# Settings → Environment Variables → add each one
```

### 6. Configure HostbuddyAI webhook

In HostbuddyAI settings → Webhooks → New webhook:

- **URL:** `https://your-project.vercel.app/api/hostbuddy-webhook`
- **Secret:** whatever you put in `HOSTBUDDY_WEBHOOK_SECRET`
- **Events:** Select maintenance, guest issues, safety alerts — whatever HostbuddyAI exposes

### 7. Test end-to-end

```bash
# Test medium severity issue (no real SMS sent in dry run)
node scripts/test-webhook.js

# Test against deployed endpoint
node scripts/test-webhook.js https://your-project.vercel.app

# Test different scenarios
SCENARIO=critical node scripts/test-webhook.js https://your-project.vercel.app
```

Available scenarios: `low`, `medium`, `high`, `critical`

---

## How routing works

Claude receives the issue details and decides:

| Severity | SMS | Call | Asana Task |
|----------|-----|------|-----------|
| `low` | ❌ | ❌ | ✅ Low priority |
| `medium` | ✅ Specialist | ❌ | ✅ Medium priority |
| `high` | ✅ Owner + specialist | ❌ | ✅ High priority |
| `critical` | ✅ Owner | ✅ Owner (urgent SMS) | ✅ High priority |

Safety issues (gas, electrical hazard, fire, injury) always escalate to the owner regardless of severity.

**Specialist matching:**
- `hvac`, `pool_equipment`, `plumbing`, `appliances` → Mike
- `electrical`, `wifi`, `entertainment_system` → Carlos
- `guest_complaint`, `safety_alert` → owner

---

## Customizing

### Add or change team members

Edit `lib/team.ts` — the `TEAM` object. Each member has:
- `name`, `role`, `phone`, `asanaUserId`
- `specialties` — issue types Claude will route to them

### Add a property

Edit `lib/team.ts` — the `PROPERTIES` object. Each property needs:
- `id` — matches the `property_id` in HostbuddyAI payloads
- `ownerKey` — which team member owns it
- `asanaProjectId` — where tasks go

### Change routing logic

Edit the `SYSTEM_PROMPT` in `lib/claude.ts`. You can adjust:
- When to SMS vs just create a task
- Which severities trigger calls
- Message tone and style
- Escalation rules

---

## Monitoring

Check **Vercel → Functions → Logs** after any webhook fires. You'll see:

```
[Pipeline] Processing: hvac @ delta-dawn (medium)
[Pipeline] Decision: Medium severity HVAC, routing to specialist Mike
[Quo SMS] → +15550200: "AC stuck at 72° at Delta Dawn. Guest here..."
[Quo SMS] ✓ sent, id=msg_abc123
[Asana] Creating task: "Delta Dawn: AC not cooling (74°F)"
[Asana] ✓ created task 1234567890
[Pipeline] Done: { sms: true, call: 'skipped', task: true }
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Webhook returns 401 | `HOSTBUDDY_WEBHOOK_SECRET` doesn't match what's in HostbuddyAI |
| Quo SMS fails with 401 | Check `QUO_API_KEY` — no "Bearer" prefix, just the raw key |
| Quo SMS fails with 422 | Check `QUO_FROM_NUMBER` is E.164 format and a valid number in your workspace |
| Asana task fails with 401 | Check `ASANA_API_KEY` — needs `Bearer` prefix (handled in code) |
| Asana task fails with 404 | Wrong project GID — re-run `npm run test:asana` |
| Claude returns bad JSON | Rare — will be caught and logged; fallback SMS sent to owner |
| No SMS received | Check Quo prepaid credit balance in Quo billing settings |

---

## File structure

```
dwellia-hostbuddy-alert/
├── api/
│   └── hostbuddy-webhook.ts    # Vercel function — receives HostbuddyAI POSTs
├── lib/
│   ├── types.ts                # Shared TypeScript types
│   ├── team.ts                 # Team members + properties config
│   ├── claude.ts               # Claude decision engine
│   ├── quo.ts                  # Quo SMS/call sender
│   ├── asana.ts                # Asana task creator
│   └── pipeline.ts             # Orchestrates the full flow
├── scripts/
│   ├── test-webhook.js         # Fire a test webhook
│   ├── test-quo.js             # Verify Quo + send test SMS
│   └── test-asana.js           # Find Asana GIDs
├── .env.example                # Template — copy to .env.local
├── .gitignore
├── package.json
├── tsconfig.json
└── vercel.json
```

---

## Expected HostbuddyAI webhook payload

If HostbuddyAI's payload shape differs from what's below, update the `validatePayload` function in `api/hostbuddy-webhook.ts` and the `HostbuddyPayload` type in `lib/types.ts`.

```json
{
  "issue_type": "hvac",
  "severity": "medium",
  "property_id": "delta-dawn",
  "description": "AC running but not cooling below 74°F.",
  "guest_present": true,
  "guest_name": "Smith Family",
  "timestamp": "2026-05-06T10:00:00Z"
}
```

`property_id` must match the keys in `PROPERTIES` in `lib/team.ts` (`"delta-dawn"` or `"legobii"`).
