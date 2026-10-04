import { expect, test } from "bun:test";
import { computeMonthEndWindow, computeWeeklyWindow, formatWindowRange } from "../src/schedule.js";

// All expectations are UTC instants. Asia/Kuala_Lumpur is UTC+8 with no DST,
// so a local Saturday 00:00 is the previous day at 16:00Z.

test("an on-time Saturday 06:00 run covers the seven days ending that midnight", () => {
  // 2026-09-19 06:00 MYT
  const window = computeWeeklyWindow(new Date("2026-09-18T22:00:00.000Z"));
  expect(new Date(window.startMs).toISOString()).toBe("2026-09-11T16:00:00.000Z");
  expect(new Date(window.endMs).toISOString()).toBe("2026-09-18T16:00:00.000Z");
});

test("a catch-up run on Monday computes the same window as the on-time run", () => {
  // 2026-09-21 10:00 MYT, two days after the Saturday it should have run on.
  const window = computeWeeklyWindow(new Date("2026-09-21T02:00:00.000Z"));
  expect(new Date(window.startMs).toISOString()).toBe("2026-09-11T16:00:00.000Z");
  expect(new Date(window.endMs).toISOString()).toBe("2026-09-18T16:00:00.000Z");
});

test("a run on the following Friday still reports the most recent completed week", () => {
  // 2026-09-25 12:00 MYT
  const window = computeWeeklyWindow(new Date("2026-09-25T04:00:00.000Z"));
  expect(new Date(window.startMs).toISOString()).toBe("2026-09-11T16:00:00.000Z");
  expect(new Date(window.endMs).toISOString()).toBe("2026-09-18T16:00:00.000Z");
});

test("a run exactly at Saturday 00:00 ends its window at that instant", () => {
  // 2026-09-19 00:00 MYT
  const window = computeWeeklyWindow(new Date("2026-09-18T16:00:00.000Z"));
  expect(new Date(window.endMs).toISOString()).toBe("2026-09-18T16:00:00.000Z");
  expect(new Date(window.startMs).toISOString()).toBe("2026-09-11T16:00:00.000Z");
});

test("one millisecond before Saturday 00:00 reports the previous completed week", () => {
  // 2026-09-18 23:59:59.999 MYT
  const window = computeWeeklyWindow(new Date("2026-09-18T15:59:59.999Z"));
  expect(new Date(window.endMs).toISOString()).toBe("2026-09-11T16:00:00.000Z");
  expect(new Date(window.startMs).toISOString()).toBe("2026-09-04T16:00:00.000Z");
});

test("the window is exactly seven days long", () => {
  const window = computeWeeklyWindow(new Date("2026-09-18T22:00:00.000Z"));
  expect(window.endMs - window.startMs).toBe(7 * 86_400_000);
});

test("formatWindowRange shows the inclusive first and last day", () => {
  const window = computeWeeklyWindow(new Date("2026-09-18T22:00:00.000Z"));
  expect(formatWindowRange(window)).toBe("12/09/2026 – 18/09/2026");
});

// Month-end runs on the 1st and covers the days since the last report. Here the
// last weekly ended Sat 29 Sep 00:00 MYT (28 Sep 16:00Z), so 1 Oct 06:00 MYT
// reports 29 and 30 Sep.

test("the month-end window runs from the last report to the month start", () => {
  const window = computeMonthEndWindow(
    new Date("2026-09-30T22:00:00.000Z"),
    Date.parse("2026-09-28T16:00:00.000Z"),
  );
  expect(new Date(window.startMs).toISOString()).toBe("2026-09-28T16:00:00.000Z");
  expect(new Date(window.endMs).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  expect(formatWindowRange(window)).toBe("29/09/2026 – 30/09/2026");
});

test("the month-end window is capped at the previous month start", () => {
  const window = computeMonthEndWindow(
    new Date("2026-09-30T22:00:00.000Z"),
    Date.parse("2026-01-01T00:00:00.000Z"),
  );
  expect(new Date(window.startMs).toISOString()).toBe("2026-08-31T16:00:00.000Z");
  expect(new Date(window.endMs).toISOString()).toBe("2026-09-30T16:00:00.000Z");
});

test("the month-end window falls back to the previous month when there is no last report", () => {
  const window = computeMonthEndWindow(new Date("2026-09-30T22:00:00.000Z"), undefined);
  expect(new Date(window.startMs).toISOString()).toBe("2026-08-31T16:00:00.000Z");
  expect(new Date(window.endMs).toISOString()).toBe("2026-09-30T16:00:00.000Z");
});

test("a month-end run with nothing since the last report has an empty window", () => {
  const window = computeMonthEndWindow(
    new Date("2026-09-30T22:00:00.000Z"),
    Date.parse("2026-09-30T16:00:00.000Z"),
  );
  expect(window.startMs).toBe(window.endMs);
});
