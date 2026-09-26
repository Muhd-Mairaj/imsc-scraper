import { DateTime } from "luxon";

export type ActivityValue = 1 | 2;

export interface MonthlyActivityItem {
  readonly timestampMs: number;
  readonly activity: ActivityValue;
  readonly participantDisplays: readonly string[];
}

/** `DD/MM/YYYY` in the process time zone. */
export function formatActivityDate(timestampMs: number): string {
  return DateTime.fromMillis(timestampMs).toFormat("dd/MM/yyyy");
}

export function renderMonthlyActivitySummary(
  items: readonly MonthlyActivityItem[],
  warnings: readonly string[],
): string {
  const sections = new Map<string, { timestampMs: number; lines: string[] }>();
  for (const item of [...items].sort((left, right) => left.timestampMs - right.timestampMs)) {
    const heading = `*${formatActivityDate(item.timestampMs)}*`;
    const section = sections.get(heading) ?? { timestampMs: item.timestampMs, lines: [] };
    for (const display of item.participantDisplays) {
      section.lines.push(`${display} - ${item.activity}`);
    }
    sections.set(heading, section);
  }

  const output: string[] = [];
  for (const [heading, section] of [...sections.entries()].sort(
    ([, left], [, right]) => left.timestampMs - right.timestampMs,
  )) {
    output.push(heading, ...section.lines.sort((left, right) => left.localeCompare(right)), "");
  }

  const uniqueWarnings = [...new Set(warnings)];
  if (uniqueWarnings.length > 0) {
    if (output.length > 0) output.push("");
    output.push("Warnings:", ...uniqueWarnings.map((warning) => `- ${warning}`));
  }

  return output.length === 0 ? "" : `${output.join("\n")}\n`;
}
