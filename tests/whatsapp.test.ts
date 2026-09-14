import { describe, expect, test } from "bun:test";
import { listWhatsAppGroups } from "../src/whatsapp.js";

describe("narrow WhatsApp group listing", () => {
  test("uses one narrow browser evaluation and sorts only group IDs and names", async () => {
    let evaluations = 0;
    const groups = await listWhatsAppGroups({
      pupPage: {
        async evaluate<T>() {
          evaluations += 1;
          return [
            { id: "z@g.us", name: "Zulu" },
            { id: "a@g.us", name: " Alpha " },
            { id: "b@g.us", name: "   " },
          ] as T;
        },
      },
    });

    expect(evaluations).toBe(1);
    expect(groups).toEqual([
      { id: "a@g.us", name: "Alpha" },
      { id: "b@g.us", name: "Unnamed group" },
      { id: "z@g.us", name: "Zulu" },
    ]);
  });
});
