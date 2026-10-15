# Stewart Blind Spot

A private, single-user research tracker that helps a SAG-AFTRA actor compare:

1. **Public casting opportunities** they can see,
2. **Submissions their agency reports** making on their behalf,
3. **Projects the agency reports that can't be found in the actor's public dataset** ("potential blind spots"), and
4. **Casting directors** who keep turning up on projects that fit the actor's professional profile.

> **Compliance by design.** This app never logs in to Actors Access or Breakdown Express, never asks for agency or representative credentials, never scrapes authenticated pages, and never bypasses CAPTCHAs or rate limits. Data comes only from public information, user-provided files (CSV/XLSX/JSON), and manual entry. A flagged project is only described as *"Agency-reported project not found in current public dataset."* It is never presented as proof of an agent-only breakdown.

Stack: Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS v4 · PostgreSQL · Prisma 6 · Recharts · exceljs / papaparse / pdf-lib · Vitest.

---

## Installation

Requirements: **Node.js 20+** (tested on 22), **PostgreSQL 14+** (tested on 16).

```bash
git clone <this repo> stewart-blind-spot
cd stewart-blind-spot
npm install
cp .env.example .env
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_USERNAME` | yes | Login username (default `paige`) |
| `APP_PASSWORD_HASH` | yes | bcrypt hash of your password. Generate it with `npm run hash-password -- "your-password"` and paste the printed line into `.env`. The `$` characters are escaped (`\$`) so Next.js doesn't mangle them. |
| `SESSION_SECRET` | yes | 32+ random characters for signing the session cookie, e.g. `openssl rand -base64 48` |
| `STALE_AFTER_DAYS` | no (14) | A record not re-verified within this many days is shown as **STALE** |
| `DEADLINE_ALERT_DAYS` | no (3) | Days before a deadline that trigger a `DEADLINE_APPROACHING` alert |
| `CRON_SECRET` | no | Enables `POST /api/cron/monitor` (24+ chars) |
| `INSECURE_COOKIES` | no | Set `true` only if you run the production build over plain HTTP on a LAN (not localhost) |
| `SMTP_*`, `ALERT_EMAIL_TO` | no | Reserved for future email alerts |

Never put Actors Access, Breakdown Express, or agency credentials in `.env`. The app has no use for them.

## Database setup

```bash
# create the database (adjust user/host as needed)
createdb stewart_blind_spot

# apply the schema
npx prisma migrate deploy        # or: npm run db:migrate  (development)

# optional: load fictional DEMO DATA so you can explore the app
npm run db:seed
```

All seeded records are fictional and carry a **DEMO DATA** badge in the UI. Remove them any time in **Settings → Data & privacy → Remove demo data**.

## Running locally

```bash
npm run dev            # http://localhost:3000  (development)

# or production
npm run build
npm start              # http://localhost:3000
```

Sign in with `APP_USERNAME` and the password you hashed.

Tests:

```bash
npm test               # unit tests (normalization, fuzzy matching, detection, profile matching, CSV/XLSX/JSON import, deadlines)
npm run test:db        # also runs DB integration tests against a database whose name ends in _test
                       # (default: postgresql://postgres:postgres@localhost:5432/stewart_blind_spot_test)
npm run typecheck
```

## Importing data

Go to **Imports**. There are two separate workflows:

**Public breakdowns** accepts CSV, XLSX, or JSON (an array of objects, or `{ "rows": [...] }`).
1. Upload a file (max 5 MB / 5,000 rows).
2. Map columns. Common headers are matched automatically; you can change any mapping. Fields: Project, Casting Director, Casting Office, Role, Role Type, Character Description, Age Range, Gender, Ethnicity (only as stated), Date, Deadline, Region, Union, Platform, Production Type, Visibility, Source, URL.
3. Preview. You'll see **rows found / valid / invalid / duplicates / potential matches**, each row's validation errors, and similar existing projects. For each row choose one: *Import as new project*, *Attach to an existing project*, *Overwrite existing record* (needs an extra confirmation), or *Skip*.
4. Import. Relevance gets recomputed, blind-spot detection re-runs, and alerts are generated.

**Agency submissions** accepts CSV or XLSX with the fields Date Submitted, Project, Role, Casting Director, Platform, Region, Union, Status, and Notes. The preview shows the detection result each row would get (public match / not found / needs review / possible duplicate). Duplicates are skipped by default.

Sample files are in `public/samples/` and linked from the Imports page. All of them are DEMO DATA.

You can also add everything by hand: **New breakdown** (Opportunities), **New agency submission**, **New project**, **New casting director**, and **Add watchlist item**.

## Finding auditions: three ways in

### 1. Paste a listing (no setup)
**Paste a Listing** in the sidebar: copy a breakdown you're looking at (for example on Actors Access, while signed in as yourself), a casting notice, or an email, and paste it in. **Read it** fills in the project, production type, platform, casting director and office, union, region and deadline, plus every role with its stated age, gender, ethnicity and role type. Check the fields, untick roles you don't want, name the source, and save. Each role becomes an opportunity with a relevance rating.
Switch to **Agency submission** to paste your agent's email ("we submitted you for HARBOR LIGHTS – Nora Vance"). It's saved as an agency submission and checked for blind spots right away.
Nothing is guessed: blank fields mean the text didn't say. Ethnicity is only filled in when the listing states it.

### 2. Web-wide search
On **Web Monitor → Search the whole web**:
- **Set up region searches** (one click) adds a free Google News casting feed for each of your target markets in Settings. If a search API key is configured, it also adds two web searches per city (e.g. `"now casting" "Chicago"`, `"casting call" "Chicago" actors`). These are checked every 12 hours.
- **Add a custom web search** with any query and region.
- Search needs your own API key in `.env`: `BRAVE_SEARCH_API_KEY` (Brave Search API, free plan available), or `GOOGLE_CSE_KEY` + `GOOGLE_CSE_ID` (Google Programmable Search). The free news feeds work without a key.
- Results show what the search engine returns (title, link, snippet), filtered by your region and excluded words, in the same findings inbox. The app doesn't open result pages, so results can point to any site the search engine indexes.

### 3. Email inbox
Put casting emails (casting newsletters, notices, your agent's submission emails) in one mail folder or Gmail label, e.g. **Casting**. Then add to `.env`:
```
IMAP_HOST="imap.gmail.com"
IMAP_PORT=993
IMAP_USER="you@gmail.com"
IMAP_PASSWORD="app password"     # Google Account → Security → App passwords (needs 2-Step Verification)
IMAP_FOLDER="Casting"
AGENT_EMAILS="youragency.com"    # emails from these addresses/domains are treated as agency submissions
```
**Email Inbox** (or `npm run monitor`) reads the newest emails in that folder **read-only**. It never deletes, moves, sends or marks anything as read. Each email becomes a draft: **Review & save** opens it in the paste form with the fields filled in. You can switch an email between "casting notice" and "agency submission", or dismiss it. The app password is only stored in your `.env` and you can revoke it any time. iCloud uses `imap.mail.me.com`; Outlook uses `outlook.office365.com`.

## Web Monitor (automatic checking of public pages)

**Web Monitor** in the sidebar automatically checks public casting pages and feeds that you choose, filtered by **region** and **keywords**, and collects new listings in a findings inbox.

1. **Add a source.** Enter a name, the URL, the type (RSS/Atom feed or web page), the region to monitor, keywords (e.g. `casting, audition, seeking`), words to exclude (e.g. `extras, background, unpaid`), and how often to check (minimum 1 hour, default 6). You must confirm the page is public and its terms allow automated checking.
2. **Check.** Sources are checked by `npm run monitor` (schedule it; see *Scheduled monitoring*) or with **Check now**.
3. **Review findings.** Each finding shows the region, platform and deadline it detected, which keywords matched, and a link to the original page. **Add as opportunity** creates an UNVERIFIED public breakdown (edit project/role first if you like). **Dismiss** hides it. New findings also create alerts.

**Easiest source for any region: Google Alerts as RSS.** At google.com/alerts, create an alert such as `"now casting" Chicago` or `"casting call" Atlanta`. Under *Show options*, set *Deliver to* to *RSS feed*, then paste the feed link here as an RSS source. Make one alert per region.

**Built-in safety rules (can't be switched off):**
- It never contacts Actors Access, Breakdown Express, Breakdown Services or other account-based casting platforms (the list is in `src/lib/web/policy.ts`), including via redirects.
- It obeys robots.txt. If robots.txt disallows the page, or can't be read, the page is skipped.
- It sends no cookies or credentials and identifies itself honestly (`StewartBlindSpot/1.0`).
- It stops at login pages, HTTP 401/403 and CAPTCHA/bot checks, and pauses that source automatically. It never tries to get past them.
- It makes one page request per source per check, with at least 60 minutes between scheduled checks (10 minutes for manual checks). It honors HTTP 429 "slow down".
- It only fetches public internet addresses (no local network), with a 2 MB page limit and a 15-second timeout.
- Findings are UNVERIFIED until you check them. Region, deadline and platform are only picked up when the text states them (for example, a deadline must be labelled "Deadline", "Submit by" or similar).

## Using blind spot detection

Each agency submission is automatically:
1. normalized (so "Untitled Paramount+ Series" and "Paramount+ Untitled Series" compare as equal),
2. compared against every project that has a public breakdown on **title, casting director/office, role, platform, region, and date proximity**, then
3. classified:
   - `PUBLIC_MATCH` means one clear likely match was found.
   - `AGENCY_REPORTED_NOT_FOUND` means nothing similar was found. The UI calls this a **Potential blind spot** and explains it as *"Agency-reported project not found in current public dataset."*
   - `NEEDS_REVIEW` means a similar project exists but the match is uncertain (for example, different platforms or casting directors, or an untitled project with no casting director to confirm it).
   - `POSSIBLE_DUPLICATE` means it looks like the same submission recorded twice.

Open **Blind Spots → (item)** for a side-by-side factor table. Uncertain matches are **never merged automatically**. To link a submission to a public project you have to tick a confirmation box. You can also *Confirm not found in public dataset*, *Dismiss*, or *Reopen & re-run detection*, and add notes. Results you've reviewed are never overwritten by later automatic re-runs. Unreviewed items are re-checked whenever new public data arrives. **Re-run detection** does the same thing on demand.

## Adding casting directors

**Casting Directors → New casting director**, or they're created automatically from imported credits (`"Jane Doe & John Roe, CSA"` becomes two people). A casting director's **"based in"** location is stored separately from project/breakdown regions, and one is never inferred from the other. Each casting director page shows current and recent projects, platform, region, production type, public breakdowns found, agency-reported projects, last activity, and source links. Counts are activity frequency only, **never a ranking**.

## Adding watchlists

Use **Watch / Unwatch** on any casting director, casting office, or project page, or go to **Watchlist → Add watchlist item** to watch a casting director, casting office, platform, project, or region. Matching activity shows up on the dashboard, on the Watchlist page, and as `WATCHLIST_ACTIVITY` alerts.

## Exporting reports

**Reports** has a Weekly Casting Report (new public opportunities, potential matches, agency submissions, potential blind spots, watched casting directors, upcoming deadlines) and a Monthly Report for any month (totals, public vs agency-reported, blind spots, and breakdowns by platform, region, and casting director). Each exports as **CSV**, **XLSX**, or **PDF**. Exports include private agency information, so keep them private. Exported cells are escaped against spreadsheet formula injection.

## Scheduled monitoring

```bash
npm run monitor
# crontab example (every 6 hours):
# 0 */6 * * * cd /path/to/app && npm run monitor >> monitor.log 2>&1
```

A monitor run checks your Web Monitor sources that are due, executes enabled, compliant source adapters (none by default), recomputes relevance, re-runs detection for unreviewed submissions, and emits deduplicated alerts. If `CRON_SECRET` is set, `POST /api/cron/monitor` with `Authorization: Bearer <CRON_SECRET>` does the same thing.

## Future API integration

New data sources plug in as **Source Adapters** (`src/lib/adapters/`). Copy `permitted-api-template.ts`, implement `fetch() → normalize() → validate() → save()`, fill in `compliance` (the terms URL and minimum interval are required), and register it in `registry.ts`. Scheduled adapters only run when `enabled`, `mode: "SCHEDULED"`, `compliance.automated`, **and** a `termsUrl` are all set. Only connect sources whose terms permit automated access for this use. If a source doesn't allow it, stay with the manual import workflow. See `ARCHITECTURE.md`.

Email alerts: implement `emailChannel.deliver()` in `src/lib/alerts/channels.ts` (e.g. with nodemailer) and set the `SMTP_*` variables.

## Security considerations

- **Single-user auth.** The password is stored only as a bcrypt hash in env. Sessions use an HS256-signed, httpOnly, SameSite=Lax cookie (Secure in production). Login attempts are throttled.
- **Protected routes.** Middleware protects every page and API route, and every server action and route handler re-checks the session.
- **No third-party credentials.** The app never stores Actors Access, Breakdown Express, or agency passwords.
- **Upload sanitizing.** The extension allow-list is enforced per workflow, XLSX files must pass a ZIP magic-byte check, there's a 5 MB / 5,000-row cap, control characters are stripped, cell length is capped, only http(s) URLs are accepted, and every row is re-validated on the server before writing.
- **Queries.** All DB access goes through the Prisma ORM, so queries are parameterized.
- **Private data stays private.** Agency data never leaves your database. Pages are `noindex`, and security headers (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`) are set. Report downloads are `Cache-Control: private, no-store`.
- **Audit log.** Imports, creates, edits, deletes, blind-spot creation/resolution, and watchlist changes are all recorded with timestamps (**Audit log** in the sidebar).
- **Source honesty.** Every external record keeps its source, source URL, discovered date, and last-verified date, and the UI marks records **UNVERIFIED**, **STALE**, or **CASTING CLOSED**. Old information is never shown as current.
- **No demographic assumptions.** Relevance only uses breakdown details that are stated explicitly. Ethnicity is compared only when the breakdown states a requirement, and nothing is ever inferred from a character description.
