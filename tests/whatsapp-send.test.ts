import { expect, test } from "bun:test";
import { describeAck, isOurMessage } from "../src/whatsapp-send.js";

test("matches our own message with the expected body", () => {
  expect(isOurMessage({ fromMe: true, body: "hello\n" }, "hello")).toBe(true);
  expect(isOurMessage({ fromMe: true, body: "hello" }, "hello\n")).toBe(true);
});

test("rejects incoming messages and different bodies", () => {
  expect(isOurMessage({ fromMe: false, body: "hello" }, "hello")).toBe(false);
  expect(isOurMessage({ fromMe: true, body: "something else" }, "hello")).toBe(false);
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
