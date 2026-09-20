import { expect, test } from "bun:test";
import { assertMessageSent, describeAck } from "../src/whatsapp-send.js";

test("returns the resolved message unchanged", () => {
  const message = { id: { _serialized: "true_123@c.us_ABC" }, ack: 1 };
  expect(assertMessageSent("123@c.us", message)).toBe(message);
});

test("throws when WhatsApp returned no message", () => {
  expect(() => assertMessageSent("123@c.us", undefined)).toThrow("could not be resolved");
});

test("labels each acknowledgement value", () => {
  expect(describeAck(-1)).toBe("error");
  expect(describeAck(0)).toBe("pending");
  expect(describeAck(1)).toBe("sent to WhatsApp");
  expect(describeAck(2)).toBe("delivered");
  expect(describeAck(3)).toBe("read");
  expect(describeAck(4)).toBe("played");
  expect(describeAck(99)).toBe("unknown (99)");
});
