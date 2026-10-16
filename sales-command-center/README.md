# Sales Command Center

A shared workspace for a **coordinator** and their **sales rep(s)**: leads, territories, weekly route plans, appointments and reschedules, visit feedback, follow-ups, sales, reports, notifications, and lead import from screenshots or CSV files. Everything lives in one database, so a visit recorded on a phone shows up on the coordinator's dashboard, the lead's history, the calendar and the reports at the same time.

- **Coordinator:** sees everything and manages leads, territories, schedules, users and settings. Approves reschedules.
- **Sales rep:** sees only their own leads, schedule, visits and sales. Records visits from the phone and *requests* schedule changes.

Permissions are enforced on the server for every page, action and export; hiding a button is never the only protection.

---

## Quick start

You need **Node.js 20+** and **PostgreSQL 14+** running locally (on a Mac, [Postgres.app](https://postgresapp.com) is the easiest).

```bash
cd sales-command-center
npm run setup     # installs, writes .env, creates the database, your login, builds
npm start         # http://localhost:3100
```

Setup asks for:
- your time zone (default America/Chicago)
- whether you'll use a phone on your Wi-Fi
- an optional Anthropic API key for reading screenshots
- your coordinator login
- optionally, the rep's login and labeled demo data

It's safe to run again: it keeps the existing `.env`, database and users.

**On your phone:** answer "yes" to the phone question during setup, then open the address setup prints (e.g. `http://192.168.1.20:3100`) from a phone on the same Wi-Fi. For use away from home, deploy it with HTTPS (see Deployment).

### Manual setup (instead of `npm run setup`)

```bash
cp .env.example .env            # then fill in DATABASE_URL and SESSION_SECRET
npm install
npm run db:deploy               # apply migrations
npm run create-user -- --role coordinator --email you@example.com --name "Your Name"
npm run create-user -- --role rep --email rep@example.com --name "Rep Name"
npm run build && npm start
```

---

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `SESSION_SECRET` | yes | Long random string used to sign login cookies (`openssl rand -base64 48`). Changing it signs everyone out. |
| `APP_TIMEZONE` | no | Default time zone (`America/Chicago`). Can be changed later in Settings. |
| `UPLOAD_DIR` | no | Where visit attachments and import screenshots are stored (`./uploads`). Back it up. |
| `ANTHROPIC_API_KEY` | no | Turns on automatic reading of lead screenshots. Used only on the server. Without it, screenshots are still stored and leads are typed in by hand. |
| `EXTRACTION_MODEL` | no | Vision model for screenshots (default `claude-opus-5-5`). |
| `EXTRACTION_PROVIDER` | no | Set to `none` to turn screenshot reading off even if a key is present. |
| `CRON_SECRET` | no | Enables `POST /api/cron/reminders` for an external scheduler (16+ characters). |
| `INSECURE_COOKIES` | no | `true` allows sign-in over plain `http` on a local network. **Never set this on an internet-facing deployment.** |

Secrets live only in `.env` (git-ignored) or your host's secret settings. Nothing secret is sent to the browser.

---

## How things work

- **Leads:**
  - Created by hand or imported.
  - Duplicates (same or similar name, phone, address or email) are flagged before saving.
  - Each lead keeps its complete history: visits, appointments with every move, follow-ups, opportunities, and an activity timeline.
- **Visits:**
  - Recorded by the rep in a few taps.
  - Feedback is stored exactly as typed.
  - A visit updates the lead's "last visited", latest feedback and next follow-up automatically. Phone calls count as contact, not visits.
- **Schedule:**
  - Each rep has a recurring weekly plan (e.g. Monday Area A).
  - Changing a single day overrides only that day. Changing the recurring plan updates every week that hasn't been individually changed.
- **Appointments:**
  - The same lead booked twice within the duplicate window is blocked; overlapping bookings require confirmation.
  - The coordinator moves appointments directly, including by drag and drop on the calendar.
  - A rep's move becomes a **reschedule request**, and nothing changes until the coordinator approves. The original time is always kept in the history.
- **Sales:**
  - **Closed sales and revenue count only closed-won deals**, by close date, each deal once.
  - **Pipeline** (estimated value of open opportunities) is shown separately and never added to revenue.
  - Closing a deal won or lost, changing a won amount, or reopening a won deal requires explicit confirmation.
  - Commission is optional and uses only the rate or amount you enter.
- **Reports:** every figure is counted from saved records, with the definitions shown on the page. Exports to CSV.
- **Import:** see below.
- **Notifications:**
  - In-app only. Email, text and push are **not** integrated, and the app never claims to have sent one.
  - Delivery channels can be added in `src/server/services/notifications.ts`.
- **Reminders:**
  - Covers due and overdue follow-ups, upcoming appointments, and a weekly digest of leads not visited recently.
  - Created automatically (at most every 10 minutes) while anyone is using the app. Each reminder is created once.
  - For reminders when nobody has the app open, schedule `npm run reminders`, or call `/api/cron/reminders` with `Authorization: Bearer $CRON_SECRET`, every 15 minutes.
- **Audit log:** every change, assignment, export and setting change is recorded (coordinator only, at `/audit`).
- **Demo data:**
  - Optional, from Settings or `npm run db:demo`.
  - Every demo record is named "… (demo)", marked "Demo", and flagged in reports.
  - "Remove demo data" deletes exactly those records (and their activity entries) and leaves real ones untouched.

### Importing leads

1. **Import Leads → Screenshots** (up to 30 images) or **CSV file**.
2. Each screenshot is read by the configured provider:
   - Text is copied exactly as it appears, the full raw text is kept with the image, and every value comes with a confidence rating.
   - Values that aren't visible are left blank, never guessed.
   - With no provider configured, the page says so and you add each lead by hand while viewing the image.
3. CSV columns are matched to lead fields by their names. You can change the matching.
4. **Review:**
   - Correct values. Missing, invalid and low-confidence values are flagged.
   - Possible duplicates are shown side by side with the existing lead.
   - For each row, choose **Create**, **Merge** (fills only empty fields on the existing lead and appends notes word for word) or **Skip**.
   - **Import ready rows** creates only rows with no problems and no duplicate match. Everything else stays for review, so partial imports are fine.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run setup` | One-step setup (see above). |
| `npm run dev` | Development server on port 3100. |
| `npm run build` / `npm start` | Production build / server on port 3100. |
| `npm run create-user -- --role coordinator\|rep --email … --name "…"` | Create a login, or reset an existing one's password. |
| `npm run reminders` | Generate reminders once (for cron). |
| `npm run db:deploy` | Apply database migrations. |
| `npm run db:demo` / `npm run db:seed -- --remove-demo` | Load / remove demo data. |
| `npm run typecheck` | TypeScript check. |
| `npm test` | Unit tests (no database needed; database tests are skipped). |
| `npm run test:db` | Unit + database tests. Needs a database whose name ends in `_test` (default `sales_command_center_test`); it is wiped on each run. |
| `npm run test:e2e -- --yes` | Browser end-to-end check against a running app. It **creates records**, so use a dev/staging database. Logins come from `E2E_*` variables (see `scripts/e2e.mjs`). |

---

## Deployment

The app is a standard Next.js server plus PostgreSQL. It runs on any host that keeps a Node process running, such as Render, Railway, Fly.io or a small VPS.

1. **Database:** use a managed PostgreSQL (Supabase, Neon, AWS RDS, Render, etc.) and set `DATABASE_URL`.
   - Most providers need `?sslmode=require`.
   - **Supabase:** use the *session* pooler or the direct connection (port 5432) for `prisma migrate deploy`. If the app itself runs through the *transaction* pooler (port 6543), add `?pgbouncer=true`.
2. **Environment:** set `DATABASE_URL`, `SESSION_SECRET` (new random value), `APP_TIMEZONE`, and optionally `ANTHROPIC_API_KEY` and `CRON_SECRET` in the host's secret settings. Do **not** set `INSECURE_COOKIES`.
3. **Build and start:** `npm ci && npm run db:deploy && npm run build`, then `npm start` (or `next start -p $PORT`).
4. **HTTPS:** serve it only over HTTPS. Login cookies are `Secure` in production.
5. **File storage:** attachments and import screenshots go to `UPLOAD_DIR` on local disk. Give the host a **persistent volume** for it. Serverless hosts with throwaway disks (e.g. Vercel, Netlify) need `src/server/storage.ts` swapped for object storage such as S3 or Supabase Storage first.
6. **Reminders:** reminders already run while people use the app. For reminders when nobody has it open, have the host's scheduler call `POST https://your-app/api/cron/reminders` with `Authorization: Bearer <CRON_SECRET>`, every 15 minutes.
7. **First login:** run `npm run create-user -- --role coordinator …` once against the production database.

Run a **single instance** unless you move login rate limiting (currently in memory) to a shared store.

---

## Backup and recovery

What to back up: the **PostgreSQL database** (all records, history, audit log) and the **`UPLOAD_DIR` folder** (attachments and screenshots).

- **Database:**
  - On a managed database, turn on automatic daily backups and point-in-time recovery.
  - Self-hosted: run a nightly `pg_dump --format=custom "$DATABASE_URL" > scc-$(date +%F).dump`, keep at least 14 days, and store copies off the machine.
- **Files:** copy `UPLOAD_DIR` nightly, e.g. `rsync -a uploads/ backup-location/` or a bucket sync.
- **Test a restore** every few months:
  1. `createdb scc_restore_test && pg_restore -d scc_restore_test scc-YYYY-MM-DD.dump`.
  2. Point a copy of the app at it and check that leads, visits and sales are there.
- **Recovering:**
  1. Restore the database and the uploads folder from the same night.
  2. Run `npm run db:deploy` to apply any newer migrations, then start the app.
  3. Users may need to sign in again.

Records are rarely deleted in normal use: leads and sales are *archived*, appointments are *canceled* with their history kept, and the audit log can't be edited from the app (the only entries ever removed are those of demo records when demo data is removed). A backup is still the only protection against losing the server or the database.

---

## Project layout

```
prisma/              schema, migrations, seed (demo data)
scripts/             setup, create-user, reminders, e2e
src/app/(app)/       pages (dashboard, leads, schedule, appointments, sales, reports, import, settings…)
src/app/actions/     server actions (thin: check login → call a service)
src/app/api/         exports (CSV), calendar feed, drag-move, files, cron
src/server/          auth, permission policy, services (all business rules), storage, extraction provider
src/lib/             pure logic (time zones, normalization, duplicates, sales math, rollups) + labels
tests/               unit tests and database tests
```

## Known limitations

- Notifications are in-app only. No email, SMS or push provider is integrated.
- Screenshot reading needs an Anthropic API key. Its accuracy depends on image quality, and every row is reviewed before import.
- Files are stored on the server's disk (see Deployment).
- Login rate limiting is per server process.
