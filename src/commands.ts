export type Command = "setup" | "verify" | "weekly";

export interface CommandArguments {
  readonly command: Command;
  readonly force: boolean;
}

const FORCE_FLAG = "--force";

/**
 * `--force` makes the weekly run ignore the recorded send state. It is only
 * meaningful for `weekly`, so using it anywhere else is a mistake worth failing
 * on rather than silently accepting.
 */
export function parseCommand(arguments_: readonly string[]): CommandArguments {
  const force = arguments_.includes(FORCE_FLAG);
  const [first] = arguments_.filter((argument) => argument !== FORCE_FLAG);
  const command: Command = first === "setup" ? "setup" : first === "weekly" ? "weekly" : "verify";
  if (force && command !== "weekly") {
    throw new Error(`${FORCE_FLAG} is only supported by the weekly command.`);
  }
  return { command, force };
}
