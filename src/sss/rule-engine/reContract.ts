/**
 * RE Contract — v0.19.1 (FROZEN MVP)
 * Scope: allow Dev1 (SSS) + Dev2 (Rule Engine) to work in parallel with a stable boundary.
 *
 * GOLD RULES (contractual):
 * - Rule Engine is PURE + DETERMINISTIC + SIDE-EFFECT FREE.
 * - Rule Engine does NOT know: DB, stream versions, expectedVersion, RNG, persistence, resolvers.
 * - Rule Engine ONLY evaluates: minimal snapshot + candidate intention event.
 *
 * Semver policy:
 * - Additive optional fields = non-breaking.
 * - Any rename/remove/behavioral change of required fields = breaking (bump minor).
 */

/** =========================
 *  Core API
 *  ========================= */

export interface RuleEngine {
  evaluate(snapshot: ReSnapshot, event: ReEvent): ReDecision;
}

/** =========================
 *  Decision + Reason codes
 *  ========================= */

export type ReDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: ReasonCode;
      /**
       * Optional, non-breaking, future-proof.
       * Intended for UI/AI explanations (e.g. {"expectedPhase":"ACTION"}).
       */
      details?: Record<string, unknown>;
    };

export enum ReasonCode {
  COMBAT_NOT_ACTIVE = "COMBAT_NOT_ACTIVE",
  INITIATIVE_NOT_SET = "INITIATIVE_NOT_SET",
  WRONG_PHASE = "WRONG_PHASE",
  NOT_YOUR_TURN = "NOT_YOUR_TURN",
  ACTIONS_EXHAUSTED = "ACTIONS_EXHAUSTED",
  ACTOR_DEAD = "ACTOR_DEAD",
  INVALID_MOVE = "INVALID_MOVE",
  TARGET_NOT_ADJACENT = "TARGET_NOT_ADJACENT",
  UNKNOWN_EVENT = "UNKNOWN_EVENT",
}

/** =========================
 *  Snapshot (minimal)
 *  ========================= */

export type ReMode = "COMBAT" | "SCENE";
export type RePhase = "INIT" | "ACTION" | "END";

export interface ReSnapshot {
  /** High-level mode switch. */
  mode: ReMode;

  /** Present when mode === "COMBAT". Optional to keep mapping flexible. */
  combat?: {
    active: boolean;
    phase: RePhase;

    /** Entity currently acting (turn owner). */
    activeEntityId?: string;

    /** True only after initiative order has been set. */
    initiativeSet: boolean;

    /** Actions used by the active entity in the current turn. */
    turnActionsUsed?: number;
  };

  /**
   * Minimal entity facts needed for MVP legality checks (turn owner, move, melee adjacency).
   * IMPORTANT: This is NOT a character sheet.
   */
  entities: Record<string, ReEntity>;
}

export interface ReEntity {
  id: string;
  alive: boolean;

  /**
   * Optional for SCENE mode (or if your MVP does not require spatial checks).
   * Used for MOVE validity + melee adjacency for ATTACK.
   */
  position?: RePoint;
}

export interface RePoint {
  x: number;
  y: number;
}

/** =========================
 *  Events (intentions)
 *  ========================= */

export type ReEventType = "TURN_ENDED" | "ADVANCE_TURN" | "ACTION_PROPOSED";

export interface ReEventBase {
  type: ReEventType;

  /** The entity attempting the action (the "actor"). */
  actorEntityId: string;
}

/**
 * TURN_ENDED / ADVANCE_TURN remain explicit events because they are key to combat legality.
 * ACTION_PROPOSED is the generic "intention" in both COMBAT and SCENE.
 */
export type ReEvent =
  | ReTurnEnded
  | ReAdvanceTurn
  | ReActionProposed;

export interface ReTurnEnded extends ReEventBase {
  type: "TURN_ENDED";
}

export interface ReAdvanceTurn extends ReEventBase {
  type: "ADVANCE_TURN";
}

export interface ReActionProposed extends ReEventBase {
  type: "ACTION_PROPOSED";
  payload: ActionProposedPayload;
}

/** =========================
 *  ACTION_PROPOSED payload (MVP)
 *  ========================= */

export type ActionType = "MOVE" | "ATTACK";

export interface ActionProposedPayload {
  actionType: ActionType;

  /** MOVE */
  destination?: RePoint;

  /** ATTACK (melee MVP) */
  targetEntityId?: string;
}

/** =========================
 *  Optional helper utilities (non-contractual)
 *  Keep these if you want shared logic in both repos; safe to delete if undesired.
 *  ========================= */

/** Manhattan adjacency (4-dir). Use Chebyshev if you decide diagonal adjacency later (breaking behavioral change in rules, not in contract). */
export function isAdjacent(a: RePoint, b: RePoint): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx + dy === 1;
}

/** Defensive getters (useful in adapter + rules). */
export function getEntity(snapshot: ReSnapshot, entityId: string): ReEntity | undefined {
  return snapshot.entities[entityId];
}
