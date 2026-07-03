import { runScan } from "./monitor.js";
import { load, save, activeListings, getLastEmailAt, setLastEmailAt } from "./store.js";
import { findMatches } from "./matcher.js";
import { listEntries } from "./watchlistStore.js";
import { listDealers } from "./dealerStore.js";
import { renderDigest } from "../summary.js";
import { sendMail } from "../email.js";
import { mailConfig } from "../config/notifications.js";

// Build and send the daily digest containing only listings that first appeared
// since the last email was sent ("updates since the last email"). Scans first
// (unless told not to), so the data is fresh at send time.
export async function sendDailyEmail({ scan = true } = {}) {
  if (scan) await runScan();

  const db = load();
  const active = activeListings(db);
  const matched = findMatches(active, listEntries());
  const since = getLastEmailAt(db);

  const updates = matched
    .filter((l) => !since || new Date(l.firstSeen) > new Date(since))
    .map((l) => ({ ...l, isNew: true }))
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

  const cfg = mailConfig();
  if (updates.length === 0 && !cfg.sendEmpty) {
    return { skipped: true, reason: "No new matches since last email.", since, count: 0 };
  }

  const dateStr = new Date().toLocaleDateString("en-US", {
    timeZone: cfg.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const subject =
    updates.length > 0
      ? `${updates.length} new car match${updates.length === 1 ? "" : "es"} — ${dateStr}`
      : `Car watch: no new matches — ${dateStr}`;

  const html = renderDigest(
    {
      startedAt: new Date().toISOString(),
      dealers: listDealers().filter((d) => d.enabled !== false),
      newCount: updates.length,
      matches: updates,
    },
    { title: "Your daily car updates" }
  );

  const result = await sendMail({ to: cfg.to, subject, html });

  // Advance the watermark only when we actually produced/sent an email.
  if (result.sent || result.dryRun) {
    setLastEmailAt(db, new Date().toISOString());
    save(db);
  }

  return { ...result, subject, count: updates.length, since };
}

// --- Daily scheduler at a fixed local hour in a timezone -------------------

let timer = null;

export function startEmailScheduler({ onSend } = {}) {
  stopEmailScheduler();
  const cfg = mailConfig();
  const scheduleNext = () => {
    const next = nextDailyRun(cfg.hour, cfg.timezone);
    const delay = Math.max(1000, next.getTime() - Date.now());
    timer = setTimeout(async () => {
      try {
        const result = await sendDailyEmail();
        if (onSend) onSend(result);
      } catch (err) {
        console.error("[email] daily send failed:", err.message);
      } finally {
        scheduleNext(); // re-arm for the following day
      }
    }, delay);
    if (timer.unref) timer.unref();
    return next;
  };
  return scheduleNext();
}

export function stopEmailScheduler() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

// Next instant at which the local wall-clock time in `timeZone` is `hour`:00.
// Correctly accounts for the zone's UTC offset (and DST) via Intl.
export function nextDailyRun(hour = 7, timeZone = "America/New_York", now = new Date()) {
  let { y, m, d } = zonedYmd(now, timeZone);
  let candidate = zonedHourToInstant(y, m, d, hour, timeZone);
  let addDays = 0;
  while (candidate <= now && addDays < 400) {
    addDays++;
    // Derive the calendar date `addDays` later in the target zone using a
    // stable reference (noon UTC) to avoid month/DST rollover surprises.
    const ref = new Date(Date.UTC(y, m - 1, d + addDays, 12, 0, 0));
    const ymd = zonedYmd(ref, timeZone);
    candidate = zonedHourToInstant(ymd.y, ymd.m, ymd.d, hour, timeZone);
  }
  return candidate;
}

// The UTC Date for `hour`:00 wall-clock on Y-M-D in `timeZone`.
function zonedHourToInstant(y, m, d, hour, timeZone) {
  const approx = Date.UTC(y, m - 1, d, hour, 0, 0);
  const offMin = tzOffsetMinutes(new Date(approx), timeZone);
  return new Date(approx - offMin * 60000);
}

// The calendar Y/M/D shown in `timeZone` for a given instant.
function zonedYmd(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

// UTC offset (in minutes) of `timeZone` at a given instant, e.g. -240 for EDT.
function tzOffsetMinutes(instant, timeZone) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")?.value || "GMT+00:00";
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}
