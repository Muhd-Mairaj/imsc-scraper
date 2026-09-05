import { mkdir, rename, writeFile } from "node:fs/promises";
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
