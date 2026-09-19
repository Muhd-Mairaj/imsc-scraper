export type ActivityValue = 1 | 2;

export interface MonthlyActivityItem {
  readonly timestampMs: number;
  readonly activity: ActivityValue;
  readonly participantDisplays: readonly string[];
}

function dateHeading(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `*${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}*`;
}

export function renderMonthlyActivitySummary(
  items: readonly MonthlyActivityItem[],
  warnings: readonly string[],
): string {
  const sections = new Map<string, { timestampMs: number; lines: string[] }>();
  for (const item of [...items].sort((left, right) => left.timestampMs - right.timestampMs)) {
    const heading = dateHeading(item.timestampMs);
    const section = sections.get(heading) ?? { timestampMs: item.timestampMs, lines: [] };
    section.lines.push(
      ...item.participantDisplays.map((display) => `${display} - ${item.activity}`),
    );
    sections.set(heading, section);
  }

  const output: string[] = [];
  for (const [heading, section] of [...sections.entries()].sort(
    ([, left], [, right]) => left.timestampMs - right.timestampMs,
  )) {
    output.push(heading, ...section.lines.sort((left, right) => left.localeCompare(right)));
    output.push("");
  }
  const uniqueWarnings = [...new Set(warnings)];
  if (uniqueWarnings.length > 0) {
    if (output.length > 0) output.push("");
    output.push("Warnings:", ...uniqueWarnings.map((warning) => `- ${warning}`));
  }

  return output.length === 0 ? "" : `${output.join("\n")}\n`;
}
