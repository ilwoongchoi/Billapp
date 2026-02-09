# BillPilot (MVP starter)

Utility bill analyzer built with Next.js + Supabase + Stripe.

## Features shipped

- Dashboard: `GET /dashboard`
  - Supabase magic-link sign in
  - launch checklist (sign-in -> property -> bill data -> reports -> deploy)
  - property management
  - parser console (upload + parse + insights)
  - performance snapshot (cost/confidence + next-bill forecast)
  - billing upgrade buttons (Stripe checkout + portal)
  - webhook diagnostics + bill history table + demo seed controls
  - monthly report automation settings + send-now control
- Dispatch optimizer: `GET /dashboard/dispatch`
  - route + margin scoring (fuel/time weighted)
  - κ-band drift classification (`flat_line` / `life` / `chaos`)
  - residual budget + falsifier readout
  - persisted run history + basin telemetry
- Property analytics: `GET /dashboard/property/[propertyId]`
  - trend charts
  - date/provider filters
  - CSV/PDF export
- API routes:
  - `GET /api/health` (env readiness + Supabase runtime/table checks + deployment verdict)
  - `GET /api/analytics/summary` (auth-protected performance snapshot)
  - `POST /api/properties` and `GET /api/properties`
  - `GET /api/bills/history`
  - `GET /api/bills/export`
  - `POST /api/bills/demo-seed`
  - `POST /api/bills/upload`
  - `POST /api/bills/parse`
  - `GET /api/reports/monthly/status`
  - `POST /api/reports/monthly/settings`
  - `POST /api/reports/monthly/send`
  - `POST /api/reports/monthly/run` (cron endpoint)
  - `POST /api/dispatch/score`
  - `GET|POST /api/dispatch/runs`
  - `GET /api/dispatch/basins`
  - `POST /api/stripe/checkout`
  - `POST /api/stripe/portal`
  - `GET /api/stripe/status`
  - `POST /api/stripe/webhook`
  - `POST /api/twilio/voice/inbound` (public Twilio voice webhook)
  - `POST /api/twilio/voice/status` (public Twilio call status callback)
  - `POST /api/twilio/sms/inbound` (public Twilio SMS webhook)
  - `GET /api/reception/overview`
  - `GET|POST /api/reception/business`
  - `GET|POST /api/reception/bookings`
  - `GET /api/reception/reschedule-requests`
  - `PATCH /api/reception/reschedule-requests/[requestId]`
  - `GET /api/reception/reminders/status`
  - `POST /api/reception/reminders/run` (auth or cron header)
  - `GET /api/reception/reschedule-requests`
  - `POST /api/reception/reschedule-requests/escalate` (auth or cron header)
  - `PATCH /api/reception/reschedule-requests/[requestId]`
  - `PATCH /api/reception/leads/[leadId]`
  - `PATCH /api/reception/bookings/[bookingId]`
- Free tier gate:
  - 2 analyses/month for `free`
  - unlimited for active/trialing paid plans
- Reception reminder SMS supports quick replies:
  - `C` / `confirm` => confirms nearest upcoming booking
  - `R` / `reschedule` => marks booking as reschedule-requested and offers available slots
  - `1` / `2` / `3` => selects one of the offered reschedule slot options
  - `4` => requests another batch of available slot options
- Reception dashboard reschedule queue:
  - status filter
  - per-request staff notes + status updates
  - assignee + SLA due controls
  - overdue action-required visibility
  - bulk actions (options sent / handoff / close)
  - escalation sweep (dry run + apply)

## Environment

Copy env template:

```bash
cp .env.example .env.local
```

Minimum vars for full flow:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_PEAKGUARD_URL` (optional cross-link to PeakGuard trial)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_STARTER_PRICE_ID`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_TEAM_PRICE_ID`
- `RESEND_API_KEY`
- `REPORTS_FROM_EMAIL`
- `MONTHLY_REPORT_CRON_SECRET`
- `TWILIO_ACCOUNT_SID` (for Twilio integration)
- `TWILIO_AUTH_TOKEN` (for Twilio integration)
- `TWILIO_PHONE_NUMBER` (for Twilio integration)
- `RECEPTION_REMINDER_CRON_SECRET` (for reminder cron trigger)

## Supabase migrations

Run in order:

1. `supabase/migrations/20260207052000_init_billpilot.sql`
2. `supabase/migrations/20260207061000_billing_indexes_and_storage.sql`
3. `supabase/migrations/20260207073000_webhook_events.sql`
4. `supabase/migrations/20260207090000_monthly_reports.sql`
5. `supabase/migrations/20260207095000_hardening_constraints.sql`
6. `supabase/migrations/20260207100000_bills_history_perf.sql`
7. `supabase/migrations/20260207101000_ai_receptionist_mvp.sql`
8. `supabase/migrations/20260207103000_booking_reminders.sql`
9. `supabase/migrations/20260207104500_reschedule_requests.sql`
10. `supabase/migrations/20260207110000_reschedule_queue_ops.sql`
11. `supabase/migrations/20260207113000_reschedule_escalation.sql`
12. `supabase/migrations/20260207114500_dispatch_optimizer.sql`

## Local run

Run preflight before starting:

```bash
npm run preflight
```

Then run app:

```bash
npm run dev
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/dashboard`
- `http://localhost:3000/dashboard/reception`
- `http://localhost:3000/dashboard/dispatch`
- `http://localhost:3000/api/health`

Run smoke test (in another terminal while dev server is running):

```bash
npm run smoke
```

Smoke now verifies:
- `/api/health`
- `/api/bills/parse`
- `/dashboard`
- `/dashboard/reception`
- `/dashboard/dispatch`
- auth guards on `/api/analytics/summary`, `/api/bills/history`, `/api/bills/demo-seed`, `/api/reception/overview`, `/api/reception/reminders/status`, `/api/reception/reschedule-requests`, `/api/dispatch/runs`, `/api/dispatch/score`

Or run dev server + smoke automatically:

```bash
npm run dev:smoke
```

Parse endpoint perf check (server must be running):

```bash
npm run perf:parse
```

Or auto-start dev server + run parse perf:

```bash
npm run dev:perf:parse
```

Run runtime QA bundle (dev smoke + dev perf):

```bash
npm run qa:runtime
```

Optional knobs:
- `BILLPILOT_PERF_ITERATIONS` (default `20`)
- `BILLPILOT_PERF_CONCURRENCY` (default `4`)
- `BILLPILOT_PARSE_P95_BUDGET_MS` (default `2000`)

Deployment check bundle:

```bash
npm run deploy:check
```

Full local QA bundle (deploy check + dev smoke):

```bash
npm run qa:local
```

Full QA (deploy check + runtime QA):

```bash
npm run qa:full
```

## Deploy (recommended: Vercel)

1) Push this repo to GitHub.
2) In Vercel: **New Project → Import Git Repo → Deploy**.
3) In Vercel Project Settings → **Environment Variables**, set at minimum:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL` (your production URL, e.g. `https://your-app.vercel.app`)

Then (optional features):
   - Stripe billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_TEAM_PRICE_ID`
   - Monthly reports: `RESEND_API_KEY`, `REPORTS_FROM_EMAIL`, `MONTHLY_REPORT_CRON_SECRET`
   - Reception: `TWILIO_*`, `RECEPTION_REMINDER_CRON_SECRET`

4) In Supabase:
   - Run migrations in `supabase/migrations/` (in order).
   - Add your Vercel domain to **Auth → URL Configuration** (redirect URLs for magic links).
5) After deploy, verify:
   - `GET https://<your-domain>/api/health` shows `deployment.deployable=true`
   - Run smoke test against prod:
     ```bash
     BILLPILOT_BASE_URL=https://<your-domain> npm run smoke
     ```
6) If Stripe enabled:
   - Create a Stripe webhook endpoint pointing to `https://<your-domain>/api/stripe/webhook`
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`
7) If you use cron endpoints, schedule:
   - `POST /api/reports/monthly/run` with header `x-cron-secret: $MONTHLY_REPORT_CRON_SECRET`
   - `POST /api/reception/reminders/run` with header `x-cron-secret: $RECEPTION_REMINDER_CRON_SECRET`

## Cron trigger (monthly automation)

Call with your cron secret header:

```bash
curl -X POST http://localhost:3000/api/reports/monthly/run \
  -H "x-cron-secret: $MONTHLY_REPORT_CRON_SECRET"
```

## Cron trigger (reception reminders)

Call with receptionist cron secret header:

```bash
curl -X POST http://localhost:3000/api/reception/reminders/run \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $RECEPTION_REMINDER_CRON_SECRET" \
  -d '{"dryRun":false}'
```

## Cron trigger (reschedule escalation sweep)

Call with receptionist cron secret header:

```bash
curl -X POST http://localhost:3000/api/reception/reschedule-requests/escalate \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $RECEPTION_REMINDER_CRON_SECRET" \
  -d '{"dryRun":false,"limitUsers":50,"maxRows":150}'
```

## API auth notes

- Protected routes require:
  - `Authorization: Bearer <supabase_access_token>`
- Protected routes:
  - `/api/properties`
  - `/api/bills/history`
  - `/api/bills/export`
  - `/api/bills/demo-seed`
  - `/api/reports/monthly/status`
  - `/api/reports/monthly/settings`
  - `/api/reports/monthly/send`
  - `/api/stripe/checkout`
  - `/api/stripe/portal`
  - `/api/bills/upload` when `propertyId` is provided
  - `/api/bills/parse` when `propertyId` is provided
  - `/api/reception/overview`
  - `/api/reception/business`
  - `/api/reception/bookings`
  - `/api/reception/reschedule-requests`
  - `/api/reception/reschedule-requests/[requestId]`
  - `/api/reception/leads/[leadId]`
  - `/api/reception/bookings/[bookingId]`
  - `/api/reception/reminders/status`
  - `/api/reception/reminders/run` (auth required unless cron secret header is used)
  - `/api/reception/reschedule-requests`
  - `/api/reception/reschedule-requests/escalate` (auth required unless cron secret header is used)
  - `/api/reception/reschedule-requests/[requestId]`
  - `/api/dispatch/score`
  - `/api/dispatch/runs`
  - `/api/dispatch/basins`

## Filter + export query params

- `/api/bills/history` and `/api/bills/export` support:
  - `propertyId=<uuid>`
  - `provider=<substring>`
  - `dateFrom=YYYY-MM-DD`
  - `dateTo=YYYY-MM-DD`
  - `limit=<int>`
- `/api/bills/history` also supports:
  - `offset=<int>`
  - response `page` metadata: `limit`, `offset`, `total`, `hasMore`

## Quick parse (public, no property persistence)

```bash
curl -X POST http://localhost:3000/api/bills/parse \
  -H "Content-Type: application/json" \
  -d '{
    "rawText":"Provider: North Utility\nBilling Period: 01/01/2026 - 01/31/2026\nTotal Amount Due: $182.44\nUsage: 648 kWh\nDelivery: 42.12\nTax: 11.21",
    "priorBills":[
      {"totalCost":150.10,"usageValue":590,"periodEnd":"2025-12-31"},
      {"totalCost":161.80,"usageValue":605,"periodEnd":"2025-11-30"},
      {"totalCost":155.00,"usageValue":598,"periodEnd":"2025-10-31"}
    ]
  }'
```

## Demo seed (auth required)

Populate sample bill history for a property (good for local UI testing):

```bash
curl -X POST http://localhost:3000/api/bills/demo-seed \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <supabase_access_token>" \
  -d '{
    "propertyId":"<property_uuid>",
    "months":6,
    "replaceExisting":false
  }'
```
