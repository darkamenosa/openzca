import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDurationInput,
  parseTimeBoundaryInput,
  parseTimeInput,
} from "../src/lib/time-range.ts";

test("parseTimeInput supports relative durations", () => {
  const now = new Date(2026, 2, 21, 12, 0, 0).getTime();
  assert.equal(parseTimeInput("1d", now), now - 24 * 60 * 60 * 1000);
  assert.equal(parseTimeInput("24h", now), now - 24 * 60 * 60 * 1000);
  assert.equal(parseTimeInput("7m", now), now - 7 * 60 * 1000);
  assert.equal(parseTimeInput("30s", now), now - 30 * 1000);
  assert.equal(parseTimeInput("2w", now), now - 14 * 24 * 60 * 60 * 1000);
  assert.equal(parseTimeInput("1d2h30m", now), now - ((24 + 2) * 60 * 60 * 1000 + 30 * 60 * 1000));
});

test("parseDurationInput only accepts duration syntax", () => {
  const now = new Date(2026, 2, 21, 12, 0, 0).getTime();
  assert.equal(parseDurationInput("30s", now), now - 30 * 1000);
  assert.equal(parseDurationInput("2w", now), now - 14 * 24 * 60 * 60 * 1000);
  assert.equal(parseDurationInput("2026-03-21", now), undefined);
  assert.equal(parseDurationInput("2026-03-21T10:00:00+07:00", now), undefined);
});

test("parseTimeBoundaryInput only accepts explicit boundary syntax", () => {
  const now = new Date(2026, 2, 21, 12, 0, 0).getTime();
  assert.equal(parseTimeBoundaryInput("2026-03-21", now), Date.parse("2026-03-21"));
  assert.equal(
    parseTimeBoundaryInput("2026-03-21T10:00:00+07:00", now),
    Date.parse("2026-03-21T10:00:00+07:00"),
  );
  assert.equal(parseTimeBoundaryInput("30s", now), undefined);
});

test("parseTimeInput supports timestamps and dates", () => {
  assert.equal(parseTimeInput("1773779309"), 1773779309000);
  assert.equal(parseTimeInput("1773779309238"), 1773779309238);
  assert.equal(parseTimeInput("2026-03-21T10:00:00+07:00"), Date.parse("2026-03-21T10:00:00+07:00"));
  assert.equal(parseTimeInput("2026-03-21"), Date.parse("2026-03-21"));
});

test("parseTimeInput rejects invalid input", () => {
  assert.equal(parseTimeInput(""), undefined);
  assert.equal(parseTimeInput("1x"), undefined);
  assert.equal(parseTimeInput("abc"), undefined);
  assert.equal(parseTimeInput("today"), undefined);
});
