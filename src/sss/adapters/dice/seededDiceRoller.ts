import type { DiceRollerPort, DiceRoll } from "../../ports/diceRollerPort";

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRollId(
  context: string,
  actor_id: string | null | undefined,
  target_id: string | null | undefined,
  cursor: number
) {
  const actor = actor_id ?? "na";
  const target = target_id ?? "na";
  return `roll_${context}_${actor}_${target}_${cursor}`;
}

export class SeededDiceRoller implements DiceRollerPort {
  roll(params: {
    seed: number;
    cursor: number;
    sides: number;
    count: number;
    modifiers?: number[];
    context: string;
    actor_id?: string | null;
    target_id?: string | null;
    roll_id?: string;
  }): DiceRoll {
    const {
      seed,
      cursor,
      sides,
      count,
      modifiers = [],
      context,
      actor_id,
      target_id,
      roll_id,
    } = params;

    const dice: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const rng = mulberry32((seed + cursor + i) >>> 0);
      const value = Math.floor(rng() * sides) + 1;
      dice.push(value);
    }

    const modsSum = modifiers.reduce((acc, v) => acc + v, 0);
    const diceSum = dice.reduce((acc, v) => acc + v, 0);
    const total = diceSum + modsSum;

    return {
      roll_id: roll_id ?? makeRollId(context, actor_id, target_id, cursor),
      context,
      actor_id,
      target_id,
      sides,
      count,
      dice,
      modifiers,
      total,
      rng_cursor_before: cursor,
      rng_cursor_after: cursor + count,
    };
  }
}
