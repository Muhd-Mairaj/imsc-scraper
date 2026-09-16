import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface SelectedChatConfig {
  id: string;
  name: string;
}

export interface AppConfig {
  selectedChat: SelectedChatConfig;
}

export const dataDirectory = resolve(process.cwd(), "data");
export const authDirectory = join(dataDirectory, "auth");
export const configFilePath = join(dataDirectory, "config.json");

export async function saveConfig(config: AppConfig): Promise<void> {
  await mkdir(dirname(configFilePath), { recursive: true, mode: 0o700 });

  const temporaryPath = `${configFilePath}.${process.pid}.tmp`;
  const serializedConfig = `${JSON.stringify(config, null, 2)}\n`;

  await writeFile(temporaryPath, serializedConfig, { encoding: "utf8", mode: 0o600 });
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
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidConfig();
  }
  const selectedChat = (parsed as Readonly<Record<string, unknown>>).selectedChat;
  if (typeof selectedChat !== "object" || selectedChat === null || Array.isArray(selectedChat)) {
    throw invalidConfig();
  }
  const fields = selectedChat as Readonly<Record<string, unknown>>;
  if (
    typeof fields.id !== "string" ||
    fields.id.trim().length === 0 ||
    typeof fields.name !== "string" ||
    fields.name.trim().length === 0
  ) {
    throw invalidConfig();
  }
  return {
    selectedChat: { id: fields.id.trim(), name: fields.name.trim() },
  };
}
