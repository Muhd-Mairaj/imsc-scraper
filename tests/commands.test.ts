import { expect, test } from "bun:test";
import { parseCommand } from "../src/commands.js";

test("defaults to the monthly verify command", () => {
  expect(parseCommand([])).toEqual({ command: "verify", force: false, dryRun: false });
  expect(parseCommand(["unexpected"])).toEqual({ command: "verify", force: false, dryRun: false });
});

test("recognizes the setup and weekly commands", () => {
  expect(parseCommand(["setup"])).toEqual({ command: "setup", force: false, dryRun: false });
  expect(parseCommand(["weekly"])).toEqual({ command: "weekly", force: false, dryRun: false });
});

test("weekly accepts --force in any position", () => {
  expect(parseCommand(["weekly", "--force"])).toEqual({
    command: "weekly",
    force: true,
    dryRun: false,
  });
  expect(parseCommand(["--force", "weekly"])).toEqual({
    command: "weekly",
    force: true,
    dryRun: false,
  });
});

test("weekly accepts --dry-run, alone and with --force", () => {
  expect(parseCommand(["weekly", "--dry-run"])).toEqual({
    command: "weekly",
    force: false,
    dryRun: true,
  });
  expect(parseCommand(["weekly", "--force", "--dry-run"])).toEqual({
    command: "weekly",
    force: true,
    dryRun: true,
  });
});

test("the flags are rejected for commands that do not send", () => {
  expect(() => parseCommand(["setup", "--force"])).toThrow("--force");
  expect(() => parseCommand(["--force"])).toThrow("--force");
  expect(() => parseCommand(["setup", "--dry-run"])).toThrow("--dry-run");
  expect(() => parseCommand(["--dry-run"])).toThrow("--dry-run");
});
