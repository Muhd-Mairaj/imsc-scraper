import { renderMonthlyActivitySummary } from "./report.js";
import {
  computeMonthEndWindow,
  computeWeeklyWindow,
  formatWindowRange,
  WEEKLY_TIME_ZONE,
  type WeeklyWindow,
} from "./schedule.js";
import {
  shouldSendAlert,
  shouldSendMonthEnd,
  shouldSendReport,
  type WeeklyState,
} from "./state.js";
import { errorMessage } from "./utils.js";
import { renderFailureAlert, renderWeeklyReport } from "./weekly.js";

export interface WeeklyEngagement {
  readonly items: Parameters<typeof renderMonthlyActivitySummary>[0];
  readonly warnings: readonly string[];
}

export interface ReportRunDependencies {
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

/** How one report differs from another: its window and how it records itself. */
interface ReportPlan {
  readonly label: string;
  readonly window: WeeklyWindow;
  readonly needsSending: (state: WeeklyState, windowEndMs: number) => boolean;
  readonly recordSent: (state: WeeklyState, windowEndMs: number) => WeeklyState;
}

/** Best effort: a failed alert is logged, and the original error still propagates. */
async function alertBestEffort(
  dependencies: ReportRunDependencies,
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

async function runReport(
  dependencies: ReportRunDependencies,
  plan: ReportPlan,
): Promise<WeeklyOutcome> {
  const { window, label } = plan;
  dependencies.log(
    `${label} window: ${formatWindowRange(window)} (${WEEKLY_TIME_ZONE}), ending ${window.endMs}.`,
  );

  if (
    !dependencies.force &&
    !dependencies.dryRun &&
    !plan.needsSending(dependencies.state, window.endMs)
  ) {
    dependencies.log(
      `The ${label.toLowerCase()} report for the window ending ${window.endMs} was already sent.`,
    );
    return { status: "skipped", emptyWeek: false };
  }

  try {
    dependencies.log("Collecting engagement from WhatsApp...");
    const collected = await dependencies.collect(window);
    const body = renderMonthlyActivitySummary(collected.items, collected.warnings);
    const emptyWeek = collected.items.length === 0;
    dependencies.log(
      `Collected ${collected.items.length} activity item(s); the period is ${emptyWeek ? "empty" : "not empty"}.`,
    );

    if (dependencies.dryRun) {
      dependencies.log(
        `Dry run: not sending to ${dependencies.recipientChatId} and not updating the state file.`,
      );
      dependencies.log(renderWeeklyReport(window, emptyWeek ? "" : body));
      return { status: "dry-run", emptyWeek };
    }

    dependencies.log(
      `Sending the ${label.toLowerCase()} report to ${dependencies.recipientChatId}...`,
    );
    await dependencies.sendMessage(
      dependencies.recipientChatId,
      renderWeeklyReport(window, emptyWeek ? "" : body),
    );
    await dependencies.saveState(plan.recordSent(dependencies.state, window.endMs));
    dependencies.log(
      `Sent the ${label.toLowerCase()} report for the window ending ${window.endMs}.`,
    );

    if (emptyWeek && dependencies.selfChatId !== undefined) {
      try {
        await dependencies.sendMessage(dependencies.selfChatId, renderWeeklyReport(window, ""));
      } catch (noticeError) {
        dependencies.log(
          `The empty-period notice could not be sent to you: ${errorMessage(noticeError)}`,
        );
      }
    }

    return { status: "sent", emptyWeek };
  } catch (error) {
    await alertBestEffort(dependencies, window, error);
    throw error;
  }
}

export async function runWeeklyReport(dependencies: ReportRunDependencies): Promise<WeeklyOutcome> {
  return runReport(dependencies, {
    label: "Weekly",
    window: computeWeeklyWindow(dependencies.now),
    needsSending: shouldSendReport,
    recordSent: (state, windowEndMs) => ({ ...state, lastReportWindowEnd: windowEndMs }),
  });
}

export async function runMonthEndReport(
  dependencies: ReportRunDependencies,
): Promise<WeeklyOutcome> {
  const window = computeMonthEndWindow(dependencies.now, dependencies.state.lastReportWindowEnd);
  if (window.startMs >= window.endMs) {
    dependencies.log(
      "No complete days have passed since the last report; skipping the month-end report.",
    );
    return { status: "skipped", emptyWeek: false };
  }
  return runReport(dependencies, {
    label: "Month-end",
    window,
    needsSending: shouldSendMonthEnd,
    recordSent: (state, windowEndMs) => ({ ...state, lastMonthEndWindowEnd: windowEndMs }),
  });
}
