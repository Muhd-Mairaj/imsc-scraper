import { expect, test } from "bun:test";
import { normalizePhoneNumbers } from "../src/config.js";

test("normalizes and deduplicates ignored phone numbers", () => {
  expect(
    normalizePhoneNumbers(["+60 12-345 6789", "60123456789", "", "  +60 12 345 6789  "]),
  ).toEqual(["60123456789"]);
});
