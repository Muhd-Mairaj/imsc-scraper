import select from "@inquirer/select";
import qrcode from "qrcode-terminal";
import WAWebJS from "whatsapp-web.js";
import { authDirectory, configFilePath, type SelectedChatConfig, saveConfig } from "./config.js";
import { listWhatsAppGroups, type WhatsAppGroupBrowserClient } from "./whatsapp.js";

const { Client, LocalAuth } = WAWebJS;

function waitForClientReady(client: WAWebJS.Client): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once("ready", resolve);
    client.once("auth_failure", (message: string) => {
      reject(new Error(`WhatsApp authentication failed: ${message}`));
    });
    client.once("disconnected", (reason: WAWebJS.WAState | "LOGOUT") => {
      reject(new Error(`WhatsApp disconnected before it was ready: ${reason}`));
    });
  });
}

async function chooseGroup(client: WAWebJS.Client): Promise<SelectedChatConfig> {
  const groups = await listWhatsAppGroups(client as unknown as WhatsAppGroupBrowserClient);
  if (groups.length === 0) {
    throw new Error("No WhatsApp groups were found for this account.");
  }
  return select({
    message: "Choose the Community announcements group:",
    choices: groups.map((group) => ({
      name: group.name,
      value: group,
      description: group.id,
    })),
    pageSize: Math.min(groups.length, 15),
    loop: false,
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "imsc-scraper",
      dataPath: authDirectory,
    }),
    puppeteer: {
      headless: false,
    },
  });

  client.on("qr", (qr) => {
    console.log("\nScan this QR code from WhatsApp > Linked devices:\n");
    qrcode.generate(qr, { small: true });
  });

  client.on("authenticated", () => {
    console.log("WhatsApp authenticated. Waiting for chats to load...");
  });

  try {
    console.log("Starting WhatsApp Web...");
    const ready = waitForClientReady(client);
    await Promise.all([client.initialize(), ready]);

    console.log("WhatsApp Web is ready. Loading groups...");
    const selectedChat = await chooseGroup(client);
    await saveConfig({ selectedChat });

    console.log(`Saved “${selectedChat.name}” to ${configFilePath}`);
  } finally {
    await client.destroy().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  console.error(`Could not select a WhatsApp group: ${formatError(error)}`);
  process.exitCode = 1;
});
