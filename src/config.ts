import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type SelectedChatConfig = Readonly<{
  id: string;
  name: string;
}>;

const dataDirectory = resolve("data");
export const authDirectory = resolve(dataDirectory, "auth");
export const configFilePath = resolve(dataDirectory, "config.json");

export async function saveConfig(
  config: Readonly<{ selectedChat: SelectedChatConfig }>,
): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(configFilePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
