export const WEEKLY_TIME_ZONE = "Asia/Kuala_Lumpur";

const SATURDAY = 6;
const DAY_MS = 86_400_000;

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface WeeklyWindow {
  readonly startMs: number;
  readonly endMs: number;
}

function partsInTimeZone(
  timeZone: string,
  instantMs: number,
  options: Intl.DateTimeFormatOptions,
): readonly Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).formatToParts(
    new Date(instantMs),
  );
}

function partValue(parts: readonly Intl.DateTimeFormatPart[], type: string): number {
  const part = parts.find((candidate) => candidate.type === type);
  if (part === undefined) {
    throw new Error(`Intl did not return a "${type}" part.`);
  }
  return Number(part.value);
}

/**
 * Offset of `timeZone` from UTC at `instantMs`, in milliseconds.
 * Computed against a whole-second instant so the result never carries sub-second noise.
 */
function timeZoneOffsetMs(timeZone: string, instantMs: number): number {
  const flooredMs = Math.floor(instantMs / 1_000) * 1_000;
  const parts = partsInTimeZone(timeZone, flooredMs, {
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const asUtcMs = Date.UTC(
    partValue(parts, "year"),
    partValue(parts, "month") - 1,
    partValue(parts, "day"),
    partValue(parts, "hour"),
    partValue(parts, "minute"),
    partValue(parts, "second"),
  );
  return asUtcMs - flooredMs;
}

function localDateParts(
  timeZone: string,
  instantMs: number,
): Readonly<{ year: number; month: number; day: number }> {
  const parts = partsInTimeZone(timeZone, instantMs, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return {
    year: partValue(parts, "year"),
    month: partValue(parts, "month"),
    day: partValue(parts, "day"),
  };
}

function localWeekday(timeZone: string, instantMs: number): number {
  const parts = partsInTimeZone(timeZone, instantMs, { weekday: "short" });
  const label = parts.find((candidate) => candidate.type === "weekday")?.value;
  const index = label === undefined ? undefined : WEEKDAY_INDEX[label];
  if (index === undefined) {
    throw new Error(`Unrecognised weekday label "${String(label)}".`);
  }
  return index;
}

/** The UTC instant of local midnight on the given civil date. */
function localMidnightUtcMs(year: number, month: number, day: number, timeZone: string): number {
  const guessMs = Date.UTC(year, month - 1, day);
  const firstOffset = timeZoneOffsetMs(timeZone, guessMs);
  const candidateMs = guessMs - firstOffset;
  const secondOffset = timeZoneOffsetMs(timeZone, candidateMs);
  return secondOffset === firstOffset ? candidateMs : guessMs - secondOffset;
}

/**
 * The seven complete local days ending at the most recent Saturday 00:00 at or
 * before `now`. Anchored to that boundary rather than to `now`, so a catch-up
 * run computes the same window it would have at 06:00 on the Saturday.
 */
export function computeWeeklyWindow(now: Date): WeeklyWindow {
  const nowMs = now.getTime();
  const { year, month, day } = localDateParts(WEEKLY_TIME_ZONE, nowMs);
  const daysBack = (localWeekday(WEEKLY_TIME_ZONE, nowMs) - SATURDAY + 7) % 7;
  const saturdayCivilMs = Date.UTC(year, month - 1, day) - daysBack * DAY_MS;
  const saturday = new Date(saturdayCivilMs);
  const endMs = localMidnightUtcMs(
    saturday.getUTCFullYear(),
    saturday.getUTCMonth() + 1,
    saturday.getUTCDate(),
    WEEKLY_TIME_ZONE,
  );
  return Object.freeze({ startMs: endMs - 7 * DAY_MS, endMs });
}

/** `DD/MM/YYYY` in the weekly timezone. */
function formatWindowDate(timestampMs: number): string {
  const parts = partsInTimeZone(WEEKLY_TIME_ZONE, timestampMs, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  return `${day}/${month}/${year}`;
}

/** Human range covering both endpoints, e.g. `12/09/2026 – 18/09/2026`. */
export function formatWindowRange(window: WeeklyWindow): string {
  return `${formatWindowDate(window.startMs)} – ${formatWindowDate(window.endMs - 1)}`;
}
