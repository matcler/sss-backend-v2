import { describe, it, expect } from "vitest";
import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import { allowAllRuleEngine } from "../src/sss/rule-engine/allowAllRuleEngine";
import type { RuleEngineGateway } from "../src/sss/rule-engine/ruleEngineGateway";
import { SeededDiceRoller } from "../src/sss/adapters/dice/seededDiceRoller";
import { ContractRuleEngineGateway } from "../src/sss/rule-engine/contractRuleEngineGateway";
import { ruleEngine } from "../src/sss/rule-engine/localContractRuleEngine";
import type { EntityState } from "../src/sss/domain/types";

describe("ACTION_PROPOSED -> ACTION_RESOLVED (E2E)", () => {
  it("MOVE produces resolved event and mutates position", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "s-action-move";

    await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "dnd5e" } } as any,
        { type: "RNG_SEEDED", payload: { seed: 1 } } as any,
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e1",
            name: "Hero",
            hp: 10,
            zone: null,
            position: { x: 0, y: 0 },
          },
        } as any,
      ],
    });

    const snap = await svc.appendEvents(sessionId, {
      expected_version: 3,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: {
            actorEntityId: "e1",
            actionType: "MOVE",
            destination: { x: 2, y: 3 },
          },
        } as any,
      ],
    });

    const events = await svc.getEvents(sessionId);
    expect(events.map((e) => e.type)).toEqual([
      "SESSION_CREATED",
      "RNG_SEEDED",
      "ENTITY_ADDED",
      "ACTION_PROPOSED",
      "ACTION_RESOLVED",
    ]);

    expect(snap.entities["e1"].position).toEqual({ x: 2, y: 3 });
  });

  it("ATTACK produces fixed damage outcome and reduces hp", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "s-action-attack";

    await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "dnd5e" } } as any,
        { type: "RNG_SEEDED", payload: { seed: 1 } } as any,
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e1",
            name: "Attacker",
            hp: 10,
            zone: null,
            position: { x: 0, y: 0 },
          },
        } as any,
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e2",
            name: "Target",
            hp: 10,
            zone: null,
            position: { x: 1, y: 0 },
          },
        } as any,
      ],
    });

    await svc.appendEvents(sessionId, {
      expected_version: 4,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: {
            actorEntityId: "e1",
            actionType: "ATTACK",
            targetEntityId: "e2",
          },
        } as any,
      ],
    });

    const events = await svc.getEvents(sessionId);
    const rolls = events.filter((e) => e.type === "ROLL_RESOLVED");
    expect(rolls.length).toBe(2);
    expect(rolls[0]?.payload?.context).toBe("ATTACK_TO_HIT");
    expect(rolls[1]?.payload?.context).toBe("DAMAGE");

    const damage = events.find((e) => e.type === "DAMAGE_APPLIED");
    expect(damage?.payload).toEqual({
      entity_id: "e2",
      amount: 3,
    });

    const resolved = events.find((e) => e.type === "ACTION_RESOLVED") as any;
    expect(resolved?.payload?.summary).toEqual({
      hit: true,
      damage_total: 3,
      targetEntityId: "e2",
    });

    const snap = await svc.getState(sessionId);
    expect(snap.entities["e2"].hp).toBe(7);
  });

  it("ATTACK uses ability/proficiency modifiers and weapon damage", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo, allowAllRuleEngine, 999_999);
    const sessionId = "s-action-attack-mods";
    const diceRoller = new SeededDiceRoller();

    await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "dnd5e" } } as any,
        { type: "RNG_SEEDED", payload: { seed: 1 } } as any,
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e1",
            name: "Attacker",
            hp: 10,
            zone: null,
            position: { x: 0, y: 0 },
            level: 1,
            str: 16,
            proficient: true,
            attack_ability: "STR",
            weapon_damage: { count: 1, sides: 8 },
          },
        } as any,
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e2",
            name: "Target",
            hp: 10,
            zone: null,
            position: { x: 1, y: 0 },
            ac: 12,
          },
        } as any,
      ],
    });

    await svc.appendEvents(sessionId, {
      expected_version: 4,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: {
            actorEntityId: "e1",
            actionType: "ATTACK",
            targetEntityId: "e2",
          },
        } as any,
      ],
    });

    const events = await svc.getEvents(sessionId);
    const rolls = events.filter((e) => e.type === "ROLL_RESOLVED");
    expect(rolls.length).toBe(2);

    const expectedToHit = diceRoller.roll({
      seed: 1,
      cursor: 0,
      sides: 20,
      count: 1,
      modifiers: [3, 2],
      context: "ATTACK_TO_HIT",
      actor_id: "e1",
      target_id: "e2",
    });
    const expectedDamage = diceRoller.roll({
      seed: 1,
      cursor: expectedToHit.rng_cursor_after,
      sides: 8,
      count: 1,
      modifiers: [3],
      context: "DAMAGE",
      actor_id: "e1",
      target_id: "e2",
    });

    expect(rolls[0]?.payload?.modifiers).toEqual([3, 2]);
    expect(rolls[0]?.payload?.total).toBe(expectedToHit.total);
    expect(rolls[1]?.payload?.modifiers).toEqual([3]);
    expect(rolls[1]?.payload?.total).toBe(expectedDamage.total);

    const damage = events.find((e) => e.type === "DAMAGE_APPLIED");
    expect(damage?.payload).toEqual({
      entity_id: "e2",
      amount: expectedDamage.total,
    });
  });

  it("deny from Rule Engine results in no persistence", async () => {
    const repo = new InMemorySssRepository();
    const denyGateway: RuleEngineGateway = {
      evaluate(_snapshot, event) {
        if (event.type === "ACTION_PROPOSED") {
          return { allowed: false, code: "DENY_ACTION" };
        }
        return { allowed: true };
      },
    };

    const svc = new SssService(repo, denyGateway, 999_999);
    const sessionId = "s-action-deny";

    await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "dnd5e" } } as any,
        {
          type: "ENTITY_ADDED",
          payload: {
            entity_id: "e1",
            name: "Hero",
            hp: 10,
            zone: null,
            position: { x: 0, y: 0 },
          },
        } as any,
      ],
    });

    await expect(
      svc.appendEvents(sessionId, {
        expected_version: 2,
        events: [
          {
            type: "ACTION_PROPOSED",
            payload: {
              actorEntityId: "e1",
              actionType: "MOVE",
              destination: { x: 1, y: 1 },
            },
          } as any,
        ],
      })
    ).rejects.toThrow(/DENY_ACTION|rule denied/i);

    const events = await svc.getEvents(sessionId);
    expect(events.map((e) => e.type)).toEqual([
      "SESSION_CREATED",
      "ENTITY_ADDED",
    ]);
  });
});

describe("C2 Initiative (E2E)", () => {
  const diceRoller = new SeededDiceRoller();

  function abilityMod(score: number): number {
    return Math.floor((score - 10) / 2);
  }

  async function setupCombatWithEntities(
    svc: SssService,
    sessionId: string,
    entities: Array<{ id: string; name: string; dex?: number }>
  ) {
    const zoneId = "Z1";
    let state = await svc.appendEvents(sessionId, {
      expected_version: 0,
      events: [
        { type: "SESSION_CREATED", payload: { ruleset: "dnd5e" } },
        { type: "RNG_SEEDED", payload: { seed: 1 } },
        { type: "ZONE_ADDED", payload: { zone_id: zoneId, name: "Arena" } },
        ...entities.map((e) => ({
          type: "ENTITY_ADDED",
          payload: {
            entity_id: e.id,
            name: e.name,
            hp: 10,
            zone: zoneId,
            dex: e.dex ?? 10,
          },
        })),
        { type: "MODE_SET", payload: { mode: "COMBAT" } },
        {
          type: "COMBAT_STARTED",
          payload: { participant_ids: entities.map((e) => e.id) },
        },
      ],
    });

    return state;
  }

  function expectedOrderFromEntries(
    entries: Array<{ entityId: string; total: number; dex_mod?: number }>,
    entities: Record<string, EntityState>
  ) {
    const computed = entries.map((e) => ({
      entityId: e.entityId,
      total: e.total,
      dex_mod: Number.isFinite(e.dex_mod)
        ? (e.dex_mod as number)
        : abilityMod(entities[e.entityId]?.dex ?? 10),
    }));

    computed.sort((a, b) => {
      if (a.total !== b.total) return b.total - a.total;
      if (a.dex_mod !== b.dex_mod) return b.dex_mod - a.dex_mod;
      if (a.entityId < b.entityId) return -1;
      if (a.entityId > b.entityId) return 1;
      return 0;
    });

    return computed.map((e) => e.entityId);
  }

  it("ROLL_INITIATIVE (AI) produces INITIATIVE_ROLLED and advances rng cursor", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine, {
      aiEntityWhitelist: ["ai"],
    });
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "s-init-roll-ai";

    const baseState = await setupCombatWithEntities(svc, sessionId, [
      { id: "ai", name: "AI", dex: 14 },
      { id: "h1", name: "H1", dex: 12 },
      { id: "h2", name: "H2", dex: 12 },
      { id: "h3", name: "H3", dex: 16 },
      { id: "h4", name: "H4", dex: 8 },
      { id: "h5", name: "H5", dex: 10 },
    ]);

    const expectedRoll = diceRoller.roll({
      seed: 1,
      cursor: 0,
      sides: 20,
      count: 1,
      modifiers: [abilityMod(14)],
      context: "INITIATIVE",
      actor_id: "ai",
    });

    const state = await svc.appendEvents(sessionId, {
      expected_version: baseState.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: { actorEntityId: "ai", actionType: "ROLL_INITIATIVE" },
        },
      ],
    });

    const events = await svc.getEvents(sessionId);
    const types = events.map((e) => e.type);
    expect(types).toContain("ACTION_PROPOSED");
    expect(types).toContain("INITIATIVE_ROLLED");
    expect(types).not.toContain("INITIATIVE_SET");

    const rollEvent = events.find((e) => e.type === "INITIATIVE_ROLLED") as any;
    expect(rollEvent.payload.context).toBe("INITIATIVE");
    expect(rollEvent.payload.rng_cursor_before).toBe(expectedRoll.rng_cursor_before);
    expect(rollEvent.payload.rng_cursor_after).toBe(expectedRoll.rng_cursor_after);
    expect(rollEvent.payload.roll.total).toBe(expectedRoll.total);
    expect(state.rng.cursor).toBe(expectedRoll.rng_cursor_after);
  });

  it("INITIATIVE_SET validates AI total, computes deterministic order, and auto-emits TURN_STARTED", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine, {
      aiEntityWhitelist: ["ai"],
    });
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "s-init-set";

    let state = await setupCombatWithEntities(svc, sessionId, [
      { id: "ai", name: "AI", dex: 14 },
      { id: "h1", name: "H1", dex: 12 },
      { id: "h2", name: "H2", dex: 12 },
      { id: "h3", name: "H3", dex: 16 },
      { id: "h4", name: "H4", dex: 8 },
      { id: "h5", name: "H5", dex: 10 },
    ]);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: { actorEntityId: "ai", actionType: "ROLL_INITIATIVE" },
        },
      ],
    });

    const eventsAfterRoll = await svc.getEvents(sessionId);
    const rollEvent = eventsAfterRoll.find((e) => e.type === "INITIATIVE_ROLLED") as any;
    const aiTotal = rollEvent.payload.roll.total;

    const entries = [
      { entityId: "h1", total: 15, source: "HUMAN_DECLARED" },
      { entityId: "h2", total: 15, source: "HUMAN_DECLARED" },
      { entityId: "h3", total: 15, source: "HUMAN_DECLARED" },
      { entityId: "h4", total: 8, source: "HUMAN_DECLARED" },
      { entityId: "h5", total: 12, source: "HUMAN_DECLARED" },
      { entityId: "ai", total: aiTotal, source: "AI_ROLL" },
    ];

    const expectedOrder = expectedOrderFromEntries(entries, state.entities);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "INITIATIVE_SET",
          payload: {
            entries,
            order: ["h4", "h3", "h2", "h1", "h5", "ai"],
          },
        },
      ],
    });

    const events = await svc.getEvents(sessionId);
    const idxInitSet = events.findIndex((e) => e.type === "INITIATIVE_SET");
    expect(idxInitSet).toBeGreaterThanOrEqual(0);
    expect(events[idxInitSet + 1]?.type).toBe("TURN_STARTED");

    expect(state.combat.initiative).toEqual(expectedOrder);
    expect(state.combat.active_entity).toBe(expectedOrder[0]);
    expect(state.combat.cursor).toBe(0);
    expect(state.combat.phase).toBe("ACTION_WINDOW");
  });

  it("Replay determinism: rebuilding state yields same initiative order and active_entity", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine, {
      aiEntityWhitelist: ["ai"],
    });
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "s-init-replay";

    let state = await setupCombatWithEntities(svc, sessionId, [
      { id: "ai", name: "AI", dex: 14 },
      { id: "h1", name: "H1", dex: 12 },
      { id: "h2", name: "H2", dex: 12 },
      { id: "h3", name: "H3", dex: 16 },
      { id: "h4", name: "H4", dex: 8 },
      { id: "h5", name: "H5", dex: 10 },
    ]);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: { actorEntityId: "ai", actionType: "ROLL_INITIATIVE" },
        },
      ],
    });

    const rollEvent = (await svc.getEvents(sessionId)).find(
      (e) => e.type === "INITIATIVE_ROLLED"
    ) as any;
    const aiTotal = rollEvent.payload.roll.total;

    const entries = [
      { entityId: "h1", total: 15, source: "HUMAN_DECLARED" },
      { entityId: "h2", total: 15, source: "HUMAN_DECLARED" },
      { entityId: "h3", total: 15, source: "HUMAN_DECLARED" },
      { entityId: "h4", total: 8, source: "HUMAN_DECLARED" },
      { entityId: "h5", total: 12, source: "HUMAN_DECLARED" },
      { entityId: "ai", total: aiTotal, source: "AI_ROLL" },
    ];

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "INITIATIVE_SET",
          payload: { entries, order: entries.map((e) => e.entityId) },
        },
      ],
    });

    const replayed = await svc.getState(sessionId);
    expect(replayed.combat.initiative).toEqual(state.combat.initiative);
    expect(replayed.combat.active_entity).toBe(state.combat.active_entity);
    expect(replayed.rng.cursor).toBe(state.rng.cursor);
  });

  it("deny from Rule Engine results in no persistence (ROLL_INITIATIVE)", async () => {
    const repo = new InMemorySssRepository();
    const denyGateway: RuleEngineGateway = {
      evaluate(_snapshot, event) {
        if (
          event.type === "ACTION_PROPOSED" &&
          event.payload.actionType === "ROLL_INITIATIVE"
        ) {
          return { allowed: false, code: "DENY_INITIATIVE" };
        }
        return { allowed: true };
      },
    };

    const svc = new SssService(repo, denyGateway, 999_999);
    const sessionId = "s-init-deny";

    const baseState = await setupCombatWithEntities(svc, sessionId, [
      { id: "ai", name: "AI", dex: 14 },
      { id: "h1", name: "H1", dex: 12 },
      { id: "h2", name: "H2", dex: 12 },
      { id: "h3", name: "H3", dex: 16 },
      { id: "h4", name: "H4", dex: 8 },
      { id: "h5", name: "H5", dex: 10 },
    ]);

    await expect(
      svc.appendEvents(sessionId, {
        expected_version: baseState.meta.version,
        events: [
          {
            type: "ACTION_PROPOSED",
            payload: { actorEntityId: "ai", actionType: "ROLL_INITIATIVE" },
          },
        ],
      })
    ).rejects.toThrow(/DENY_INITIATIVE/i);

    const events = await svc.getEvents(sessionId);
    expect(events.map((e) => e.type)).not.toContain("ACTION_PROPOSED");
    expect(events.map((e) => e.type)).not.toContain("INITIATIVE_ROLLED");
  });

  it("anti-tamper: INITIATIVE_SET with wrong AI total is rejected and not persisted", async () => {
    const repo = new InMemorySssRepository();
    const gateway = new ContractRuleEngineGateway(ruleEngine, {
      aiEntityWhitelist: ["ai"],
    });
    const svc = new SssService(repo, gateway, 999_999);
    const sessionId = "s-init-tamper";

    let state = await setupCombatWithEntities(svc, sessionId, [
      { id: "ai", name: "AI", dex: 14 },
      { id: "h1", name: "H1", dex: 12 },
      { id: "h2", name: "H2", dex: 12 },
      { id: "h3", name: "H3", dex: 16 },
      { id: "h4", name: "H4", dex: 8 },
      { id: "h5", name: "H5", dex: 10 },
    ]);

    state = await svc.appendEvents(sessionId, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ACTION_PROPOSED",
          payload: { actorEntityId: "ai", actionType: "ROLL_INITIATIVE" },
        },
      ],
    });

    const before = await svc.getEvents(sessionId);

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
                { entityId: "h2", total: 10, source: "HUMAN_DECLARED" },
                { entityId: "h3", total: 10, source: "HUMAN_DECLARED" },
                { entityId: "h4", total: 10, source: "HUMAN_DECLARED" },
                { entityId: "h5", total: 10, source: "HUMAN_DECLARED" },
              ],
              order: ["ai", "h1", "h2", "h3", "h4", "h5"],
            },
          },
        ],
      })
    ).rejects.toThrow();

    const after = await svc.getEvents(sessionId);
    const newTypes = after.slice(before.length).map((e) => e.type);
    expect(newTypes).not.toContain("INITIATIVE_SET");
    expect(newTypes).not.toContain("TURN_STARTED");
  });
});
