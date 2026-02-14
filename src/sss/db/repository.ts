import { Pool, PoolClient } from "pg";
import { DomainEvent, Snapshot } from "../domain/types";
import { ConflictError } from "../domain/errors";

export type PersistedEvent = {
  session_id: string;
  version: number;
  event_type: string;
  event_payload: unknown;
  created_at: Date;
};

export class SssRepository {
  constructor(private pool: Pool) {}

  async withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async insertSessionIfMissing(
    client: PoolClient,
    session_id: string,
    ruleset: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO sessions(session_id, ruleset)
       VALUES ($1, $2)
       ON CONFLICT (session_id) DO NOTHING`,
      [session_id, ruleset]
    );
  }

  async getSessionRuleset(
    client: PoolClient,
    session_id: string
  ): Promise<string | null> {
    const r = await client.query(
      `SELECT ruleset
       FROM sessions
       WHERE session_id = $1
       LIMIT 1`,
      [session_id]
    );

    if (r.rowCount === 0) return null;
    return String(r.rows[0].ruleset);
  }

  async sessionExists(client: PoolClient, session_id: string): Promise<boolean> {
    const r = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM sessions WHERE session_id = $1
       ) OR EXISTS (
         SELECT 1 FROM session_events WHERE session_id = $1
       ) OR EXISTS (
         SELECT 1 FROM session_snapshots WHERE session_id = $1
       ) AS exists`,
      [session_id]
    );
    return Boolean(r.rows[0]?.exists);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  async appendEvents(
    client: PoolClient,
    session_id: string,
    expected_version: number,
    events: DomainEvent[]
  ): Promise<PersistedEvent[]> {
    // currentVersion: stream vuoto => 0
    const vr = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS v
       FROM session_events
       WHERE session_id = $1`,
      [session_id]
    );

    const currentVersion = Number(vr.rows[0]?.v ?? 0);

    if (currentVersion !== expected_version) {
      throw new ConflictError(
        `version conflict: expected=${expected_version} current=${currentVersion}`
      );
    }

    const inserted: PersistedEvent[] = [];

    try {
      for (let i = 0; i < events.length; i++) {
        const version = expected_version + i + 1;
        const e = events[i];

        const ins = await client.query(
          `INSERT INTO session_events
           (session_id, version, event_type, event_payload)
           VALUES ($1, $2, $3, $4)
           RETURNING session_id, version, event_type, event_payload, created_at`,
          [session_id, version, e.type, e.payload]
        );

        inserted.push(ins.rows[0] as PersistedEvent);
      }

      return inserted;
    } catch (err: any) {
      // unique violation (session_id, version)
      if (err?.code === "23505") {
        throw new ConflictError(
          `version conflict (unique violation): expected=${expected_version}`
        );
      }
      throw err;
    }
  }

  async getEventsAfter(
    client: PoolClient,
    session_id: string,
    afterVersion: number
  ): Promise<PersistedEvent[]> {
    const r = await client.query(
      `SELECT session_id, version, event_type, event_payload, created_at
       FROM session_events
       WHERE session_id = $1 AND version > $2
       ORDER BY version ASC`,
      [session_id, afterVersion]
    );

    return r.rows as PersistedEvent[];
  }

  async getEventsInRange(
    client: PoolClient,
    session_id: string,
    from?: number,
    to?: number
  ): Promise<PersistedEvent[]> {
    const params: any[] = [session_id];
    const conds: string[] = ["session_id = $1"];

    if (from != null) {
      params.push(from);
      conds.push(`version >= $${params.length}`);
    }
    if (to != null) {
      params.push(to);
      conds.push(`version <= $${params.length}`);
    }

    const q = `
      SELECT session_id, version, event_type, event_payload, created_at
      FROM session_events
      WHERE ${conds.join(" AND ")}
      ORDER BY version ASC
    `;

    const r = await client.query(q, params);
    return r.rows as PersistedEvent[];
  }

  // ---------------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------------

  async saveSnapshot(client: PoolClient, snapshot: Snapshot): Promise<void> {
  await client.query(
    `INSERT INTO session_snapshots
     (session_id, version, snapshot)
     VALUES ($1, $2, $3)`,
    [snapshot.meta.session_id, snapshot.meta.version, snapshot]
  );
}


  async getLatestSnapshot(
  client: PoolClient,
  session_id: string
): Promise<Snapshot | null> {
  const r = await client.query(
    `SELECT snapshot
     FROM session_snapshots
     WHERE session_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [session_id]
  );

  if (r.rowCount === 0) return null;
  return r.rows[0].snapshot as Snapshot;
 }
}
