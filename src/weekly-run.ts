import { renderMonthlyActivitySummary } from "./report.js";
import {
  computeWeeklyWindow,
  formatWindowRange,
  WEEKLY_TIME_ZONE,
  type WeeklyWindow,
} from "./schedule.js";
import { shouldSendAlert, shouldSendReport, type WeeklyState } from "./state.js";
import { errorMessage } from "./utils.js";
import { renderFailureAlert, renderWeeklyReport } from "./weekly.js";

export interface WeeklyEngagement {
  readonly items: Parameters<typeof renderMonthlyActivitySummary>[0];
  readonly warnings: readonly string[];
}

export interface WeeklyRunDependencies {
  readonly now: Date;
  readonly collect: (window: WeeklyWindow) => Promise<WeeklyEngagement>;
  readonly sendMessage: (chatId: string, content: string) => Promise<void>;
  readonly recipientChatId: string;
  readonly selfChatId: string | undefined;
  /** Bypass the recorded send state and run the report for this window anyway. */
  readonly force: boolean;
  /** Collect and print the message that would be sent, without sending or saving state. */
  readonly dryRun: boolean;
  readonly state: WeeklyState;
  readonly saveState: (state: WeeklyState) => Promise<void>;
  readonly log: (message: string) => void;
}

export interface WeeklyOutcome {
  readonly status: "sent" | "skipped" | "dry-run";
  readonly emptyWeek: boolean;
}

/** Best effort: a failed alert is logged, and the original error still propagates. */
async function alertBestEffort(
  dependencies: WeeklyRunDependencies,
  window: WeeklyWindow,
  error: unknown,
): Promise<void> {
  if (dependencies.selfChatId === undefined) {
    dependencies.log("No self chat id is available; skipping the failure alert.");
    return;
  }
  if (!dependencies.force && !shouldSendAlert(dependencies.state, window.endMs)) {
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
  dependencies.log(
    `Weekly window: ${formatWindowRange(window)} (${WEEKLY_TIME_ZONE}), ending ${window.endMs}.`,
  );

  if (
    !dependencies.force &&
    !dependencies.dryRun &&
    !shouldSendReport(dependencies.state, window.endMs)
  ) {
    dependencies.log(`The weekly report for the window ending ${window.endMs} was already sent.`);
    return { status: "skipped", emptyWeek: false };
  }

  try {
    dependencies.log("Collecting engagement from WhatsApp...");
    const collected = await dependencies.collect(window);
    const body = renderMonthlyActivitySummary(collected.items, collected.warnings);
    const emptyWeek = collected.items.length === 0;
    dependencies.log(
      `Collected ${collected.items.length} activity item(s); the week is ${emptyWeek ? "empty" : "not empty"}.`,
    );

    if (dependencies.dryRun) {
      dependencies.log(
        `Dry run: not sending to ${dependencies.recipientChatId} and not updating the state file.`,
      );
      dependencies.log(renderWeeklyReport(window, emptyWeek ? "" : body));
      return { status: "dry-run", emptyWeek };
    }

    dependencies.log(`Sending the weekly report to ${dependencies.recipientChatId}...`);
    await dependencies.sendMessage(
      dependencies.recipientChatId,
      renderWeeklyReport(window, emptyWeek ? "" : body),
    );
    await dependencies.saveState({ ...dependencies.state, lastReportWindowEnd: window.endMs });
    dependencies.log(`Sent the weekly report for the window ending ${window.endMs}.`);

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
