# Warehouse Scanner — Production Deployment Guide

React + Google Sheets warehouse scanning system. 30 simultaneous stations, 150k–300k orders/month, 20-hour operating day. Runs in any tablet browser — no app install required.

---

## Architecture Overview

```
[Zebra DS2278 Scanner] → HID Keyboard → [React App on Tablet]
                                               │
                              ┌────────────────┤
                              ▼                ▼
                        [IndexedDB]    [Vercel Serverless]
                        (offline buf)   /api/* proxy
                              │                │
                              └────────────────┘
                                       │
                               [Google Sheets API]
                              SCAN_LOG | EMPLOYEES
                              CONFIG | ERROR_LOG
                              SESSION_REGISTRY
```

---

## Step 1 — Google Sheets Setup

Create a new Google Spreadsheet and add these **exact tab names** (case-sensitive):

| Tab | Purpose | Required Columns |
|-----|---------|-----------------|
| `SCAN_LOG` | Append-only scan records | *(auto-populated — leave empty)* |
| `EMPLOYEES` | Employee roster | A: EmployeeID, B: Name, C: Active (TRUE/FALSE) |
| `CONFIG` | Shift times | A: Key, B: Value |
| `ERROR_LOG` | Application errors | *(auto-populated — leave empty)* |
| `SESSION_REGISTRY` | Active session tracking | *(auto-populated — leave empty)* |

### EMPLOYEES tab example:
```
EmployeeID   Name           Active
EMP-001      Jane Smith     TRUE
EMP-002      John Doe       TRUE
EMP-003      Mary Jones     TRUE
```

### CONFIG tab — required keys:
```
Key               Value
SHIFT_AM_START    06:00
SHIFT_PM_START    14:00
SHIFT_PM_END      02:00
```

Copy the **Spreadsheet ID** from the URL:
`https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_ID/edit`

---

## Step 2 — Google Service Account

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use existing)
3. Enable **Google Sheets API**: APIs & Services → Enable APIs → search "Google Sheets API"
4. Create credentials: APIs & Services → Credentials → Create Credentials → **Service Account**
5. Name it anything (e.g. `warehouse-scanner`), click Done
6. Click the service account → Keys tab → Add Key → Create new key → **JSON**
7. Download the JSON file — keep it secret, never commit it
8. **Share your Google Spreadsheet** with the service account email (looks like `name@project.iam.gserviceaccount.com`) — give it **Editor** access

---

## Step 3 — Generate Supervisor PIN Hash

On any machine with Node.js:

```bash
node -e "
const bcrypt = require('bcryptjs');
const pin = '1234'; // ← change this to your actual PIN
console.log('Hash:', bcrypt.hashSync(pin, 10));
"
```

Save the output hash — you'll need it in Step 4.

---

## Step 4 — Deploy to Vercel

### Option A: Vercel CLI (recommended)

```bash
npm install -g vercel
cd /Users/jj/warehouse-scanner
vercel --prod
```

Follow the prompts. When asked about build settings:
- Build command: `vite build`
- Output directory: `dist`
- Install command: `npm install`

### Option B: Vercel Dashboard

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Framework preset: **Vite**
4. Root directory: leave as `/`
5. Deploy

### Set Environment Variables in Vercel

Go to your project → Settings → Environment Variables and add:

| Variable | Value |
|----------|-------|
| `VITE_GOOGLE_SHEETS_ID` | Your spreadsheet ID from Step 1 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The **entire contents** of your service account JSON file, as a single line |
| `SUPERVISOR_PIN_HASH` | The bcrypt hash from Step 3 |

> **VITE_ prefix**: Variables starting with `VITE_` are embedded in the browser bundle at build time. `GOOGLE_SERVICE_ACCOUNT_JSON` and `SUPERVISOR_PIN_HASH` do NOT have this prefix — they stay server-side only.

After setting env vars, trigger a **Redeploy** from the Vercel dashboard.

---

## Step 5 — Configure Tablets

On each Amazon Fire HD 10 tablet:

1. Open Chrome and navigate to your Vercel URL
2. Tap the address bar → Add to Home Screen (optional but recommended)
3. Set screen timeout to **Never** in Settings
4. Enable **Stay Awake** in Developer Options if available
5. Connect Zebra DS2278 scanner via Bluetooth
6. Confirm scanner is programmed to send **Enter** after each scan (factory default)

**Station ID convention:** Use `STATION-01` through `STATION-30`. The station ID determines the sync jitter window — stations are distributed across a 10-second flush window to avoid simultaneous API bursts.

---

## Routes

| URL | Screen | Access |
|-----|--------|--------|
| `/` or `/login` | Employee login | All |
| `/scan` | Scan screen | Authenticated employees |
| `/supervisor` | Supervisor dashboard | PIN required |
| `/admin` | Admin panel | PIN required |

---

## What Each Screen Does

### `/login`
- Dropdown of employees from EMPLOYEES tab
- Station ID field (pre-fills from `VITE_STATION_ID` env var if set per-device)
- Offline fallback: if API is down, uses last-cached employee list from IndexedDB
- Duplicate session detection: warns if employee is already logged in elsewhere

### `/scan`
- Full-screen input always focused — scanner inputs directly here
- Auto-submits on Enter, clears immediately, stays focused
- Green flash = successful scan | Red/yellow flash = error or unrecognized barcode
- Status bar: employee name, station, shift, offline indicator, queued scan count
- All scans queue to IndexedDB instantly (< 5ms) — Google Sheets write is async
- Syncs in batches of 10, staggered by station ID to distribute API load

### `/supervisor`
- PIN-protected live view, auto-refreshes every 30 seconds
- Active/Idle/Offline status per packer (idle = no scan in 10 min)
- Hourly breakdown chart per employee
- Daily leaderboard sorted by scan count
- Export to CSV button

### `/admin`
- Add or deactivate employees without touching code
- Set shift start/end times
- Both use the same supervisor PIN

---

## Offline Mode

The app detects connectivity loss within 30 seconds (active probe) or immediately (browser event). During offline mode:

- All scans are saved to IndexedDB with `syncStatus: "queued"`
- Screen shows live count of unsynced scans
- On reconnect, oldest scans sync first in batches of 10
- Zero data loss — scans persist across page refreshes and app crashes
- Circuit breaker: after 10 consecutive sync failures, pauses 5 minutes then retries

---

## Google Sheets Column Reference

### SCAN_LOG
| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| Timestamp | Employee Name | Employee ID | Barcode | Barcode Type | Shift | Station ID | Sync Status | Scan UUID |

### ERROR_LOG
| A | B | C | D | E | F |
|---|---|---|---|---|---|
| Timestamp | Station ID | Employee ID | Error Code | Message | Context (JSON) |

---

## Barcode Types Logged

| Type | Format |
|------|--------|
| `USPS_IMB` | 22-digit starting with 92/94/93/95/91/96 |
| `USPS_20` | 20-digit USPS prefix |
| `USPS_22` | 22-digit USPS |
| `USPS_30` | 30-digit USPS |
| `UPS` | `1Z` + 16 alphanumeric |
| `FEDEX_12` | 12-digit FedEx |
| `FEDEX_15` | 15-digit FedEx |
| `TIKTOK_ORDER` | Starts with TT/TO/TK |
| `WHATNOT_ORDER` | Starts with WN |
| `UNKNOWN` | No pattern matched — logged, not blocked |

---

## Capacity & Rate Limits

- Google Sheets API limit: 60 requests/minute
- 30 stations × 1 batch per 10s = ~3 requests/second max = **18 req/10s** — well within limits
- Burst protection: each station's flush is staggered by `(stationId % 10) × 1000ms`
- After network outage, all 30 stations draining queues simultaneously is the worst case — circuit breaker and backoff handle this gracefully

---

## Adding Employees (No Code Required)

1. Go to `/admin` and enter your PIN
2. Enter Employee ID (e.g. `EMP-042`) and Full Name
3. Click Add Employee
4. They appear in the login dropdown immediately on next page load

Or edit the EMPLOYEES tab in Google Sheets directly — set column C to `TRUE` to activate, `FALSE` to deactivate.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Employee list unavailable" on login | API unreachable or env vars not set | Check Vercel env vars, redeploy |
| Scans stuck as "queued" | Sheets API auth failure | Check service account JSON and spreadsheet sharing |
| Supervisor shows 403 | Wrong PIN or hash mismatch | Re-generate hash and update SUPERVISOR_PIN_HASH in Vercel |
| Scanner not triggering | Scanner not sending Enter | Reprogram scanner or use Zebra 123Scan utility |
| Double scans logged | Debounce window too short | Increase `DEBOUNCE_MS` in `ScanScreen.jsx` (default 300ms) |
| "SYNC PAUSED" badge | 10+ consecutive failures | Check internet, wait 5 min for auto-resume, or reload |
