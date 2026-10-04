import { parseArgs } from "node:util";

export type Command = "setup" | "verify" | "weekly" | "month-end" | "help";

export interface CommandArguments {
  readonly command: Command;
  readonly force: boolean;
  readonly dryRun: boolean;
}

export const USAGE = `Usage: imsc <command> [options]

Commands:
  verify      Write the current month's engagement summary (default)
  setup       Link WhatsApp, choose the group, and set the weekly recipient
  weekly      Send the weekly engagement report
  month-end   Send the days since the last report up to the end of the month

Options:
  --force     weekly, month-end: send even if this window was already recorded
  --dry-run   weekly, month-end: print the report without sending or saving state
  -h, --help  Show this help
`;

export function parseCommand(arguments_: readonly string[]): CommandArguments {
  const { values, positionals } = parseArgs({
    args: [...arguments_],
    options: {
      force: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });
  if (values.help === true) return { command: "help", force: false, dryRun: false };
  const [first] = positionals;
  const command: Command =
    first === "setup" || first === "weekly" || first === "month-end" ? first : "verify";
  const force = values.force === true;
  const dryRun = values["dry-run"] === true;
  if (command !== "weekly" && command !== "month-end" && (force || dryRun)) {
    throw new Error(
      `${force ? "--force" : "--dry-run"} is only supported by the weekly and month-end commands.`,
    );
  }
  return { command, force, dryRun };
}
