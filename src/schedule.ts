import { DateTime } from "luxon";

export const WEEKLY_TIME_ZONE = "Asia/Kuala_Lumpur";

const DAY_MS = 86_400_000;
const SATURDAY = 6; // luxon weekday scale: Monday = 1 … Sunday = 7

export interface WeeklyWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Seven complete local days ending at the most recent Saturday 00:00. Anchored
 * to that boundary, not to `now`, so a catch-up run reports the same week it
 * would have on the Saturday.
 */
export function computeWeeklyWindow(now: Date): WeeklyWindow {
  const local = DateTime.fromJSDate(now, { zone: WEEKLY_TIME_ZONE });
  const daysSinceSaturday = (local.weekday - SATURDAY + 7) % 7;
  const endMs = local.startOf("day").minus({ days: daysSinceSaturday }).toMillis();
  return { startMs: endMs - 7 * DAY_MS, endMs };
}

/**
 * The days since the last report, ending at the start of the current local
 * month. Used on the 1st so the previous month can be tallied without waiting
 * for the next Saturday. The start is capped at the previous month start, so a
 * long gap between reports still yields at most one month.
 */
export function computeMonthEndWindow(
  now: Date,
  lastReportWindowEnd: number | undefined,
): WeeklyWindow {
  const local = DateTime.fromJSDate(now, { zone: WEEKLY_TIME_ZONE });
  const monthStartMs = local.startOf("month").toMillis();
  const previousMonthStartMs = local.startOf("month").minus({ months: 1 }).toMillis();
  const startMs = Math.max(lastReportWindowEnd ?? previousMonthStartMs, previousMonthStartMs);
  return { startMs, endMs: monthStartMs };
}

/** Both endpoint days are inclusive, e.g. `12/09/2026 – 18/09/2026`. */
export function formatWindowRange(window: WeeklyWindow): string {
  const format = (timestampMs: number): string =>
    DateTime.fromMillis(timestampMs, { zone: WEEKLY_TIME_ZONE }).toFormat("dd/MM/yyyy");
  return `${format(window.startMs)} – ${format(window.endMs - 1)}`;
}
