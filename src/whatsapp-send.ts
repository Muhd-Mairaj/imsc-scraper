export interface SentWhatsAppMessage {
  readonly id: { readonly _serialized: string };
  readonly ack: number;
}

/**
 * True when a message observed via the chat is our own outgoing message with the
 * expected body. Used to confirm a send independently of `sendMessage`'s return
 * value, which the pinned client can leave `undefined` even on success.
 */
export function isOurMessage(
  message: { readonly fromMe: boolean; readonly body: string },
  expectedBody: string,
): boolean {
  return message.fromMe && message.body.trim() === expectedBody.trim();
}

/** Human label for a WhatsApp message acknowledgement value. */
export function describeAck(ack: number): string {
  switch (ack) {
    case -1:
      return "error";
    case 0:
      return "pending";
    case 1:
      return "sent to WhatsApp";
    case 2:
      return "delivered";
    case 3:
      return "read";
    case 4:
      return "played";
    default:
      return `unknown (${ack})`;
  }
}
