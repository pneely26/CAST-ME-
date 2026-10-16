#!/usr/bin/env node
/**
 * One-step setup:  npm run setup
 * Installs packages, writes .env (asks for your password), creates the database,
 * applies the schema, optionally loads demo data, and builds the app.
 * Safe to run again: it keeps an existing .env and database.
 *
 * Non-interactive (for automation): SETUP_PASSWORD=... SETUP_DEMO=yes npm run setup
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { userInfo, platform } from "node:os";
import { createInterface } from "node:readline";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
process.chdir(root);
const isWin = platform() === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const npx = isWin ? "npx.cmd" : "npx";

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const step = (n, s) => console.log(`\n${bold(`[${n}/6]`)} ${s}`);

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

console.log(bold("\nStewart Blind Spot — setup\n"));

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
  const bcrypt = (await import("bcryptjs")).default;
  let password = process.env.SETUP_PASSWORD ?? "";
  while (password.length < 10) {
    password = await ask("Choose a password for the app (at least 10 characters): ", { hidden: true });
    if (password.length < 10) console.log(red("  Too short — try again."));
  }
  const username = process.env.SETUP_USERNAME ?? "paige";
  const dbUser = isWin ? "postgres:postgres" : userInfo().username;
  const databaseUrl = process.env.SETUP_DATABASE_URL ?? `postgresql://${dbUser}@localhost:5432/stewart_blind_spot?schema=public`;
  const hash = bcrypt.hashSync(password, 12).replace(/\$/g, "\\$");
  const example = readFileSync(".env.example", "utf8");
  const env = example
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${databaseUrl}"`)
    .replace(/^APP_USERNAME=.*$/m, `APP_USERNAME="${username}"`)
    .replace(/^APP_PASSWORD_HASH=.*$/m, `APP_PASSWORD_HASH="${hash}"`)
    .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET="${randomBytes(48).toString("base64")}"`);
  writeFileSync(".env", env, { mode: 0o600 });
  console.log(green(`✓ Created .env — your username is "${username}"`));
}

// 4. Database
step(4, "Database");
const envText = readFileSync(".env", "utf8");
const dbUrl = (envText.match(/^DATABASE_URL="?([^"\n]+)"?/m) ?? [])[1] ?? "";
const dbName = (() => {
  try {
    return new URL(dbUrl).pathname.slice(1) || "stewart_blind_spot";
  } catch {
    return "stewart_blind_spot";
  }
})();
const pgBins = ["", "/Applications/Postgres.app/Contents/Versions/latest/bin/", "/opt/homebrew/bin/", "/usr/local/bin/"];
for (const bin of pgBins) {
  const cmd = `${bin}createdb`;
  if (bin && !existsSync(cmd)) continue;
  const u = (() => {
    try {
      return new URL(dbUrl);
    } catch {
      return null;
    }
  })();
  const args = u ? ["-h", u.hostname || "localhost", "-p", u.port || "5432", ...(u.username ? ["-U", decodeURIComponent(u.username)] : []), dbName] : [dbName];
  const r = run(cmd, args, { quiet: true, env: u?.password ? { PGPASSWORD: decodeURIComponent(u.password) } : {} });
  if (r.ok || /already exists/.test(r.out)) break;
  if (/could not connect|Connection refused|No such file or directory.*socket|is the server running/i.test(r.out)) {
    fail("PostgreSQL isn't running. On a Mac, open Postgres.app and click Start (or Initialize), then run `npm run setup` again.");
  }
}
run(npx, ["prisma", "generate"], { quiet: true });
const migrate = run(npx, ["prisma", "migrate", "deploy"], { quiet: true });
if (!migrate.ok) {
  if (/P1001|Can't reach database/i.test(migrate.out)) fail("Can't reach PostgreSQL. Make sure Postgres.app (or your PostgreSQL server) is running, then run `npm run setup` again.");
  if (/P1000|authentication failed/i.test(migrate.out)) fail(`PostgreSQL rejected the login in DATABASE_URL. Edit the DATABASE_URL line in .env (currently ${dbUrl.replace(/:[^:@/]+@/, ":****@")}) and run setup again.`);
  if (/P1003|does not exist/i.test(migrate.out)) fail(`Database "${dbName}" doesn't exist and couldn't be created automatically. Create it (e.g. \`createdb ${dbName}\`) and run setup again.`);
  console.log(migrate.out);
  fail("Database setup failed (details above).");
}
console.log(green(`✓ Database "${dbName}" ready`));

// 5. Demo data
step(5, "Demo data");
const counts = run(npx, ["tsx", "-e", "import('./scripts/load-env.ts').then(()=>import('@prisma/client')).then(async ({PrismaClient})=>{const p=new PrismaClient();console.log(await p.project.count());await p.$disconnect()})"], { quiet: true });
const hasData = Number((counts.out.match(/^\d+$/m) ?? ["0"])[0]) > 0;
if (hasData) {
  console.log(green("✓ Your database already has data — leaving it alone"));
} else {
  const want = process.env.SETUP_DEMO ?? (await ask("Load fictional DEMO DATA so you can explore the app first? (y/N): ", { def: "n" }));
  if (/^y/i.test(want)) {
    if (!run(npm, ["run", "db:seed"]).ok) fail("Loading demo data failed.");
    console.log(green("✓ Demo data loaded (remove it any time in Settings)"));
  } else console.log("  Skipped — starting with an empty app.");
}

// 6. Build
step(6, "Building the app (about a minute)");
if (!run(npm, ["run", "build"], { quiet: true }).ok) {
  run(npm, ["run", "build"]);
  fail("Build failed (details above).");
}
console.log(green("✓ Built"));

console.log(`
${green(bold("All set!"))}

  Start the app:   ${bold("npm start")}${platform() === "darwin" ? `   (or double-click ${bold("Start Stewart Blind Spot.command")})` : ""}
  Then open:       ${bold("http://localhost:3000")}   and sign in.

  Optional extras (Web search key, email inbox): see the Web Monitor and Email Inbox pages in the app.
`);
