import { z } from "zod";

export interface WhatsAppGroupReference {
  readonly id: string;
  readonly name: string;
}

export interface WhatsAppGroupBrowserClient {
  readonly pupPage: {
    readonly evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
  };
}

interface Evaluator {
  evaluate<T, A>(pageFunction: (argument: A) => T | Promise<T>, argument: A): Promise<T>;
}

// `pupPage.evaluate` is declared without arguments by the client type so callers
// (and test stubs) stay simple; the real page evaluate accepts one argument.
function evaluator(client: WhatsAppGroupBrowserClient): Evaluator {
  return client.pupPage as unknown as Evaluator;
}

const groupSchema = z.object({ id: z.string(), name: z.unknown().optional() });

function normalizedGroup(value: unknown): WhatsAppGroupReference | undefined {
  const parsed = groupSchema.safeParse(value);
  if (!parsed.success || !/\S/u.test(parsed.data.id)) return undefined;
  const name = typeof parsed.data.name === "string" ? parsed.data.name.trim() : "";
  return Object.freeze({
    id: parsed.data.id.trim(),
    name: name.length === 0 ? "Unnamed group" : name,
  });
}

function compareGroups(left: WhatsAppGroupReference, right: WhatsAppGroupReference): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

export async function listWhatsAppGroups(
  client: WhatsAppGroupBrowserClient,
): Promise<readonly WhatsAppGroupReference[]> {
  const candidates = await evaluator(client).evaluate(() => {
    const browser = globalThis as unknown as {
      readonly require: (moduleName: string) => {
        readonly Chat: {
          readonly getModelsArray: () => readonly Record<string, unknown>[];
        };
      };
    };
    return browser
      .require("WAWebCollections")
      .Chat.getModelsArray()
      .flatMap((chat) => {
        const id = (chat.id as { readonly _serialized?: unknown } | undefined)?._serialized;
        const isGroup = chat.isGroup === true || chat.groupMetadata !== undefined;
        if (typeof id !== "string" || !isGroup) return [];
        const name =
          typeof chat.formattedTitle === "string"
            ? chat.formattedTitle
            : typeof chat.name === "string"
              ? chat.name
              : "";
        return [{ id, name }];
      });
  }, undefined);

  const unique = new Map<string, WhatsAppGroupReference>();
  for (const candidate of candidates) {
    const group = normalizedGroup(candidate);
    if (group !== undefined) unique.set(group.id, group);
  }
  return Object.freeze([...unique.values()].sort(compareGroups));
}

export interface WhatsAppGroupHistoryProbe {
  readonly group: WhatsAppGroupReference;
  readonly loadedMessageCountBefore: number;
  readonly newlyLoadedMessageCount: number | undefined;
  readonly loadedMessageCountAfter: number;
  readonly oldestLoadedTimestampMs: number | undefined;
  readonly newestLoadedTimestampMs: number | undefined;
}

const historyProbeSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  loadedMessageCountBefore: z.number(),
  newlyLoadedMessageCount: z.number().optional(),
  loadedMessageCountAfter: z.number(),
  oldestLoadedTimestampMs: z.number().optional(),
  newestLoadedTimestampMs: z.number().optional(),
});

export async function probeWhatsAppGroupHistory(
  client: WhatsAppGroupBrowserClient,
  chatId: string,
): Promise<WhatsAppGroupHistoryProbe | undefined> {
  const result = await evaluator(client).evaluate(async (requestedChatId) => {
    const browser = globalThis as unknown as {
      readonly require: (moduleName: string) => unknown;
    };
    const collections = browser.require("WAWebCollections") as {
      readonly Chat: {
        readonly getModelsArray: () => readonly Record<string, unknown>[];
      };
    };
    const chat = collections.Chat.getModelsArray().find(
      (candidate) =>
        (candidate.id as { readonly _serialized?: unknown } | undefined)?._serialized ===
        requestedChatId,
    );
    if (chat === undefined || (chat.isGroup !== true && chat.groupMetadata === undefined)) {
      return undefined;
    }

    const messages = chat.msgs as {
      readonly getModelsArray?: () => readonly Record<string, unknown>[];
    };
    if (messages?.getModelsArray === undefined) return undefined;
    const before = messages.getModelsArray();
    const loaded = await (
      browser.require("WAWebChatLoadMessages") as {
        readonly loadEarlierMsgs: (input: {
          readonly chat: Record<string, unknown>;
        }) => Promise<unknown>;
      }
    ).loadEarlierMsgs({ chat });
    const after = messages.getModelsArray();
    const timestamps = after.flatMap((message) =>
      typeof message.t === "number" && Number.isFinite(message.t) ? [message.t * 1_000] : [],
    );
    return {
      id: (chat.id as { readonly _serialized?: unknown } | undefined)?._serialized,
      name:
        typeof chat.formattedTitle === "string"
          ? chat.formattedTitle
          : typeof chat.name === "string"
            ? chat.name
            : "",
      loadedMessageCountBefore: before.length,
      newlyLoadedMessageCount: Array.isArray(loaded) ? loaded.length : undefined,
      loadedMessageCountAfter: after.length,
      oldestLoadedTimestampMs: timestamps.length === 0 ? undefined : Math.min(...timestamps),
      newestLoadedTimestampMs: timestamps.length === 0 ? undefined : Math.max(...timestamps),
    };
  }, chatId);

  const parsed = historyProbeSchema.safeParse(result);
  if (!parsed.success) return undefined;
  const group = normalizedGroup(parsed.data);
  if (group === undefined) return undefined;
  return Object.freeze({
    group,
    loadedMessageCountBefore: parsed.data.loadedMessageCountBefore,
    newlyLoadedMessageCount: parsed.data.newlyLoadedMessageCount,
    loadedMessageCountAfter: parsed.data.loadedMessageCountAfter,
    oldestLoadedTimestampMs: parsed.data.oldestLoadedTimestampMs,
    newestLoadedTimestampMs: parsed.data.newestLoadedTimestampMs,
  });
}

export interface WhatsAppWeeklyMarkerCandidate {
  readonly markerTimestampMs: number;
  readonly markerText: string;
  readonly followingTimestampMs: number;
  readonly followingType: string;
  readonly followingMessageId: string | undefined;
  readonly followingHasReaction: boolean;
  readonly recoveredAfterRevoked: boolean;
}

const markerSchema = z.object({
  markerTimestampMs: z.number(),
  markerText: z.string(),
  followingTimestampMs: z.number(),
  followingType: z.string(),
  followingMessageId: z.string().optional(),
  followingHasReaction: z.boolean(),
  recoveredAfterRevoked: z.boolean(),
});

export async function discoverWhatsAppWeeklyMarkers(
  client: WhatsAppGroupBrowserClient,
  input: Readonly<{
    chatId: string;
    rangeStartMs: number;
    rangeEndMs: number;
  }>,
): Promise<readonly WhatsAppWeeklyMarkerCandidate[]> {
  const candidates = await evaluator(client).evaluate((range) => {
    const browser = globalThis as unknown as {
      readonly require: (moduleName: string) => unknown;
    };
    const chat = (
      browser.require("WAWebCollections") as {
        readonly Chat: {
          readonly getModelsArray: () => readonly Record<string, unknown>[];
        };
      }
    ).Chat.getModelsArray().find(
      (candidate) =>
        (candidate.id as { readonly _serialized?: unknown } | undefined)?._serialized ===
        range.chatId,
    );
    if (chat === undefined) return [];

    const messages = chat.msgs as {
      readonly getModelsArray?: () => readonly Record<string, unknown>[];
    };
    if (messages?.getModelsArray === undefined) return [];
    const ordered = [...messages.getModelsArray()].sort(
      (left, right) =>
        (typeof left.t === "number" ? left.t : 0) - (typeof right.t === "number" ? right.t : 0),
    );
    const normalizedText = (message: Readonly<Record<string, unknown>>): string | undefined =>
      typeof message.body === "string" ? message.body.trim().replaceAll(/\s+/gu, " ") : undefined;
    const isWeeklyTitle = (message: Readonly<Record<string, unknown>>): boolean => {
      const title = normalizedText(message)?.match(/\*([^*]+)\*/u)?.[1];
      return title !== undefined && /\bbi\s*-?\s*weekly\b|\bweekly\b/iu.test(title);
    };

    return ordered.flatMap((marker, index) => {
      if (!isWeeklyTitle(marker)) return [];
      const markerText = normalizedText(marker);
      const markerTimestampMs = typeof marker.t === "number" ? marker.t * 1_000 : undefined;
      let following = ordered[index + 1];
      // If the next post is already the following week's title, this week had no
      // engagement post; the title belongs to the next week.
      if (following !== undefined && isWeeklyTitle(following)) return [];
      let recoveredAfterRevoked = false;
      if (following?.type === "revoked" && markerTimestampMs !== undefined) {
        const markerDate = new Date(markerTimestampMs).toDateString();
        for (let i = index + 2; i < ordered.length; i += 1) {
          const replacement = ordered[i];
          const replacementTimestampMs =
            typeof replacement?.t === "number" ? replacement.t * 1_000 : undefined;
          if (
            replacement === undefined ||
            replacementTimestampMs === undefined ||
            new Date(replacementTimestampMs).toDateString() !== markerDate ||
            isWeeklyTitle(replacement)
          ) {
            break;
          }
          if (replacement.type !== "revoked") {
            following = replacement;
            recoveredAfterRevoked = true;
            break;
          }
        }
      }
      const followingTimestampMs =
        typeof following?.t === "number" ? following.t * 1_000 : undefined;
      const followingId = following?.id as { readonly toString?: () => string } | undefined;
      if (
        following === undefined ||
        markerText === undefined ||
        markerTimestampMs === undefined ||
        followingTimestampMs === undefined ||
        followingTimestampMs < range.rangeStartMs ||
        followingTimestampMs > range.rangeEndMs
      ) {
        return [];
      }
      return [
        {
          markerTimestampMs,
          markerText,
          followingTimestampMs,
          followingType: typeof following.type === "string" ? following.type : "unknown",
          followingMessageId: followingId?.toString?.(),
          followingHasReaction: following.hasReaction === true,
          recoveredAfterRevoked,
        },
      ];
    });
  }, input);

  const markers = candidates.flatMap((candidate) => {
    const parsed = markerSchema.safeParse(candidate);
    if (!parsed.success) return [];
    return [
      {
        markerTimestampMs: parsed.data.markerTimestampMs,
        markerText: parsed.data.markerText,
        followingTimestampMs: parsed.data.followingTimestampMs,
        followingType: parsed.data.followingType,
        followingMessageId: parsed.data.followingMessageId,
        followingHasReaction: parsed.data.followingHasReaction,
        recoveredAfterRevoked: parsed.data.recoveredAfterRevoked,
      },
    ];
  });
  return Object.freeze(markers);
}

export interface WhatsAppParticipant {
  readonly display: string;
  readonly phoneNumber: string | undefined;
}

const participantSchema = z.object({
  display: z.string(),
  phoneNumber: z.string().optional(),
});

const participantKeysSchema = z.object({ recordCount: z.number(), keys: z.array(z.string()) });

const resolvedParticipantsSchema = z.object({
  participants: z.array(participantSchema),
  unresolvedParticipantCount: z.number(),
});

interface ResolvedParticipants {
  readonly participants: readonly WhatsAppParticipant[];
  readonly unresolvedParticipantCount: number;
}

/**
 * Resolves participant ids to display names and phone numbers. Shared because
 * the poll and reaction probes would otherwise carry identical copies; the
 * work still happens inside the page, where the WhatsApp store lives.
 */
async function resolveWhatsAppParticipants(
  client: WhatsAppGroupBrowserClient,
  participantKeys: readonly string[],
): Promise<ResolvedParticipants | undefined> {
  const result = await evaluator(client).evaluate(async (keys) => {
    const browser = globalThis as unknown as {
      readonly require: (moduleName: string) => unknown;
    };
    const widFactory = browser.require("WAWebWidFactory") as {
      readonly createWid: (value: string) => unknown;
    };
    const contacts = browser.require("WAWebCollections") as {
      readonly Contact: { readonly find: (value: unknown) => Promise<Record<string, unknown>> };
    };
    const apiContact = browser.require("WAWebApiContact") as {
      readonly getPhoneNumber: (value: unknown) => unknown;
    };
    const phoneText = (value: unknown): string => {
      if (typeof value === "string") return value;
      const user = (value as { readonly user?: unknown } | undefined)?.user;
      if (typeof user === "string") return user;
      const stringify = (value as { readonly toString?: unknown } | undefined)?.toString;
      return typeof stringify === "function"
        ? (value as { readonly toString: () => string }).toString()
        : "";
    };

    const byDisplay = new Map<string, WhatsAppParticipant>();
    let unresolvedParticipantCount = 0;
    for (const key of keys) {
      try {
        const wid = widFactory.createWid(key);
        const contact = await contacts.Contact.find(wid);
        const username = typeof contact?.username === "string" ? contact.username.trim() : "";
        const phoneNumber =
          phoneText(contact?.phoneNumber ?? apiContact.getPhoneNumber(wid)).replaceAll(
            /\D/gu,
            "",
          ) || undefined;
        const display =
          username.length > 0
            ? username.startsWith("@")
              ? username
              : `@${username}`
            : phoneNumber === undefined
              ? undefined
              : `+${phoneNumber}`;
        if (display === undefined) unresolvedParticipantCount += 1;
        else byDisplay.set(display, { display, phoneNumber });
      } catch {
        unresolvedParticipantCount += 1;
      }
    }
    return {
      participants: [...byDisplay.values()].sort((left, right) =>
        left.display.localeCompare(right.display),
      ),
      unresolvedParticipantCount,
    };
  }, participantKeys);

  const parsed = resolvedParticipantsSchema.safeParse(result);
  if (!parsed.success) return undefined;
  return Object.freeze({
    participants: Object.freeze(
      parsed.data.participants.map((participant) => ({
        display: participant.display,
        phoneNumber: participant.phoneNumber,
      })),
    ),
    unresolvedParticipantCount: parsed.data.unresolvedParticipantCount,
  });
}

export interface WhatsAppPollParticipantProbe {
  readonly voteRecordCount: number;
  readonly participants: readonly WhatsAppParticipant[];
  readonly unresolvedParticipantCount: number;
}

export async function probeWhatsAppPollParticipants(
  client: WhatsAppGroupBrowserClient,
  pollMessageId: string,
): Promise<WhatsAppPollParticipantProbe | undefined> {
  const gathered = await evaluator(client).evaluate(async (messageId) => {
    const browser = globalThis as unknown as {
      readonly require: (moduleName: string) => unknown;
    };
    const messageKey = (
      browser.require("WAWebMsgKey") as {
        readonly fromString: (value: string) => { readonly toString: () => string };
      }
    ).fromString(messageId);
    const voteRows = await (
      browser.require("WAWebPollsVotesSchema") as {
        readonly getTable: () => {
          readonly equals: (columns: readonly string[], value: string) => Promise<unknown>;
        };
      }
    )
      .getTable()
      .equals(["parentMsgKey"], messageKey.toString());
    if (!Array.isArray(voteRows)) return undefined;

    const keys = new Set<string>();
    for (const row of voteRows) {
      const sender = (row as { readonly sender?: unknown }).sender as
        | { readonly toString?: () => string }
        | undefined;
      if (typeof sender?.toString === "function") keys.add(sender.toString());
    }
    return { recordCount: voteRows.length, keys: [...keys] };
  }, pollMessageId);

  const parsed = participantKeysSchema.safeParse(gathered);
  if (!parsed.success) return undefined;
  const resolved = await resolveWhatsAppParticipants(client, parsed.data.keys);
  if (resolved === undefined) return undefined;
  return Object.freeze({
    voteRecordCount: parsed.data.recordCount,
    participants: resolved.participants,
    unresolvedParticipantCount: resolved.unresolvedParticipantCount,
  });
}

export interface WhatsAppReactionParticipantProbe {
  readonly reactionSenderRecordCount: number;
  readonly participants: readonly WhatsAppParticipant[];
  readonly unresolvedParticipantCount: number;
}

export async function probeWhatsAppReactionParticipants(
  client: WhatsAppGroupBrowserClient,
  messageId: string,
  hasReaction: boolean,
): Promise<WhatsAppReactionParticipantProbe | undefined> {
  if (!hasReaction) {
    return Object.freeze({
      reactionSenderRecordCount: 0,
      participants: Object.freeze([]),
      unresolvedParticipantCount: 0,
    });
  }

  const gathered = await evaluator(client).evaluate(async (reactionMessageId) => {
    const browser = globalThis as unknown as {
      readonly require: (moduleName: string) => unknown;
    };
    const reactionModel = await (
      browser.require("WAWebCollections") as {
        readonly Reactions: { readonly find: (value: string) => Promise<Record<string, unknown>> };
      }
    ).Reactions.find(reactionMessageId);
    const reactionGroups = (
      reactionModel?.reactions as { readonly serialize?: () => unknown } | undefined
    )?.serialize?.();
    if (!Array.isArray(reactionGroups)) return undefined;

    const senderRecords = reactionGroups.flatMap((group) =>
      Array.isArray((group as { readonly senders?: unknown }).senders)
        ? (group as { readonly senders: readonly Record<string, unknown>[] }).senders
        : [],
    );
    const senderKey = (sender: Readonly<Record<string, unknown>>): string | undefined => {
      const value = sender.senderId ?? sender.senderUserJid ?? sender.author ?? sender.from;
      if (typeof value === "string") return value;
      return typeof (value as { readonly toString?: unknown } | undefined)?.toString === "function"
        ? (value as { readonly toString: () => string }).toString()
        : undefined;
    };
    const keys = new Set<string>();
    for (const sender of senderRecords) {
      const key = senderKey(sender);
      if (key !== undefined) keys.add(key);
    }
    return { recordCount: senderRecords.length, keys: [...keys] };
  }, messageId);

  const parsed = participantKeysSchema.safeParse(gathered);
  if (!parsed.success) return undefined;
  const resolved = await resolveWhatsAppParticipants(client, parsed.data.keys);
  if (resolved === undefined) return undefined;
  return Object.freeze({
    reactionSenderRecordCount: parsed.data.recordCount,
    participants: resolved.participants,
    unresolvedParticipantCount: resolved.unresolvedParticipantCount,
  });
}

export interface WhatsAppSentMessageConfirmation {
  readonly body: string;
  readonly ack: number | undefined;
}

/**
 * Ids of the messages already in a chat. Taken before a send so the message
 * that send creates can be told apart from older copies with the same body.
 */
export async function snapshotWhatsAppMessageIds(
  client: WhatsAppGroupBrowserClient,
  chatId: string,
): Promise<readonly string[]> {
  return await evaluator(client).evaluate(async (requestedChatId) => {
    const browser = globalThis as unknown as {
      readonly require: (moduleName: string) => unknown;
    };
    const chat = (
      browser.require("WAWebCollections") as {
        readonly Chat: {
          readonly get: (wid: unknown) => Record<string, unknown> | undefined;
        };
      }
    ).Chat.get(
      (
        browser.require("WAWebWidFactory") as {
          readonly createWid: (id: string) => unknown;
        }
      ).createWid(requestedChatId),
    );
    const messages = chat?.msgs as
      | { readonly getModelsArray?: () => readonly Record<string, unknown>[] }
      | undefined;
    if (messages?.getModelsArray === undefined) return [];
    return messages.getModelsArray().flatMap((message) => {
      const id = message.id as
        | { readonly _serialized?: unknown; readonly toString?: () => string }
        | undefined;
      const serialized =
        typeof id?._serialized === "string"
          ? id._serialized
          : typeof id?.toString === "function"
            ? id.toString()
            : undefined;
      return serialized === undefined ? [] : [serialized];
    });
  }, chatId);
}

/**
 * Finds the message a send created, by looking for a matching outgoing message
 * whose id was not present before the send. `getChatById` is avoided (its model
 * conversion is unstable on the pinned client), and retries share the same
 * body, so an id that is new is the only reliable signal.
 */
export async function findWhatsAppSentMessage(
  client: WhatsAppGroupBrowserClient,
  chatId: string,
  body: string,
  knownIds: readonly string[],
): Promise<WhatsAppSentMessageConfirmation | undefined> {
  return await evaluator(client).evaluate(
    async (request: {
      readonly chatId: string;
      readonly expected: string;
      readonly known: readonly string[];
    }) => {
      const browser = globalThis as unknown as {
        readonly require: (moduleName: string) => unknown;
      };
      const chat = (
        browser.require("WAWebCollections") as {
          readonly Chat: {
            readonly get: (wid: unknown) => Record<string, unknown> | undefined;
          };
        }
      ).Chat.get(
        (
          browser.require("WAWebWidFactory") as {
            readonly createWid: (id: string) => unknown;
          }
        ).createWid(request.chatId),
      );
      const messages = chat?.msgs as
        | { readonly getModelsArray?: () => readonly Record<string, unknown>[] }
        | undefined;
      if (messages?.getModelsArray === undefined) return undefined;
      const serializedId = (message: Record<string, unknown>): string | undefined => {
        const id = message.id as
          | { readonly _serialized?: unknown; readonly toString?: () => string }
          | undefined;
        return typeof id?._serialized === "string"
          ? id._serialized
          : typeof id?.toString === "function"
            ? id.toString()
            : undefined;
      };
      const known = new Set(request.known);
      const matches = messages.getModelsArray().filter((message) => {
        if ((message.id as { readonly fromMe?: unknown } | undefined)?.fromMe !== true)
          return false;
        if (String(message.body ?? "").trim() !== request.expected) return false;
        const id = serializedId(message);
        return id !== undefined && !known.has(id);
      });
      const match = matches[matches.length - 1];
      if (match === undefined) return undefined;
      return {
        body: String(match.body ?? ""),
        ack: typeof match.ack === "number" ? match.ack : undefined,
      };
    },
    { chatId, expected: body.trim(), known: knownIds },
  );
}
