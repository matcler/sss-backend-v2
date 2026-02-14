import { PoolClient } from "pg";
import { DomainEvent, Snapshot } from "../../domain/types";
import { ConflictError } from "../../domain/errors";
import { PersistedEvent, SssRepository } from "../repository";

export class InMemorySssRepository extends SssRepository {
  // NB: non usiamo il pool: passiamo un placeholder al super
  constructor() {
    super({ connect: async () => ({}) } as any);
  }

  override async withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    // niente transazione: client finto
    return fn({} as PoolClient);
  }

  private rulesetBySession = new Map<string, string>();
  private eventsBySession = new Map<string, PersistedEvent[]>();
  private snapshotsBySession = new Map<string, Snapshot[]>();

  override async insertSessionIfMissing(
    _client: PoolClient,
    session_id: string,
    ruleset: string
  ): Promise<void> {
    if (!this.rulesetBySession.has(session_id)) {
      this.rulesetBySession.set(session_id, ruleset);
    }
  }

  override async getSessionRuleset(
    _client: PoolClient,
    session_id: string
  ): Promise<string | null> {
    return this.rulesetBySession.get(session_id) ?? null;
  }

  override async sessionExists(
    _client: PoolClient,
    session_id: string
  ): Promise<boolean> {
    return (
      this.rulesetBySession.has(session_id) ||
      this.eventsBySession.has(session_id) ||
      this.snapshotsBySession.has(session_id)
    );
  }

  override async appendEvents(
    _client: PoolClient,
    session_id: string,
    expected_version: number,
    events: DomainEvent[]
  ): Promise<PersistedEvent[]> {
    const list = this.eventsBySession.get(session_id) ?? [];

    const currentVersion = list.length === 0 ? 0 : list[list.length - 1].version;

    if (currentVersion !== expected_version) {
      throw new ConflictError(
        `version conflict: expected=${expected_version} current=${currentVersion}`
      );
    }

    const inserted: PersistedEvent[] = [];

    for (let i = 0; i < events.length; i++) {
      const version = expected_version + i + 1;
      const e = events[i];

      const pe: PersistedEvent = {
        session_id,
        version,
        event_type: e.type,
        event_payload: e.payload,
        created_at: new Date(),
      };

      list.push(pe);
      inserted.push(pe);
    }

    this.eventsBySession.set(session_id, list);
    return inserted;
  }

  override async getEventsAfter(
    _client: PoolClient,
    session_id: string,
    afterVersion: number
  ): Promise<PersistedEvent[]> {
    const list = this.eventsBySession.get(session_id) ?? [];
    return list.filter((e) => e.version > afterVersion);
  }

  override async getEventsInRange(
    _client: PoolClient,
    session_id: string,
    from?: number,
    to?: number
  ): Promise<PersistedEvent[]> {
    const list = this.eventsBySession.get(session_id) ?? [];
    return list.filter((e) => {
      if (from != null && e.version < from) return false;
      if (to != null && e.version > to) return false;
      return true;
    });
  }

  override async saveSnapshot(
    _client: PoolClient,
    snapshot: Snapshot
  ): Promise<void> {
    const list = this.snapshotsBySession.get(snapshot.meta.session_id) ?? [];
    list.push(snapshot);
    this.snapshotsBySession.set(snapshot.meta.session_id, list);
  }

  override async getLatestSnapshot(
    _client: PoolClient,
    session_id: string
  ): Promise<Snapshot | null> {
    const list = this.snapshotsBySession.get(session_id);
    if (!list || list.length === 0) return null;

    return list.reduce((latest, s) =>
      s.meta.version > latest.meta.version ? s : latest
    );
  }
}
