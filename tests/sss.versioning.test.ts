import { describe, it, expect } from "vitest";
import { applyEvent } from "../src/sss/domain/apply";

function makeBareState() {
  return {
    meta: { version: -1, ruleset: "default" },
    mode: "EXPLORATION",
    combat: {
      active: false,
      round: 0,
      initiative: [],
      cursor: 0,
      active_entity: null,
      phase: "START",
      turn_actions_used: 0,
    },
    map: { zones: {}, adjacency: {} },
    entities: {},
  };
}

describe("SSS versioning: meta.version must reflect stream version", () => {
  it("applyEvent should set state.meta.version = event.version after every apply", () => {
    const state = makeBareState();

    const e0 = { type: "COMBAT_STARTED", payload: { participant_ids: [] }, version: 0 } as any;
    const e1 = { type: "INITIATIVE_SET", payload: { order: ["e1", "e2"] }, version: 1 } as any;

    const s0 = applyEvent(state as any, e0) as any;
    expect(s0.meta.version).toBe(0);

    const s1 = applyEvent(s0 as any, e1) as any;
    expect(s1.meta.version).toBe(1);

  });
});
