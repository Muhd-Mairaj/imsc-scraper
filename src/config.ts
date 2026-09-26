import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

export interface SelectedChatConfig {
  id: string;
  name: string;
}

export interface AppConfig {
  selectedChat: SelectedChatConfig;
  ignoredPhoneNumbers: readonly string[];
  /** Normalized digits, or undefined when unset. */
  weeklyReportRecipient: string | undefined;
}

export const dataDirectory = resolve(process.cwd(), "data");
export const authDirectory = join(dataDirectory, "auth");
export const configFilePath = join(dataDirectory, "config.json");

const configSchema = z.object({
  selectedChat: z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
  }),
  ignoredPhoneNumbers: z.array(z.string()).default([]),
  weeklyReportRecipient: z.string().optional(),
});

export function normalizePhoneNumbers(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.replaceAll(/\D/gu, "")).filter(Boolean))];
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await mkdir(dirname(configFilePath), { recursive: true, mode: 0o700 });
  const serialized = `${JSON.stringify(
    {
      selectedChat: config.selectedChat,
      ignoredPhoneNumbers: normalizePhoneNumbers(config.ignoredPhoneNumbers),
      ...(config.weeklyReportRecipient === undefined
        ? {}
        : { weeklyReportRecipient: normalizePhoneNumbers([config.weeklyReportRecipient])[0] }),
    },
    null,
    2,
  )}\n`;
  const temporaryPath = `${configFilePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, configFilePath);
}

function invalidConfig(): Error {
  return new Error(
    `Invalid selected chat config at ${configFilePath}. Run \`bun run dev setup\` again.`,
  );
}

export async function loadConfig(): Promise<AppConfig> {
  let raw: string;
  try {
    raw = await readFile(configFilePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("Run `bun run dev setup` first.");
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw invalidConfig();
  }
  const result = configSchema.safeParse(parsed);
  if (!result.success) throw invalidConfig();

  const recipient = result.data.weeklyReportRecipient;
  return {
    selectedChat: result.data.selectedChat,
    ignoredPhoneNumbers: normalizePhoneNumbers(result.data.ignoredPhoneNumbers),
    weeklyReportRecipient:
      recipient === undefined ? undefined : (normalizePhoneNumbers([recipient])[0] ?? undefined),
  };
}

export function monthlySummaryFilePath(now: Date): string {
  return join(
    dataDirectory,
    `monthly-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.txt`,
  );
}
