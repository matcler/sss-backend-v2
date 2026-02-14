import { describe, it, expect } from "vitest";
import type { DomainEvent } from "../src/sss/domain/types";

// Se nel tuo service hai un metodo pubblico per appendere eventi, importalo qui.
// Esempi possibili (scegline uno e adatta):
// import { SssService } from "../src/sss/service/sss.service";

type Persisted = { version: number; event_type: string; event_payload: any; session_id: string };

class ConcurrencyError extends Error {
  code = "CONFLICT";
  constructor(msg: string) {
    super(msg);
  }
}

class FakeRepo {
  private events = new Map<string, Persisted[]>();

  seed(session_id: string, persisted: Persisted[]) {
    this.events.set(session_id, [...persisted].sort((a, b) => a.version - b.version));
  }

  currentVersion(session_id: string): number {
    const list = this.events.get(session_id) ?? [];
    return list.length ? list[list.length - 1].version : -1;
  }

  async withTx<T>(fn: (client: any) => Promise<T>): Promise<T> {
    return fn({});
  }

  async insertSessionIfMissing() {
    return;
  }

  // Minimal methods some codepaths might call (safe defaults)
  async getLatestSnapshot() {
    return null;
  }
  async getEventsAfter(_c: any, session_id: string, afterVersion: number) {
    const list = this.events.get(session_id) ?? [];
    return list.filter((e) => e.version > afterVersion);
  }

  // >>> The one we care about:
  async appendEvents(_client: any, session_id: string, events: DomainEvent[], expected_version: number) {
    const cur = this.currentVersion(session_id);
    if (expected_version !== cur) {
      throw new ConcurrencyError(`expected_version=${expected_version} current=${cur}`);
    }

    const list = this.events.get(session_id) ?? [];
    let v = cur;

    for (const e of events) {
      v += 1;
      list.push({
        session_id,
        version: v,
        event_type: (e as any).type,
        event_payload: (e as any).payload,
      });
    }

    this.events.set(session_id, list);
    return v; // tipicamente ritorna lastVersion
  }
}

describe("SSS optimistic concurrency (expected_version)", () => {
  it("happy path: expected_version matches current stream version -> append ok", async () => {
    const repo = new FakeRepo();
    const session_id = "s-conc-1";

    // stream già con v0,v1
    repo.seed(session_id, [
      { session_id, version: 0, event_type: "COMBAT_STARTED", event_payload: { participant_ids: ["e1"] } },
      { session_id, version: 1, event_type: "INITIATIVE_SET", event_payload: { order: ["e1"] } },
    ]);

    const newEvents: DomainEvent[] = [
      { type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } } as any,
    ];

    const last = await repo.appendEvents({}, session_id, newEvents, 1);
    expect(last).toBe(2);
    expect(repo.currentVersion(session_id)).toBe(2);
  });

  it("conflict: expected_version does NOT match current stream version -> throws", async () => {
    const repo = new FakeRepo();
    const session_id = "s-conc-2";

    repo.seed(session_id, [
      { session_id, version: 0, event_type: "COMBAT_STARTED", event_payload: { participant_ids: ["e1"] } },
      { session_id, version: 1, event_type: "INITIATIVE_SET", event_payload: { order: ["e1"] } },
    ]);

    const newEvents: DomainEvent[] = [
      { type: "ADVANCE_TURN", payload: { actorEntityId: "e1" } } as any,
    ];

    await expect(repo.appendEvents({}, session_id, newEvents, 0)).rejects.toThrow(/expected_version=0/);
    expect(repo.currentVersion(session_id)).toBe(1);
  });
});
