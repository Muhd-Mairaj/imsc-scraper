import { expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = realpathSync(resolve(import.meta.dir, ".."));
const installScript = resolve(import.meta.dir, "..", "deploy", "install.sh");
const serviceUnit = resolve(import.meta.dir, "..", "deploy", "imsc-weekly.service");

test("install.sh points the service at its own checkout", () => {
  const result = Bun.spawnSync(["sh", installScript, "--print"]);
  const output = result.stdout.toString();
  expect(result.exitCode).toBe(0);
  expect(output).toContain(`WorkingDirectory=${repoRoot}\n`);
  expect(output).not.toContain("/path/to/imsc-scraper");
  expect(output).toMatch(/^ExecStart=\S+ compose run --rm imsc weekly$/mu);
});

test("the committed service unit carries no machine-specific path", () => {
  const unit = readFileSync(serviceUnit, "utf8");
  expect(unit).not.toMatch(/^WorkingDirectory=\/home\//mu);
  expect(unit).toContain("WorkingDirectory=/path/to/imsc-scraper");
});
