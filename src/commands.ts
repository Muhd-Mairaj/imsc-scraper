import { parseArgs } from "node:util";

export type Command = "setup" | "verify" | "weekly";

export interface CommandArguments {
  readonly command: Command;
  readonly force: boolean;
  readonly dryRun: boolean;
}

/** `--force` and `--dry-run` only apply to `weekly`; using them elsewhere is an error. */
export function parseCommand(arguments_: readonly string[]): CommandArguments {
  const { values, positionals } = parseArgs({
    args: [...arguments_],
    options: { force: { type: "boolean" }, "dry-run": { type: "boolean" } },
    allowPositionals: true,
    strict: false,
  });
  const [first] = positionals;
  const command: Command = first === "setup" || first === "weekly" ? first : "verify";
  const force = values.force === true;
  const dryRun = values["dry-run"] === true;
  if (command !== "weekly" && (force || dryRun)) {
    throw new Error(`${force ? "--force" : "--dry-run"} is only supported by the weekly command.`);
  }
  return { command, force, dryRun };
}
