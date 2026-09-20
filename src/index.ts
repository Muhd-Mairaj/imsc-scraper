import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import select from "@inquirer/select";
import qrcode from "qrcode-terminal";
import WAWebJS from "whatsapp-web.js";
import { parseCommand } from "./commands.js";
import {
  type AppConfig,
  authDirectory,
  configFilePath,
  dataDirectory,
  loadConfig,
  monthlySummaryFilePath,
  type SelectedChatConfig,
  saveConfig,
} from "./config.js";
import { createLogger, type Logger, pruneLogFiles } from "./logger.js";
import { type MonthlyActivityItem, renderMonthlyActivitySummary } from "./report.js";
import { loadWeeklyState, saveWeeklyState } from "./state.js";
import { runWeeklyReport } from "./weekly-run.js";
import {
  discoverWhatsAppWeeklyMarkers,
  listWhatsAppGroups,
  probeWhatsAppGroupHistory,
  probeWhatsAppPollParticipants,
  probeWhatsAppReactionParticipants,
  type WhatsAppGroupBrowserClient,
  type WhatsAppParticipant,
} from "./whatsapp.js";
import { describeAck, isOurMessage } from "./whatsapp-send.js";

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

async function promptWeeklyReportRecipient(): Promise<string | undefined> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    console.log(
      "Enter the phone number that should receive the weekly report in international format.",
    );
    const value = await readline.question("Weekly report recipient (blank to skip): ");
    const digits = phoneDigits(value);
    return digits.length === 0 ? undefined : digits;
  } finally {
    readline.close();
  }
}

async function runSetup(client: WAWebJS.Client, logger: Logger): Promise<void> {
  logger.info("WhatsApp Web is ready; loading groups for setup.");
  const selectedChat = await chooseGroup(client);
  const ignoredPhoneNumbers = await promptIgnoredPhoneNumbers();
  const weeklyReportRecipient = await promptWeeklyReportRecipient();
  await saveConfig({ selectedChat, ignoredPhoneNumbers, weeklyReportRecipient });
  logger.info(
    `Saved configuration: group "${selectedChat.name}" (${selectedChat.id}), ${ignoredPhoneNumbers.length} ignored number(s), weekly recipient ${weeklyReportRecipient ?? "unset"}.`,
  );
  console.log(`Saved “${selectedChat.name}” to ${configFilePath}`);
}

function phoneDigits(value: string): string {
  return value.replaceAll(/\D/gu, "");
}

async function runWeekly(
  client: WAWebJS.Client,
  force: boolean,
  dryRun: boolean,
  logger: Logger,
): Promise<void> {
  if (client.pupPage === undefined) {
    throw new Error("WhatsApp Web did not provide a browser page for the weekly report.");
  }
  const config = await loadConfig();
  const recipient = config.weeklyReportRecipient;
  if (recipient === undefined) {
    throw new Error(
      `No weekly report recipient is configured in ${configFilePath}. Run \`bun run dev setup\` again.`,
    );
  }
  const browserClient = { pupPage: client.pupPage } as WhatsAppGroupBrowserClient;
  // `info.wid` is non-optional in the whatsapp-web.js types and `_serialized` is
  // already the canonical chat id, so it is passed through unchanged.
  const selfChatId = client.info.wid._serialized;
  const state = await loadWeeklyState();
  const recipientChatId = await resolveRecipientChatId(client, recipient, logger);
  logger.info(
    `Weekly run starting: recipient=${recipientChatId}, self=${selfChatId}, force=${force}, dryRun=${dryRun}.`,
  );

  await runWeeklyReport({
    now: new Date(),
    collect: async (window) => {
      const probe = await probeWhatsAppGroupHistory(browserClient, config.selectedChat.id);
      if (probe === undefined) {
        throw new Error(`Selected chat metadata is not available for ${config.selectedChat.id}.`);
      }
      const warnings: string[] = [];
      if (
        probe.oldestLoadedTimestampMs === undefined ||
        probe.oldestLoadedTimestampMs > window.startMs
      ) {
        warnings.push("History may not reach the start of the reporting week.");
      }
      const collected = await collectEngagement(browserClient, config, {
        startMs: window.startMs,
        endMs: window.endMs - 1,
      });
      return { items: collected.items, warnings: [...warnings, ...collected.warnings] };
    },
    sendMessage: async (chatId, content) => {
      await sendWhatsAppMessage(client, chatId, content, logger);
    },
    recipientChatId,
    selfChatId,
    state,
    force,
    dryRun,
    saveState: saveWeeklyState,
    log: (message) => {
      logger.info(message);
    },
  });
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

async function verifySelectedChat(client: WAWebJS.Client, logger: Logger): Promise<void> {
  if (client.pupPage === undefined) {
    throw new Error("WhatsApp Web did not provide a browser page for selected chat verification.");
  }
  const config = await loadConfig();
  const browserClient = { pupPage: client.pupPage } as WhatsAppGroupBrowserClient;
  logger.info(
    `Monthly summary for chat "${config.selectedChat.name}" (${config.selectedChat.id}).`,
  );
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
  logger.info(
    `Oldest loaded message: ${probe.oldestLoadedTimestampMs === undefined ? "unknown" : new Date(probe.oldestLoadedTimestampMs).toISOString()}; range starts ${new Date(rangeStartMs).toISOString()}.`,
  );
  const collected = await collectEngagement(browserClient, config, {
    startMs: rangeStartMs,
    endMs: now.getTime(),
  });
  const summary = renderMonthlyActivitySummary(collected.items, [
    ...warnings,
    ...collected.warnings,
  ]);
  const summaryPath = monthlySummaryFilePath(now);
  stdout.write(summary);
  await writeFile(summaryPath, summary, { encoding: "utf8", mode: 0o600 });
  logger.info(
    `Monthly summary: ${collected.items.length} item(s), ${warnings.length + collected.warnings.length} warning(s), written to ${summaryPath}.`,
  );
}

/**
 * Waits briefly for the message to reach the recipient, so a message that
 * WhatsApp accepted but could not deliver is visible in the logs rather than
 * looking like a success. `Message.reload()` refreshes `ack` in place.
 */
async function waitForAcknowledgement(
  message: WAWebJS.Message,
  logger: Logger,
  timeoutMs = 15_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (message.ack < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    try {
      const reloaded = await message.reload();
      if (!reloaded) break;
    } catch {
      break;
    }
  }
  if (message.ack < 2) {
    logger.warn(
      `Message ${message.id._serialized} did not reach "delivered" within ${timeoutMs}ms; last ack=${message.ack} (${describeAck(message.ack)}).`,
    );
  }
  return message.ack;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves a phone number to the id WhatsApp Web actually uses. WhatsApp has
 * migrated contacts to LID identifiers, and sending straight to `digits@c.us`
 * fails for any chat the linked device has not opened yet. `getNumberId` asks
 * WhatsApp for the current id and registers the contact as a side effect.
 */
async function resolveRecipientChatId(
  client: WAWebJS.Client,
  digits: string,
  logger: Logger,
): Promise<string> {
  const fallback = `${digits}@c.us`;
  try {
    const resolved = await client.getNumberId(digits);
    if (resolved === null) {
      logger.warn(`WhatsApp reports ${digits} is not registered on WhatsApp; using ${fallback}.`);
      return fallback;
    }
    logger.info(`Resolved ${digits} to ${resolved._serialized}.`);
    return resolved._serialized;
  } catch (error) {
    logger.warn(`getNumberId failed for ${digits} (${errorMessage(error)}); using ${fallback}.`);
    return fallback;
  }
}

/**
 * Confirms a send by looking for our outgoing message in the chat. The pinned
 * client returns `undefined` from `sendMessage` even on success (WhatsApp Web
 * renamed the message id field it reads), so the return value alone cannot be
 * trusted in either direction.
 */
async function confirmSentMessage(
  client: WAWebJS.Client,
  chatId: string,
  content: string,
  timeoutMs: number,
): Promise<WAWebJS.Message | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const chat = await client.getChatById(chatId);
      const recent = await chat.fetchMessages({ limit: 10 });
      const match = recent.find((message) => isOurMessage(message, content));
      if (match !== undefined) return match;
    } catch {
      // The chat may not be resolvable yet; retry until the deadline.
    }
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function sendWhatsAppMessage(
  client: WAWebJS.Client,
  chatId: string,
  content: string,
  logger: Logger,
): Promise<void> {
  const message = await client.sendMessage(chatId, content);
  if (message !== undefined) {
    logger.info(
      `WhatsApp accepted message ${message.id._serialized} for ${chatId} (ack=${message.ack}: ${describeAck(message.ack)}).`,
    );
    const ack = await waitForAcknowledgement(message, logger);
    logger.info(`Message ${message.id._serialized} settled at ack=${ack} (${describeAck(ack)}).`);
    return;
  }
  logger.warn(
    `The send call for ${chatId} returned no message; checking whether it was still created...`,
  );
  const confirmed = await confirmSentMessage(client, chatId, content, 10_000);
  if (confirmed === undefined) {
    throw new Error(
      `WhatsApp did not send the message to ${chatId}: the chat could not be resolved and no outgoing message appeared.`,
    );
  }
  logger.info(
    `WhatsApp created message ${confirmed.id._serialized} for ${chatId} (the send call returned no message, but the outgoing message is present).`,
  );
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
  const { command, force, dryRun } = parseCommand(process.argv.slice(2));
  const logger = createLogger({ scope: command });
  pruneLogFiles();
  logger.info(`Starting "${command}" with args ${JSON.stringify(process.argv.slice(2))}.`);
  const versions = process.versions as Readonly<Record<string, string | undefined>>;
  logger.info(
    `Runtime: bun=${versions.bun ?? "?"} node=${versions.node ?? "?"} pid=${process.pid} cwd=${process.cwd()} timeZone=${Intl.DateTimeFormat().resolvedOptions().timeZone}.`,
  );

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "imsc-scraper",
      dataPath: authDirectory,
    }),
    // Keep the web-version cache inside the writable data directory. The
    // default path is `./.wwebjs_cache` relative to the process cwd, which is
    // root-owned in the container; the resulting mkdir EACCES prevents the
    // client from ever reaching the `ready` event.
    webVersionCache: { type: "local", path: join(dataDirectory, ".wwebjs_cache") },
    puppeteer: puppeteerOptions(),
  });

  client.on("qr", (qr) => {
    logger.info("A QR code was requested; waiting for a linked-device scan.");
    console.log("\nScan this QR code from WhatsApp > Linked devices:\n");
    qrcode.generate(qr, { small: true });
  });
  client.on("authenticated", () => {
    logger.info("WhatsApp authenticated; waiting for chats to load.");
    console.log("WhatsApp authenticated. Waiting for chats to load...");
  });

  try {
    logger.info("Starting WhatsApp Web.");
    const ready = waitForClientReady(client);
    await Promise.all([client.initialize(), ready]);
    logger.info("WhatsApp Web is ready.");
    if (command === "setup") {
      await runSetup(client, logger);
    } else if (command === "weekly") {
      await runWeekly(client, force, dryRun, logger);
    } else {
      await verifySelectedChat(client, logger);
    }
    logger.info(`Command "${command}" completed successfully.`);
  } catch (error) {
    logger.error(
      `Command "${command}" failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    throw error;
  } finally {
    await client.destroy().catch(() => undefined);
    logger.info("WhatsApp client closed.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
