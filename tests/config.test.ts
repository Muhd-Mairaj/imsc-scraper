import { afterAll, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  configFilePath,
  dataDirectory,
  loadConfig,
  normalizePhoneNumbers,
  saveConfig,
} from "../src/config.js";

// These tests write to the real data/config.json. Preserve any existing local
// configuration so running the suite never destroys the user's setup.
const originalConfig = await readFile(configFilePath, "utf8").catch(() => undefined);

afterAll(async () => {
  if (originalConfig === undefined) {
    await rm(configFilePath, { force: true });
    return;
  }
  await writeFile(configFilePath, originalConfig, { encoding: "utf8", mode: 0o600 });
});

test("normalizes and deduplicates ignored phone numbers", () => {
  expect(
    normalizePhoneNumbers(["+60 12-345 6789", "60123456789", "", "  +60 12 345 6789  "]),
  ).toEqual(["60123456789"]);
});

test("loads a config that has no weekly recipient", async () => {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(
    configFilePath,
    JSON.stringify({
      selectedChat: { id: "1@g.us", name: "Group" },
      ignoredPhoneNumbers: [],
    }),
    "utf8",
  );
  const config = await loadConfig();
  expect(config.weeklyReportRecipient).toBeUndefined();
  await rm(configFilePath, { force: true });
});

test("normalizes the weekly recipient on save and read", async () => {
  await saveConfig({
    selectedChat: { id: "1@g.us", name: "Group" },
    ignoredPhoneNumbers: [],
    weeklyReportRecipient: "+60 12-345 6789",
  });
  const config = await loadConfig();
  expect(config.weeklyReportRecipient).toBe("60123456789");
  await rm(configFilePath, { force: true });
});

test("rejects a non-string weekly recipient", async () => {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(
    configFilePath,
    JSON.stringify({
      selectedChat: { id: "1@g.us", name: "Group" },
      ignoredPhoneNumbers: [],
      weeklyReportRecipient: 42,
    }),
    "utf8",
  );
  await expect(loadConfig()).rejects.toThrow(/Invalid selected chat config/u);
  await rm(configFilePath, { force: true });
});
