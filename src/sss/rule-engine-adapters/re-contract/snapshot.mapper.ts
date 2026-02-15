import type { Snapshot, Mode } from "../../domain/types";
import type { ReSnapshot } from "../../rule-engine/reContract";

/**
 * Snapshot SSS minimale richiesto dal Rule Engine.
 * NON aggiungere campi non necessari alle regole.
 */
export type SssSnapshot = Snapshot;

/**
 * Mapping verso lo snapshot atteso dal Rule Engine (RE contract v0.19.1).
 */
export function mapSnapshot(snapshot: SssSnapshot): ReSnapshot {
  const initiativeSet =
    Array.isArray(snapshot.combat?.initiative) &&
    snapshot.combat.initiative.length > 0;
  return {
    mode: mapMode(snapshot.mode),
    combat: {
      active: Boolean(snapshot.combat?.active),
      phase: mapPhase(snapshot.combat?.phase, initiativeSet),
      activeEntityId: snapshot.combat?.active_entity ?? undefined,
      initiativeSet,
      turnActionsUsed: snapshot.combat?.turn_actions_used,
      actionUsed:
        snapshot.combat?.action_used ??
        ((snapshot.combat?.turn_actions_used ?? 0) >= 1),
      movementRemaining: snapshot.combat?.movement_remaining ?? 6,
    },
    entities: mapEntities(snapshot),
  };
}

function mapMode(mode: Mode): "COMBAT" | "SCENE" {
  return mode === "COMBAT" ? "COMBAT" : "SCENE";
}

function mapPhase(
  phase: Snapshot["combat"]["phase"],
  initiativeSet: boolean
): "INIT" | "ACTION_WINDOW" | "END" {
  if (phase === "START") return initiativeSet ? "ACTION_WINDOW" : "INIT";
  if (phase === "ACTION" || phase === "ACTION_WINDOW") return "ACTION_WINDOW";
  return "END";
}

function mapEntities(sss: Snapshot): ReSnapshot["entities"] {
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
