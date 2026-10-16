// Load .env for command-line scripts the same way Next.js does.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
