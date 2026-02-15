import type { Snapshot, ActionProposedEvent, ActionOutcome, DomainEvent, EntityState } from "../domain/types";
import { DomainError } from "../domain/errors";
import { SeededDiceRoller } from "../adapters/dice/seededDiceRoller";

const diceRoller = new SeededDiceRoller();

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function proficiencyBonus(level: number): number {
  return 2 + Math.floor((level - 1) / 4);
}

function getAbilityScore(entity: EntityState): number {
  const ability = entity.attack_ability ?? "STR";
  if (ability === "DEX") return entity.dex ?? 10;
  return entity.str ?? 10;
}

function getDexMod(entity: EntityState): number {
  return abilityMod(entity.dex ?? 10);
}

function getToHitModifiers(entity: EntityState): number[] {
  const mod = abilityMod(getAbilityScore(entity));
  const pb = entity.proficient ? proficiencyBonus(entity.level ?? 1) : 0;
  return [mod, pb];
}

function getDamageModifiers(entity: EntityState): number[] {
  const mod = abilityMod(getAbilityScore(entity));
  return mod === 0 ? [] : [mod];
}

function getTargetAC(entity: EntityState): number {
  return entity.ac ?? 10;
}

function getWeaponDamage(entity: EntityState): { count: number; sides: number } {
  return entity.weapon_damage ?? { count: 1, sides: 4 };
}

export function resolveAction(
  snapshot: Snapshot,
  proposed: ActionProposedEvent
): DomainEvent[] {
  const { actorEntityId, actionType, destination, targetEntityId } = proposed.payload;

  if (!snapshot.entities[actorEntityId]) {
    throw new DomainError(`actor not found: ${actorEntityId}`);
  }

  let outcomes: ActionOutcome[] = [];
  const resolvedEvents: DomainEvent[] = [];

  switch (actionType) {
    case "MOVE": {
      if (!destination) throw new DomainError("destination is required for MOVE");
      outcomes = [
        {
          type: "MOVE_APPLIED",
          entityId: actorEntityId,
          to: destination,
        },
      ];
      resolvedEvents.push({
        type: "ACTION_RESOLVED",
        payload: {
          proposedEventVersion:
            typeof proposed.version === "number" ? proposed.version : undefined,
          actorEntityId,
          actionType,
          outcomes,
        },
      });
      break;
    }

    case "ATTACK": {
      if (!targetEntityId) throw new DomainError("targetEntityId is required for ATTACK");
      if (!snapshot.entities[targetEntityId]) {
        throw new DomainError(`target not found: ${targetEntityId}`);
      }
      const seed = snapshot.rng?.seed ?? 0;
      const cursor = snapshot.rng?.cursor ?? 0;

      const attacker = snapshot.entities[actorEntityId];
      const target = snapshot.entities[targetEntityId];
      const toHitModifiers = getToHitModifiers(attacker);
      const toHitRoll = diceRoller.roll({
        seed,
        cursor,
        sides: 20,
        count: 1,
        modifiers: toHitModifiers,
        context: "ATTACK_TO_HIT",
        actor_id: actorEntityId,
        target_id: targetEntityId,
      });

      resolvedEvents.push({
        type: "ROLL_RESOLVED",
        payload: toHitRoll,
      });

      const targetAc = getTargetAC(target);
      const isHit = toHitRoll.total >= targetAc;
      let damageTotal = 0;

      if (isHit) {
        const damageModifiers = getDamageModifiers(attacker);
        const weaponDamage = getWeaponDamage(attacker);
        const damageRoll = diceRoller.roll({
          seed,
          cursor: toHitRoll.rng_cursor_after,
          sides: weaponDamage.sides,
          count: weaponDamage.count,
          modifiers: damageModifiers,
          context: "DAMAGE",
          actor_id: actorEntityId,
          target_id: targetEntityId,
        });

        resolvedEvents.push({
          type: "ROLL_RESOLVED",
          payload: damageRoll,
        });

        resolvedEvents.push({
          type: "DAMAGE_APPLIED",
          payload: {
            entity_id: targetEntityId,
            amount: damageRoll.total,
          },
        });
        damageTotal = damageRoll.total;
      }

      resolvedEvents.push({
        type: "ACTION_RESOLVED",
        payload: {
          proposedEventVersion:
            typeof proposed.version === "number" ? proposed.version : undefined,
          actorEntityId,
          actionType,
          outcomes: [],
          summary: {
            hit: isHit,
            damage_total: damageTotal,
            targetEntityId,
          },
        },
      });
      break;
    }

    case "PASS": {
      resolvedEvents.push({
        type: "ACTION_RESOLVED",
        payload: {
          proposedEventVersion:
            typeof proposed.version === "number" ? proposed.version : undefined,
          actorEntityId,
          actionType,
          outcomes: [],
        },
      });
      break;
    }

    case "ROLL_INITIATIVE": {
      const actor = snapshot.entities[actorEntityId];
      if (!actor) throw new DomainError(`actor not found: ${actorEntityId}`);

      const seed = snapshot.rng?.seed ?? 0;
      const cursor = snapshot.rng?.cursor ?? 0;
      const modifiers = [getDexMod(actor)];

      const roll = diceRoller.roll({
        seed,
        cursor,
        sides: 20,
        count: 1,
        modifiers,
        context: "INITIATIVE",
        actor_id: actorEntityId,
      });

      resolvedEvents.push({
        type: "INITIATIVE_ROLLED",
        payload: {
          entityId: actorEntityId,
          roll: {
            sides: 20,
            count: 1,
            dice: roll.dice,
            modifiers: roll.modifiers,
            total: roll.total,
          },
          rng_cursor_before: roll.rng_cursor_before,
          rng_cursor_after: roll.rng_cursor_after,
          context: "INITIATIVE",
        },
      });
      break;
    }

    default: {
      const _exhaustive: never = actionType;
      return _exhaustive;
    }
  }

  return resolvedEvents;
}
