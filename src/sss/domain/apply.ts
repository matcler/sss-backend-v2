import { Snapshot, DomainEvent, ZoneId, EntityId } from "./types";

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function linkAdj(adjacency: Record<ZoneId, ZoneId[]>, a: ZoneId, b: ZoneId) {
  adjacency[a] = uniq([...(adjacency[a] ?? []), b]);
  adjacency[b] = uniq([...(adjacency[b] ?? []), a]);
}

function manhattan(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
}

function normalizePhase(phase: Snapshot["combat"]["phase"]): Snapshot["combat"]["phase"] {
  return phase === "ACTION" ? "ACTION_WINDOW" : phase;
}

export function applyEvent(snapshot: Snapshot, event: DomainEvent): Snapshot {
  // Clone shallow (we mutate in place after structuredClone fallback)
const sc = (globalThis as any).structuredClone as undefined | (<T>(v: T) => T);

const next: Snapshot =
  typeof sc === "function"
    ? sc(snapshot)
    : JSON.parse(JSON.stringify(snapshot));


  switch (event.type) {
    case "SESSION_CREATED": {
      next.meta.ruleset = event.payload.ruleset;
     setMetaVersion(next, event);
      return next;
    }

    case "RNG_SEEDED": {
      next.rng.seed = event.payload.seed;
      next.rng.cursor = 0;
      setMetaVersion(next, event);
      return next;
    }

    case "ROLL_RESOLVED": {
      next.rng.cursor = event.payload.rng_cursor_after;
      setMetaVersion(next, event);
      return next;
    }

    case "MODE_SET": {
  next.mode = event.payload.mode;
  setMetaVersion(next, event);
  return next;
}


    case "ZONE_ADDED": {
      const { zone_id, name } = event.payload;
      next.map.zones[zone_id] = { id: zone_id, name };
      if (!next.map.adjacency[zone_id]) next.map.adjacency[zone_id] = [];
     setMetaVersion(next, event);
      return next;
    }

    case "ZONE_LINKED": {
      const { a, b } = event.payload;
      linkAdj(next.map.adjacency, a, b);
     setMetaVersion(next, event);
      return next;
    }

    case "ENTITY_ADDED": {
      const {
        entity_id,
        name,
        hp,
        zone,
        factionId,
        position,
        ac,
        level,
        str,
        dex,
        con,
        int,
        wis,
        cha,
        proficient,
        attack_ability,
        weapon_damage,
        weapon_damage_type,
      } = event.payload;

      next.entities[entity_id] = {
        id: entity_id,
        name,
        hp,
        zone,
        factionId,
        position,
        ac,
        level: level ?? 1,
        str: str ?? 10,
        dex: dex ?? 10,
        con: con ?? 10,
        int: int ?? 10,
        wis: wis ?? 10,
        cha: cha ?? 10,
        proficient: proficient ?? false,
        attack_ability: attack_ability ?? "STR",
        weapon_damage: weapon_damage ?? { count: 1, sides: 4 },
        weapon_damage_type: weapon_damage_type ?? "physical",
      };
      // MVP legacy behavior: auto-add to initiative if in COMBAT
      if (next.mode === "COMBAT") {
        next.combat.initiative = uniq([...next.combat.initiative, entity_id]);
        if (!next.combat.active_entity) {
          next.combat.cursor = 0;
          next.combat.active_entity = next.combat.initiative[0] ?? null;
        }
      }
     setMetaVersion(next, event);
      return next;
    }

    case "ENTITY_MOVED_ZONE": {
      const { entity_id, to_zone } = event.payload;
      next.entities[entity_id].zone = to_zone;
      setMetaVersion(next, event);
      return next;
    }

    case "APPLY_DAMAGE": {
      const { entity_id, amount } = event.payload;
      next.entities[entity_id].hp = next.entities[entity_id].hp - amount;
      setMetaVersion(next, event);
      return next;
    }

    case "DAMAGE_APPLIED": {
      const { entity_id, amount } = event.payload;
      const ent = next.entities[entity_id];
      ent.hp = Math.max(0, ent.hp - amount);
      setMetaVersion(next, event);
      return next;
    }

    case "ACTION_PROPOSED": {
      // No-op: proposed actions do not mutate state.
      setMetaVersion(next, event);
      return next;
    }

    case "ACTION_RESOLVED": {
      const actorBefore = next.entities[event.payload.actorEntityId];
      const actorPosBefore = actorBefore?.position;
      next.combat.phase = normalizePhase(next.combat.phase);

      for (const outcome of event.payload.outcomes) {
        switch (outcome.type) {
          case "MOVE_APPLIED": {
            const from =
              outcome.entityId === event.payload.actorEntityId
                ? actorPosBefore
                : next.entities[outcome.entityId].position;
            if (from) {
              const cost = manhattan(from, outcome.to);
              if (cost > 0) {
                next.combat.movement_remaining = Math.max(
                  0,
                  (next.combat.movement_remaining ?? 6) - cost
                );
              }
            }
            next.entities[outcome.entityId].position = outcome.to;
            break;
          }
          case "DAMAGE_APPLIED": {
            const ent = next.entities[outcome.entityId];
            ent.hp = Math.max(0, ent.hp - outcome.amount);
            break;
          }
          default: {
            const _exhaustive: never = outcome;
            return _exhaustive;
          }
        }
      }
      if (next.mode === "COMBAT" && next.combat.active === true) {
        if (event.payload.actionType === "ATTACK") {
          next.combat.action_used = true;
          next.combat.turn_actions_used = 1;
          next.combat.phase = "ACTION_WINDOW";
        } else if (event.payload.actionType === "PASS") {
          next.combat.action_used = true;
          next.combat.turn_actions_used = 1;
          next.combat.phase = "END";
        } else if (event.payload.actionType === "MOVE") {
          next.combat.phase = "ACTION_WINDOW";
        }
      }
      setMetaVersion(next, event);
      return next;
    }

    case "TURN_ENDED": {
      // minimal: move to END phase
      next.combat.phase = "END";
      setMetaVersion(next, event);
      return next;
    }

    case "TURN_STARTED": {
      const entityId = (event.payload as any)?.entityId ?? (event.payload as any)?.entity_id;
      const round = (event.payload as any)?.round;
      next.combat.active_entity = entityId ?? null;
      const idx = entityId ? next.combat.initiative.indexOf(entityId) : -1;
      if (idx >= 0) {
        next.combat.cursor = idx;
      }
      if (typeof round === "number") {
        next.combat.round = round;
      }
      next.combat.phase = "ACTION_WINDOW";
      next.combat.action_used = false;
      next.combat.movement_remaining = 6;
      next.combat.turn_actions_used = 0;
      setMetaVersion(next, event);
      return next;
    }

    case "ADVANCE_TURN": {
      setMetaVersion(next, event);
      return next;
    }

    // ---- Combat core (Punto C) ----

    case "COMBAT_STARTED": {
      // Do not force mode change (keep explicit if you want MODE_SET).
      next.combat.active = true;
      next.combat.round = 1;
      next.combat.initiative = [];
      next.combat.cursor = 0;
      next.combat.active_entity = null;
      next.combat.phase = "START";
      next.combat.action_used = false;
      next.combat.movement_remaining = 6;
      next.combat.turn_actions_used = 0;
      setMetaVersion(next, event);
      return next;
    }

    case "INITIATIVE_ROLLED": {
      next.rng.cursor = event.payload.rng_cursor_after;
      setMetaVersion(next, event);
      return next;
    }

    case "INITIATIVE_SET": {
      const entries = Array.isArray(event.payload.entries) ? event.payload.entries : [];
      const legacyOrder = event.payload.order ?? [];

      if (entries.length === 0) {
        // Legacy INITIATIVE_SET payloads carried only "order".
        next.combat.initiative = legacyOrder;
        next.combat.cursor = 0;
        next.combat.active_entity = legacyOrder[0] ?? null;
        next.combat.phase = "START";
        next.combat.active = true;
        next.combat.action_used = false;
        next.combat.movement_remaining = 6;
        next.combat.turn_actions_used = 0;
        setMetaVersion(next, event);
        return next;
      }

      const eligible = entries
        .map((e) => {
          const ent = next.entities[e.entityId];
          if (!ent) return null;
          if ((ent.hp ?? 0) <= 0) return null;
          const dex_mod = Number.isFinite(e.dex_mod) ? e.dex_mod : abilityMod(ent.dex ?? 10);
          return { ...e, dex_mod };
        })
        .filter((e): e is NonNullable<typeof e> => Boolean(e));

      eligible.sort((a, b) => {
        if (a.total !== b.total) return b.total - a.total;
        const aDex = a.dex_mod ?? 0;
        const bDex = b.dex_mod ?? 0;
        if (aDex !== bDex) return bDex - aDex;
        if (a.entityId < b.entityId) return -1;
        if (a.entityId > b.entityId) return 1;
        return 0;
      });

      const withTiebreak = eligible.map((e, i) => {
        if (i === 0) return { ...e, tiebreak: "TOTAL" as const };
        const prev = eligible[i - 1];
        if (e.total !== prev.total) return { ...e, tiebreak: "TOTAL" as const };
        const eDex = e.dex_mod ?? 0;
        const pDex = prev.dex_mod ?? 0;
        if (eDex !== pDex) return { ...e, tiebreak: "DEX" as const };
        return { ...e, tiebreak: "ENTITY_ID" as const };
      });

      const order = withTiebreak.map((e) => e.entityId);
      next.combat.initiative = order;
      next.combat.initiative_entries = withTiebreak;
      next.combat.cursor = 0;
      next.combat.active_entity = order[0] ?? null;
      next.combat.phase = "START";
      next.combat.active = true;
      next.combat.action_used = false;
      next.combat.movement_remaining = 6;
      next.combat.turn_actions_used = 0;
      setMetaVersion(next, event);
      return next;
    }

    case "COMBAT_ENDED": {
      next.combat.active = false;
      next.combat.initiative = [];
      next.combat.cursor = 0;
      next.combat.active_entity = null;
      next.combat.phase = "END";
      next.combat.action_used = false;
      next.combat.movement_remaining = 0;
      next.combat.turn_actions_used = 0;
      setMetaVersion(next, event);
      return next;
    }

    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// ===== helpers =====

function setMetaVersion(next: Snapshot, event: DomainEvent) {
  if (typeof event.version === "number") {
    next.meta.version = event.version;
  }
}
