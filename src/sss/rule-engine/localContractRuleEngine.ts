import {
  getEntity,
  isAdjacent,
  ReasonCode,
  ReDecision,
  ReEvent,
  ReSnapshot,
  RuleEngine,
} from "./reContract";

export function evaluate(snapshot: ReSnapshot, event: ReEvent): ReDecision {
  if (
    event.type !== "TURN_ENDED" &&
    event.type !== "ADVANCE_TURN" &&
    event.type !== "ACTION_PROPOSED"
  ) {
    return { allowed: false, code: ReasonCode.UNKNOWN_EVENT };
  }

  if (snapshot.mode !== "COMBAT") return { allowed: true };
  if (!snapshot.combat || snapshot.combat.active === false) {
    return { allowed: false, code: ReasonCode.COMBAT_NOT_ACTIVE };
  }
  if (snapshot.combat.initiativeSet === false) {
    return { allowed: false, code: ReasonCode.INITIATIVE_NOT_SET };
  }

  const actor = getEntity(snapshot, event.actorEntityId);
  if (!actor || !actor.alive) {
    return { allowed: false, code: ReasonCode.ACTOR_DEAD };
  }

  if (
    snapshot.combat.activeEntityId &&
    snapshot.combat.activeEntityId !== event.actorEntityId
  ) {
    return { allowed: false, code: ReasonCode.NOT_YOUR_TURN };
  }

  if (event.type === "ADVANCE_TURN" || event.type === "TURN_ENDED") {
    const phase =
      snapshot.combat.phase === "ACTION" ? "ACTION_WINDOW" : snapshot.combat.phase;
    const actionUsed =
      snapshot.combat.actionUsed ??
      ((snapshot.combat.turnActionsUsed ?? 0) >= 1);
    if (!(phase === "END" || (phase === "ACTION_WINDOW" && actionUsed === true))) {
      return {
        allowed: false,
        code: ReasonCode.WRONG_PHASE,
        details: {
          expected: "END or ACTION_WINDOW with actionUsed=true",
          actualPhase: snapshot.combat.phase,
          actionUsed,
        },
      };
    }
    return { allowed: true };
  }

  const phase =
    snapshot.combat.phase === "ACTION" ? "ACTION_WINDOW" : snapshot.combat.phase;
  if (phase !== "ACTION_WINDOW") {
    return {
      allowed: false,
      code: ReasonCode.WRONG_PHASE,
      details: { expectedPhase: "ACTION_WINDOW", actualPhase: snapshot.combat.phase },
    };
  }

  const actionUsed =
    snapshot.combat.actionUsed ??
    ((snapshot.combat.turnActionsUsed ?? 0) >= 1);
  const movementRemaining = snapshot.combat.movementRemaining ?? 6;

  if (event.payload.actionType === "PASS") {
    if (actionUsed) return { allowed: false, code: ReasonCode.ACTIONS_EXHAUSTED };
    return { allowed: true };
  }

  if (event.payload.actionType === "MOVE") {
    if (!actor.position || !event.payload.destination) {
      return { allowed: false, code: ReasonCode.INVALID_MOVE };
    }
    const cost =
      Math.abs(actor.position.x - event.payload.destination.x) +
      Math.abs(actor.position.y - event.payload.destination.y);
    if (cost < 1) {
      return { allowed: false, code: ReasonCode.INVALID_MOVE };
    }
    if (cost > movementRemaining) {
      return {
        allowed: false,
        code: ReasonCode.MOVEMENT_EXHAUSTED,
        details: { movementRemaining, cost },
      };
    }
    return { allowed: true };
  }

  if (event.payload.actionType === "ATTACK") {
    if (actionUsed) return { allowed: false, code: ReasonCode.ACTIONS_EXHAUSTED };
    const targetId = event.payload.targetEntityId;
    if (!targetId) {
      return { allowed: false, code: ReasonCode.INVALID_MOVE };
    }
    const target = getEntity(snapshot, targetId);
    if (!target || !target.alive || !actor.position || !target.position) {
      return { allowed: false, code: ReasonCode.INVALID_MOVE };
    }
    if (!isAdjacent(actor.position, target.position)) {
      return {
        allowed: false,
        code: ReasonCode.TARGET_NOT_ADJACENT,
        details: { actorEntityId: event.actorEntityId, targetEntityId: targetId },
      };
    }
    return { allowed: true };
  }

  return { allowed: false, code: ReasonCode.UNKNOWN_EVENT };
}

export const ruleEngine: RuleEngine = { evaluate };
