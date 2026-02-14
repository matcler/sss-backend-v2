import { describe, it, expect } from "vitest";
import { SssService } from "../src/sss/service/sss.service";

// Fake repo minimale che basta a far girare getState()/replay()
class FakeRepo {
  private snapshots = new Map<string, any>();
  private events = new Map<string, any[]>();

  seed(session_id: string, snapshot: any, events: any[]) {
    this.snapshots.set(session_id, snapshot);
    this.events.set(session_id, events);
  }

  async withTx<T>(fn: (client: any) => Promise<T>): Promise<T> {
    // SssService potrebbe passare questo client ai metodi repo
    const client = {};
    return fn(client);
  }

  // Alcune implementazioni chiamano questa prima di tutto
  async insertSessionIfMissing(_client: any, _session_id: string) {
    return;
  }

  async getLatestSnapshot(_client: any, session_id: string) {
    return this.snapshots.get(session_id) ?? null;
  }

  async getSnapshotAtOrBefore(_client: any, session_id: string, _target: number) {
    return this.snapshots.get(session_id) ?? null;
  }

  async getEventsAfter(_client: any, session_id: string, afterVersion: number) {
    const all = this.events.get(session_id) ?? [];
    return all.filter((e) => e.version > afterVersion).sort((a, b) => a.version - b.version);
  }

  async getEventsInRange(_client: any, session_id: string, from?: number, to?: number) {
    const all = this.events.get(session_id) ?? [];
    return all
      .filter((e) => (from == null || e.version >= from) && (to == null || e.version <= to))
      .sort((a, b) => a.version - b.version);
  }

  // Se getState/replay prova a salvare snapshot o appendere eventi in qualche ramo
  async saveSnapshot(_client: any, _snapshot: any) {
    return;
  }

  async appendEvents(_client: any, _session_id: string, _events: any[], _expected_version: number) {
    // non usato in questo test, ma lo stub evita crash
    return 0;
  }
}


function makeSnapshotV0() {
  return {
    meta: { version: 0, ruleset: "default" },
    mode: "EXPLORATION",
    combat: {
      active: false,
      round: 0,
      initiative: [],
      cursor: 0,
      active_entity: null,
      phase: "START",
      turn_actions_used: 0,
    },
    map: { zones: {}, adjacency: {} },
    entities: {
      e1: { id: "e1", type: "npc", name: "E1" },
      e2: { id: "e2", type: "npc", name: "E2" }
    },
  };
}


describe("SSS replay: meta.version must track persisted stream version", () => {
  it("getState should end with meta.version = last persisted event.version", async () => {
    const repo = new FakeRepo();
    const service = new SssService(repo as any);

    const session_id = "s-replay-1";

    repo.seed(session_id, makeSnapshotV0(), [
  {
    session_id,
    version: 1,
    event_type: "COMBAT_STARTED",
    event_payload: { participant_ids: ["e1", "e2"] },
  },
  {
    session_id,
    version: 2,
    event_type: "INITIATIVE_SET",
    event_payload: { order: ["e1", "e2"] },
  },
]);


    const state = await service.getState(session_id);

    expect(state.meta.version).toBe(2);
  });
});
