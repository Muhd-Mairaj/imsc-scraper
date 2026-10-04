import { expect, test } from "bun:test";
import type { WeeklyState } from "../src/state.js";
import {
  type ReportRunDependencies,
  runMonthEndReport,
  runWeeklyReport,
} from "../src/weekly-run.js";

const NOW = new Date("2026-09-18T22:00:00.000Z");
const WINDOW_END = Date.parse("2026-09-18T16:00:00.000Z");

const EMPTY_STATE: WeeklyState = {
  lastReportWindowEnd: undefined,
  lastAlertWindowEnd: undefined,
  lastMonthEndWindowEnd: undefined,
};

function harness(overrides: Partial<ReportRunDependencies> = {}) {
  const sent: { chatId: string; content: string }[] = [];
  const saved: WeeklyState[] = [];
  const logs: string[] = [];
  const dependencies: ReportRunDependencies = {
    now: NOW,
    collect: async () => ({
      items: [
        {
          timestampMs: Date.parse("2026-09-15T02:00:00.000Z"),
          activity: 2,
          participantDisplays: ["+601162168427"],
        },
      ],
      warnings: [],
    }),
    sendMessage: async (chatId, content) => {
      sent.push({ chatId, content });
    },
    recipientChatId: "60123456789@c.us",
    selfChatId: "60199999999@c.us",
    force: false,
    dryRun: false,
    state: EMPTY_STATE,
    saveState: async (state) => {
      saved.push(state);
    },
    log: (message) => {
      logs.push(message);
    },
    ...overrides,
  };
  return { dependencies, sent, saved, logs };
}

test("sends the report to the recipient and records the window", async () => {
  const { dependencies, sent, saved } = harness();
  const outcome = await runWeeklyReport(dependencies);
  expect(outcome).toEqual({ status: "sent", emptyWeek: false });
  expect(sent).toHaveLength(1);
  expect(sent[0]?.chatId).toBe("60123456789@c.us");
  expect(sent[0]?.content.startsWith("[AUTO MESSAGE]\n")).toBe(true);
  expect(saved.at(-1)?.lastReportWindowEnd).toBe(WINDOW_END);
});

test("skips without collecting when the window was already sent", async () => {
  let collected = 0;
  const { dependencies, sent } = harness({
    state: { lastReportWindowEnd: WINDOW_END, lastAlertWindowEnd: undefined },
    collect: async () => {
      collected += 1;
      return { items: [], warnings: [] };
    },
  });
  const outcome = await runWeeklyReport(dependencies);
  expect(outcome.status).toBe("skipped");
  expect(collected).toBe(0);
  expect(sent).toHaveLength(0);
});

test("force sends again when the window was already sent", async () => {
  const { dependencies, sent, saved } = harness({
    force: true,
    state: { lastReportWindowEnd: WINDOW_END, lastAlertWindowEnd: undefined },
  });
  const outcome = await runWeeklyReport(dependencies);
  expect(outcome).toEqual({ status: "sent", emptyWeek: false });
  expect(sent).toHaveLength(1);
  expect(sent[0]?.chatId).toBe("60123456789@c.us");
  expect(saved.at(-1)?.lastReportWindowEnd).toBe(WINDOW_END);
});

test("a dry run prints the report without sending or saving", async () => {
  const { dependencies, sent, saved, logs } = harness({ dryRun: true });
  const outcome = await runWeeklyReport(dependencies);
  expect(outcome).toEqual({ status: "dry-run", emptyWeek: false });
  expect(sent).toHaveLength(0);
  expect(saved).toHaveLength(0);
  expect(logs.some((line) => line.includes("[AUTO MESSAGE]"))).toBe(true);
});

test("a dry run ignores an already-sent window and still records nothing", async () => {
  const { dependencies, sent, saved } = harness({
    dryRun: true,
    state: { lastReportWindowEnd: WINDOW_END, lastAlertWindowEnd: undefined },
  });
  const outcome = await runWeeklyReport(dependencies);
  expect(outcome.status).toBe("dry-run");
  expect(sent).toHaveLength(0);
  expect(saved).toHaveLength(0);
});

test("an empty week notifies both the recipient and the operator", async () => {
  const { dependencies, sent } = harness({
    collect: async () => ({ items: [], warnings: [] }),
  });
  const outcome = await runWeeklyReport(dependencies);
  expect(outcome).toEqual({ status: "sent", emptyWeek: true });
  expect(sent.map((entry) => entry.chatId)).toEqual(["60123456789@c.us", "60199999999@c.us"]);
});

test("warnings do not hide an empty week from the operator", async () => {
  const { dependencies, sent } = harness({
    collect: async () => ({
      items: [],
      warnings: ["History may not reach the start of the reporting week."],
    }),
  });
  const outcome = await runWeeklyReport(dependencies);
  expect(outcome).toEqual({ status: "sent", emptyWeek: true });
  expect(sent.map((entry) => entry.chatId)).toEqual(["60123456789@c.us", "60199999999@c.us"]);
  expect(sent[0]?.content).toContain("No engagement recorded this week.");
});

test("collect receives the same window used for the report", async () => {
  let received: { startMs: number; endMs: number } | undefined;
  const { dependencies } = harness({
    collect: async (window) => {
      received = window;
      return { items: [], warnings: [] };
    },
  });
  await runWeeklyReport(dependencies);
  expect(received?.endMs).toBe(WINDOW_END);
});

test("a collection failure alerts the operator once and rethrows", async () => {
  const { dependencies, sent, saved } = harness({
    collect: async () => {
      throw new Error("history unavailable");
    },
  });
  await expect(runWeeklyReport(dependencies)).rejects.toThrow("history unavailable");
  expect(sent).toHaveLength(1);
  expect(sent[0]?.chatId).toBe("60199999999@c.us");
  expect(sent[0]?.content).toContain("history unavailable");
  expect(saved.at(-1)?.lastAlertWindowEnd).toBe(WINDOW_END);
});

test("a second failure in the same window does not alert again", async () => {
  const { dependencies, sent } = harness({
    state: { lastReportWindowEnd: undefined, lastAlertWindowEnd: WINDOW_END },
    collect: async () => {
      throw new Error("history unavailable");
    },
  });
  await expect(runWeeklyReport(dependencies)).rejects.toThrow("history unavailable");
  expect(sent).toHaveLength(0);
});

test("force alerts again when the window already alerted", async () => {
  const { dependencies, sent } = harness({
    force: true,
    state: { lastReportWindowEnd: undefined, lastAlertWindowEnd: WINDOW_END },
    collect: async () => {
      throw new Error("history unavailable");
    },
  });
  await expect(runWeeklyReport(dependencies)).rejects.toThrow("history unavailable");
  expect(sent).toHaveLength(1);
  expect(sent[0]?.chatId).toBe("60199999999@c.us");
});

test("a failed alert never breaks the run", async () => {
  const { dependencies, logs } = harness({
    selfChatId: undefined,
    collect: async () => {
      throw new Error("history unavailable");
    },
  });
  await expect(runWeeklyReport(dependencies)).rejects.toThrow("history unavailable");
  expect(logs.some((line) => line.includes("alert"))).toBe(true);
});

test("an unsupported self send is swallowed", async () => {
  const { dependencies, logs } = harness({
    sendMessage: async (chatId) => {
      if (chatId === "60199999999@c.us") throw new Error("cannot send to yourself");
      return undefined;
    },
    collect: async () => {
      throw new Error("history unavailable");
    },
  });
  await expect(runWeeklyReport(dependencies)).rejects.toThrow("history unavailable");
  expect(logs.some((line) => line.includes("cannot send to yourself"))).toBe(true);
});

// Month-end runs on the 1st. Here the last weekly ended Sat 29 Sep 00:00 MYT,
// so the 1 Oct run covers 29 and 30 Sep.
const MONTH_END_NOW = new Date("2026-09-30T22:00:00.000Z");
const LAST_WEEKLY_END = Date.parse("2026-09-28T16:00:00.000Z");
const MONTH_START = Date.parse("2026-09-30T16:00:00.000Z");

function monthEndState(overrides: Partial<WeeklyState> = {}): WeeklyState {
  return {
    lastReportWindowEnd: LAST_WEEKLY_END,
    lastAlertWindowEnd: undefined,
    lastMonthEndWindowEnd: undefined,
    ...overrides,
  };
}

test("the month-end run sends the days since the last report", async () => {
  const { dependencies, sent, saved } = harness({ now: MONTH_END_NOW, state: monthEndState() });
  const outcome = await runMonthEndReport(dependencies);
  expect(outcome).toEqual({ status: "sent", emptyWeek: false });
  expect(sent).toHaveLength(1);
  expect(sent[0]?.chatId).toBe("60123456789@c.us");
  expect(saved.at(-1)?.lastMonthEndWindowEnd).toBe(MONTH_START);
  // The weekly window end is left alone so the next weekly still runs.
  expect(saved.at(-1)?.lastReportWindowEnd).toBe(LAST_WEEKLY_END);
});

test("the month-end window starts at the last report and ends at the month start", async () => {
  let received: { startMs: number; endMs: number } | undefined;
  const { dependencies } = harness({
    now: MONTH_END_NOW,
    state: monthEndState(),
    collect: async (window) => {
      received = window;
      return { items: [], warnings: [] };
    },
  });
  await runMonthEndReport(dependencies);
  expect(received).toEqual({ startMs: LAST_WEEKLY_END, endMs: MONTH_START });
});

test("the month-end run skips when nothing has happened since the last report", async () => {
  const { dependencies, sent, logs } = harness({
    now: MONTH_END_NOW,
    state: monthEndState({ lastReportWindowEnd: MONTH_START }),
  });
  const outcome = await runMonthEndReport(dependencies);
  expect(outcome.status).toBe("skipped");
  expect(sent).toHaveLength(0);
  expect(logs.some((line) => line.includes("No complete days"))).toBe(true);
});

test("the month-end run skips a month that was already recorded", async () => {
  const { dependencies, sent } = harness({
    now: MONTH_END_NOW,
    state: monthEndState({ lastMonthEndWindowEnd: MONTH_START }),
    collect: async () => {
      throw new Error("should not collect");
    },
  });
  const outcome = await runMonthEndReport(dependencies);
  expect(outcome.status).toBe("skipped");
  expect(sent).toHaveLength(0);
});

test("force re-sends an already-recorded month-end", async () => {
  const { dependencies, sent } = harness({
    now: MONTH_END_NOW,
    state: monthEndState({ lastMonthEndWindowEnd: MONTH_START }),
    force: true,
  });
  const outcome = await runMonthEndReport(dependencies);
  expect(outcome).toEqual({ status: "sent", emptyWeek: false });
  expect(sent).toHaveLength(1);
});
