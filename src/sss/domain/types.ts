export type SessionId = string;

export type RulesetId = string;

export type Mode = "COMBAT" | "EXPLORATION";

export type EntityId = string;
export type ZoneId = string;
export const DEFAULT_FACTION = "neutral";
export interface Point {
  x: number;
  y: number;
}

export interface SnapshotMeta {
  session_id: SessionId;
  version: number;      // last applied event version
  ruleset: RulesetId;
  created_at: string;   // ISO
}

export interface CombatState {
  /**
   * True when an encounter is actively running.
   * NOTE: we also set this to true when mode becomes COMBAT (legacy compatibility).
   */
  active: boolean;

  round: number;

  initiative: EntityId[];      // ordered list
  initiative_entries?: InitiativeEntry[];

  /**
   * Cursor index inside initiative order.
   * This makes ADVANCE_TURN deterministic without relying on indexOf(active_entity).
   */
  cursor: number;

  active_entity: EntityId | null;

  phase: "START" | "ACTION" | "END";

  /**
   * Number of actions used by the active entity in the current turn.
   */
  turn_actions_used: number;
}

export interface MapState {
  zones: Record<ZoneId, { id: ZoneId; name: string }>;
  adjacency: Record<ZoneId, ZoneId[]>; // undirected edges stored as lists
}

export interface EntityState {
  id: EntityId;
  name: string;
  hp: number;
  zone: ZoneId | null;
  factionId?: string;
  position?: Point;
  ac?: number;
  level?: number;
  str?: number;
  dex?: number;
  con?: number;
  int?: number;
  wis?: number;
  cha?: number;
  proficient?: boolean;
  attack_ability?: "STR" | "DEX";
  weapon_damage?: { count: number; sides: number };
  weapon_damage_type?: string;
}

export interface RngState {
  seed: number;
  cursor: number;
}

export interface Snapshot {
  meta: SnapshotMeta;
  mode: Mode;
  combat: CombatState;
  map: MapState;
  entities: Record<EntityId, EntityState>;
  rng: RngState;
}

// ---- Events ----

export type InitiativeTiebreak = "TOTAL" | "DEX" | "ENTITY_ID";

export interface InitiativeEntry {
  entityId: EntityId;
  total: number;
  dex_mod?: number;
  tiebreak?: InitiativeTiebreak;
  source: "AI_ROLL" | "HUMAN_DECLARED";
}

export interface InitiativeRollPayload {
  entityId: EntityId;
  roll: {
    sides: 20;
    count: 1;
    dice: number[];
    modifiers: number[];
    total: number;
  };
  rng_cursor_before: number;
  rng_cursor_after: number;
  context: "INITIATIVE";
}

export type EventType =
  | "SESSION_CREATED"
  | "RNG_SEEDED"
  | "ROLL_RESOLVED"
  | "MODE_SET"
  | "ZONE_ADDED"
  | "ZONE_LINKED"
  | "ENTITY_ADDED"
  | "ENTITY_MOVED_ZONE"
  | "APPLY_DAMAGE"
  | "DAMAGE_APPLIED"
  | "TURN_STARTED"
  | "TURN_ENDED"
  | "ADVANCE_TURN"
  // Combat core (Punto C)
  | "COMBAT_STARTED"
  | "INITIATIVE_ROLLED"
  | "INITIATIVE_SET"
  | "COMBAT_ENDED"
  | "ACTION_PROPOSED"
  | "ACTION_RESOLVED";

export interface BaseEvent<T extends EventType, P> {
  type: T;
  payload: P;

  /**
   * Stream version (0..N).
   * Optional: quando l’evento nasce lato client non è ancora persistito.
   * Deve essere popolato dal repository quando legge da storage (DB o in-memory).
   */
  version?: number;
}


export type DomainEvent =
  | BaseEvent<"SESSION_CREATED", { ruleset: RulesetId }>
  | BaseEvent<"RNG_SEEDED", { seed: number }>
  | BaseEvent<
      "ROLL_RESOLVED",
      {
        roll_id: string;
        context: string;
        actor_id?: EntityId | null;
        target_id?: EntityId | null;
        sides: number;
        count: number;
        dice: number[];
        modifiers: number[];
        total: number;
        rng_cursor_before: number;
        rng_cursor_after: number;
      }
    >
  | BaseEvent<"MODE_SET", { mode: Mode }>
  | BaseEvent<"ZONE_ADDED", { zone_id: ZoneId; name: string }>
  | BaseEvent<"ZONE_LINKED", { a: ZoneId; b: ZoneId }>
  | BaseEvent<
      "ENTITY_ADDED",
      {
        entity_id: EntityId;
        name: string;
        hp: number;
        zone: ZoneId | null;
        factionId?: string;
        position?: Point;
        ac?: number;
        level?: number;
        str?: number;
        dex?: number;
        con?: number;
        int?: number;
        wis?: number;
        cha?: number;
        proficient?: boolean;
        attack_ability?: "STR" | "DEX";
        weapon_damage?: { count: number; sides: number };
        weapon_damage_type?: string;
      }
    >
  | BaseEvent<"ENTITY_MOVED_ZONE", { entity_id: EntityId; to_zone: ZoneId }>
  | BaseEvent<"APPLY_DAMAGE", { entity_id: EntityId; amount: number }>
  | BaseEvent<"DAMAGE_APPLIED", { entity_id: EntityId; amount: number }>
  | BaseEvent<"TURN_STARTED", { entityId: EntityId; round?: number }>
  | BaseEvent<
      "TURN_ENDED",
      { entity_id: EntityId; reason?: string; round?: number; cursor?: number }
    >
  | BaseEvent<"ADVANCE_TURN", { actorEntityId: EntityId; reason?: string }>
  // Combat core (Punto C)
  | BaseEvent<"COMBAT_STARTED", { participant_ids: EntityId[] }>
  | BaseEvent<"INITIATIVE_ROLLED", InitiativeRollPayload>
  | BaseEvent<"INITIATIVE_SET", { entries: InitiativeEntry[]; order: EntityId[] }>
  | BaseEvent<"COMBAT_ENDED", {}>
  | ActionProposedEvent
  | ActionResolvedEvent;

export type ActionType = "MOVE" | "ATTACK" | "ROLL_INITIATIVE";

export type ActionOutcome =
  | { type: "MOVE_APPLIED"; entityId: EntityId; to: Point }
  | { type: "DAMAGE_APPLIED"; entityId: EntityId; amount: number };

export type ActionProposedEvent = BaseEvent<
  "ACTION_PROPOSED",
  {
    actorEntityId: EntityId;
    actionType: ActionType;
    destination?: Point;
    targetEntityId?: EntityId;
  }
>;

export type ActionResolvedEvent = BaseEvent<
  "ACTION_RESOLVED",
  {
    proposedEventVersion?: number;
    actorEntityId: EntityId;
    actionType: ActionType;
    outcomes: ActionOutcome[];
    summary?: { hit?: boolean; damage_total?: number; targetEntityId?: string };
  }
>;

export interface PersistedEvent {
  session_id: SessionId;
  version: number;          // 1..N
  event_type: EventType;
  event_payload: unknown;   // JSON
  created_at: string;       // ISO
}
