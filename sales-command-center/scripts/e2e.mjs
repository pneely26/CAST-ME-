/**
 * End-to-end acceptance check against a running app (npm run dev or npm start).
 *   npm run test:e2e -- --yes
 * It CREATES real records (a lead, visit, appointment, sale) — run it only against a development
 * or staging database, never production. Logins come from E2E_COORD_EMAIL/E2E_COORD_PASSWORD and
 * E2E_REP_EMAIL/E2E_REP_PASSWORD (one coordinator and one rep, with the rep named in E2E_REP_NAME).
 * Uses Playwright's Chromium; set PLAYWRIGHT_CHROMIUM_PATH to use a different browser binary.
 */
import { chromium } from "playwright";
if (!process.argv.includes("--yes")) {
  console.log("This creates test records in the app's database. Re-run with --yes against a dev/staging database.");
  process.exit(2);
}
const base = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const env = (k, d) => process.env[k] ?? d;
const COORD = [env("E2E_COORD_EMAIL", "coord@example.com"), env("E2E_COORD_PASSWORD", "coordinator-pass-123")];
const REP = [env("E2E_REP_EMAIL", "rep@example.com"), env("E2E_REP_PASSWORD", "rep-pass-12345")];
const REP_NAME = env("E2E_REP_NAME", "Riley Rep");
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
let failures = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`); if (!cond) failures++; };
const login = async (email, pw, vp = { width: 1440, height: 900 }) => {
  const ctx = await b.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const p = await ctx.newPage(); p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Owner asked for later" : undefined)); p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(base + "/login"); await p.fill("input[name=email]", email); await p.fill("input[name=password]", pw); await p.click("form button");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { waitUntil: "commit" }); await p.waitForLoadState(); return p;
};
const rnd = (n) => Array.from({ length: n }, () => "bcdfghjklmnpqrstvwxz"[Math.floor(Math.random() * 20)]).join("");
const name = `${rnd(1).toUpperCase()}${rnd(6)} ${rnd(5)} Supply`;
const c = await login(...COORD);

// 1. coordinator creates + assigns a lead
await c.goto(base + "/leads/new");
await c.fill("input[name=businessName]", name); await c.fill("input[name=phone]", `312-555-${String(Date.now() % 10000).padStart(4, "0")}`); await c.fill("input[name=address]", "77 Test Ave");
await c.selectOption("select[name=assignedRepId]", { label: REP_NAME });
await c.locator("button", { hasText: "Create lead" }).click();
await c.waitForURL(/\/leads\/c[a-z0-9]{20,}/, { waitUntil: "commit" }); await c.waitForLoadState();
const leadId = c.url().match(/leads\/(c[a-z0-9]+)/)[1];
check("coordinator created lead", !!leadId);

// 2. rep sees it on phone and records a visit with a follow-up
const r = await login(...REP, { width: 390, height: 844 });
await r.goto(base + "/leads");
check("rep sees assigned lead", (await r.locator(`text=${name}`).count()) > 0);
await r.goto(base + `/leads/${leadId}/visit`);
await r.locator("button", { hasText: /^Interested$/ }).click();
await r.fill("textarea[name=feedback]", "E2E: owner wants a quote — exact words kept.");
await r.locator("label", { hasText: "Set a follow-up" }).locator("input").check();
await r.fill("input[name=followUpAction]", "Send quote");
await r.locator("button", { hasText: "Save visit" }).click();
await r.waitForURL((u) => !u.pathname.endsWith("/visit"), { waitUntil: "commit" }); await r.waitForLoadState();
await r.goto(base + `/leads/${leadId}?tab=visits`);
check("visit + verbatim feedback on lead", (await r.locator("text=E2E: owner wants a quote — exact words kept.").count()) > 0);

// 3. coordinator sees feedback notification and books an appointment
await c.goto(base + "/notifications");
check("coordinator notified of feedback", (await c.locator(`text=${name}`).count()) > 0);
const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: process.env.APP_TIMEZONE ?? "America/Chicago" });
await c.goto(base + `/appointments/new?lead=${leadId}`);
await c.fill("input[name=date]", tomorrow); await c.fill("input[name=time]", "11:00");
await c.locator("button", { hasText: "Book appointment" }).click();
await c.waitForURL(/\/appointments\/c[a-z0-9]{20,}/, { waitUntil: "commit" }); await c.waitForLoadState();
const apptId = c.url().match(/appointments\/(c[a-z0-9]+)/)[1];
check("appointment booked", !!apptId);
// duplicate booking blocked
await c.goto(base + `/appointments/new?lead=${leadId}`);
await c.fill("input[name=date]", tomorrow); await c.fill("input[name=time]", "11:30");
await c.locator("button", { hasText: "Book appointment" }).click(); await c.waitForTimeout(1500);
check("duplicate appointment blocked", /duplicate|already/i.test(await c.locator("form p[role=alert]").innerText().catch(() => "")));

// 4. drag-and-drop on the calendar (coordinator moves directly)
await c.goto(base + `/schedule?date=${tomorrow}`); await c.waitForSelector(".fc-event", { timeout: 15000 }).catch(() => {});
const ev = c.locator(".fc-timegrid-event", { hasText: name }).first();
let dragged = false;
if (await ev.count()) {
  const box = await ev.boundingBox();
  const slot = await c.locator(".fc-timegrid-slot").first().boundingBox();
  await c.mouse.move(box.x + box.width / 2, box.y + 5); await c.mouse.down();
  for (let i = 1; i <= 10; i++) await c.mouse.move(box.x + box.width / 2, box.y + 5 + (slot.height * 4 * i) / 10);
  await c.mouse.up(); await c.waitForTimeout(2500);
  const msg = await c.locator("[role=status], [role=alert]").filter({ hasText: /moved|Appointment|conflict/i }).first().innerText().catch(() => "");
  dragged = /moved/i.test(msg);
  console.log("   drag message:", msg.slice(0, 100));
}
check("calendar drag moves appointment (UI)", dragged);
await c.goto(base + `/appointments/${apptId}`);
const hist = (await c.locator("main").innerText()).replace(/\n/g, " ");
check("history keeps original time", /11:00/.test(hist) && /Moved|moved/.test(hist), hist.match(/History.{0,160}/)?.[0]);

// 5. move API permissions: rep can't move directly; coordinator can
const repMove = await r.request.post(base + "/api/appointments/move", { data: { id: apptId, start: new Date(Date.now() + 3 * 86400000).toISOString(), end: new Date(Date.now() + 3 * 86400000 + 2700000).toISOString() } }).then((x) => x.json());
check("rep blocked from direct move", repMove.ok === false, repMove.error);
// a random slot 2–9 days out so repeated runs don't collide with earlier runs' appointments
const reqStart = new Date(Math.round((Date.now() + 2 * 86400000 + Math.floor(Math.random() * 7 * 24) * 3600000) / 3600000) * 3600000);
const reqRes = await r.request.post(base + "/api/reschedules/request", { data: { id: apptId, start: reqStart.toISOString(), end: new Date(reqStart.getTime() + 2700000).toISOString(), reason: "Owner asked for later" } }).then((x) => x.json());
check("rep reschedule request accepted", reqRes.ok === true, reqRes.error);
await c.goto(base + "/reschedules");
await c.locator("a", { hasText: name }).first().locator("xpath=ancestor::*[.//button[normalize-space()='Approve']][1]").locator("button", { hasText: /^Approve$/ }).click();
await c.waitForTimeout(2000);
const approveAlert = await c.locator("form p[role=alert]").first().innerText().catch(() => "");
if (approveAlert) console.log("   approve alert:", approveAlert);
const st = await c.request.get(base + `/appointments/${apptId}`).then((x) => x.text());
check("coordinator approved reschedule", /Approved|approved/.test(st));

// 6. sale recorded and counted
await c.goto(base + `/sales/new?lead=${leadId}`);
await c.fill("input[name=product]", "E2E package"); await c.selectOption("select[name=status]", "WON"); await c.fill("input[name=finalAmount]", "999"); await c.check("input[name=confirmed]");
await c.locator("form button[type=submit]").last().click();
await c.waitForURL(/msg=/, { waitUntil: "commit" }).catch(() => {}); await c.waitForLoadState();
await c.goto(base + `/leads/${leadId}`);
check("lead marked Won", (await c.locator("main").innerText()).includes("Won"));
const csv = await c.request.get(base + "/api/export/sales?range=all").then((x) => x.text());
check("sale in CSV export", csv.includes("E2E package") && csv.includes("999.00"));

// 7. security: rep can't open another rep's lead or admin data
const other = await r.request.get(base + "/api/export/leads?view=all").then((x) => x.text());
check("rep export only has own leads", !other.includes("(demo)") && other.split("\n").length >= 2);
const audit = await r.request.get(base + "/api/export/audit"); check("rep blocked from audit export", audit.status() === 403);
const anon = await (await b.newContext()).request.get(base + "/api/export/leads", { maxRedirects: 0 }); check("anonymous blocked", [401, 307, 302].includes(anon.status()), String(anon.status()));
const cron = await (await b.newContext()).request.post(base + "/api/cron/reminders"); check("cron endpoint not open without the secret", [401, 404].includes(cron.status()), String(cron.status()));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
await b.close();
process.exit(failures ? 1 : 0);
