import { expect, test } from "bun:test";
import { computeWeeklyWindow } from "../src/schedule.js";
import { renderFailureAlert, renderWeeklyReport } from "../src/weekly.js";

const window = computeWeeklyWindow(new Date("2026-09-18T22:00:00.000Z"));

test("wraps a report body with the marker and signature", () => {
  expect(renderWeeklyReport(window, "*15/09/2026*\n+601162168427 - 2\n\n")).toBe(
    "[AUTO MESSAGE]\n*Weekly engagement report*\n12/09/2026 – 18/09/2026\n\n*15/09/2026*\n+601162168427 - 2\n\n_~ Mairaj's Bot_\n",
  );
});

test("a blank body becomes the empty-week notice", () => {
  expect(renderWeeklyReport(window, "")).toBe(
    "[AUTO MESSAGE]\n*Weekly engagement report*\n12/09/2026 – 18/09/2026\n\nNo engagement recorded this week.\n\n_~ Mairaj's Bot_\n",
  );
});

test("a whitespace-only body is also treated as empty", () => {
  expect(renderWeeklyReport(window, "\n\n  \n")).toBe(
    "[AUTO MESSAGE]\n*Weekly engagement report*\n12/09/2026 – 18/09/2026\n\nNo engagement recorded this week.\n\n_~ Mairaj's Bot_\n",
  );
});

test("renders a failure alert", () => {
  expect(renderFailureAlert(window, "WhatsApp session is not connected.")).toBe(
    "[AUTO MESSAGE]\n*Weekly report failed*\n12/09/2026 – 18/09/2026\n\nWhatsApp session is not connected.\n\n_~ Mairaj's Bot_\n",
  );
});

test("every rendered message carries both markers", () => {
  for (const message of [
    renderWeeklyReport(window, "body\n"),
    renderWeeklyReport(window, ""),
    renderFailureAlert(window, "boom"),
  ]) {
    expect(message.startsWith("[AUTO MESSAGE]\n")).toBe(true);
    expect(message.endsWith("_~ Mairaj's Bot_\n")).toBe(true);
  }
});
