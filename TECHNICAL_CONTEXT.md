# Dwellia Automation — Technical Context
## Lessons Learned (May 2026)

This file captures everything discovered building the HostbuddyAI → Claude → Quo → Asana pipeline. Read this before starting any new automation work to avoid repeating mistakes.

---

## PROJECT OVERVIEW

**Repo:** dwellia-hostbuddy-alert  
**Deployed at:** https://hostbuddy-two.vercel.app  
**Dashboard:** https://hostbuddy-two.vercel.app/dashboard.html  
**Webhook URL:** https://hostbuddy-two.vercel.app/api/hostbuddy-webhook

**What it does:**
1. HostbuddyAI fires a webhook when an action item is created
2. Vercel endpoint receives it, calls Claude
3. Claude fetches the Hospitable conversation for context
4. Claude decides if guest explicitly asked for someone to come out
5. If yes → SMS via Quo + Asana task created
6. Everything logged to Vercel Blob and visible on dashboard

---

## TEAM & PROPERTIES

- **Ryan** → handles Delta Dawn Retreat (Sevierville, TN)
- **Amanda** → handles LeGobi Villa (Kissimmee, FL)
- All SMS/calls come FROM the Dwellia Quo number

**Property IDs (used in code):**
- `delta-dawn` → Delta Dawn Retreat
- `legobii` → LeGobi Villa (ONE i — this has caused bugs before)

**Asana GIDs:**
- Delta Dawn project: `1200748932634513`
- LeGobi project: `1204026608001469`
- Ryan user: `1202811494442466`
- Amanda user: `1204089449363429`

---

## QUO API

**Base URL:** `https://api.openphone.com/v1`  
**Auth:** `Authorization: YOUR_API_KEY` — NO "Bearer" prefix. Just the raw key.  
**Send SMS endpoint:** `POST /messages`  
**Required fields:** `from`, `to` (array), `content`  
**Phone format:** E.164 — must include `+` prefix e.g. `+16512533249` not `16512533249`  
**Quo does NOT have an outbound call API** — calls are read-only. For "urgent calls" we send a 🚨 URGENT SMS instead.  
**SMS cost:** $0.01 per segment (prepaid)

**Test curl:**
```bash
curl -X POST https://api.openphone.com/v1/messages \
  -H "Authorization: YOUR_QUO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"+1XXXXXXXXXX","to":["+1XXXXXXXXXX"],"content":"test"}'
```

---

## HOSTBUDDYAI WEBHOOKS

**No webhook secret** — HostbuddyAI does not send a signature. Do not add signature verification.

**Webhook payload shape:**
```json
{
  "hook_id": "uuid",
  "hook_timestamp": "ISO8601",
  "hook_type": "action_items",
  "user_id": "admin_bookdwellia_com",
  "action_items": [{
    "id": "string",
    "status": "incomplete",
    "hook_type": "action_items",
    "category": "MAINTENANCE",
    "item": "action item description",
    "guest_name": "Guest Name",
    "reservation_id": "HMBTXXXXXXXX",
    "conversation_id": "conv_xxx",
    "property_name": "internal-name",
    "property_alias": "Human Readable Name",
    "created_at_utc": "ISO8601",
    "user_id": "admin_bookdwellia_com"
  }]
}
```

**Categories (built-in + custom):**
- CLEANLINESS
- GUEST REQUESTS
- MAINTENANCE
- RESERVATION CHANGES
- SUPPLY
- OTHER

**Hook types:** `action_items` (new) and `action_items_completed` (resolved)

**Key field:** `reservation_id` — maps directly to Hospitable reservation ID

---

## HOSPITABLE API

**Base URL:** `https://public.api.hospitable.com/v2`  
**Auth:** `Authorization: Bearer YOUR_KEY`  
**Required scope:** `message:read`  
**Get messages:** `GET /reservations/{reservation_id}/messages`  
**Note:** Reservation IDs from HostbuddyAI must be valid UUIDs — fake test IDs will return 400 "Invalid uuid provided." This is expected in testing and is caught/handled gracefully.

---

## ASANA API

**Base URL:** `https://app.asana.com/api/1.0`  
**Auth:** `Authorization: Bearer YOUR_KEY` (Bearer IS required here, unlike Quo)  
**Create task:** `POST /tasks`  
**Required:** `name`, `projects` (array of GIDs)  
**Optional:** `assignee`, `notes`  
**Task URL format:** `https://app.asana.com/0/{projectGid}/{taskGid}`

---

## VERCEL — CRITICAL LESSONS

### Async processing
**DO NOT** fire-and-forget with `.catch()` after sending `res.status(200)` on the free tier. Vercel kills the function as soon as the response is sent. **Always `await` the pipeline before responding.**

```typescript
// WRONG — pipeline gets killed
res.status(200).json({ status: 'queued' });
processIssue(payload).catch(...); // never runs

// CORRECT
await processIssue(payload);
res.status(200).json({ status: 'ok' });
```

### vercel.json
Keep it minimal or delete it entirely. Do NOT specify `runtime` — Vercel auto-detects Node.js for TypeScript. Do NOT use `maxDuration` as a top-level field (invalid). If you need longer timeouts, set them per-function in the Vercel dashboard.

```json
// WRONG — causes deployment failure
{
  "functions": { "api/**/*.ts": { "runtime": "nodejs20.x" } },
  "maxDuration": 60
}

// CORRECT — or just delete the file
{}
```

### CSP (Content Security Policy)
Do NOT add CSP meta tags to HTML files hosted on Vercel. It blocks Chart.js and inline styles. Instead, keep all JavaScript in external `.js` files (no inline scripts). Vercel's default CSP is fine — don't override it.

### Vercel Blob
- `allowOverwrite: true` does NOT actually overwrite — it creates new files with random suffixes
- To maintain a single file: use `list()` to find old files, write new file, then `del()` old files
- Private blobs cannot be read with a plain `fetch()` — use `downloadUrl` with auth or just use public access
- Private stores **cannot be changed to public** after creation — delete and recreate
- Blob stores connect to projects automatically and add `BLOB_READ_WRITE_TOKEN` env var
- Vercel KV is no longer available as a native product (removed) — use Upstash Redis or Blob instead

### Storage options available in Vercel (May 2026)
- **Blob** — good for files/JSON, free tier, use public for easy reading
- **Edge Config** — ultra-low latency reads, small data only
- **Upstash** (marketplace) — Redis/KV, requires separate account
- **Neon/Supabase/etc.** (marketplace) — Postgres, requires separate accounts
- **NO native KV** — was removed

---

## CLAUDE API IN VERCEL FUNCTIONS

**Model:** `claude-sonnet-4-5` (always use this — not claude-sonnet-4-20250514 or other variants)  
**Always use structured JSON output** — prompt Claude to return only valid JSON with no markdown fences. Strip fences before parsing as a safety measure:

```typescript
const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
const decision = JSON.parse(cleaned);
```

**System prompt tips:**
- Give Claude explicit routing rules (LOW → task only, MEDIUM → SMS + task, etc.)
- Give Claude the full team context (names, keys, properties)
- Tell Claude exactly what JSON shape to return
- Include a `reasoning` field — invaluable for debugging in logs

---

## FILE STRUCTURE

```
/api
  hostbuddy-webhook.ts    — main webhook receiver
  issues.ts               — GET all issues for dashboard
  delete-issue.ts         — DELETE single issue by ID
  debug-blob.ts           — temporary debug (can delete)

/lib
  types.ts                — shared TypeScript interfaces
  team.ts                 — Ryan/Amanda + property config
  claude.ts               — Claude decision engine
  quo.ts                  — Quo SMS sender
  asana.ts                — Asana task creator
  hospitable.ts           — Hospitable conversation fetcher
  pipeline.ts             — orchestrates everything
  db.ts                   — Vercel Blob read/write

/public
  dashboard.html          — dashboard UI (no inline JS)
  dashboard.js            — dashboard logic (external file)
```

---

## ENVIRONMENT VARIABLES

```
ANTHROPIC_API_KEY           Anthropic console
QUO_API_KEY                 Quo → Settings → API (no Bearer prefix when used)
QUO_FROM_NUMBER             Dwellia Quo number in E.164 format (+1XXXXXXXXXX)
RYAN_PHONE                  Ryan's phone in E.164 format
AMANDA_PHONE                Amanda's phone in E.164 format
ASANA_API_KEY               Asana → Settings → Apps → Developer Apps
ASANA_PROJECT_DELTA_DAWN    1200748932634513
ASANA_PROJECT_LEGOBII       1204026608001469
ASANA_USER_RYAN             1202811494442466
ASANA_USER_AMANDA           1204089449363429
HOSPITABLE_API_KEY          Hospitable → Settings → API → Personal Access Token
BLOB_READ_WRITE_TOKEN       Auto-added by Vercel when Blob store is linked
```

---

## TEST CURL

Use this to fire a fake webhook and test the full pipeline:

```bash
curl -X POST https://hostbuddy-two.vercel.app/api/hostbuddy-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "hook_id": "test-001",
    "hook_timestamp": "2026-05-08T20:00:00Z",
    "hook_type": "action_items",
    "user_id": "admin_bookdwellia_com",
    "action_items": [{
      "id": "test-item-001",
      "status": "incomplete",
      "hook_type": "action_items",
      "category": "MAINTENANCE",
      "item": "**TEST** Guest is asking if someone can come look at the AC.",
      "guest_name": "Test Family",
      "reservation_id": "HMBT0000001",
      "conversation_id": "conv_test_001",
      "property_name": "delta-dawn",
      "property_alias": "Delta Dawn Retreat",
      "created_at_utc": "2026-05-08T20:00:00Z",
      "user_id": "admin_bookdwellia_com"
    }]
  }'
```

- Hospitable fetch will fail (fake reservation ID) — this is expected and handled
- Claude will still evaluate the action item text
- If "**TEST**" is in the item, Claude treats it as a visit request
- SMS will go to Ryan (Delta Dawn), task created in Asana
- Issue logged to dashboard

**Change `property_name` and `property_alias` to `legobii` / `LeGobi Villa` to test Amanda's flow.**

---

## COMMON DEBUGGING STEPS

1. **Dashboard empty** → check `/api/issues` directly in browser first
2. **Issues not saving** → check Vercel logs for `[DB] Failed to save issue`
3. **SMS not sending** → verify `QUO_FROM_NUMBER` has `+` prefix
4. **Asana task not creating** → verify project GID and API key
5. **Pipeline not running** → make sure `await processIssue()` is before `res.status(200)`
6. **Webhook not received** → check HostbuddyAI webhook URL is correct and project is deployed
7. **Multiple blob files** → `list()` and `del()` old files — `allowOverwrite` doesn't work as expected

---

## WHAT'S NOT BUILT YET (Future Work)

- Hospitable conversation fetch currently fails on test data (fake reservation IDs) — works fine with real HostbuddyAI webhooks that have valid reservation IDs
- No way to mark issues as "resolved" on the dashboard (only delete)
- No email notifications (Brevo post-stay campaigns are separate — see main Dwellia context)
- No WhatsApp integration (decided against — Quo only to keep costs at zero)
- No webhook secret validation (HostbuddyAI doesn't send one)
