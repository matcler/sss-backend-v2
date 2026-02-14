import type { Snapshot, DomainEvent } from "./types";

export function makeInitialSnapshot(
  session_id: string,
  ruleset: string = "default"
): Snapshot {
  const now = new Date().toISOString();
  return {
    meta: {
      session_id,
      version: 0,
      ruleset,
      created_at: now,
    },
    mode: "EXPLORATION",
    combat: {
      active: false,
      round: 0,
      initiative: [],
      initiative_entries: [],
      cursor: 0,
      active_entity: null,
      phase: "START",
      turn_actions_used: 0,
    },
    map: {
      zones: {},
      adjacency: {},
    },
    entities: {},
    rng: {
      seed: 0,
      cursor: 0,
    },
  };
}
export const DEFAULT_SNAPSHOT_KEY_EVENTS: ReadonlyArray<DomainEvent["type"]> = [
  "COMBAT_ENDED",
];

export function shouldTakeSnapshot(
  version: number,
  every: number,
  lastEventType?: DomainEvent["type"],
  keyEvents: ReadonlyArray<DomainEvent["type"]> = DEFAULT_SNAPSHOT_KEY_EVENTS
): boolean {
  const v = Number(version);
  const n = Number(every);

  if (!Number.isFinite(v) || !Number.isFinite(n)) return false;
  if (v <= 0) return false;

  const periodic = n > 0 && v % n === 0;
  const eventDriven =
    lastEventType != null && Array.isArray(keyEvents) && keyEvents.includes(lastEventType);

  return periodic || eventDriven;
}
