import { expect, test } from "bun:test";
import { describeAck, errorMessage, phoneDigits } from "../src/utils.js";

test("labels each acknowledgement value", () => {
  expect(describeAck(-1)).toBe("error");
  expect(describeAck(0)).toBe("pending");
  expect(describeAck(1)).toBe("sent to WhatsApp");
  expect(describeAck(2)).toBe("delivered");
  expect(describeAck(3)).toBe("read");
  expect(describeAck(4)).toBe("played");
  expect(describeAck(99)).toBe("unknown (99)");
});

test("strips everything but digits", () => {
  expect(phoneDigits("+60 12-345 6789")).toBe("60123456789");
});

test("formats errors and non-errors alike", () => {
  expect(errorMessage(new Error("boom"))).toBe("boom");
  expect(errorMessage("boom")).toBe("boom");
});
