import { writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import select from "@inquirer/select";
import qrcode from "qrcode-terminal";
import WAWebJS from "whatsapp-web.js";
import {
  type AppConfig,
  authDirectory,
  configFilePath,
  loadConfig,
  monthlySummaryFilePath,
  type SelectedChatConfig,
  saveConfig,
} from "./config.js";
import { type MonthlyActivityItem, renderMonthlyActivitySummary } from "./report.js";
import {
  discoverWhatsAppWeeklyMarkers,
  listWhatsAppGroups,
  probeWhatsAppGroupHistory,
  probeWhatsAppPollParticipants,
  probeWhatsAppReactionParticipants,
  type WhatsAppGroupBrowserClient,
  type WhatsAppParticipant,
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

async function promptIgnoredPhoneNumbers(): Promise<readonly string[]> {
  const readline = createInterface({ input: stdin, output: stdout });
  const values: string[] = [];
  try {
    console.log("Enter ignored admin phone numbers in international format, one per line.");
    while (true) {
      const value = await readline.question("Ignored phone number (blank to finish): ");
      if (value.trim().length === 0) return values;
      values.push(value);
    }
  } finally {
    readline.close();
  }
}

async function runSetup(client: WAWebJS.Client): Promise<void> {
  console.log("WhatsApp Web is ready. Loading groups...");
  const selectedChat = await chooseGroup(client);
  const ignoredPhoneNumbers = await promptIgnoredPhoneNumbers();
  await saveConfig({ selectedChat, ignoredPhoneNumbers, weeklyReportRecipient: undefined });
  console.log(`Saved “${selectedChat.name}” to ${configFilePath}`);
}

function eligibleParticipants(
  participants: readonly WhatsAppParticipant[],
  ignoredPhoneNumbers: readonly string[],
): Readonly<{ participants: readonly WhatsAppParticipant[]; ignoredCount: number }> {
  const ignored = new Set(ignoredPhoneNumbers);
  const eligible = participants.filter(
    (participant) => participant.phoneNumber === undefined || !ignored.has(participant.phoneNumber),
  );
  return Object.freeze({
    participants: Object.freeze(eligible),
    ignoredCount: participants.length - eligible.length,
  });
}

function currentMonthStartMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function formatLocalDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

interface EngagementCollection {
  readonly items: readonly MonthlyActivityItem[];
  readonly warnings: readonly string[];
}

async function collectEngagement(
  browserClient: WhatsAppGroupBrowserClient,
  config: AppConfig,
  rangeMs: Readonly<{ startMs: number; endMs: number }>,
): Promise<EngagementCollection> {
  const markers = await discoverWhatsAppWeeklyMarkers(browserClient, {
    chatId: config.selectedChat.id,
    rangeStartMs: rangeMs.startMs,
    rangeEndMs: rangeMs.endMs,
  });
  const items: MonthlyActivityItem[] = [];
  const warnings: string[] = [];
  for (const marker of markers) {
    const itemDate = formatLocalDate(marker.followingTimestampMs);
    if (marker.followingMessageId === undefined) {
      warnings.push(`${itemDate}: engagement is unavailable.`);
      continue;
    }
    if (marker.followingType === "poll_creation") {
      const pollParticipants = await probeWhatsAppPollParticipants(
        browserClient,
        marker.followingMessageId,
      );
      if (pollParticipants === undefined) {
        warnings.push(`${itemDate}: poll vote records are unavailable.`);
        continue;
      }
      const eligible = eligibleParticipants(
        pollParticipants.participants,
        config.ignoredPhoneNumbers,
      );
      items.push({
        timestampMs: marker.followingTimestampMs,
        activity: 2,
        participantDisplays: eligible.participants.map((participant) => participant.display),
      });
      if (pollParticipants.unresolvedParticipantCount > 0) {
        warnings.push(
          `${itemDate}: ${pollParticipants.unresolvedParticipantCount} poll participant identities are unavailable.`,
        );
      }
    } else {
      const reactionParticipants = await probeWhatsAppReactionParticipants(
        browserClient,
        marker.followingMessageId,
        marker.followingHasReaction,
      );
      if (reactionParticipants === undefined) {
        warnings.push(`${itemDate}: reaction sender records are unavailable.`);
        continue;
      }
      const eligible = eligibleParticipants(
        reactionParticipants.participants,
        config.ignoredPhoneNumbers,
      );
      items.push({
        timestampMs: marker.followingTimestampMs,
        activity: 1,
        participantDisplays: eligible.participants.map((participant) => participant.display),
      });
      if (reactionParticipants.unresolvedParticipantCount > 0) {
        warnings.push(
          `${itemDate}: ${reactionParticipants.unresolvedParticipantCount} reaction participant identities are unavailable.`,
        );
      }
    }
    if (marker.recoveredAfterRevoked) {
      warnings.push(`${itemDate}: uses a same-day replacement after a revoked item.`);
    }
  }
  return { items, warnings };
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
  const warnings: string[] = [];
  if (probe.oldestLoadedTimestampMs === undefined || probe.oldestLoadedTimestampMs > rangeStartMs) {
    warnings.push("History may not reach the start of the current month.");
  }
  const collected = await collectEngagement(browserClient, config, {
    startMs: rangeStartMs,
    endMs: now.getTime(),
  });
  const summary = renderMonthlyActivitySummary(collected.items, [
    ...warnings,
    ...collected.warnings,
  ]);
  stdout.write(summary);
  await writeFile(monthlySummaryFilePath(now), summary, { encoding: "utf8", mode: 0o600 });
}

function puppeteerOptions() {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  return {
    headless: process.env.WHATSAPP_HEADLESS === "true",
    ...(executablePath === undefined ? {} : { executablePath }),
    ...(process.env.WHATSAPP_DOCKER === "true"
      ? { args: ["--no-sandbox", "--disable-setuid-sandbox"] }
      : {}),
  };
}

async function main(): Promise<void> {
  const command = commandFromArguments(process.argv.slice(2));
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "imsc-scraper",
      dataPath: authDirectory,
    }),
    puppeteer: puppeteerOptions(),
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
