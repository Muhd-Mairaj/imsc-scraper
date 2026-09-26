import { formatWindowRange, type WeeklyWindow } from "./schedule.js";

export const AUTO_MESSAGE_MARKER = "[AUTO MESSAGE]";
export const BOT_SIGNATURE = "_~ Mairaj's Bot_";
export const EMPTY_WEEK_NOTICE = "No engagement recorded this week.";

function envelope(heading: string, window: WeeklyWindow, body: string): string {
  return `${AUTO_MESSAGE_MARKER}\n*${heading}*\n${formatWindowRange(window)}\n\n${body}\n\n${BOT_SIGNATURE}\n`;
}

/** A blank body renders the empty-week notice. */
export function renderWeeklyReport(window: WeeklyWindow, body: string): string {
  const trimmed = body.trim();
  return envelope(
    "Weekly engagement report",
    window,
    trimmed.length === 0 ? EMPTY_WEEK_NOTICE : trimmed,
  );
}

export function renderFailureAlert(window: WeeklyWindow, errorSummary: string): string {
  return envelope("Weekly report failed", window, errorSummary.trim());
}
