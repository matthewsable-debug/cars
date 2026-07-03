import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { mailConfig } from "./config/notifications.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTBOX = path.join(__dirname, "..", "data", "outbox");

// Send an email. If SMTP is configured (SMTP_HOST set), it's delivered for real;
// otherwise the message is written to data/outbox/ as a dry run so the whole
// pipeline is testable without credentials. Returns a small result descriptor.
export async function sendMail({ to, subject, html, text }) {
  const cfg = mailConfig();
  const recipient = to || cfg.to;

  if (!cfg.smtp.host) {
    return dryRun({ to: recipient, subject, html });
  }
  if (!recipient) {
    return { sent: false, error: "No recipient: set MAIL_TO." };
  }

  const transporter = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
  });

  const info = await transporter.sendMail({
    from: cfg.from,
    to: recipient,
    subject,
    html,
    text: text || htmlToText(html),
  });
  return { sent: true, transport: "smtp", messageId: info.messageId, to: recipient };
}

function dryRun({ to, subject, html }) {
  fs.mkdirSync(OUTBOX, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(OUTBOX, `${stamp}.html`);
  const header =
    `<!-- DRY RUN (no SMTP_HOST configured)\n` +
    `     To: ${to || "(MAIL_TO not set)"}\n` +
    `     Subject: ${subject}\n-->\n`;
  fs.writeFileSync(file, header + html);
  return { sent: false, dryRun: true, transport: "outbox", file, to: to || null, subject };
}

// Very small HTML→text fallback for the plaintext part of the email.
function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

export { OUTBOX };
