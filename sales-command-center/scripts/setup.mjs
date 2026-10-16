#!/usr/bin/env node
/**
 * One-step setup:  npm run setup
 * Installs packages, writes .env, creates the database, applies the schema, creates the first
 * coordinator (and optionally a sales rep), optionally loads labeled demo data, and builds the app.
 * Safe to run again: it keeps an existing .env, database, and users.
 *
 * Non-interactive (automation): SETUP_COORD_EMAIL=... SETUP_COORD_NAME=... SETUP_COORD_PASSWORD=...
 *   [SETUP_REP_EMAIL SETUP_REP_NAME SETUP_REP_PASSWORD] [SETUP_DATABASE_URL] [SETUP_TIMEZONE]
 *   [SETUP_PHONE=yes] [SETUP_DEMO=yes] npm run setup
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { userInfo, platform, networkInterfaces } from "node:os";
import { createInterface } from "node:readline";

const root = new URL("..", import.meta.url).pathname;
process.chdir(root);
const isWin = platform() === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const npx = isWin ? "npx.cmd" : "npx";
const STEPS = 7;

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const step = (n, s) => console.log(`\n${bold(`[${n}/${STEPS}]`)} ${s}`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8", env: { ...process.env, ...(opts.env ?? {}) }, shell: isWin });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function fail(msg) {
  console.log(`\n${red("✗ " + msg)}\n`);
  process.exit(1);
}

function ask(question, { hidden = false, def = "" } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      process.stdout.write(question);
      rl._writeToOutput = () => {}; // don't echo what's typed
    }
    rl.question(hidden ? "" : question, (a) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(a.trim() || def);
    });
  });
}

async function askPassword(label, envVar) {
  let pw = process.env[envVar] ?? "";
  while (pw.length < 10) {
    pw = await ask(`${label} (at least 10 characters): `, { hidden: true });
    if (pw.length < 10) console.log(red("  Too short — try again."));
  }
  return pw;
}

const q = (s) => `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`;

console.log(bold("\nSales Command Center — setup\n"));

// 1. Node
step(1, "Checking Node.js");
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) fail(`Node.js 20 or newer is needed (you have ${process.versions.node}). Install the LTS version from https://nodejs.org and run this again.`);
console.log(green(`✓ Node.js ${process.versions.node}`));

// 2. Packages
step(2, "Installing packages (first time takes a minute or two)");
if (!run(npm, ["install", "--no-audit", "--no-fund"]).ok) fail("Package install failed. Check your internet connection and run `npm run setup` again.");
console.log(green("✓ Packages installed"));

// 3. .env
step(3, "Settings file (.env)");
if (existsSync(".env")) {
  console.log(green("✓ .env already exists — keeping it"));
} else {
  const dbUser = isWin ? "postgres:postgres" : userInfo().username;
  const databaseUrl = process.env.SETUP_DATABASE_URL ?? `postgresql://${dbUser}@localhost:5432/sales_command_center?schema=public`;
  const tz = process.env.SETUP_TIMEZONE ?? (await ask("Time zone for schedules and reports [America/Chicago]: ", { def: "America/Chicago" }));
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    fail(`"${tz}" isn't a time zone name. Use one like America/Chicago or America/New_York.`);
  }
  const phone = process.env.SETUP_PHONE ?? (await ask("Will you open the app from a phone or another computer on your Wi-Fi? (y/N): ", { def: "n" }));
  const key = process.env.SETUP_ANTHROPIC_API_KEY ?? (await ask("Anthropic API key for reading lead screenshots (optional — press Enter to skip): ", { hidden: true }));
  let env = readFileSync(".env.example", "utf8")
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${q(databaseUrl)}`)
    .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${q(randomBytes(48).toString("base64"))}`)
    .replace(/^APP_TIMEZONE=.*$/m, `APP_TIMEZONE=${q(tz)}`)
    .replace(/^ANTHROPIC_API_KEY=.*$/m, `ANTHROPIC_API_KEY=${q(key)}`);
  if (/^y/i.test(phone)) env += `\n# Allows sign-in over plain http on your local network (phones on the same Wi-Fi).\n# Remove this line when the app is served over https.\nINSECURE_COOKIES="true"\n`;
  writeFileSync(".env", env, { mode: 0o600 });
  console.log(green(`✓ Created .env${key ? " (screenshot reading on)" : " (screenshot reading off — add ANTHROPIC_API_KEY later to turn it on)"}`));
}

// 4. Database
step(4, "Database");
const envText = readFileSync(".env", "utf8");
const dbUrl = (envText.match(/^DATABASE_URL="?([^"\n]+)"?/m) ?? [])[1] ?? "";
let parsed = null;
try {
  parsed = new URL(dbUrl);
} catch {
  /* reported below */
}
const dbName = parsed?.pathname.slice(1) || "sales_command_center";
const local = !parsed || ["localhost", "127.0.0.1", "::1", ""].includes(parsed.hostname);
if (local) {
  for (const bin of ["", "/Applications/Postgres.app/Contents/Versions/latest/bin/", "/opt/homebrew/bin/", "/usr/local/bin/"]) {
    const cmd = `${bin}createdb`;
    if (bin && !existsSync(cmd)) continue;
    const args = parsed ? ["-h", parsed.hostname || "localhost", "-p", parsed.port || "5432", ...(parsed.username ? ["-U", decodeURIComponent(parsed.username)] : []), dbName] : [dbName];
    const r = run(cmd, args, { quiet: true, env: parsed?.password ? { PGPASSWORD: decodeURIComponent(parsed.password) } : {} });
    if (r.ok || /already exists/.test(r.out)) break;
    if (/could not connect|Connection refused|No such file or directory.*socket|is the server running/i.test(r.out)) {
      fail("PostgreSQL isn't running. On a Mac, open Postgres.app and click Start (or Initialize), then run `npm run setup` again.");
    }
  }
}
run(npx, ["prisma", "generate"], { quiet: true });
const migrate = run(npx, ["prisma", "migrate", "deploy"], { quiet: true });
if (!migrate.ok) {
  if (/P1001|Can't reach database/i.test(migrate.out)) fail("Can't reach PostgreSQL. Make sure your PostgreSQL server is running (and DATABASE_URL in .env is right), then run `npm run setup` again.");
  if (/P1000|authentication failed/i.test(migrate.out)) fail(`PostgreSQL rejected the login in DATABASE_URL (${dbUrl.replace(/:[^:@/]+@/, ":****@")}). Fix it in .env and run setup again.`);
  if (/P1003|does not exist/i.test(migrate.out)) fail(`Database "${dbName}" doesn't exist and couldn't be created automatically. Create it (e.g. \`createdb ${dbName}\`) and run setup again.`);
  console.log(migrate.out);
  fail("Database setup failed (details above).");
}
console.log(green(`✓ Database "${dbName}" ready`));

// 5. Logins
step(5, "Logins");
const countUsers = (role) => {
  const r = run(npx, ["tsx", "-e", `import('./scripts/load-env.ts').then(()=>import('@prisma/client')).then(async ({PrismaClient})=>{const p=new PrismaClient();console.log('COUNT='+await p.user.count({where:{role:'${role}',active:true}}));await p.$disconnect()})`], { quiet: true });
  return Number((r.out.match(/COUNT=(\d+)/) ?? [])[1] ?? 0);
};
const createUser = (role, name, email, password) => {
  const r = run(npm, ["run", "-s", "create-user", "--", "--role", role, "--email", email, "--name", name], { env: { NEW_USER_PASSWORD: password } });
  if (!r.ok) fail(`Couldn't create the ${role} login.`);
};
if (countUsers("COORDINATOR") > 0) {
  console.log(green("✓ A coordinator login already exists — keeping it"));
} else {
  console.log("  Create your coordinator (admin) login:");
  const name = process.env.SETUP_COORD_NAME ?? (await ask("  Your name: "));
  const email = process.env.SETUP_COORD_EMAIL ?? (await ask("  Your email (used to sign in): "));
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) fail("A name and a valid email are needed.");
  createUser("coordinator", name, email, await askPassword("  Password", "SETUP_COORD_PASSWORD"));
  console.log(green(`✓ Coordinator ${email} created`));
}
if (countUsers("REP") > 0) {
  console.log(green("✓ A sales rep login already exists"));
} else {
  const want = process.env.SETUP_REP_EMAIL ? "y" : await ask("  Add your sales rep's login now? You can also do this later in Settings. (y/N): ", { def: "n" });
  if (/^y/i.test(want)) {
    const name = process.env.SETUP_REP_NAME ?? (await ask("  Rep's name: "));
    const email = process.env.SETUP_REP_EMAIL ?? (await ask("  Rep's email: "));
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) fail("A name and a valid email are needed.");
    createUser("rep", name, email, await askPassword("  Temporary password for the rep", "SETUP_REP_PASSWORD"));
    console.log(green(`✓ Sales rep ${email} created — share the password with them privately`));
  } else console.log("  Skipped — add the rep later in Settings → Users.");
}

// 6. Demo data
step(6, "Demo data");
const leadCount = (() => {
  const r = run(npx, ["tsx", "-e", "import('./scripts/load-env.ts').then(()=>import('@prisma/client')).then(async ({PrismaClient})=>{const p=new PrismaClient();console.log('COUNT='+await p.lead.count());await p.$disconnect()})"], { quiet: true });
  return Number((r.out.match(/COUNT=(\d+)/) ?? [])[1] ?? 0);
})();
if (leadCount > 0) console.log(green("✓ Your database already has leads — leaving it alone"));
else if (countUsers("REP") === 0) console.log("  Skipped — demo data needs a sales rep login.");
else {
  const want = process.env.SETUP_DEMO ?? (await ask("Load clearly-labeled DEMO DATA to explore first? It can be removed in Settings. (y/N): ", { def: "n" }));
  if (/^y/i.test(want)) {
    if (!run(npm, ["run", "-s", "db:demo"]).ok) fail("Loading demo data failed.");
    console.log(green("✓ Demo data loaded (every demo record is marked “Demo”)"));
  } else console.log("  Skipped — starting with an empty app. Every number you see will come from your own records.");
}

// 7. Build
step(7, "Building the app (about a minute)");
if (!run(npm, ["run", "build"], { quiet: true }).ok) {
  run(npm, ["run", "build"]);
  fail("Build failed (details above).");
}
console.log(green("✓ Built"));

const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
console.log(`\n${bold(green("All set!"))}\n`);
console.log(`  Start it:   ${bold("npm start")}`);
console.log(`  Then open:  ${bold("http://localhost:3100")}`);
if (lan && /INSECURE_COOKIES="true"/.test(readFileSync(".env", "utf8"))) console.log(`  On a phone (same Wi-Fi): ${bold(`http://${lan}:3100`)}`);
console.log(`\n  Reminders run automatically while the app is open. Back up the database and the uploads folder regularly (see README).\n`);
