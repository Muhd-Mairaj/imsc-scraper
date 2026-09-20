import { expect, test } from "bun:test";
import { parseCommand } from "../src/commands.js";

test("defaults to the monthly verify command", () => {
  expect(parseCommand([])).toEqual({ command: "verify", force: false });
  expect(parseCommand(["unexpected"])).toEqual({ command: "verify", force: false });
});

test("recognizes the setup and weekly commands", () => {
  expect(parseCommand(["setup"])).toEqual({ command: "setup", force: false });
  expect(parseCommand(["weekly"])).toEqual({ command: "weekly", force: false });
});

test("weekly accepts --force in any position", () => {
  expect(parseCommand(["weekly", "--force"])).toEqual({ command: "weekly", force: true });
  expect(parseCommand(["--force", "weekly"])).toEqual({ command: "weekly", force: true });
});

test("--force is rejected for commands that do not send", () => {
  expect(() => parseCommand(["setup", "--force"])).toThrow("--force");
  expect(() => parseCommand(["--force"])).toThrow("--force");
});
