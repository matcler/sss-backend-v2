import type { DomainEvent } from "../../domain/types";
import type { ReEvent } from "../../rule-engine/reContract";

/**
 * Evento candidato lato SSS.
 */
export type SssEvent = DomainEvent;

/**
 * Mapping verso evento Rule Engine (RE contract v0.19.1).
 */
export function mapEvent(event: SssEvent): ReEvent | null {
  switch (event.type) {
    case "TURN_ENDED": {
      const actor = event.payload.entity_id;
      if (!actor) return null;
      return {
        type: "TURN_ENDED",
        actorEntityId: actor,
      };
    }

    case "ADVANCE_TURN": {
      const actor = (event.payload as any).actorEntityId ?? (event.payload as any).entity_id;
      if (!actor) return null;
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
