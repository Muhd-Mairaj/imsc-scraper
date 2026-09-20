import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, logFilePath, pruneLogFiles } from "../src/logger.js";

function withTempDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "imsc-logger-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("writes scoped, levelled lines to the daily log file", () => {
  withTempDirectory((directory) => {
    const now = (): Date => new Date("2026-09-20T12:00:00.000Z");
    const logger = createLogger({ scope: "weekly", directory, now, mirror: () => undefined });
    logger.info("started");
    logger.warn("careful");
    logger.error("broke");
    const lines = readFileSync(logFilePath(directory, now()), "utf8").trimEnd().split("\n");
    expect(lines).toEqual([
      "2026-09-20T12:00:00.000Z INFO [weekly] started",
      "2026-09-20T12:00:00.000Z WARN [weekly] careful",
      "2026-09-20T12:00:00.000Z ERROR [weekly] broke",
    ]);
  });
});

test("appends across calls and mirrors every line", () => {
  withTempDirectory((directory) => {
    const now = (): Date => new Date("2026-09-20T12:00:00.000Z");
    const mirrored: string[] = [];
    const logger = createLogger({
      scope: "run",
      directory,
      now,
      mirror: (level, line) => mirrored.push(`${level}:${line}`),
    });
    logger.info("first");
    logger.info("second");
    const lines = readFileSync(logFilePath(directory, now()), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(mirrored).toEqual([
      "info:2026-09-20T12:00:00.000Z INFO [run] first",
      "info:2026-09-20T12:00:00.000Z INFO [run] second",
    ]);
  });
});

test("keeps a failing file write from throwing", () => {
  withTempDirectory((directory) => {
    const fileAsDirectory = join(directory, "imsc-2026-09-20.log");
    writeFileSync(fileAsDirectory, "not a directory\n");
    const logger = createLogger({
      scope: "run",
      directory: fileAsDirectory,
      mirror: () => undefined,
      now: () => new Date("2026-09-20T12:00:00.000Z"),
    });
    expect(() => logger.info("still works")).not.toThrow();
  });
});

test("prunes the oldest log files beyond the keep limit", () => {
  withTempDirectory((directory) => {
    for (const day of ["01", "02", "03", "04", "05"]) {
      writeFileSync(join(directory, `imsc-2026-09-${day}.log`), "x\n");
    }
    writeFileSync(join(directory, "unrelated.txt"), "keep me\n");
    pruneLogFiles(directory, 3);
    expect(readdirSync(directory).sort()).toEqual([
      "imsc-2026-09-03.log",
      "imsc-2026-09-04.log",
      "imsc-2026-09-05.log",
      "unrelated.txt",
    ]);
  });
});
