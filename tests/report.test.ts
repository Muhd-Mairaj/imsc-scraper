import { expect, test } from "bun:test";
import { renderMonthlyActivitySummary } from "../src/report.js";

test("renders sorted activity lines, empty day headings, warnings, and day separators", () => {
  expect(
    renderMonthlyActivitySummary(
      [
        { timestampMs: new Date(2026, 8, 8, 9).getTime(), activity: 1, participantDisplays: [] },
        {
          timestampMs: new Date(2026, 8, 9, 9).getTime(),
          activity: 2,
          participantDisplays: ["+8801303077021", "+601162168427"],
        },
      ],
      ["09/09/2026: participant identity unavailable."],
    ),
  ).toBe(
    "*08/09/2026*\n\n*09/09/2026*\n+601162168427 - 2\n+8801303077021 - 2\n\n\nWarnings:\n- 09/09/2026: participant identity unavailable.\n",
  );
});
