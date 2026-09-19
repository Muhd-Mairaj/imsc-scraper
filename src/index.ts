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
  discoverWhatsAppWeeklyMarkers,
  listWhatsAppGroups,
  probeWhatsAppGroupHistory,
  probeWhatsAppPollParticipants,
  probeWhatsAppReactionParticipants,
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

function currentMonthStartMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function formatLocalDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

async function verifySelectedChat(client: WAWebJS.Client): Promise<void> {
  if (client.pupPage === undefined) {
    throw new Error("WhatsApp Web did not provide a browser page for selected chat verification.");
  }
  const config = await loadConfig();
  const browserClient = { pupPage: client.pupPage } as WhatsAppGroupBrowserClient;
  const probe = await probeWhatsAppGroupHistory(browserClient, config.selectedChat.id);
  if (probe === undefined) {
    throw new Error(`Selected chat metadata is not available for ${config.selectedChat.id}.`);
  }
  const now = new Date();
  const rangeStartMs = currentMonthStartMs(now);
  const markers = await discoverWhatsAppWeeklyMarkers(browserClient, {
    chatId: config.selectedChat.id,
    rangeStartMs,
    rangeEndMs: now.getTime(),
  });
  const newestPoll = [...markers]
    .reverse()
    .find(
      (marker) =>
        marker.followingType === "poll_creation" && marker.followingMessageId !== undefined,
    );
  if (newestPoll === undefined || newestPoll.followingMessageId === undefined) {
    throw new Error("No paired poll item was found in the loaded current-month markers.");
  }
  const pollParticipants = await probeWhatsAppPollParticipants(
    browserClient,
    newestPoll.followingMessageId,
  );
  if (pollParticipants === undefined) {
    throw new Error("Poll participant details are not available for the newest paired poll item.");
  }
  const newestPost = [...markers]
    .reverse()
    .find(
      (marker) =>
        marker.followingType !== "poll_creation" && marker.followingMessageId !== undefined,
    );
  if (newestPost === undefined || newestPost.followingMessageId === undefined) {
    throw new Error("No paired non-poll item was found in the loaded current-month markers.");
  }
  const reactionParticipants = await probeWhatsAppReactionParticipants(
    browserClient,
    newestPost.followingMessageId,
  );
  if (reactionParticipants === undefined) {
    throw new Error(
      "Reaction participant details are not available for the newest paired non-poll item.",
    );
  }

  console.log(`Selected chat is available: ${probe.group.name}`);
  console.log(`Loaded messages before request: ${probe.loadedMessageCountBefore}`);
  console.log(`Earlier messages returned: ${probe.newlyLoadedMessageCount ?? "unavailable"}`);
  console.log(`Loaded messages after request: ${probe.loadedMessageCountAfter}`);
  console.log(
    `History reaches current month start: ${
      probe.oldestLoadedTimestampMs !== undefined && probe.oldestLoadedTimestampMs <= rangeStartMs
        ? "yes"
        : "no"
    }`,
  );
  console.log(`Weekly-marker candidates: ${markers.length}`);
  for (const marker of markers) {
    console.log(`- ${formatLocalDate(marker.markerTimestampMs)} ${marker.markerText}`);
    console.log(
      `  following item: ${formatLocalDate(marker.followingTimestampMs)} ${marker.followingType}`,
    );
    if (marker.recoveredAfterRevoked) {
      console.log("  recovered replacement after revoked item");
    }
  }
  console.log(`Newest poll candidate: ${formatLocalDate(newestPoll.followingTimestampMs)}`);
  console.log(`Poll vote records: ${pollParticipants.voteRecordCount}`);
  console.log("Poll participants:");
  for (const display of pollParticipants.participantDisplays) {
    console.log(display);
  }
  if (pollParticipants.unresolvedParticipantCount > 0) {
    console.log(`Unresolved participants: ${pollParticipants.unresolvedParticipantCount}`);
  }
  console.log(
    `Newest non-poll candidate: ${formatLocalDate(newestPost.followingTimestampMs)} ${newestPost.followingType}`,
  );
  console.log(`Reaction sender records: ${reactionParticipants.reactionSenderRecordCount}`);
  console.log("Post participants:");
  for (const display of reactionParticipants.participantDisplays) {
    console.log(display);
  }
  if (reactionParticipants.unresolvedParticipantCount > 0) {
    console.log(`Unresolved post participants: ${reactionParticipants.unresolvedParticipantCount}`);
  }
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
