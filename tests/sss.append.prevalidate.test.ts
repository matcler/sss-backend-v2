import { describe, it, expect } from "vitest";

import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import { ValidationError } from "../src/sss/domain/errors";
import { allowAllRuleEngine } from "../src/sss/rule-engine/allowAllRuleEngine";


describe("SSS appendEvents", () => {
  it("does not persist invalid events (validate-before-persist)", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999)
;

    const sessionId = "s-prevalidate";

    // 1) Create session (v1)
    await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [{ type: "SESSION_CREATED", payload: { ruleset: "dnd5e" } }],
    });

    // 2) Set mode COMBAT (v2) — still no combat.active
    await svc.appendEvents(sessionId, {
      expected_version: 1,
      events: [{ type: "MODE_SET", payload: { mode: "COMBAT" } }],
    });

    // 3) Try illegal ADVANCE_TURN (combat not active)
    await expect(
      svc.appendEvents(sessionId, {
        expected_version: 2,
        events: [{ type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } }],
      })
    ).rejects.toBeInstanceOf(ValidationError);

    // 4) Ensure stream did NOT advance (still only v1..v2)
    const events = await svc.getEvents(sessionId);
    expect(events.map((e) => e.version)).toEqual([1, 2]);
    expect(events.map((e) => e.type)).toEqual(["SESSION_CREATED", "MODE_SET"]);
  });

  it("rejects INITIATIVE_SET when AI entry mismatches last INITIATIVE_ROLLED", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);

    const sessionId = "s-init-ai-mismatch";
    const zoneId = "Z1";

    let state = await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "dnd5e" } },
        { type: "RNG_SEEDED", payload: { seed: 1 } },
        { type: "ZONE_ADDED", payload: { zone_id: zoneId, name: "Arena" } },
        { type: "ENTITY_ADDED", payload: { entity_id: "ai", name: "AI", hp: 10, zone: zoneId } },
        { type: "ENTITY_ADDED", payload: { entity_id: "h1", name: "H1", hp: 10, zone: zoneId } },
        { type: "COMBAT_STARTED", payload: { participant_ids: ["ai", "h1"] } },
      ],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: { actorEntityId: "ai", actionType: "ROLL_INITIATIVE" },
        },
      ],
    });

    await expect(
      svc.appendEvents(sessionId, {
        expected_version: state.meta.version,
        events: [
          {
            type: "INITIATIVE_SET",
            payload: {
              entries: [
                { entityId: "ai", total: 999, source: "AI_ROLL" },
                { entityId: "h1", total: 10, source: "HUMAN_DECLARED" },
              ],
              order: ["ai", "h1"],
            },
          },
        ],
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects INITIATIVE_SET when human entry is not HUMAN_DECLARED", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);

    const sessionId = "s-init-human-source";
    const zoneId = "Z1";

    let state = await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "dnd5e" } },
        { type: "RNG_SEEDED", payload: { seed: 1 } },
        { type: "ZONE_ADDED", payload: { zone_id: zoneId, name: "Arena" } },
        { type: "ENTITY_ADDED", payload: { entity_id: "ai", name: "AI", hp: 10, zone: zoneId } },
        { type: "ENTITY_ADDED", payload: { entity_id: "h1", name: "H1", hp: 10, zone: zoneId } },
        { type: "COMBAT_STARTED", payload: { participant_ids: ["ai", "h1"] } },
      ],
    });

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: { actorEntityId: "ai", actionType: "ROLL_INITIATIVE" },
        },
      ],
    });

    const events = await svc.getEvents(sessionId);
    const roll = events.find((e) => e.type === "INITIATIVE_ROLLED") as any;
    const total = roll?.payload?.roll?.total ?? 0;

    await expect(
      svc.appendEvents(sessionId, {
        expected_version: state.meta.version,
        events: [
          {
            type: "INITIATIVE_SET",
            payload: {
              entries: [
                { entityId: "ai", total, source: "AI_ROLL" },
                { entityId: "h1", total: 10, source: "AI_ROLL" },
              ],
              order: ["ai", "h1"],
            },
          },
        ],
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
