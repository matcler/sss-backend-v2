// tests/re-contract.adapter.test.ts
import { describe, expect, test, vi } from "vitest";

import { ContractRuleEngineGateway } from "../src/sss/rule-engine/contractRuleEngineGateway";
import type { RuleEngine, ReDecision } from "../src/sss/rule-engine/reContract";
import { ReasonCode } from "../src/sss/rule-engine/reContract";
import type { Snapshot, DomainEvent } from "../src/sss/domain/types";

/**
 * NOTE:
 * This test is intentionally resilient: it only builds the subset of Snapshot/DomainEvent
 * that the adapter/gateway currently reads. Everything else is left out.
 */

function makeBaseSnapshot(overrides?: Partial<Snapshot>): Snapshot {
  const base = {
    meta: { session_id: "s1", version: 0, ruleset: "5e" },
    mode: "COMBAT",
    combat: {
      active: true,
      phase: "ACTION", // SSS: START | ACTION | END
      active_entity: "e1",
      initiative: ["e1", "e2"],
      turn_actions_used: 0,
    },
    entities: {
      e1: { id: "e1", hp: 10, zone: "A1" },
      e2: { id: "e2", hp: 10, zone: "A1" },
    },
  } as any as Snapshot;

  return { ...base, ...(overrides ?? {}) };
}

describe("RE contract adapter (SSS -> RE contract) via ContractRuleEngineGateway", () => {
  test("TURN_ENDED is mapped and denial is forwarded", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({
        allowed: false,
        code: ReasonCode.NOT_YOUR_TURN,
        details: { expectedActor: "e2" },
      })),
    };

    const gw = new ContractRuleEngineGateway(engine);

    const snap = makeBaseSnapshot({
      combat: { ...makeBaseSnapshot().combat, active_entity: "e2" } as any,
    });

    const ev: DomainEvent = {
      type: "TURN_ENDED",
      payload: { entity_id: "e1" },
    } as any;

    const decision = gw.evaluate(snap, ev);

    expect(engine.evaluate).toHaveBeenCalledTimes(1);

    // Check decision forwarded
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe(ReasonCode.NOT_YOUR_TURN);
    }

    // Check event mapping sanity
    const [, reEv] = (engine.evaluate as any).mock.calls[0];
    expect(reEv.type).toBe("TURN_ENDED");
    expect(reEv.actorEntityId).toBe("e1");
  });

  test("ADVANCE_TURN: actorEntityId is forwarded to contract", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({ allowed: true } as const)),
    };

    const gw = new ContractRuleEngineGateway(engine);

    const snap = makeBaseSnapshot({
      combat: { ...makeBaseSnapshot().combat, active_entity: "e1" } as any,
    });

    const ev: DomainEvent = {
      type: "ADVANCE_TURN",
      payload: { actorEntityId: "e1" },
    } as any;

    const decision = gw.evaluate(snap, ev);

    expect(decision.allowed).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledTimes(1);

    const [reSnap, reEv] = (engine.evaluate as any).mock.calls[0];

    // Snapshot mapping sanity
    expect(reSnap.mode).toBe("COMBAT");
    expect(reSnap.combat.active).toBe(true);
    expect(reSnap.combat.phase).toBe("ACTION");
    expect(reSnap.combat.activeEntityId).toBe("e1");
    expect(reSnap.combat.initiativeSet).toBe(true);

    // Event mapping sanity
    expect(reEv.type).toBe("ADVANCE_TURN");
    expect(reEv.actorEntityId).toBe("e1");
  });

  test("non-gated events are allowed-by-default and do not call the contract engine", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({
        allowed: false,
        code: ReasonCode.UNKNOWN_EVENT,
      })),
    };

    const gw = new ContractRuleEngineGateway(engine);

    const snap = makeBaseSnapshot();

    const ev: DomainEvent = {
      type: "SESSION_CREATED",
      payload: { ruleset: "5e" },
    } as any;

    const decision = gw.evaluate(snap, ev);

    expect(decision.allowed).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledTimes(0);
  });

  test("gated event that cannot be mapped returns UNKNOWN_EVENT (fail-closed for gated set)", () => {
    const engine: RuleEngine = {
      evaluate: vi.fn((): ReDecision => ({ allowed: true } as const)),
    };

    const gw = new ContractRuleEngineGateway(engine);

    const snap = makeBaseSnapshot({
      combat: { ...makeBaseSnapshot().combat, active_entity: undefined } as any,
    });

    // ADVANCE_TURN requires explicit actor. Missing actor -> mapping fails.
    const ev: DomainEvent = {
      type: "ADVANCE_TURN",
      payload: {},
    } as any;

    const decision = gw.evaluate(snap, ev);

    expect(engine.evaluate).toHaveBeenCalledTimes(0); // mapping failed before calling engine
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe(ReasonCode.UNKNOWN_EVENT);
    }
  });
});
