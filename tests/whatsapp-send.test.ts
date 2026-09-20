import { expect, test } from "bun:test";
import { describeAck } from "../src/whatsapp-send.js";

test("labels each acknowledgement value", () => {
  expect(describeAck(-1)).toBe("error");
  expect(describeAck(0)).toBe("pending");
  expect(describeAck(1)).toBe("sent to WhatsApp");
  expect(describeAck(2)).toBe("delivered");
  expect(describeAck(3)).toBe("read");
  expect(describeAck(4)).toBe("played");
  expect(describeAck(99)).toBe("unknown (99)");
});
