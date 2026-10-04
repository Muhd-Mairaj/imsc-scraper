import { expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = realpathSync(resolve(import.meta.dir, ".."));
const installScript = resolve(import.meta.dir, "..", "deploy", "install.sh");
const serviceUnit = resolve(import.meta.dir, "..", "deploy", "imsc-weekly.service");
const monthEndServiceUnit = resolve(import.meta.dir, "..", "deploy", "imsc-month-end.service");

test("install.sh points the services at their own checkout", () => {
  const result = Bun.spawnSync(["sh", installScript, "--print"]);
  const output = result.stdout.toString();
  expect(result.exitCode).toBe(0);
  expect(output).toContain(`WorkingDirectory=${repoRoot}\n`);
  expect(output).not.toContain("/path/to/imsc-scraper");
  expect(output).toMatch(/^ExecStart=\S+ compose run --rm imsc weekly$/mu);
  expect(output).toMatch(/^ExecStart=\S+ compose run --rm imsc month-end$/mu);
});

test("the committed service units carry no machine-specific path", () => {
  for (const unitPath of [serviceUnit, monthEndServiceUnit]) {
    const unit = readFileSync(unitPath, "utf8");
    expect(unit).not.toMatch(/^WorkingDirectory=\/home\//mu);
    expect(unit).toContain("WorkingDirectory=/path/to/imsc-scraper");
  }
});
