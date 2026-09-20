import { renderMonthlyActivitySummary } from "./report.js";
import { computeWeeklyWindow, type WeeklyWindow } from "./schedule.js";
import { shouldSendAlert, shouldSendReport, type WeeklyState } from "./state.js";
import { renderFailureAlert, renderWeeklyReport } from "./weekly.js";

export interface WeeklyEngagement {
  readonly items: Parameters<typeof renderMonthlyActivitySummary>[0];
  readonly warnings: readonly string[];
}

export interface WeeklyRunDependencies {
  readonly now: Date;
  readonly collect: () => Promise<WeeklyEngagement>;
  readonly sendMessage: (chatId: string, content: string) => Promise<void>;
  readonly recipientChatId: string;
  readonly selfChatId: string | undefined;
  readonly state: WeeklyState;
  readonly saveState: (state: WeeklyState) => Promise<void>;
  readonly log: (message: string) => void;
}

export interface WeeklyOutcome {
  readonly status: "sent" | "skipped";
  readonly emptyWeek: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Best-effort operator alert. Never throws: if WhatsApp cannot send to the
 * operator's own number, that is logged and the original failure propagates.
 */
async function alertBestEffort(
  dependencies: WeeklyRunDependencies,
  window: WeeklyWindow,
  error: unknown,
): Promise<void> {
  if (dependencies.selfChatId === undefined) {
    dependencies.log("No self chat id is available; skipping the failure alert.");
    return;
  }
  if (!shouldSendAlert(dependencies.state, window.endMs)) {
    dependencies.log("A failure alert was already sent for this window; skipping.");
    return;
  }
  try {
    await dependencies.sendMessage(
      dependencies.selfChatId,
      renderFailureAlert(window, errorMessage(error)),
    );
    await dependencies.saveState({ ...dependencies.state, lastAlertWindowEnd: window.endMs });
  } catch (alertError) {
    dependencies.log(`The failure alert could not be sent: ${errorMessage(alertError)}`);
  }
}

export async function runWeeklyReport(dependencies: WeeklyRunDependencies): Promise<WeeklyOutcome> {
  const window = computeWeeklyWindow(dependencies.now);

  if (!shouldSendReport(dependencies.state, window.endMs)) {
    dependencies.log(`The weekly report for the window ending ${window.endMs} was already sent.`);
    return { status: "skipped", emptyWeek: false };
  }

  try {
    const collected = await dependencies.collect();
    const body = renderMonthlyActivitySummary(collected.items, collected.warnings);
    const emptyWeek = body.trim().length === 0;

    await dependencies.sendMessage(dependencies.recipientChatId, renderWeeklyReport(window, body));
    await dependencies.saveState({ ...dependencies.state, lastReportWindowEnd: window.endMs });

    if (emptyWeek && dependencies.selfChatId !== undefined) {
      try {
        await dependencies.sendMessage(dependencies.selfChatId, renderWeeklyReport(window, ""));
      } catch (noticeError) {
        dependencies.log(
          `The empty-week notice could not be sent to you: ${errorMessage(noticeError)}`,
        );
      }
    }

    return { status: "sent", emptyWeek };
  } catch (error) {
    await alertBestEffort(dependencies, window, error);
    throw error;
  }
}
