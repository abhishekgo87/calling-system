# Omixo Call Test

An internal test application and CRM telephony foundation that places automated phone calls (OBD) and bridged two-leg calls (Click-to-Call) through the Omixo AI REST API and displays call history.

---

## 1. Stack & Architecture

This repository is structured as a TypeScript monorepo with strict type-safety (`strict: true`, zero `any`):

- **Monorepo**:
  - `/server`: Node 20+, Express, Mongoose (MongoDB), Zod schema validation, Helmet security headers, Express Rate Limit. Dev runner: `tsx`. Build: `tsc`.
  - `/client`: React 18, Vite, TypeScript, React Router 6, TanStack Query 5. Plain CSS (utility console styling, IBM Plex Sans, no UI framework).
- **Network / Proxy**: Vite dev server proxies `/api` requests to Express (`http://localhost:4000`), avoiding cross-origin issues during local development.

---

## 2. Quickstart (Get Running in < 5 Minutes)

### Prerequisites
- Node.js 20+ (tested on Node v24)
- npm 10+

### Step 1: Install Dependencies
From the repository root:
```bash
npm install
```
*(This automatically installs dependencies for both `server` and `client` workspaces).*

### Step 2: Configure Environment
Copy the example environment file to `server/.env`:
```bash
# On Windows PowerShell
Copy-Item server/.env.example server/.env

# On macOS / Linux
cp server/.env.example server/.env
```

By default, `server/.env` comes ready with Mock Mode enabled (`OMIXO_MOCK=true`), so you can test the application immediately without spending money or needing an active API key:
```env
OMIXO_API_KEY=mock_omixo_api_key_for_testing
OMIXO_BASE_URL=https://api.omixo.ai/api/v1
ALLOWED_NUMBERS=9876543210,9123456789
MONGODB_URI=mongodb://127.0.0.1:27017/omixo-test
PORT=4000
OMIXO_MOCK=true
```

### Step 3: Run the Application
Run both client and server concurrently with one command from the root:
```bash
npm run dev
```

Or run each service individually in separate terminals:
```bash
# Terminal 1: Backend Server
npm run dev:server

# Terminal 2: Frontend Client
npm run dev:client
```

- **Frontend Client**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:4000](http://localhost:4000)

---

## 3. Switching Off Mock Mode (Using Live Omixo API)

When you are ready to place real telephone calls using your Omixo AI account:

1. Open `server/.env`.
2. Set `OMIXO_MOCK=false`.
3. Fill your genuine Omixo API key in `OMIXO_API_KEY`:
   ```env
   OMIXO_API_KEY=cpaas_your_live_key_here
   OMIXO_BASE_URL=https://api.omixo.ai/api/v1
   ALLOWED_NUMBERS=9876543210,9123456789
   MONGODB_URI=mongodb://127.0.0.1:27017/omixo-test
   PORT=4000
   OMIXO_MOCK=false
   ```
4. Restart the server (`npm run dev:server` or `npm run dev`).
5. The server will output: `🔐 Live Omixo API mode enabled.` instead of the mock mode warning banner.

---

## 4. Security Rules Implementation

This project implements all hard security rules specified in the requirements:

| Security Rule | Implementation Detail |
|---|---|
| **API Key Isolation** | `OMIXO_API_KEY` lives only in `server/.env` and is read strictly in `config.ts`. It is **never** bundled in Vite client code, never returned in API responses, and never logged to console. |
| **Strict Server-Side Allow-List** | Calls are strictly restricted to phone numbers configured in `ALLOWED_NUMBERS`. Even if client-side validation is bypassed, `POST /api/calls` rejects any unlisted number with **HTTP 403 Forbidden**. |
| **Git Safety & Exclusion** | `.gitignore` explicitly excludes `.env`, `server/.env`, `client/.env`, `node_modules`, and `dist` build folders. Safe template provided in `server/.env.example`. |
| **Request Body Validation** | Every incoming request payload is validated with Zod. Phone numbers are normalized using `normalizePhone()` to their last 10 digits before allow-list verification and dispatch. |
| **Server-Side Rate Limiting** | `POST /api/calls` enforces a rate limit of 20 requests per minute via `express-rate-limit`. Exceeding requests receive HTTP 429 (`"Too many requests, wait a minute."`). |

---

## 5. Bridge Call (Click-to-Call) Architecture

The application includes two-leg bridged calling via Omixo's `POST /calls/click-to-call`:

1. **Call Flow**:
   - The user supplies an agent number and a customer number.
   - Omixo calls the agent's phone first.
   - When the agent answers, Omixo dials the customer's phone and bridges the two together.
   - The customer sees the company's virtual DID (`+91 5226523628`) as caller ID.
2. **No-Status Limitation & CDR Reconciliation**:
   - Unlike OBD automated calls (`GET /calls/obd/{id}`), Omixo does **not** provide a live progress endpoint for Click-to-Call.
   - The UI displays a step tracker showing `"Ringing agent"`, and polls `GET /api/bridge/:id/result` every 5 seconds (up to 4 minutes).
   - The server reconciles the call against the live Call Detail Records (`GET /calls/records`) by matching the customer's or agent's 10-digit number and timestamps within 1 minute of `placedAt`.
   - Once logged by Omixo, the step tracker completes and displays talk time, disposition, and cost.
3. **Mock Mode & `no_plan` Testing**:
   - In mock mode (`OMIXO_MOCK=true`), bridge calls simulate a 10-second completion and generate realistic CDR records.
   - To test the **402 `no_plan`** error handling in mock mode, enter `9000000000` as either the agent or customer number. The UI will render the prominent calling plan required banner.
4. **Hangup**:
   - Active bridge calls can be cancelled before completion using the **Hang up** button, which triggers `POST /api/bridge/:id/hangup` (`POST /calls/hangup` on Omixo) and updates local status to `hung_up`.

---

## 6. Outbound Capacity Test Architecture

The application includes an outbound concurrency capacity test accessible at `/capacity`:

1. **Test Goal & Concurrency Measurement**:
   - Dispatches $N$ parallel OBD calls (2 to 5 numbers) using `Promise.allSettled`, without awaiting one call before starting the next.
   - Measures exact milliseconds offsets from `startedAt` for request dispatch (`requestSentAtMs`), completion (`requestDoneAtMs`), first seen `queued`, `ringing`, `answered`, and `final`.
   - Polling runs in the background every 2 seconds for up to 90 seconds.
2. **Hard Safety Controls**:
   - Fixed spoken message: `"Namaste, ye capacity test call hai. Dhanyavaad!"` (no custom text).
   - Rate limit: Only 1 run active at a time, and at most 1 run per 2 minutes (server enforces HTTP 429).
   - Mandatory consent checkbox: User must explicitly confirm `"These phones are ready and belong to the test team"` before the run button activates.
   - Unique phone numbers check (HTTP 422 if duplicate numbers are provided).
3. **Honest Concurrency Limit**:
   - The UI and summary explicitly highlight that the test only reflects behavior up to the number of phones tested (e.g. "at least 4 concurrent calls worked", not the absolute ceiling).
4. **Mock Mode Simulation**:
   - In mock mode (`OMIXO_MOCK=true`), calls simulate realistic random 0-to-3 second ringing delays so concurrency behavior can be tested at zero cost.

---

## 7. Endpoints & API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/config` | Returns `{ allowedNumbers: string[] }` for phone chips and hint display. |
| `GET` | `/api/account` | Proxies `GET /me` and returns `{ name, status, walletBalance, currency }`. |
| `POST` | `/api/calls` | Validates body `{ to, message }`, checks allow-list (403), calls `placeObdCall`, saves to MongoDB, returns saved call. |
| `GET` | `/api/calls/:omixoCallId` | Polls `getObdCall(id)`, syncs updated status/disposition/duration to MongoDB, and returns record. |
| `GET` | `/api/calls?limit=50` | Returns calls placed from this application stored in MongoDB (newest first). |
| `GET` | `/api/records?limit=50` | Proxies `getCallRecords` and normalizes call detail records with `+05:30` IST ISO timestamps. |
| `POST` | `/api/bridge` | Originates bridge call with body `{ agent, customer }`, rate-limited to 10 req/min. |
| `POST` | `/api/bridge/:omixoCallId/hangup` | Cuts an active bridge call via Omixo `POST /calls/hangup` and sets Mongo status to `hung_up`. |
| `GET` | `/api/bridge/:omixoCallId/result` | Reconciles bridge call against latest CDRs and updates Mongo record when logged. |
| `POST` | `/api/capacity/outbound` | Originates parallel outbound calls (2-5 phones), rate-limited to 1 run per 2 mins. |
| `GET` | `/api/capacity/:runId` | Returns specific capacity test run and call progression offsets. |
| `GET` | `/api/capacity` | Returns the last 10 capacity test runs. |

---

## 8. Type-Check and Production Build

Both client and server support zero-error strict TypeScript type-checking and production builds:

```bash
# Run strict TypeScript checks across both workspaces
npm run typecheck

# Build both server (dist/) and client (dist/) bundles
npm run build
```

---

## 9. Assumptions & Unverified Behaviors

- **Real Omixo API Connectivity**: Verified against live account schema and mock simulation. Live calls require team phones and active wallet balance.
- **MongoDB Connection**: Connects to `MONGODB_URI` (`mongodb://127.0.0.1:27017/omixo-test` by default). An in-memory repository fallback is provided so developers can immediately test the full UI and API flows without friction.

