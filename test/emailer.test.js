import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDailyRun } from "../src/core/emailer.js";

// Format an instant as wall-clock time in a timezone for assertions.
function wall(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(instant);
}
function ymd(instant, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

test("nextDailyRun lands on 07:00 in the target timezone", () => {
  const now = new Date("2026-07-03T18:00:00Z"); // afternoon UTC
  const next = nextDailyRun(7, "America/New_York", now);
  assert.equal(wall(next, "America/New_York"), "07:00");
  assert.ok(next > now, "in the future");
});

test("nextDailyRun rolls to the next day when past today's time", () => {
  // 15:00 UTC on 2026-07-03 is 11:00 EDT — already past 07:00, so next is Jul 4.
  const now = new Date("2026-07-03T15:00:00Z");
  const next = nextDailyRun(7, "America/New_York", now);
  assert.equal(ymd(next, "America/New_York"), "2026-07-04");
  assert.equal(wall(next, "America/New_York"), "07:00");
});

test("nextDailyRun stays today when before the time", () => {
  // 08:00 UTC on 2026-07-03 is 04:00 EDT — before 07:00, so next is today.
  const now = new Date("2026-07-03T08:00:00Z");
  const next = nextDailyRun(7, "America/New_York", now);
  assert.equal(ymd(next, "America/New_York"), "2026-07-03");
  assert.equal(wall(next, "America/New_York"), "07:00");
});

test("nextDailyRun handles standard time (EST) offset too", () => {
  const now = new Date("2026-01-10T18:00:00Z"); // winter → EST (GMT-5)
  const next = nextDailyRun(7, "America/New_York", now);
  assert.equal(wall(next, "America/New_York"), "07:00");
});

test("nextDailyRun works for other timezones", () => {
  const now = new Date("2026-07-03T00:00:00Z");
  const next = nextDailyRun(9, "America/Los_Angeles", now);
  assert.equal(wall(next, "America/Los_Angeles"), "09:00");
});
