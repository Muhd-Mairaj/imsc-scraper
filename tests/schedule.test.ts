import { expect, test } from "bun:test";
import { computeWeeklyWindow, formatWindowRange } from "../src/schedule.js";

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
