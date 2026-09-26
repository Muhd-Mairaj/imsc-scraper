export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Digits only, so `+60 12-345 6789` and `60123456789` compare equal. */
export function phoneDigits(value: string): string {
  return value.replaceAll(/\D/gu, "");
}

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
