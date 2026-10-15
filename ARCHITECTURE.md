# Architecture

```
src/
  app/                    Next.js App Router
    (app)/…               authenticated pages (dashboard, opportunities, blind-spots, …)
    actions/              server actions (all call requireUser())
    api/reports/[kind]    CSV / XLSX / PDF exports
    api/cron/monitor      optional scheduled-monitor webhook (CRON_SECRET)
    login/, logout/       single-user auth
  middleware.ts           session check on every route
  lib/
    constants.ts          regions, platforms, enums, the blind-spot explanation text
    normalize.ts          title / casting-director / office / role normalization
    matching/
      fuzzy.ts            explainable record similarity
      blindspot.ts        submission → classification (pure)
      profile.ts          actor-profile relevance (pure)
    deadlines.ts          deadline + source-freshness calculations (pure)
    import/               file parsing (CSV/XLSX/JSON), column mapping, row validation (pure)
    adapters/             Source Adapter interface, PUBLIC_DATA_IMPORT, API template, registry
    alerts/               alert channels + alert engine
    server/               Prisma-backed services (records, detection, imports, reports, watchlist, monitor)
prisma/                   schema, migrations, DEMO DATA seed
tests/                    Vitest unit + DB integration tests
```

The matching, detection, relevance, deadline, and parsing logic is **pure TypeScript with no DB access**, so it is unit-tested directly. The services in `lib/server` wrap those functions with persistence.

## Database architecture

| Model | Purpose |
|---|---|
| `Project` | A production. `normalizedTitle` is indexed for matching. `agencyReported=true` means the project exists only because an agency reported it (it's not in the public dataset). Source fields: `sourceName`, `sourceUrl`, `discoveredAt`, `verifiedAt`. |
| `CastingDirector` | A person. `normalizedName` is unique. `city`/`state` record **where the CD is based**, which is deliberately independent of project regions. |
| `ProjectCasting` | Many-to-many credit linking a CD to a project, with a `role` (e.g. "Casting Director (agency-reported)") and `castingOffice`. |
| `PublicBreakdown` | One public listing/role. `visibility` is PUBLIC/UNKNOWN/CLOSED. Role details are stored **exactly as stated** (age range, gender, ethnicity, union, description). `relevance` + `relevanceDetails` cache the explainable profile match. |
| `AgencySubmission` | A private agency-reported submission. Keeps the raw title and CD. `projectId` points to the matched public project or to an agency-only project. |
| `BlindSpot` | One detection result per submission: `classification`, `confidence` (record similarity, **not** a talent score), `matchDetails` (candidate list with per-factor notes), `candidateProjectId`, `reviewStatus`, notes. |
| `WatchlistItem` | `type` (CASTING_DIRECTOR / CASTING_OFFICE / PLATFORM / PROJECT / REGION) + `value`, with optional FK. |
| `ActorProfile` | A single editable row. `playingAgeMin/Max` are the numeric form of the display `castingRange`. |
| `Platform` | Custom platforms (the built-ins live in code). |
| `Alert` | In-app notification. `dedupeKey` is unique, so alert generation is idempotent. `deliveredTo` lists the channels used. |
| `AuditLog` | action, entity, summary, JSON details, timestamp. |
| `ImportBatch`, `SourceRun` | Import history and adapter run history. |

`isDemo` on the core models marks fictional seed/sample data, which the UI labels **DEMO DATA**.

## Matching engine

### Normalization (`normalize.ts`)
- **Titles.** The engine folds accents and case, maps `&` → `and`, and strips punctuation, season markers (`Season 2`, `S2`), and `(w/t)`. It then pulls out **platform words** (so `Paramount+` = `Paramount Plus`) and **generic words** (`untitled`, `series`, `pilot`, `project`, …). The remaining distinctive tokens are sorted, which makes the result order-insensitive. A title with no distinctive tokens is marked `isGeneric`, and its key is built from its platform and generic words, so `"Untitled Paramount+ Series"` ≡ `"Paramount+ Untitled Series"` while `"Untitled Netflix Series"` stays different.
- **Casting directors.** Accents, CSA/"Casting"/Inc suffixes, and middle initials are removed, and `Last, First` is flipped. Multi-name credits are split on `&`, `/`, `and`, and `;`.

### Record similarity (`matching/fuzzy.ts`)
`compareRecords(a, b)` returns `{ score, verdict, factors[], conflicts[] }`:

| Factor | Weight | Method |
|---|---|---|
| Title | 0.45 | token Jaccard / bigram Dice (order-insensitive), containment bonus; generic titles use platform agreement |
| Casting director / office | 0.20 | exact normalized name → 1; same surname + first initial → 0.85; otherwise Dice |
| Platform | 0.10 | canonical equality |
| Role | 0.10 | normalized role Dice |
| Date proximity | 0.10 | 1 within 7 days, linear decay to 0 at 120 days |
| Region | 0.05 | equal → 1; NATIONWIDE → 0.7; Atlanta/Southeast → 0.8 |

**Missing data is excluded from the weighting**, never counted as a mismatch. Thresholds: `LIKELY_MATCH ≥ 0.75` with no conflicts, `UNCERTAIN ≥ 0.45` (or a strong distinctive title). Safety rules:
- Any explicit **conflict** (different platform, CD, or region) blocks `LIKELY_MATCH`.
- **Generic titles** need casting-director corroboration (≥ 0.85) before they can be a likely match.
- If one title is generic and the other isn't, the pair is at most `UNCERTAIN`.

Every factor produces a human-readable note, which feeds the side-by-side review table.

### Blind-spot classification (`matching/blindspot.ts`)
1. **Duplicate check.** Same normalized title + same role + dates within 5 days → `POSSIBLE_DUPLICATE`.
2. Compare against all projects that have public breakdowns and keep the top 5 non-`NO_MATCH` candidates.
3. No candidates → `AGENCY_REPORTED_NOT_FOUND`, with the fixed explanation text.
4. The best candidate is `LIKELY_MATCH` and not ambiguous (no second likely match within 0.10) → `PUBLIC_MATCH`.
5. Anything else → `NEEDS_REVIEW`.

Persistence (`server/detection.ts`): a `PUBLIC_MATCH` links the submission to the public project. Every other outcome links it to an agency-only project, which is reused only on an exact normalized title with a compatible platform. Human-reviewed results (`reviewStatus ≠ UNREVIEWED`) are never overwritten by automatic re-runs. When a re-run upgrades a submission to `PUBLIC_MATCH`, the orphaned agency-only project is deleted and `BLIND_SPOT_RESOLVED` is logged. The user's "Link as same project" decision moves the credits and requires an explicit confirmation checkbox. Project merges (on the project page) also require confirmation.

### Profile relevance (`matching/profile.ts`)
Each factor comes out as MATCH / OPEN / MISMATCH / NOT_STATED / INFO:
- **Age.** The stated range is parsed (`25-35`, `20s-30s`, `late 20s to early 30s`, `45+`) and checked for overlap with the profile's playing age.
- **Gender.** Explicit value only. "Any/all genders" counts as OPEN.
- **Ethnicity.** Compared **only when the breakdown states a requirement**. "Open/all ethnicities" counts as OPEN. It is never inferred from descriptions or names.
- **Union.** Profile union plus unions listed in *Additional* (e.g. AEA). "Non-union only" is flagged.
- **Region, production type, platform.** Compared against target markets, primary work, and target platforms.
- **Role type.** Informational unless the profile lists preferred role types.
- **Character description.** Counts only when it **explicitly** mentions a skill that's in the profile (singing, dance).

Tier: any MISMATCH → **LOW**; age and gender both MATCH/OPEN plus ≥ 3 MATCH → **HIGH**; ≥ 2 MATCH → **POSSIBLE**; otherwise **LOW**. The engine never produces a numeric talent score.

## Source adapters

```ts
interface SourceAdapter<TRaw, TNormalized, TSaveOptions> {
  id; name; description;
  mode: "MANUAL_IMPORT" | "SCHEDULED";
  enabled: boolean;
  compliance: { automated; basis; termsUrl?; minIntervalMinutes? };
  fetch(ctx): Promise<TRaw[]>;
  normalize(raw, index, ctx): NormalizedResult<TNormalized>;
  validate(item): NormalizedResult<TNormalized>;
  save(items, ctx, options): Promise<SaveSummary>;
}
```

- **`PUBLIC_DATA_IMPORT`** (enabled, manual). `fetch` returns the uploaded rows, `normalize` applies the user's column mapping and row validation, `validate` adds cross-field checks (e.g. deadline before posted date), and `save` creates or attaches breakdowns according to the per-row decisions from the preview.
- **`PERMITTED_API_TEMPLATE`** (disabled). A skeleton with a compliance checklist.
- `registry.scheduledAdapters()` only returns adapters that are enabled, scheduled, automated **and** declare a `termsUrl`. `server/monitor.ts` runs them with a minimum-interval guard and records each run in `SourceRun`.

## Web monitor

`lib/web/` holds the pure logic and `lib/server/webmonitor.ts` handles persistence. Data models: `WebSource` and `WebFinding`.

- **`policy.ts`** holds the non-negotiable rules: a blocklist of account-based casting platforms (subdomains included), a private-address (SSRF) guard, login-wall and CAPTCHA detection, and minimum intervals.
- **`fetcher.ts`** has `politeFetch()`. It re-runs the host and blocklist checks, DNS public-address check and robots.txt check on **every redirect hop**. It follows redirects manually (up to 3), omits credentials, sends an honest User-Agent, and enforces a timeout and a body size cap. Results are typed:
  - hard stops: `BLOCKED_DOMAIN`, `ROBOTS_DISALLOWED`, `LOGIN_REQUIRED`, `CHALLENGE`
  - other failures: `ROBOTS_UNAVAILABLE`, `NETWORK`, and so on.

  robots.txt results are cached per origin for an hour. A robots.txt that returns 404 means "allowed". Any other failure to read it means "skip the page".
- **`extract.ts`** does the parsing:
  - RSS/Atom via fast-xml-parser.
  - HTML via cheerio: a CSS selector per listing, or all links when there's no selector. Nav, header, footer and scripts are stripped.
  - Keyword and exclude filtering, region detection by explicit place names, deadline detection only when the date is labelled, and platform detection.
  - A listing that names a different region than the source's region is dropped.
- **`webmonitor.ts`**:
  - `checkSource()` enforces terms confirmation, the blocklist and the interval, then saves new findings (unique per source + key), emits a `NEW_MATCH` alert for each, and audit-logs the run. A hard stop sets `enabled=false`.
  - `runWebSources()` is called from `runMonitor()`.
  - `acceptFinding()` turns a finding into a `PublicBreakdown` with `verifiedAt=null` and the original URL as its source. It then recomputes relevance and re-runs blind-spot detection.

## Paste parser, web search and email inbox

- **`lib/listing/parse.ts`** handles pasted text.
  - `parseListingText(text, {subject})` reads `Label: value` header lines through an alias table (Network, Casting Director, Location, Submissions Due, …) and role blocks (`[ROLE NAME] Female, 28-35…`, ALL-CAPS names followed by gender/age, or `Role:` labels). For each role it extracts the stated age, gender, ethnicity and role type.
  - Dates are parsed loosely ("Oct 22", "10/30", "Friday, October 30th"). A deadline must be labelled.
  - The project title comes from, in order: a label, a quoted title, the email subject, then a title-like first line (not greetings or sentences). `projectFrom` records which.
  - `parseAgencyText()` adds subject and body patterns ("Submitted: X – Role", "we submitted you for X – Role", "for the role of Role on X"), a status (self-tape request, callback…) and the submission date (labelled, or the email date).
  - `looksLikeAgencyEmail()` uses `AGENT_EMAILS` and the subject wording.
- **`lib/web/search.ts`** defines a `SearchProvider` interface with Brave and Google Programmable Search implementations. `activeSearchProvider()` picks the provider from `SEARCH_PROVIDER` or whichever is configured. `presetQueries()` and `newsFeedUrl()` build the region presets. SEARCH sources (`WebSource.kind = SEARCH`, `query`) go through `checkSource()`: provider → `filterItems()` with `keywordsOptional`, so the query itself is the filter → findings. No result page is fetched.
- **`lib/server/email.ts`** reads mail through a `MailSource` interface. `imapSource()` uses imapflow, opens the mailbox with `readOnly: true`, takes the newest 100 messages from the last 21 days, and parses them with mailparser. `processEmails()` dedupes by Message-ID, classifies each email, stores the parsed draft in `EmailMessage`, and raises a `NEW_MATCH` alert. Saving from the paste form marks the email `ACCEPTED` with the created record ids. `runMonitor()` checks email when it's configured.

## Import system

`client upload → parseUploadAction (server) → mapping UI → previewImportAction → per-row decisions → commitImportAction`

- Parsing (`import/parse.ts`) uses papaparse for CSV, exceljs for XLSX (first worksheet, Date cells converted), and JSON arrays. It enforces an extension allow-list, a ZIP magic-byte check for XLSX, 5 MB / 5,000 rows, control-character stripping, and cell length caps.
- Mapping (`import/mapping.ts`) holds the field definitions, the header-alias auto-mapping, and row validators. Dates accept ISO, US `m/d/yy(yy)`, and Excel serials; region and platform names are canonicalized.
- The client sends raw rows and the mapping back. The server **re-sanitizes and re-validates everything** before previewing or committing, and decisions are validated against a strict pattern.
- Preview reports rows found/valid/invalid, duplicates (in-file and in-DB), and potential matches. Public rows get attach/new/skip/overwrite choices, and overwrite needs a second confirmation. Agency rows get the detection outcome they would receive.
- Commit writes an `ImportBatch` and an `IMPORT` audit entry, then recomputes relevance, re-runs detection, and generates alerts.

## Alert system

- `alerts/channels.ts` defines the `AlertChannel` interface (`id`, `enabled()`, `deliver()`). In-app delivery is built in (the `Alert` table). `emailChannel` is a stub that turns on when the SMTP env vars are set; add real sending there.
- `alerts/engine.ts`:
  - `emitAlert()` is idempotent via `dedupeKey`.
  - `generateAlerts()` scans for:
    - `NEW_MATCH`: open breakdowns with HIGH/POSSIBLE relevance
    - `DEADLINE_APPROACHING`: within `DEADLINE_ALERT_DAYS`
    - `POTENTIAL_BLIND_SPOT`: unreviewed not-found / needs-review items
    - `WATCHLIST_ACTIVITY`: breakdowns or submissions touching watched CDs, offices, platforms, projects, or regions
    - `REPEAT_CASTING_DIRECTOR`: 3+ projects in 90 days, framed as frequency, not a ranking
- `generateAlerts()` runs after imports, manual entries, profile edits, and every monitor run.

## Source freshness

`deadlines.sourceState()` checks, in order: **CASTING_CLOSED** (visibility CLOSED, project casting closed, or deadline passed) → **UNVERIFIED** (no verified date) → **STALE** (verified more than `STALE_AFTER_DAYS` ago) → **VERIFIED**. The state is derived at render time, so old data is never shown as current and stored data is never silently rewritten.
