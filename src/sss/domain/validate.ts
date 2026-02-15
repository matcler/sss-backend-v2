import { Snapshot, DomainEvent } from "./types";
import { ValidationError } from "./errors";

export function validateEvent(snapshot: Snapshot, event: DomainEvent): void {
  switch (event.type) {
    case "SESSION_CREATED": {
      if (snapshot.meta.version !== 0) throw new ValidationError("SESSION_CREATED only allowed on version 0");
      if (!event.payload.ruleset) throw new ValidationError("ruleset is required");
      return;
    }

    case "RNG_SEEDED": {
      const { seed } = event.payload;
      if (!Number.isFinite(seed)) throw new ValidationError("seed must be a finite number");
      return;
    }

    case "ROLL_RESOLVED": {
      const {
        roll_id,
        context,
        actor_id,
        target_id,
        sides,
        count,
        dice,
        modifiers,
        total,
        rng_cursor_before,
        rng_cursor_after,
      } = event.payload;

      if (!roll_id) throw new ValidationError("roll_id is required");
      if (!context) throw new ValidationError("context is required");
      if (actor_id != null && !snapshot.entities[actor_id]) {
        throw new ValidationError(`actor not found: ${actor_id}`);
      }
      if (target_id != null && !snapshot.entities[target_id]) {
        throw new ValidationError(`target not found: ${target_id}`);
      }
      if (!Number.isFinite(sides) || sides < 2) throw new ValidationError("sides must be >= 2");
      if (!Number.isFinite(count) || count <= 0) throw new ValidationError("count must be > 0");
      if (!Array.isArray(dice) || dice.length !== count) {
        throw new ValidationError("dice must be an array with length equal to count");
      }
      for (const d of dice) {
        if (!Number.isFinite(d) || d < 1 || d > sides) {
          throw new ValidationError("dice values must be within 1..sides");
        }
      }
      if (!Array.isArray(modifiers)) throw new ValidationError("modifiers must be an array");
      for (const m of modifiers) {
        if (!Number.isFinite(m)) throw new ValidationError("modifiers must be finite numbers");
      }
      if (!Number.isFinite(total)) throw new ValidationError("total must be a finite number");
      const modsSum = modifiers.reduce((acc, v) => acc + v, 0);
      const diceSum = dice.reduce((acc, v) => acc + v, 0);
      if (total !== diceSum + modsSum) {
        throw new ValidationError("total must equal sum(dice) + sum(modifiers)");
      }
      if (!Number.isFinite(rng_cursor_before) || rng_cursor_before < 0) {
        throw new ValidationError("rng_cursor_before must be >= 0");
      }
      if (!Number.isFinite(rng_cursor_after) || rng_cursor_after < 0) {
        throw new ValidationError("rng_cursor_after must be >= 0");
      }
      if (snapshot.rng.cursor !== rng_cursor_before) {
        throw new ValidationError("rng_cursor_before must match snapshot rng.cursor");
      }
      if (rng_cursor_after !== rng_cursor_before + count) {
        throw new ValidationError("rng_cursor_after must equal rng_cursor_before + count");
      }
      return;
    }

    case "MODE_SET": {
      if (!event.payload.mode) throw new ValidationError("mode is required");
      return;
    }

    case "ZONE_ADDED": {
      const { zone_id, name } = event.payload;
      if (!zone_id) throw new ValidationError("zone_id is required");
      if (!name) throw new ValidationError("name is required");
      if (snapshot.map.zones[zone_id]) throw new ValidationError(`zone already exists: ${zone_id}`);
      return;
    }

    case "ZONE_LINKED": {
      const { a, b } = event.payload;
      if (!snapshot.map.zones[a]) throw new ValidationError(`zone not found: ${a}`);
      if (!snapshot.map.zones[b]) throw new ValidationError(`zone not found: ${b}`);
      if (a === b) throw new ValidationError("cannot link zone to itself");
      return;
    }

    case "ENTITY_ADDED": {
      const { entity_id, name, hp, zone, position } = event.payload;
      if (!entity_id) throw new ValidationError("entity_id is required");
      if (!name) throw new ValidationError("name is required");
      if (!Number.isFinite(hp) || hp <= 0) throw new ValidationError("hp must be > 0");
      if (snapshot.entities[entity_id]) throw new ValidationError(`entity already exists: ${entity_id}`);
      if (zone !== null && !snapshot.map.zones[zone]) throw new ValidationError(`zone not found: ${zone}`);
      if (position) {
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
          throw new ValidationError("position must be finite numbers");
        }
      }
      return;
    }

    case "ENTITY_MOVED_ZONE": {
      const { entity_id, to_zone } = event.payload;
      if (!snapshot.entities[entity_id]) throw new ValidationError(`entity not found: ${entity_id}`);
      if (!snapshot.map.zones[to_zone]) throw new ValidationError(`zone not found: ${to_zone}`);
      return;
    }

    case "APPLY_DAMAGE": {
      const { entity_id, amount } = event.payload;
      const ent = snapshot.entities[entity_id];
      if (!ent) throw new ValidationError(`entity not found: ${entity_id}`);
      if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError("amount must be > 0");
      if (ent.hp - amount < 0) throw new ValidationError("damage would make hp negative (use clamp or different rule)");
      return;
    }

    case "DAMAGE_APPLIED": {
      const { entity_id, amount } = event.payload;
      const ent = snapshot.entities[entity_id];
      if (!ent) throw new ValidationError(`entity not found: ${entity_id}`);
      if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError("amount must be > 0");
      return;
    }

    case "TURN_STARTED": {
      const entityId = (event.payload as any)?.entityId ?? (event.payload as any)?.entity_id;
      const round = (event.payload as any)?.round;
      if (!snapshot.combat.active) throw new ValidationError("TURN_STARTED only allowed when combat is active");
      if (event.version == null && !entityId) throw new ValidationError("entityId is required");
      if (entityId != null && typeof entityId !== "string") {
        throw new ValidationError("entityId must be a string");
      }
      if (entityId && !snapshot.entities[entityId]) throw new ValidationError(`entity not found: ${entityId}`);
      if (round != null && !Number.isFinite(round)) {
        throw new ValidationError("round must be a finite number");
      }
      return;
    }

    case "ACTION_PROPOSED": {
      const { actorEntityId, actionType, destination, targetEntityId } = event.payload;
      if (!actorEntityId) throw new ValidationError("actorEntityId is required");
      if (!snapshot.entities[actorEntityId]) throw new ValidationError(`actor not found: ${actorEntityId}`);
      if (
        actionType !== "MOVE" &&
        actionType !== "ATTACK" &&
        actionType !== "PASS" &&
        actionType !== "ROLL_INITIATIVE"
      ) {
        throw new ValidationError("actionType must be MOVE, ATTACK, PASS, or ROLL_INITIATIVE");
      }
      if (actionType === "MOVE") {
        if (!destination) throw new ValidationError("destination is required for MOVE");
        if (!Number.isFinite(destination.x) || !Number.isFinite(destination.y)) {
          throw new ValidationError("destination must be finite numbers");
        }
      }
      if (actionType === "ATTACK") {
        if (!targetEntityId) throw new ValidationError("targetEntityId is required for ATTACK");
        if (!snapshot.entities[targetEntityId]) throw new ValidationError(`target not found: ${targetEntityId}`);
      }
      return;
    }

    case "ACTION_RESOLVED": {
      const { actorEntityId, actionType, outcomes } = event.payload;
      if (!actorEntityId) throw new ValidationError("actorEntityId is required");
      if (!snapshot.entities[actorEntityId]) throw new ValidationError(`actor not found: ${actorEntityId}`);
      if (
        actionType !== "MOVE" &&
        actionType !== "ATTACK" &&
        actionType !== "PASS" &&
        actionType !== "ROLL_INITIATIVE"
      ) {
        throw new ValidationError("actionType must be MOVE, ATTACK, PASS, or ROLL_INITIATIVE");
      }
      if (!Array.isArray(outcomes)) {
        throw new ValidationError("outcomes must be an array");
      }
      if (outcomes.length === 0 && actionType !== "ATTACK" && actionType !== "PASS") {
        throw new ValidationError("outcomes must be a non-empty array");
      }
      for (const o of outcomes) {
        if (!o || typeof o !== "object") throw new ValidationError("invalid outcome");
        if (o.type === "MOVE_APPLIED") {
          const ent = snapshot.entities[o.entityId];
          if (!ent) throw new ValidationError(`entity not found: ${o.entityId}`);
          if (!o.to || !Number.isFinite(o.to.x) || !Number.isFinite(o.to.y)) {
            throw new ValidationError("MOVE_APPLIED.to must be finite numbers");
          }
        } else if (o.type === "DAMAGE_APPLIED") {
          const ent = snapshot.entities[o.entityId];
          if (!ent) throw new ValidationError(`entity not found: ${o.entityId}`);
          if (!Number.isFinite(o.amount) || o.amount <= 0) {
            throw new ValidationError("DAMAGE_APPLIED.amount must be > 0");
          }
        } else {
          throw new ValidationError("unknown outcome type");
        }
      }
      return;
    }

    case "TURN_ENDED": {
  const { entity_id, round, cursor, reason } = event.payload;
  if (snapshot.mode !== "COMBAT") throw new ValidationError("TURN_ENDED only allowed in COMBAT");
  if (!snapshot.combat.active) throw new ValidationError("TURN_ENDED only allowed when combat is active");
  if (snapshot.combat.phase === "END") throw new ValidationError("TURN_ENDED not allowed when phase is END");
  if (snapshot.combat.active_entity !== entity_id) throw new ValidationError("only active_entity can end turn");
  if (round != null && !Number.isFinite(round)) throw new ValidationError("round must be a finite number");
  if (cursor != null && !Number.isFinite(cursor)) throw new ValidationError("cursor must be a finite number");
  if (reason != null && typeof reason !== "string") throw new ValidationError("reason must be a string");
  return;
}


    case "ADVANCE_TURN": {
  const actorEntityId = (event.payload as any)?.actorEntityId ?? (event.payload as any)?.entityId;
  if (snapshot.mode !== "COMBAT") throw new ValidationError("ADVANCE_TURN only allowed in COMBAT");
  if (!snapshot.combat.active) throw new ValidationError("ADVANCE_TURN only allowed when combat is active");
  if (snapshot.combat.initiative.length === 0) throw new ValidationError("initiative is empty");
  const phase = snapshot.combat.phase === "ACTION" ? "ACTION_WINDOW" : snapshot.combat.phase;
  const actionUsed =
    snapshot.combat.action_used ??
    ((snapshot.combat.turn_actions_used ?? 0) >= 1);
  if (event.version == null) {
    if (!(phase === "END" || (phase === "ACTION_WINDOW" && actionUsed === true))) {
      throw new ValidationError("ADVANCE_TURN denied: must be END or action_used=true");
    }
  }
  // Enforce explicit actor for new events (version undefined). Allow legacy events on replay.
  if (event.version == null && !actorEntityId) {
    throw new ValidationError("actorEntityId is required");
  }
  if (actorEntityId != null && typeof actorEntityId !== "string") {
    throw new ValidationError("actorEntityId must be a string");
  }
  if (actorEntityId && !snapshot.entities[actorEntityId]) {
    throw new ValidationError(`actor not found: ${actorEntityId}`);
  }
  return;
}


    // ---- Combat core (Punto C) ----

    case "COMBAT_STARTED": {
      const { participant_ids } = event.payload;
      if (snapshot.combat.active) throw new ValidationError("combat already active");
      if (!Array.isArray(participant_ids) || participant_ids.length === 0) {
        throw new ValidationError("participant_ids must be a non-empty array");
      }
      for (const id of participant_ids) {
        if (!snapshot.entities[id]) throw new ValidationError(`participant entity not found: ${id}`);
      }
      return;
    }

    case "INITIATIVE_ROLLED": {
      const {
        entityId,
        roll,
        rng_cursor_before,
        rng_cursor_after,
        context,
      } = event.payload;

      if (!snapshot.entities[entityId]) throw new ValidationError(`entity not found: ${entityId}`);
      if (!roll) throw new ValidationError("roll is required");
      if (roll.sides !== 20) throw new ValidationError("roll.sides must be 20");
      if (roll.count !== 1) throw new ValidationError("roll.count must be 1");
      if (!Array.isArray(roll.dice) || roll.dice.length !== roll.count) {
        throw new ValidationError("roll.dice must be an array with length equal to count");
      }
      for (const d of roll.dice) {
        if (!Number.isFinite(d) || d < 1 || d > roll.sides) {
          throw new ValidationError("roll.dice values must be within 1..sides");
        }
      }
      if (!Array.isArray(roll.modifiers)) throw new ValidationError("roll.modifiers must be an array");
      for (const m of roll.modifiers) {
        if (!Number.isFinite(m)) throw new ValidationError("roll.modifiers must be finite numbers");
      }
      if (!Number.isFinite(roll.total)) throw new ValidationError("roll.total must be a finite number");
      const modsSum = roll.modifiers.reduce((acc, v) => acc + v, 0);
      const diceSum = roll.dice.reduce((acc, v) => acc + v, 0);
      if (roll.total !== diceSum + modsSum) {
        throw new ValidationError("roll.total must equal sum(dice) + sum(modifiers)");
      }
      if (!Number.isFinite(rng_cursor_before) || rng_cursor_before < 0) {
        throw new ValidationError("rng_cursor_before must be >= 0");
      }
      if (!Number.isFinite(rng_cursor_after) || rng_cursor_after < 0) {
        throw new ValidationError("rng_cursor_after must be >= 0");
      }
      if (snapshot.rng.cursor !== rng_cursor_before) {
        throw new ValidationError("rng_cursor_before must match snapshot rng.cursor");
      }
      if (rng_cursor_after !== rng_cursor_before + roll.count) {
        throw new ValidationError("rng_cursor_after must equal rng_cursor_before + count");
      }
      if (context !== "INITIATIVE") throw new ValidationError("context must be INITIATIVE");
      return;
    }

    case "INITIATIVE_SET": {
      const { entries, order } = event.payload;
      if (!snapshot.combat.active) throw new ValidationError("combat not active");
      const hasEntries = Array.isArray(entries) && entries.length > 0;
      // Require entries for new events (version undefined). Allow legacy events on replay.
      if (event.version == null && !hasEntries) {
        throw new ValidationError("entries must be a non-empty array");
      }
      if (!Array.isArray(order)) throw new ValidationError("order must be an array");
      if (!hasEntries && order.length === 0) {
        throw new ValidationError("order must be a non-empty array");
      }

      if (!hasEntries) {
        // Legacy payloads relied on order.
        const set = new Set(order);
        if (set.size !== order.length) throw new ValidationError("order contains duplicates");
        for (const id of order) {
          if (!snapshot.entities[id]) throw new ValidationError(`entity not found in order: ${id}`);
        }
      }

      if (Array.isArray(entries)) {
        for (const e of entries) {
          if (!e || typeof e !== "object") throw new ValidationError("invalid entry");
          if (!Number.isFinite(e.total)) throw new ValidationError("entry.total must be a finite number");
          if (e.dex_mod != null && !Number.isFinite(e.dex_mod)) {
            throw new ValidationError("entry.dex_mod must be a finite number");
          }
          if (e.tiebreak && e.tiebreak !== "TOTAL" && e.tiebreak !== "DEX" && e.tiebreak !== "ENTITY_ID") {
            throw new ValidationError("entry.tiebreak invalid");
          }
          if (e.source !== "AI_ROLL" && e.source !== "HUMAN_DECLARED") {
            throw new ValidationError("entry.source invalid");
          }
        }
      }
      return;
    }

    case "COMBAT_ENDED": {
      if (!snapshot.combat.active) throw new ValidationError("combat not active");
      return;
    }

    default: {
      // exhaustive
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
