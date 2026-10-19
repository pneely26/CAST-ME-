import "server-only";
import nodemailer from "nodemailer";

/**
 * Outgoing email over SMTP. Nothing is sent unless SMTP_HOST, SMTP_USER and SMTP_PASS are set —
 * the app says so instead of pretending. Works with Gmail (app password), Outlook / Microsoft 365, Brevo, etc.
 */
export function emailStatus() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM?.trim() || user || "";
  return { configured: Boolean(host && user && pass), from, host: host ?? null };
}

let transport: nodemailer.Transporter | null = null;
function getTransport() {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transport;
}

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string; replyTo?: string | null }) {
  const s = emailStatus();
  if (!s.configured) throw new Error("Email isn't set up on the server (SMTP settings are missing).");
  await getTransport().sendMail({ from: s.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, ...(msg.replyTo ? { replyTo: msg.replyTo } : {}) });
}

/** Public address of the app for links in emails (Render sets RENDER_EXTERNAL_URL). */
export function appUrl(): string | null {
  const u = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  return u ? u.replace(/\/$/, "") : null;
}
