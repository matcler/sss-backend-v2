import type { Snapshot } from "./types";
import { DEFAULT_FACTION } from "./types";

export function getAliveFactions(snapshot: Snapshot): Set<string> {
  const factions = new Set<string>();
  const order = snapshot.combat.initiative ?? [];
  let hasExplicitFaction = false;
  let aliveCount = 0;

  for (const id of order) {
    const ent = snapshot.entities[id];
    if (ent && ent.hp > 0) {
      aliveCount += 1;
      if (ent.factionId) hasExplicitFaction = true;
      factions.add(ent.factionId ?? DEFAULT_FACTION);
    }
  }

  if (!hasExplicitFaction) {
    // Backward-compatible: if no factionId is set for any participant,
    // treat each alive entity as its own "faction".
    const pseudo = new Set<string>();
    for (let i = 0; i < aliveCount; i += 1) {
      pseudo.add(`_solo_${i}`);
    }
    return pseudo;
  }

  return factions;
}

export function isCombatOver(
  snapshot: Snapshot
): { over: boolean; winningFactionId?: string } {
  const factions = getAliveFactions(snapshot);
  if (factions.size <= 1) {
    const winningFactionId = factions.values().next().value as string | undefined;
    return { over: true, winningFactionId };
  }
  return { over: false };
}
