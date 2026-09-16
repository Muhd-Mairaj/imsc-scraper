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
