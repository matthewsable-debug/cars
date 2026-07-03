// Email / notification configuration, read from environment variables so no
// credentials are committed to the repo. All are optional: with no SMTP host
// configured, the platform runs in "dry-run" mode and writes each digest email
// to data/outbox/ instead of sending it, so you can develop and test freely.
//
//   MAIL_TO          recipient address for the daily digest (comma-separated ok)
//   MAIL_FROM        From header (default: Car Dealer Monitor <no-reply@localhost>)
//   SMTP_HOST        SMTP server host (enables real sending)
//   SMTP_PORT        SMTP port (default 587)
//   SMTP_SECURE      "true" to use TLS on connect (port 465)
//   SMTP_USER        SMTP username
//   SMTP_PASS        SMTP password
//   MAIL_HOUR        local hour (in MAIL_TZ) to send the daily digest (default 7)
//   MAIL_TZ          IANA timezone for the schedule (default America/New_York)
//   MAIL_SEND_EMPTY  "true" to email even when there are no new matches

export function mailConfig() {
  return {
    to: (process.env.MAIL_TO || "").trim(),
    from: process.env.MAIL_FROM || "Car Dealer Monitor <no-reply@localhost>",
    smtp: {
      host: (process.env.SMTP_HOST || "").trim(),
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
    hour: clampHour(Number(process.env.MAIL_HOUR)),
    timezone: process.env.MAIL_TZ || "America/New_York",
    sendEmpty: process.env.MAIL_SEND_EMPTY === "true",
  };
}

export function isMailConfigured() {
  const c = mailConfig();
  return !!c.smtp.host && !!c.to;
}

function clampHour(h) {
  if (!Number.isFinite(h)) return 7;
  return Math.min(23, Math.max(0, Math.round(h)));
}
