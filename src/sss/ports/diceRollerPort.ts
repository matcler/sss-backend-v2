import type { EntityId } from "../domain/types";

export interface DiceRoll {
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

export interface DiceRollerPort {
  roll(params: {
    seed: number;
    cursor: number;
    sides: number;
    count: number;
    modifiers?: number[];
    context: string;
    actor_id?: EntityId | null;
    target_id?: EntityId | null;
    roll_id?: string;
  }): DiceRoll;
}
