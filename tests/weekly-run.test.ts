import { expect, test } from "bun:test";
import type { WeeklyState } from "../src/state.js";
import { runWeeklyReport, type WeeklyRunDependencies } from "../src/weekly-run.js";

const NOW = new Date("2026-09-18T22:00:00.000Z");
const WINDOW_END = Date.parse("2026-09-18T16:00:00.000Z");

const EMPTY_STATE: WeeklyState = {
  lastReportWindowEnd: undefined,
  lastAlertWindowEnd: undefined,
};

function harness(overrides: Partial<WeeklyRunDependencies> = {}) {
  const sent: { chatId: string; content: string }[] = [];
  const saved: WeeklyState[] = [];
  const logs: string[] = [];
  const dependencies: WeeklyRunDependencies = {
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
