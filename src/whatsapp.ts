export interface WhatsAppGroupReference {
  readonly id: string;
  readonly name: string;
}

export interface WhatsAppGroupBrowserClient {
  readonly pupPage: {
    readonly evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
  };
}

export interface WhatsAppGroupHistoryProbe {
  readonly group: WhatsAppGroupReference;
  readonly loadedMessageCountBefore: number;
  readonly newlyLoadedMessageCount: number | undefined;
  readonly loadedMessageCountAfter: number;
  readonly oldestLoadedTimestampMs: number | undefined;
  readonly newestLoadedTimestampMs: number | undefined;
}

function normalizedGroup(value: unknown): WhatsAppGroupReference | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const fields = value as Readonly<Record<string, unknown>>;
  if (typeof fields.id !== "string" || !/\S/u.test(fields.id)) return undefined;
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  return Object.freeze({
    id: fields.id.trim(),
    name: name.length === 0 ? "Unnamed group" : name,
  });
}

function compareGroups(left: WhatsAppGroupReference, right: WhatsAppGroupReference): number {
  return left.name < right.name
    ? -1
    : left.name > right.name
      ? 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0;
}

export async function listWhatsAppGroups(
  client: WhatsAppGroupBrowserClient,
): Promise<readonly WhatsAppGroupReference[]> {
  const candidates = await client.pupPage.evaluate(() => {
    const browser = globalThis as unknown as {
      readonly require: (moduleName: string) => {
        readonly Chat: {
          readonly getModelsArray: () => readonly Record<string, unknown>[];
        };
      };
    };
    const chats = browser.require("WAWebCollections").Chat.getModelsArray();
    return chats.flatMap((chat) => {
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
  });

  const unique = new Map<string, WhatsAppGroupReference>();
  for (const candidate of candidates) {
    const group = normalizedGroup(candidate);
    if (group !== undefined) unique.set(group.id, group);
  }
  return Object.freeze([...unique.values()].sort(compareGroups));
}

export async function probeWhatsAppGroupHistory(
  client: WhatsAppGroupBrowserClient,
  chatId: string,
): Promise<WhatsAppGroupHistoryProbe | undefined> {
  const page = client.pupPage as unknown as {
    readonly evaluate: <T, A>(
      pageFunction: (argument: A) => T | Promise<T>,
      argument: A,
    ) => Promise<T>;
  };
  const result = await page.evaluate(async (requestedChatId) => {
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
    const loader = browser.require("WAWebChatLoadMessages") as {
      readonly loadEarlierMsgs: (input: {
        readonly chat: Record<string, unknown>;
      }) => Promise<unknown>;
    };
    const loaded = await loader.loadEarlierMsgs({ chat });
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
  if (result === undefined) return undefined;

  const group = normalizedGroup(result);
  if (group === undefined) return undefined;
  const fields = result as Readonly<Record<string, unknown>>;
  if (
    typeof fields.loadedMessageCountBefore !== "number" ||
    typeof fields.loadedMessageCountAfter !== "number"
  ) {
    return undefined;
  }
  return Object.freeze({
    group,
    loadedMessageCountBefore: fields.loadedMessageCountBefore,
    newlyLoadedMessageCount:
      typeof fields.newlyLoadedMessageCount === "number"
        ? fields.newlyLoadedMessageCount
        : undefined,
    loadedMessageCountAfter: fields.loadedMessageCountAfter,
    oldestLoadedTimestampMs:
      typeof fields.oldestLoadedTimestampMs === "number"
        ? fields.oldestLoadedTimestampMs
        : undefined,
    newestLoadedTimestampMs:
      typeof fields.newestLoadedTimestampMs === "number"
        ? fields.newestLoadedTimestampMs
        : undefined,
  });
}

export interface WhatsAppWeeklyMarkerCandidate {
  readonly markerTimestampMs: number;
  readonly markerText: string;
  readonly followingTimestampMs: number;
  readonly followingType: string;
  readonly followingMessageId: string | undefined;
  readonly recoveredAfterRevoked: boolean;
}

export async function discoverWhatsAppWeeklyMarkers(
  client: WhatsAppGroupBrowserClient,
  input: Readonly<{
    chatId: string;
    rangeStartMs: number;
    rangeEndMs: number;
  }>,
): Promise<readonly WhatsAppWeeklyMarkerCandidate[]> {
  const page = client.pupPage as unknown as {
    readonly evaluate: <T, A>(
      pageFunction: (argument: A) => T | Promise<T>,
      argument: A,
    ) => Promise<T>;
  };
  const candidates = await page.evaluate((range) => {
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
      let recoveredAfterRevoked = false;
      if (following?.type === "revoked" && markerTimestampMs !== undefined) {
        const markerDate = new Date(markerTimestampMs).toDateString();
        for (
          let replacementIndex = index + 2;
          replacementIndex < ordered.length;
          replacementIndex += 1
        ) {
          const replacement = ordered[replacementIndex];
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
          recoveredAfterRevoked,
        },
      ];
    });
  }, input);

  return Object.freeze(
    candidates.filter(
      (candidate): candidate is WhatsAppWeeklyMarkerCandidate =>
        typeof candidate.markerTimestampMs === "number" &&
        typeof candidate.markerText === "string" &&
        typeof candidate.followingTimestampMs === "number" &&
        typeof candidate.followingType === "string" &&
        typeof candidate.recoveredAfterRevoked === "boolean",
    ),
  );
}

export interface WhatsAppPollParticipantProbe {
  readonly voteRecordCount: number;
  readonly participantDisplays: readonly string[];
  readonly unresolvedParticipantCount: number;
}

export async function probeWhatsAppPollParticipants(
  client: WhatsAppGroupBrowserClient,
  pollMessageId: string,
): Promise<WhatsAppPollParticipantProbe | undefined> {
  const page = client.pupPage as unknown as {
    readonly evaluate: <T, A>(
      pageFunction: (argument: A) => T | Promise<T>,
      argument: A,
    ) => Promise<T>;
  };
  const result = await page.evaluate(async (messageId) => {
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

    const participantKeys = new Set(
      voteRows.flatMap((row) => {
        const sender = (row as { readonly sender?: unknown }).sender as
          | { readonly toString?: () => string }
          | undefined;
        return typeof sender?.toString === "function" ? [sender.toString()] : [];
      }),
    );
    const displays: string[] = [];
    let unresolvedParticipantCount = 0;
    for (const participantKey of participantKeys) {
      try {
        const wid = (
          browser.require("WAWebWidFactory") as {
            readonly createWid: (value: string) => unknown;
          }
        ).createWid(participantKey);
        const contact = await (
          browser.require("WAWebCollections") as {
            readonly Contact: {
              readonly find: (value: unknown) => Promise<Record<string, unknown>>;
            };
          }
        ).Contact.find(wid);
        const username = typeof contact?.username === "string" ? contact.username.trim() : "";
        if (username.length > 0) {
          displays.push(username.startsWith("@") ? username : `@${username}`);
          continue;
        }
        const directPhone = contact?.phoneNumber;
        const phoneValue =
          directPhone ??
          (
            browser.require("WAWebApiContact") as {
              readonly getPhoneNumber: (value: unknown) => unknown;
            }
          ).getPhoneNumber(wid);
        const phoneText =
          typeof phoneValue === "string"
            ? phoneValue
            : typeof (phoneValue as { readonly user?: unknown } | undefined)?.user === "string"
              ? (phoneValue as { readonly user: string }).user
              : typeof (phoneValue as { readonly toString?: unknown } | undefined)?.toString ===
                  "function"
                ? (phoneValue as { readonly toString: () => string }).toString()
                : "";
        const digits = phoneText.replaceAll(/\D/gu, "");
        if (digits.length > 0) {
          displays.push(`+${digits}`);
        } else {
          unresolvedParticipantCount += 1;
        }
      } catch {
        unresolvedParticipantCount += 1;
      }
    }
    return {
      voteRecordCount: voteRows.length,
      participantDisplays: [...new Set(displays)].sort((left, right) => left.localeCompare(right)),
      unresolvedParticipantCount,
    };
  }, pollMessageId);
  if (result === undefined) return undefined;

  const fields = result as Readonly<Record<string, unknown>>;
  if (
    typeof fields.voteRecordCount !== "number" ||
    !Array.isArray(fields.participantDisplays) ||
    typeof fields.unresolvedParticipantCount !== "number" ||
    fields.participantDisplays.some((display) => typeof display !== "string")
  ) {
    return undefined;
  }
  return Object.freeze({
    voteRecordCount: fields.voteRecordCount,
    participantDisplays: Object.freeze([...fields.participantDisplays]),
    unresolvedParticipantCount: fields.unresolvedParticipantCount,
  });
}

export interface WhatsAppReactionParticipantProbe {
  readonly reactionSenderRecordCount: number;
  readonly participantDisplays: readonly string[];
  readonly unresolvedParticipantCount: number;
}

export async function probeWhatsAppReactionParticipants(
  client: WhatsAppGroupBrowserClient,
  messageId: string,
): Promise<WhatsAppReactionParticipantProbe | undefined> {
  const page = client.pupPage as unknown as {
    readonly evaluate: <T, A>(
      pageFunction: (argument: A) => T | Promise<T>,
      argument: A,
    ) => Promise<T>;
  };
  const result = await page.evaluate(async (reactionMessageId) => {
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
    const participantKeys = new Set(
      senderRecords.flatMap((sender) => {
        const key = senderKey(sender);
        return key === undefined ? [] : [key];
      }),
    );

    const displays: string[] = [];
    let unresolvedParticipantCount = 0;
    for (const participantKey of participantKeys) {
      try {
        const wid = (
          browser.require("WAWebWidFactory") as {
            readonly createWid: (value: string) => unknown;
          }
        ).createWid(participantKey);
        const contact = await (
          browser.require("WAWebCollections") as {
            readonly Contact: {
              readonly find: (value: unknown) => Promise<Record<string, unknown>>;
            };
          }
        ).Contact.find(wid);
        const username = typeof contact?.username === "string" ? contact.username.trim() : "";
        if (username.length > 0) {
          displays.push(username.startsWith("@") ? username : `@${username}`);
          continue;
        }
        const directPhone = contact?.phoneNumber;
        const phoneValue =
          directPhone ??
          (
            browser.require("WAWebApiContact") as {
              readonly getPhoneNumber: (value: unknown) => unknown;
            }
          ).getPhoneNumber(wid);
        const phoneText =
          typeof phoneValue === "string"
            ? phoneValue
            : typeof (phoneValue as { readonly user?: unknown } | undefined)?.user === "string"
              ? (phoneValue as { readonly user: string }).user
              : typeof (phoneValue as { readonly toString?: unknown } | undefined)?.toString ===
                  "function"
                ? (phoneValue as { readonly toString: () => string }).toString()
                : "";
        const digits = phoneText.replaceAll(/\D/gu, "");
        if (digits.length > 0) {
          displays.push(`+${digits}`);
        } else {
          unresolvedParticipantCount += 1;
        }
      } catch {
        unresolvedParticipantCount += 1;
      }
    }
    return {
      reactionSenderRecordCount: senderRecords.length,
      participantDisplays: [...new Set(displays)].sort((left, right) => left.localeCompare(right)),
      unresolvedParticipantCount,
    };
  }, messageId);
  if (result === undefined) return undefined;

  const fields = result as Readonly<Record<string, unknown>>;
  if (
    typeof fields.reactionSenderRecordCount !== "number" ||
    !Array.isArray(fields.participantDisplays) ||
    typeof fields.unresolvedParticipantCount !== "number" ||
    fields.participantDisplays.some((display) => typeof display !== "string")
  ) {
    return undefined;
  }
  return Object.freeze({
    reactionSenderRecordCount: fields.reactionSenderRecordCount,
    participantDisplays: Object.freeze([...fields.participantDisplays]),
    unresolvedParticipantCount: fields.unresolvedParticipantCount,
  });
}
