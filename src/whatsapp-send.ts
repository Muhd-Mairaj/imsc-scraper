export interface SentWhatsAppMessage {
  readonly id: { readonly _serialized: string };
  readonly ack: number;
}

/**
 * `client.sendMessage` is typed as `Promise<Message>`, but the implementation
 * returns `undefined` without throwing when WhatsApp cannot resolve the chat or
 * produce a message. Left unchecked that looks like a successful send, so the
 * window gets recorded while nothing was actually sent. Treat it as a failure.
 */
export function assertMessageSent<T extends SentWhatsAppMessage>(
  chatId: string,
  message: T | undefined,
): T {
  if (message === undefined) {
    throw new Error(
      `WhatsApp did not send the message to ${chatId}: it returned no message, so the chat could not be resolved.`,
    );
  }
  return message;
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
