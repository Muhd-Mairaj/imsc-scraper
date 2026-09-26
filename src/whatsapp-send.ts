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
