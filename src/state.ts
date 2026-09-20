import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDirectory } from "./config.js";

export interface WeeklyState {
  readonly lastReportWindowEnd: number | undefined;
  readonly lastAlertWindowEnd: number | undefined;
}

export const weeklyStateFilePath = join(dataDirectory, "weekly-state.json");

const EMPTY_STATE: WeeklyState = Object.freeze({
  lastReportWindowEnd: undefined,
  lastAlertWindowEnd: undefined,
});

function windowEnd(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Missing or malformed state is empty state, never an error — worst case we resend once. */
export async function loadWeeklyState(): Promise<WeeklyState> {
  let raw: string;
  try {
    raw = await readFile(weeklyStateFilePath, "utf8");
  } catch {
    return EMPTY_STATE;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return EMPTY_STATE;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return EMPTY_STATE;
  }
  const fields = parsed as Readonly<Record<string, unknown>>;
  return {
    lastReportWindowEnd: windowEnd(fields.lastReportWindowEnd),
    lastAlertWindowEnd: windowEnd(fields.lastAlertWindowEnd),
  };
}

export async function saveWeeklyState(state: WeeklyState): Promise<void> {
  await mkdir(dirname(weeklyStateFilePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${weeklyStateFilePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, weeklyStateFilePath);
}

export function shouldSendReport(state: WeeklyState, windowEndMs: number): boolean {
  return state.lastReportWindowEnd !== windowEndMs;
}

export function shouldSendAlert(state: WeeklyState, windowEndMs: number): boolean {
  return state.lastAlertWindowEnd !== windowEndMs;
}
