// src/sss/rule-engine/contractRuleEngineGateway.ts
//
// Adapter: SSS (Snapshot/DomainEvent) -> RE Contract (ReSnapshot/ReEvent) -> Decision
//
// NOTE:
// - This gateway should be *selective*: it only gates the event types that the RE currently understands.
// - All other SSS events are allowed by default to avoid blocking legacy flows.
// - Add mappings incrementally as you expand the frozen contract event set.

import type { Snapshot, DomainEvent, Mode } from "../domain/types";
import type { RuleEngineGateway, RuleEngineDecision } from "./ruleEngineGateway";

// Import the frozen RE contract types (same file copied into both repos).
// Adjust the relative path if you placed the contract elsewhere.
import type { RuleEngine as ContractRuleEngine, ReSnapshot, ReEvent } from "./reContract";
import { ReasonCode } from "./reContract";

export class ContractRuleEngineGateway implements RuleEngineGateway {
  private readonly aiEntityWhitelist: Set<string> | null;

  constructor(
    private readonly engine: ContractRuleEngine,
    options?: { aiEntityWhitelist?: Iterable<string> }
  ) {
    this.aiEntityWhitelist = options?.aiEntityWhitelist
      ? new Set(options.aiEntityWhitelist)
      : null;
  }

  evaluate(snapshot: Snapshot, event: DomainEvent): RuleEngineDecision {
    if (
      event.type === "ACTION_PROPOSED" &&
      event.payload.actionType === "ROLL_INITIATIVE"
    ) {
      const actor = event.payload.actorEntityId;
      if (!actor) return { allowed: false, code: "DENY_INITIATIVE" };
      if (snapshot.mode !== "COMBAT") return { allowed: false, code: "DENY_INITIATIVE" };
      if (!snapshot.combat?.active) return { allowed: false, code: "DENY_INITIATIVE" };
      if (Array.isArray(snapshot.combat?.initiative) && snapshot.combat.initiative.length > 0) {
        return { allowed: false, code: "DENY_INITIATIVE" };
      }
      if (!this.aiEntityWhitelist || !this.aiEntityWhitelist.has(actor)) {
        return { allowed: false, code: "DENY_INITIATIVE" };
      }
      return { allowed: true };
    }
    if (event.type === "INITIATIVE_SET") {
      if (snapshot.mode !== "COMBAT") return { allowed: false, code: "DENY_INITIATIVE" };
      if (!snapshot.combat?.active) return { allowed: false, code: "DENY_INITIATIVE" };
      if (!this.aiEntityWhitelist) return { allowed: true };
      const aiIds = Array.from(this.aiEntityWhitelist).filter((id) => snapshot.entities?.[id]);
      if (aiIds.length === 0) return { allowed: true };
      const entries = Array.isArray((event.payload as any)?.entries) ? (event.payload as any).entries : [];
      const entryIds = new Set(entries.map((e: any) => e?.entityId).filter(Boolean));
      for (const id of aiIds) {
        if (!entryIds.has(id)) return { allowed: false, code: "DENY_INITIATIVE" };
      }
      return { allowed: true };
    }

    // Only gate what the Rule Engine currently supports.
    // Everything else remains allowed to keep SSS existing tests/flows stable.
    if (!this.isGatedEvent(event)) {
      return { allowed: true };
    }

    const reSnapshot = this.mapSnapshot(snapshot);

    const reEvent = this.mapEvent(snapshot, event);
    if (!reEvent) {
      // If we intended to gate this event but cannot map it safely, deny (fail-closed for gated events).
      return {
        allowed: false,
        code: ReasonCode.UNKNOWN_EVENT,
        message: `Gated event "${event.type}" could not be mapped to RE contract event.`,
      };
    }

    const decision = this.engine.evaluate(reSnapshot, reEvent);

    if (decision.allowed) return { allowed: true };

    // Map contract denial -> SSS gateway denial
    return {
      allowed: false,
      code: decision.code,
      message: this.formatMessage(decision.code, decision.details),
    };
  }

  private isGatedEvent(event: DomainEvent): boolean {
    // MVP gating (extend over time):
    return (
      event.type === "TURN_ENDED" ||
      event.type === "ADVANCE_TURN" ||
      event.type === "ACTION_PROPOSED"
    );
  }

  private mapSnapshot(sss: Snapshot): ReSnapshot {
    const initiativeSet =
      Array.isArray(sss.combat?.initiative) && sss.combat.initiative.length > 0;
    return {
      mode: this.mapMode(sss.mode),
      combat: {
        active: Boolean(sss.combat?.active),
        phase: this.mapPhase(sss.combat?.phase, initiativeSet),
        activeEntityId: sss.combat?.active_entity ?? undefined,
        initiativeSet,
        turnActionsUsed: sss.combat?.turn_actions_used ?? 0,
      },
      entities: this.mapEntities(sss),
    };
  }

  private mapMode(mode: Mode): "COMBAT" | "SCENE" {
    // SSS uses "EXPLORATION"; RE contract uses "SCENE"
    return mode === "COMBAT" ? "COMBAT" : "SCENE";
  }

  private mapPhase(
    phase: Snapshot["combat"]["phase"],
    initiativeSet: boolean
  ): "INIT" | "ACTION" | "END" {
    // SSS: "START" | "ACTION" | "END"
    // RE:  "INIT"  | "ACTION" | "END"
    if (phase === "START") return initiativeSet ? "ACTION" : "INIT";
    if (phase === "ACTION") return "ACTION";
    return "END";
  }

  private mapEntities(sss: Snapshot): ReSnapshot["entities"] {
    const out: ReSnapshot["entities"] = {};

    for (const [id, e] of Object.entries(sss.entities ?? {})) {
      out[id] = {
        id,
        alive: (e.hp ?? 0) > 0,

        position: e.position,
      };
    }

    return out;
  }

  private mapEvent(snapshot: Snapshot, event: DomainEvent): ReEvent | null {
    switch (event.type) {
      case "TURN_ENDED": {
        // SSS has payload: { entity_id }
        return {
          type: "TURN_ENDED",
          actorEntityId: event.payload.entity_id,
        };
      }

      case "ADVANCE_TURN": {
        const actor = event.payload.actorEntityId;

        if (!actor) {
          return null;
        }

        return {
          type: "ADVANCE_TURN",
          actorEntityId: actor,
        };
      }

      case "ACTION_PROPOSED": {
        const p = event.payload as any;
        if (!p?.actorEntityId) return null;

        return {
          type: "ACTION_PROPOSED",
          actorEntityId: p.actorEntityId,
          payload: {
            actionType: p.actionType,
            destination: p.destination,
            targetEntityId: p.targetEntityId,
          },
        };
      }

      default:
        return null;
    }
  }

  private formatMessage(code: string, details?: Record<string, unknown>): string | undefined {
    // Keep this very lightweight: UI/i18n messaging should live elsewhere.
    // This is just a helper so tests / logs are readable.
    if (!details) return undefined;

    // Example: add small human hints (optional)
    if (code === ReasonCode.WRONG_PHASE && typeof details["expectedPhase"] === "string") {
      return `Wrong phase. Expected: ${details["expectedPhase"]}`;
    }

    return undefined;
  }
}
