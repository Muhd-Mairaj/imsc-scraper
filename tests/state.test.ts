import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import {
  loadWeeklyState,
  saveWeeklyState,
  shouldSendAlert,
  shouldSendReport,
  weeklyStateFilePath,
} from "../src/state.js";

const EMPTY = { lastReportWindowEnd: undefined, lastAlertWindowEnd: undefined };

beforeEach(async () => {
  await rm(weeklyStateFilePath, { force: true });
});

afterEach(async () => {
  await rm(weeklyStateFilePath, { force: true });
});

test("a missing state file reads as empty state", async () => {
  expect(await loadWeeklyState()).toEqual(EMPTY);
});

test("a malformed state file reads as empty state rather than throwing", async () => {
  await mkdir(weeklyStateFilePath.replace(/\/[^/]+$/u, ""), { recursive: true });
  await writeFile(weeklyStateFilePath, "not json at all", "utf8");
  expect(await loadWeeklyState()).toEqual(EMPTY);
});

test("state survives a save and load round trip", async () => {
  await saveWeeklyState({ lastReportWindowEnd: 1_789_000_000_000, lastAlertWindowEnd: undefined });
  expect(await loadWeeklyState()).toEqual({
    lastReportWindowEnd: 1_789_000_000_000,
    lastAlertWindowEnd: undefined,
  });
});

test("reports are sent when the window has not been recorded", () => {
  expect(shouldSendReport(EMPTY, 1_789_000_000_000)).toBe(true);
  expect(
    shouldSendReport({ ...EMPTY, lastReportWindowEnd: 1_788_000_000_000 }, 1_789_000_000_000),
  ).toBe(true);
});

test("reports are skipped when the window was already recorded", () => {
  expect(
    shouldSendReport({ ...EMPTY, lastReportWindowEnd: 1_789_000_000_000 }, 1_789_000_000_000),
  ).toBe(false);
});

test("alerts are tracked independently of reports", () => {
  const state = { lastReportWindowEnd: 1_789_000_000_000, lastAlertWindowEnd: 1_789_000_000_000 };
  expect(shouldSendReport(state, 1_789_000_000_000)).toBe(false);
  expect(shouldSendAlert(state, 1_789_000_000_000)).toBe(false);
  expect(shouldSendAlert({ ...state, lastAlertWindowEnd: undefined }, 1_789_000_000_000)).toBe(
    true,
  );
});
