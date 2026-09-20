export type Command = "setup" | "verify" | "weekly";

export interface CommandArguments {
  readonly command: Command;
  readonly force: boolean;
  readonly dryRun: boolean;
}

const FORCE_FLAG = "--force";
const DRY_RUN_FLAG = "--dry-run";

/**
 * `--force` and `--dry-run` only affect the weekly run, so using them anywhere
 * else is a mistake worth failing on rather than silently accepting.
 */
export function parseCommand(arguments_: readonly string[]): CommandArguments {
  const force = arguments_.includes(FORCE_FLAG);
  const dryRun = arguments_.includes(DRY_RUN_FLAG);
  const [first] = arguments_.filter(
    (argument) => argument !== FORCE_FLAG && argument !== DRY_RUN_FLAG,
  );
  const command: Command = first === "setup" ? "setup" : first === "weekly" ? "weekly" : "verify";
  for (const flag of [FORCE_FLAG, DRY_RUN_FLAG]) {
    if (arguments_.includes(flag) && command !== "weekly") {
      throw new Error(`${flag} is only supported by the weekly command.`);
    }
  }
  return { command, force, dryRun };
}
