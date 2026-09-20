import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "./config.js";

export const logsDirectory = join(dataDirectory, "logs");

const LOG_FILE_PREFIX = "imsc-";
const LOG_FILE_SUFFIX = ".log";
const RETAINED_LOG_FILES = 30;

/**
 * UTC day stamp. UTC keeps a file to one unambiguous 24h span and sorts
 * cleanly; each line still carries a full ISO timestamp.
 */
function logDayStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function logFilePath(directory: string, now: Date): string {
  return join(directory, `${LOG_FILE_PREFIX}${logDayStamp(now)}${LOG_FILE_SUFFIX}`);
}

export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerOptions {
  readonly scope: string;
  /** Defaults to the shared `data/logs` directory. */
  readonly directory?: string;
  readonly now?: () => Date;
  /** Mirror for live output; defaults to the console. */
  readonly mirror?: (level: LogLevel, line: string) => void;
}

/** Keeps the newest log files so an always-on server cannot fill the disk. */
export function pruneLogFiles(directory: string = logsDirectory, keep = RETAINED_LOG_FILES): void {
  try {
    const files = readdirSync(directory)
      .filter((name) => name.startsWith(LOG_FILE_PREFIX) && name.endsWith(LOG_FILE_SUFFIX))
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - keep))) {
      unlinkSync(join(directory, name));
    }
  } catch {
    // Pruning is best effort; logging must never break a run.
  }
}

/**
 * Appends timestamped, levelled lines to a daily file under `data/logs` and
 * mirrors them to the console. Writes are synchronous so the final lines are on
 * disk even when the process exits immediately after, and are best-effort so a
 * logging failure can never take down a run.
 */
export function createLogger(options: LoggerOptions): Logger {
  const directory = options.directory ?? logsDirectory;
  const now = options.now ?? (() => new Date());
  const mirror =
    options.mirror ??
    ((level: LogLevel, line: string): void => {
      if (level === "error") console.error(line);
      else console.log(line);
    });

  const write = (level: LogLevel, message: string): void => {
    const timestamp = now();
    const line = `${timestamp.toISOString()} ${level.toUpperCase()} [${options.scope}] ${message}`;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      appendFileSync(logFilePath(directory, timestamp), `${line}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch {
      // Best effort: the mirror below still surfaces the line.
    }
    mirror(level, line);
  };

  return {
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  };
}
