import select from "@inquirer/select";
import qrcode from "qrcode-terminal";
import WAWebJS from "whatsapp-web.js";
import {
  authDirectory,
  configFilePath,
  loadConfig,
  type SelectedChatConfig,
  saveConfig,
} from "./config.js";
import {
  findWhatsAppGroup,
  listWhatsAppGroups,
  type WhatsAppGroupBrowserClient,
} from "./whatsapp.js";

const { Client, LocalAuth } = WAWebJS;

type Command = "setup" | "verify";

function commandFromArguments(arguments_: readonly string[]): Command {
  if (arguments_[0] === "setup") return "setup";
  return "verify";
}

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

async function runSetup(client: WAWebJS.Client): Promise<void> {
  console.log("WhatsApp Web is ready. Loading groups...");
  const selectedChat = await chooseGroup(client);
  await saveConfig({ selectedChat });
  console.log(`Saved “${selectedChat.name}” to ${configFilePath}`);
}

async function verifySelectedChat(client: WAWebJS.Client): Promise<void> {
  if (client.pupPage === undefined) {
    throw new Error("WhatsApp Web did not provide a browser page for selected chat verification.");
  }
  const config = await loadConfig();
  const group = await findWhatsAppGroup(
    { pupPage: client.pupPage } as WhatsAppGroupBrowserClient,
    config.selectedChat.id,
  );
  if (group === undefined) {
    throw new Error(`The selected chat ${config.selectedChat.id} is not available.`);
  }
  console.log(`Selected chat is available: ${group.name}`);
}

async function main(): Promise<void> {
  const command = commandFromArguments(process.argv.slice(2));
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "imsc-scraper",
      dataPath: authDirectory,
    }),
    puppeteer: { headless: false },
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
    if (command === "setup") {
      await runSetup(client);
    } else {
      await verifySelectedChat(client);
    }
  } finally {
    await client.destroy().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
