// Load .env for command-line scripts (Next.js does this itself for the web app).
// Uses the same loader as Next.js so escaped "$" values behave identically.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
