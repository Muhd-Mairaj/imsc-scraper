export interface WhatsAppGroupReference {
  readonly id: string;
  readonly name: string;
}

export interface WhatsAppGroupBrowserClient {
  readonly pupPage: {
    readonly evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
  };
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
