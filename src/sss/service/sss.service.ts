import { SssRepository } from "../db/repository";
import { makeInitialSnapshot, shouldTakeSnapshot } from "../domain/snapshot";
import { reduce } from "../domain/reducer";
import {
  Snapshot,
  DomainEvent,
  ActionProposedEvent,
  InitiativeRollPayload,
  InitiativeEntry,
} from "../domain/types";
import { NotFoundError, SnapshotMissingError, ValidationError } from "../domain/errors";
import { env } from "../../config/env";
import type { RuleEngineGateway } from "../rule-engine/ruleEngineGateway";
import { allowAllRuleEngine } from "../rule-engine/allowAllRuleEngine";
import { resolveAction } from "./actionResolver";
import { isCombatOver } from "../domain/combatEnd";

export interface AppendEventsRequest {
  expected_version: number;
  events: DomainEvent[];
}

export interface DevSeedCombatOptions {
  actorId?: string;
  enemyId?: string;
  seed?: number;
  positions?: {
    actor?: { x: number; y: number };
    enemy?: { x: number; y: number };
  };
}

export interface DevSeedCombatResult {
  session_id: string;
  version: number;
  mode: "COMBAT";
  phase: "ACTION_WINDOW";
  active_entity: string;
}

export interface ReplayResult {
  from: number | null;
  to: number | null;
  count: number;
  base_version: number;
  state: Snapshot;
}

export class SssService {
  private ruleEngine: RuleEngineGateway;
  private snapshotEvery: number;
  private static readonly AI_ENTITY_ID = "ai";

  // ---- constructor overloads (retro-compat) ----
  constructor(repo: SssRepository);
  constructor(repo: SssRepository, snapshotEvery: number);
  constructor(repo: SssRepository, ruleEngine: RuleEngineGateway);
  constructor(repo: SssRepository, ruleEngine: RuleEngineGateway, snapshotEvery: number);

  constructor(
    private repo: SssRepository,
    arg2: RuleEngineGateway | number = allowAllRuleEngine,
    arg3: number = env.SNAPSHOT_EVERY
  ) {
    if (typeof arg2 === "number") {
      // vecchia firma: (repo, snapshotEvery)
      this.ruleEngine = allowAllRuleEngine;
      this.snapshotEvery = arg2;
    } else {
      // nuova firma
      this.ruleEngine = arg2 ?? allowAllRuleEngine;
      this.snapshotEvery = arg3;
    }

    // safety net assoluta
    if (typeof (this.ruleEngine as any)?.evaluate !== "function") {
      throw new Error(
        "RuleEngineGateway misconfigured: expected { evaluate(snapshot, event) }"
      );
    }
  }

  // ============================================================
  // READ
  // ============================================================
  async getState(session_id: string): Promise<Snapshot> {
    return this.repo.withTx((client) => this.getStateInTx(client, session_id));
  }

  // ============================================================
  // WRITE (validate-before-persist + rule-engine gate)
  // ============================================================
  async appendEvents(
    session_id: string,
    req: AppendEventsRequest
  ): Promise<Snapshot> {
    return this.repo.withTx((client) =>
      this.appendEventsInTx(client, session_id, req, { forceSnapshot: false })
    );
  }

  // ============================================================
  // EVENTS
  // ============================================================
  async createSession(ruleset: string = "5e"): Promise<{ session_id: string; version: number }> {
    const normalizedRuleset =
      typeof ruleset === "string" && ruleset.trim().length > 0 ? ruleset.trim() : "5e";
    const session_id = `test-session-${Date.now()}`;

    return this.repo.withTx(async (client) => {
      await this.repo.insertSessionIfMissing(client, session_id, normalizedRuleset);

      const createdEvent: DomainEvent = {
        type: "SESSION_CREATED",
        payload: { ruleset: normalizedRuleset },
      };

      const inserted = await this.repo.appendEvents(client, session_id, 0, [createdEvent]);
      const version = inserted[0]?.version ?? 1;
      const persistedCreatedEvent: DomainEvent = {
        ...createdEvent,
        version,
      };
      const snapshot = reduce(
        makeInitialSnapshot(session_id, normalizedRuleset),
        [persistedCreatedEvent]
      );
      await this.repo.saveSnapshot(client, snapshot);
      return { session_id, version };
    });
  }

  async getEvents(session_id: string, from?: number, to?: number) {
    if (from != null && to != null && from > to) {
      throw new ValidationError(`invalid range`);
    }

    return this.repo.withTx(async (client) => {
      const exists = await this.sessionExistsCompat(client, session_id);
      if (!exists) {
        throw new NotFoundError(`session not found: ${session_id}`);
      }
      const rows = await this.repo.getEventsInRange(
        client,
        session_id,
        from,
        to
      );

      return rows.map((r) => ({
        version: r.version,
        type: r.event_type,
        payload: r.event_payload,
        created_at: r.created_at,
      }));
    });
  }

  async replay(session_id: string, from?: number, to?: number): Promise<ReplayResult> {
    return this.repo.withTx(async (client) => {
      const exists = await this.sessionExistsCompat(client, session_id);
      if (!exists) {
        throw new NotFoundError(`session not found: ${session_id}`);
      }

      const replayFrom = from ?? 1;
      const replayTo = to;

      const before =
        replayFrom > 1
          ? await this.repo.getEventsInRange(client, session_id, 1, replayFrom - 1)
          : [];
      const range = await this.repo.getEventsInRange(client, session_id, replayFrom, replayTo);

      const toDomain = (rows: Awaited<ReturnType<SssRepository["getEventsInRange"]>>): DomainEvent[] =>
        rows.map(
          (e) =>
            ({
              type: e.event_type,
              payload: e.event_payload,
              version: e.version,
            } as DomainEvent)
        );

      const beforeEvents = toDomain(before);
      const replayEvents = toDomain(range);

      const ruleset = await this.repo.getSessionRuleset(client, session_id);
      const base = ruleset
        ? makeInitialSnapshot(session_id, String(ruleset))
        : makeInitialSnapshot(session_id, "unknown");
      const baseState = reduce(base, beforeEvents);
      const state = reduce(baseState, replayEvents);

      return {
        from: from ?? null,
        to: to ?? null,
        count: range.length,
        base_version: baseState.meta.version,
        state,
      };
    });
  }

  async devSeedCombat(
    session_id: string,
    opts: DevSeedCombatOptions = {}
  ): Promise<DevSeedCombatResult> {
    return this.repo.withTx(async (client) => {
      const current = await this.getStateInTx(client, session_id);
      const actorId = opts.actorId?.trim() || "e1";
      const enemyId = opts.enemyId?.trim() || "m1";
      if (actorId === enemyId) {
        throw new ValidationError("actorId and enemyId must be different");
      }

      if (isCombatReady(current, actorId)) {
        return {
          session_id,
          version: current.meta.version,
          mode: "COMBAT",
          phase: "ACTION_WINDOW",
          active_entity: actorId,
        };
      }

      const actorPosition = opts.positions?.actor ?? { x: 0, y: 0 };
      const enemyPosition = opts.positions?.enemy ?? { x: 1, y: 0 };
      const initiativeEntries: InitiativeEntry[] = [
        { entityId: actorId, total: 15, source: "HUMAN_DECLARED", tiebreak: "TOTAL" as const },
        { entityId: enemyId, total: 10, source: "HUMAN_DECLARED", tiebreak: "TOTAL" as const },
      ];
      const seedEvents: DomainEvent[] = [{ type: "RNG_SEEDED", payload: { seed: Number(opts.seed ?? 1) } }];
      if (!current.entities[actorId]) {
        seedEvents.push({
          type: "ENTITY_ADDED",
          payload: {
            entity_id: actorId,
            name: actorId,
            hp: 20,
            zone: null,
            position: actorPosition,
          },
        });
      }
      if (!current.entities[enemyId]) {
        seedEvents.push({
          type: "ENTITY_ADDED",
          payload: {
            entity_id: enemyId,
            name: enemyId,
            hp: 20,
            zone: null,
            position: enemyPosition,
          },
        });
      }
      seedEvents.push(
        { type: "MODE_SET", payload: { mode: "COMBAT" } },
        { type: "COMBAT_STARTED", payload: { participant_ids: [actorId, enemyId] } },
        {
          type: "INITIATIVE_SET",
          payload: { entries: initiativeEntries, order: [actorId, enemyId] },
        }
      );

      const next = await this.appendEventsInTx(
        client,
        session_id,
        { expected_version: current.meta.version, events: seedEvents },
        { forceSnapshot: true }
      );

      if (!isCombatReady(next, actorId)) {
        throw new ValidationError("dev seed failed to reach COMBAT/ACTION_WINDOW with active actor");
      }

      console.info(
        `[dev-seed-combat] session=${session_id} version=${next.meta.version} active=${actorId} phase=ACTION_WINDOW`
      );

      return {
        session_id,
        version: next.meta.version,
        mode: "COMBAT",
        phase: "ACTION_WINDOW",
        active_entity: actorId,
      };
    });
  }

  private async sessionExistsCompat(client: any, session_id: string): Promise<boolean> {
    const repoAny = this.repo as any;
    if (typeof repoAny.sessionExists === "function") {
      return Boolean(await repoAny.sessionExists(client, session_id));
    }

    if (typeof repoAny.getSessionRuleset === "function") {
      const ruleset = await repoAny.getSessionRuleset(client, session_id);
      if (ruleset) return true;
    }

    if (typeof repoAny.getLatestSnapshot === "function") {
      const snapshot = await repoAny.getLatestSnapshot(client, session_id);
      if (snapshot) return true;
    }

    if (typeof repoAny.getEventsAfter === "function") {
      const events = await repoAny.getEventsAfter(client, session_id, 0);
      return Array.isArray(events) && events.length > 0;
    }

    return false;
  }

  private async getStateInTx(client: any, session_id: string): Promise<Snapshot> {
    const exists = await this.sessionExistsCompat(client, session_id);
    if (!exists) {
      throw new NotFoundError(`session not found: ${session_id}`);
    }

    let base = await this.repo.getLatestSnapshot(client, session_id);
    const persisted = await this.repo.getEventsAfter(client, session_id, base?.meta.version ?? 0);
    const domainEvents = persisted.map(
      (e) =>
        ({
          type: e.event_type,
          payload: e.event_payload,
          version: e.version,
        } as DomainEvent)
    );

    if (!base) {
      const ruleset = await this.repo.getSessionRuleset(client, session_id);
      if (ruleset) {
        base = makeInitialSnapshot(session_id, String(ruleset));
      } else {
        const createdEvent = domainEvents.find(
          (event) =>
            event.type === "SESSION_CREATED" &&
            typeof (event.payload as any)?.ruleset === "string"
        );
        if (createdEvent) {
          base = makeInitialSnapshot(session_id, String((createdEvent.payload as any).ruleset));
        } else {
          throw new SnapshotMissingError(
            `snapshot missing and ruleset unavailable for session: ${session_id}`
          );
        }
      }
    }

    return reduce(base, domainEvents);
  }

  private async appendEventsInTx(
    client: any,
    session_id: string,
    req: AppendEventsRequest,
    options: { forceSnapshot: boolean }
  ): Promise<Snapshot> {
    let snap = await this.repo.getLatestSnapshot(client, session_id);

    if (!snap) {
      if (req.expected_version !== 0) {
        throw new NotFoundError(`session not found: ${session_id}`);
      }

      const created = req.events.find((e) => e.type === "SESSION_CREATED");
      if (!created) {
        throw new ValidationError("first append must include SESSION_CREATED");
      }

      const ruleset = (created.payload as any)?.ruleset ?? "unknown";
      await this.repo.insertSessionIfMissing(client, session_id, String(ruleset));
      snap = makeInitialSnapshot(session_id, String(ruleset));
      await this.repo.saveSnapshot(client, snap);
    }

    const past = await this.repo.getEventsAfter(client, session_id, snap.meta.version);
    const pastDomainEvents = past.map(
      (e) =>
        ({
          type: e.event_type,
          payload: e.event_payload,
          version: e.version,
        } as DomainEvent)
    );

    const baseSnap = reduce(snap, pastDomainEvents);
    let lastAiRoll = findLastAiRoll(pastDomainEvents, SssService.AI_ENTITY_ID);

    if (req.expected_version !== baseSnap.meta.version) {
      throw new ValidationError(
        `version mismatch: expected ${req.expected_version}, current ${baseSnap.meta.version}`
      );
    }

    let currentSnap = baseSnap;
    const toPersist: DomainEvent[] = [];
    const applyAndPersist = (
      snapshot: Snapshot,
      events: DomainEvent | DomainEvent[]
    ): Snapshot => {
      let updated = snapshot;
      const list = Array.isArray(events) ? events : [events];
      for (const ev of list) {
        updated = reduce(updated, [ev]);
        toPersist.push(ev);
        if (ev.type === "TURN_STARTED") {
          updated = applyAutoSkipDead(updated, toPersist);
          updated = applyAutoEndCombat(updated, toPersist);
        }
      }
      return updated;
    };

    for (const incomingEvent of req.events) {
      const ev = normalizeIncomingEvent(incomingEvent, currentSnap);
      const decision = this.ruleEngine.evaluate(currentSnap, ev);
      if (!decision.allowed) {
        throw new ValidationError(`rule denied: ${decision.code}`);
      }

      if (ev.type === "INITIATIVE_SET") {
        this.assertInitiativeSetMatchesAiRoll(
          currentSnap,
          ev,
          lastAiRoll,
          SssService.AI_ENTITY_ID
        );
      }

      let nextSnap = applyAndPersist(currentSnap, ev);

      if (ev.type === "ADVANCE_TURN") {
        const derived = buildAdvanceTurnDerivedEvents(nextSnap, ev);
        nextSnap = applyAndPersist(nextSnap, derived);
      } else if (ev.type === "ACTION_PROPOSED") {
        const resolvedEvents = resolveAction(nextSnap, ev as ActionProposedEvent);
        nextSnap = applyAndPersist(nextSnap, resolvedEvents);
        const lastResolvedAiRoll = findLastAiRoll(resolvedEvents, SssService.AI_ENTITY_ID);
        if (lastResolvedAiRoll) lastAiRoll = lastResolvedAiRoll;
      } else if (ev.type === "INITIATIVE_ROLLED" && ev.payload.entityId === SssService.AI_ENTITY_ID) {
        lastAiRoll = ev.payload;
      }

      if (ev.type === "INITIATIVE_SET") {
        const activeEntityId = nextSnap.combat.active_entity;
        if (activeEntityId) {
          const turnStarted: DomainEvent = {
            type: "TURN_STARTED",
            payload: { entityId: activeEntityId, round: nextSnap.combat.round },
          };
          nextSnap = applyAndPersist(nextSnap, turnStarted);
        }
      }

      nextSnap = applyAutoSkipDead(nextSnap, toPersist);
      nextSnap = applyAutoEndCombat(nextSnap, toPersist);
      currentSnap = nextSnap;
    }

    const inserted = await this.repo.appendEvents(client, session_id, req.expected_version, toPersist);
    const lastVersion =
      inserted.length > 0 ? inserted[inserted.length - 1].version : baseSnap.meta.version;
    currentSnap.meta.version = lastVersion;

    const lastType = toPersist.at(-1)?.type;
    if (options.forceSnapshot || shouldTakeSnapshot(lastVersion, this.snapshotEvery, lastType)) {
      await this.repo.saveSnapshot(client, currentSnap);
    }

    return currentSnap;
  }

  private assertInitiativeSetMatchesAiRoll(
    snapshot: Snapshot,
    event: DomainEvent,
    lastAiRoll: InitiativeRollPayload | null,
    aiEntityId: string
  ): void {
    if (event.type !== "INITIATIVE_SET") return;

    const aiPresent = Boolean(snapshot.entities?.[aiEntityId]);
    if (!aiPresent && !lastAiRoll) return;

    const entries = Array.isArray((event.payload as any)?.entries)
      ? (event.payload as any).entries
      : [];

    if (!lastAiRoll) {
      throw new ValidationError("missing AI initiative roll");
    }

    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      if (hasRngFields(e as Record<string, unknown>)) {
        throw new ValidationError("initiative entry must not include rng fields");
      }
      if (e.entityId === aiEntityId) {
        if (e.source !== "AI_ROLL") {
          throw new ValidationError("AI initiative entry must have source AI_ROLL");
        }
        if (e.total !== lastAiRoll.roll.total) {
          throw new ValidationError("AI initiative total mismatch");
        }
      } else {
        if (e.source !== "HUMAN_DECLARED") {
          throw new ValidationError("human initiative entry must have source HUMAN_DECLARED");
        }
      }
    }

    const aiEntry = entries.find((e: any) => e?.entityId === aiEntityId);
    if (!aiEntry) {
      throw new ValidationError("AI initiative entry missing");
    }
  }
}

function findLastAiRoll(
  events: DomainEvent[],
  aiEntityId: string
): InitiativeRollPayload | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev.type === "INITIATIVE_ROLLED" && ev.payload.entityId === aiEntityId) {
      return ev.payload;
    }
  }
  return null;
}

function hasRngFields(entry: Record<string, unknown>): boolean {
  return (
    "rng_cursor_before" in entry ||
    "rng_cursor_after" in entry ||
    "roll" in entry ||
    "context" in entry
  );
}

function buildAdvanceTurnDerivedEvents(
  snapshot: Snapshot,
  advanceEvent: DomainEvent
): DomainEvent[] {
  if (advanceEvent.type !== "ADVANCE_TURN") return [];

  const combat = snapshot.combat;
  if (!combat.active) {
    throw new ValidationError("ADVANCE_TURN requires active combat");
  }
  if (combat.initiative.length === 0) {
    throw new ValidationError("ADVANCE_TURN requires initiative order");
  }
  if (!combat.active_entity) {
    throw new ValidationError("ADVANCE_TURN requires active_entity");
  }

  const reason = (advanceEvent.payload as any)?.reason;

  const emitTurnEnded = combat.phase !== "END";
  const turnEnded: DomainEvent = {
    type: "TURN_ENDED",
    payload: {
      entity_id: combat.active_entity,
      reason,
      round: combat.round,
      cursor: combat.cursor,
    },
  };

  const order = combat.initiative;
  const combatOver = isCombatOver(snapshot);
  if (combatOver.over) {
    const out: DomainEvent[] = [];
    if (emitTurnEnded) out.push(turnEnded);
    out.push({ type: "COMBAT_ENDED", payload: { winningFactionId: combatOver.winningFactionId } });
    return out;
  }

  const start = combat.cursor;
  const n = order.length;
  let nextCursor = -1;
  for (let step = 1; step <= n; step += 1) {
    const i = (start + step) % n;
    const ent = snapshot.entities[order[i]];
    if (ent && ent.hp > 0) {
      nextCursor = i;
      break;
    }
  }

  if (nextCursor < 0) {
    return [
      turnEnded,
      { type: "COMBAT_ENDED", payload: { winningFactionId: combatOver.winningFactionId } },
    ];
  }

  const wrapped = nextCursor < start;
  const nextRound = combat.round + (wrapped ? 1 : 0);
  const nextEntityId = order[nextCursor];

  const turnStarted: DomainEvent = {
    type: "TURN_STARTED",
    payload: { entityId: nextEntityId, round: nextRound },
  };

  const out: DomainEvent[] = [];
  if (emitTurnEnded) out.push(turnEnded);
  out.push(turnStarted);
  return out;
}

function buildSkipDeadDerivedEvents(snapshot: Snapshot): DomainEvent[] {
  const combat = snapshot.combat;
  if (!combat.active) return [];
  if (!combat.active_entity) return [];

  const turnEnded: DomainEvent = {
    type: "TURN_ENDED",
    payload: {
      entity_id: combat.active_entity,
      reason: "SKIP_DEAD",
      round: combat.round,
      cursor: combat.cursor,
    },
  };

  const order = combat.initiative;
  const combatOver = isCombatOver(snapshot);
  if (order.length === 0 || combatOver.over) {
    return [
      turnEnded,
      { type: "COMBAT_ENDED", payload: { winningFactionId: combatOver.winningFactionId } },
    ];
  }

  const start = combat.cursor;
  const n = order.length;
  let nextCursor = -1;
  for (let step = 1; step <= n; step += 1) {
    const i = (start + step) % n;
    const ent = snapshot.entities[order[i]];
    if (ent && ent.hp > 0) {
      nextCursor = i;
      break;
    }
  }

  if (nextCursor < 0) {
    return [
      turnEnded,
      { type: "COMBAT_ENDED", payload: { winningFactionId: combatOver.winningFactionId } },
    ];
  }

  const wrapped = nextCursor < start;
  const nextRound = combat.round + (wrapped ? 1 : 0);
  const nextEntityId = order[nextCursor];

  const turnStarted: DomainEvent = {
    type: "TURN_STARTED",
    payload: { entityId: nextEntityId, round: nextRound },
  };

  return [turnEnded, turnStarted];
}

function applyAutoSkipDead(snapshot: Snapshot, toPersist: DomainEvent[]): Snapshot {
  let next = snapshot;
  let guard = 0;

  while (true) {
    if (next.mode !== "COMBAT") return next;
    if (!next.combat.active) return next;
    const activeId = next.combat.active_entity;
    if (!activeId) return next;
    const active = next.entities[activeId];
    if (!active || active.hp > 0) return next;

    const derived = buildSkipDeadDerivedEvents(next);
    if (derived.length === 0) return next;

    next = reduce(next, derived);
    toPersist.push(...derived);

    guard += 1;
    if (guard > (next.combat.initiative?.length ?? 0) + 1) {
      return next;
    }
  }
}

function applyAutoEndCombat(snapshot: Snapshot, toPersist: DomainEvent[]): Snapshot {
  if (snapshot.mode !== "COMBAT") return snapshot;
  if (!snapshot.combat.active) return snapshot;
  if (!Array.isArray(snapshot.combat.initiative) || snapshot.combat.initiative.length === 0) {
    return snapshot;
  }
  const activeId = snapshot.combat.active_entity;
  const active = activeId ? snapshot.entities[activeId] : null;
  if (active && active.hp <= 0) {
    return snapshot;
  }

  const combatOver = isCombatOver(snapshot);
  if (!combatOver.over) return snapshot;

  const ev: DomainEvent = {
    type: "COMBAT_ENDED",
    payload: { winningFactionId: combatOver.winningFactionId },
  };

  const next = reduce(snapshot, [ev]);
  toPersist.push(ev);
  return next;
}

function isCombatReady(snapshot: Snapshot, actorId: string): boolean {
  const phase = snapshot.combat.phase === "ACTION" ? "ACTION_WINDOW" : snapshot.combat.phase;
  const actionUsed =
    snapshot.combat.action_used ??
    ((snapshot.combat.turn_actions_used ?? 0) >= 1);
  const movementRemaining = snapshot.combat.movement_remaining ?? 6;
  return (
    snapshot.mode === "COMBAT" &&
    snapshot.combat.active === true &&
    phase === "ACTION_WINDOW" &&
    snapshot.combat.active_entity === actorId &&
    Array.isArray(snapshot.combat.initiative) &&
    snapshot.combat.initiative.length >= 2 &&
    Array.isArray(snapshot.combat.initiative_entries) &&
    snapshot.combat.initiative_entries.length >= 2 &&
    actionUsed === false &&
    movementRemaining === 6
  );
}

function normalizeIncomingEvent(event: DomainEvent, snapshot: Snapshot): DomainEvent {
  if (event.type === "ACTION_PROPOSED") {
    const p = (event.payload ?? {}) as any;
    const actorEntityId =
      p.actorEntityId ??
      p.actor_entity_id ??
      p.actor_entity ??
      p.actorId ??
      p.actor?.entityId;
    const actionType = p.actionType ?? p.action?.type;
    const destination = p.destination ?? p.action?.destination;
    const targetEntityId = p.targetEntityId ?? p.action?.targetEntityId;

    if (!actorEntityId && !actionType && destination === undefined && targetEntityId === undefined) {
      return event;
    }

    return {
      ...event,
      payload: {
        actorEntityId,
        actionType,
        destination,
        targetEntityId,
      },
    } as DomainEvent;
  }

  if (event.type === "ADVANCE_TURN") {
    const p = (event.payload ?? {}) as any;
    const actorEntityId =
      p.actorEntityId ??
      p.entityId ??
      p.entity_id ??
      p.actor_entity ??
      p.actorEntity ??
      snapshot.combat?.active_entity;
    if (!actorEntityId) return event;
    return {
      ...event,
      payload: {
        actorEntityId,
        reason: p.reason,
      },
    } as DomainEvent;
  }

  return event;
}
