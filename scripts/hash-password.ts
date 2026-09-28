/**
 * Usage: npm run hash-password -- "your-strong-password"
 * Prints an APP_PASSWORD_HASH line for .env. "$" characters are escaped so Next.js's
 * dotenv expansion does not mangle the bcrypt hash.
 */
import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error('Provide a password of at least 10 characters:  npm run hash-password -- "your-password"');
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 12);
console.log(`APP_PASSWORD_HASH="${hash.replace(/\$/g, "\\$")}"`);
