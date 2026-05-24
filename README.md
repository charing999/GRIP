# GRIP

QR payment security system for traditional markets. Built to detect and block QR tampering, SQL injection, and brute force attacks in real time.

---

## What it does

Traditional market vendors generate a signed QR code that embeds their GPS coordinates. Consumers scan the QR to initiate payment. The server validates the HMAC signature, checks that the consumer is physically close to the merchant, and rejects any replayed or expired QR. Every suspicious event is logged and surfaced on an admin dashboard with AI-generated summaries.

Security features:

- HMAC-SHA256 signed QR codes with expiry and nonce-based replay prevention
- Location verification using Haversine distance, rejecting payments beyond 100 meters
- SQL injection detection on login input via meta-character pattern matching
- Brute force protection with in-memory sliding window rate limiting per IP and 30-minute account lockout after 5 failed attempts
- Local LLM analysis via Ollama that summarizes anomaly patterns and generates block recommendations for admins
- Real-time security event feed on the dashboard via SSE

---

## Stack

- Node.js, Express
- Supabase, PostgreSQL with Row Level Security
- Vanilla JS, no frontend framework
- Chart.js via CDN for dashboard charts
- Ollama with Gemma 4 for local AI analysis

---

## Project structure

```
GRIP/
├── index.js
├── routes/
├── controllers/
├── middleware/
│   ├── auth.middleware.js        JWT verification
│   ├── rateLimit.middleware.js   In-memory sliding window rate limiter
│   └── sqliDetect.middleware.js  SQL meta-character detection
├── lib/
│   ├── supabase.js
│   ├── hmac.js                   HMAC-SHA256 sign and verify
│   ├── haversine.js              Distance calculation in meters
│   └── localAI.js               Ollama fetch wrapper
├── services/
│   └── aiAnalyzer.js            Periodic AI analysis loop
├── public/
│   ├── index.html               Consumer payment screen
│   ├── merchant.html            Merchant QR generation screen
│   ├── payment.html             Payment confirmation screen
│   └── dashboard.html           Admin security dashboard
├── db/
│   └── schema.sql
└── tests/
    ├── schema/
    ├── backend/
    └── frontend/
```

---

## Getting started

### Prerequisites

- Node.js 18 or later
- A Supabase project
- Ollama installed locally with Gemma 4 pulled

### Install

```bash
git clone https://github.com/charing999/grip.git
cd grip
npm install
```

### Configure environment

```bash
cp .env.example .env
```

Fill in the values:

```
PORT=3000
NODE_ENV=development

SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

HMAC_SECRET=
MAX_DISTANCE_METERS=100

OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=gemma4
AI_ANALYSIS_INTERVAL_MINUTES=5
DISABLE_AI=false
```

SUPABASE_SERVICE_ROLE_KEY is server-only. Never expose it on the client side.

### Initialize the database

Run db/schema.sql in the Supabase SQL Editor. This creates all tables, indexes, triggers, and RLS policies.

### Run

```bash
npm run dev     # development with nodemon
npm start       # production
```

Server starts at http://localhost:3000. Health check at /api/health.

---

## API overview

All endpoints are under /api. Protected routes require an Authorization: Bearer header with a valid JWT.

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout

POST   /api/payments/request    Generate a signed QR code
POST   /api/payments/verify     Validate QR and execute payment
GET    /api/payments/history    Transaction history

GET    /api/dashboard/stats     Aggregated security event counts
GET    /api/dashboard/ai-alerts AI analysis results

GET    /api/security/events     Security event feed via SSE

GET    /api/admin/users         List all users
POST   /api/admin/block         Block a user
```

Response format:

```json
{ "success": true, "data": {} }
{ "success": false, "error": { "code": "ERROR_CODE", "message": "description" } }
```

Error codes: INVALID_CREDENTIALS, ACCOUNT_LOCKED, SQLI_DETECTED, RATE_LIMITED, INVALID_QR, REPLAY_QR, INSUFFICIENT_BALANCE, UNAUTHORIZED, FORBIDDEN, LOCATION_MISMATCH.

---

## Testing

```bash
npm test               # all tests
npm run test:schema    # schema and RLS tests
npm run test:backend   # API endpoint tests
npm run test:frontend  # client-side unit tests
```

---

## AI analysis

The server runs an analysis loop every 5 minutes by default. It pulls recent security events and transactions, sends them to the local Ollama instance, and stores the result as an AI_ALERT event. Admins see these on the dashboard as natural language summaries with block recommendations.

AI does not make blocking decisions autonomously. Deterministic rules handle all blocking. The LLM only produces summaries and recommendations.

Set DISABLE_AI=true to skip AI analysis entirely if Ollama is not available.

---

## Notes

- Do not commit .env
- Do not expose SUPABASE_SERVICE_ROLE_KEY to any client-facing code
- The in-memory rate limiter resets on server restart; use an external store if you need persistence across restarts
