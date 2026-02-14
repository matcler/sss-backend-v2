import { describe, it, expect } from "vitest";
import { SeededDiceRoller } from "../src/sss/adapters/dice/seededDiceRoller";

describe("SeededDiceRoller", () => {
  it("produces deterministic sequence for fixed seed and cursor", () => {
    const roller = new SeededDiceRoller();

    const first = roller.roll({
      seed: 12345,
      cursor: 0,
      sides: 20,
      count: 5,
      modifiers: [2],
      context: "TEST",
    });

    expect(first.dice).toEqual([20, 8, 14, 2, 19]);
    expect(first.total).toBe(65);
    expect(first.rng_cursor_before).toBe(0);
    expect(first.rng_cursor_after).toBe(5);

    const second = roller.roll({
      seed: 12345,
      cursor: first.rng_cursor_after,
      sides: 20,
      count: 5,
      modifiers: [],
      context: "TEST",
    });

    expect(second.dice).toEqual([5, 10, 20, 14, 6]);
    expect(second.rng_cursor_before).toBe(5);
    expect(second.rng_cursor_after).toBe(10);
  });
});
