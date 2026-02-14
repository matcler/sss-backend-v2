import { describe, it, expect, vi } from "vitest";
import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import { makeInitialSnapshot } from "../src/sss/domain/snapshot";
import type { DomainEvent } from "../src/sss/domain/types";
import { allowAllRuleEngine } from "../src/sss/rule-engine/allowAllRuleEngine";


describe("SssService.getState (snapshot read-path)", () => {
  it("snapshot presente: carica solo eventi > snapshot.version e meta.version arriva all'ultima versione", async () => {
    const repo = new InMemorySssRepository();
    const sss = new SssService(repo as any, allowAllRuleEngine, 25);


    const session_id = "S_GETSTATE_A";

    // Base snapshot a version 10
    const snap = makeInitialSnapshot(session_id, "default");
    snap.meta.version = 10;
    await repo.saveSnapshot({} as any, snap);

    // Seed eventi fino a version 30 (MODE_SET ripetuto va bene per il test)
    const events: DomainEvent[] = Array.from({ length: 30 }, () => ({
      type: "MODE_SET",
      payload: { mode: "EXPLORATION" },
      version: 0, // ignored in persist; repo assegna version 1..N
    }));

    // append 30 eventi in un colpo con expected_version=0 -> crea stream 1..30
    await repo.appendEvents({} as any, session_id, 0, events);

    const spy = vi.spyOn(repo, "getEventsAfter");

    const state = await sss.getState(session_id);

    // deve chiedere eventi dopo la versione dello snapshot (10)
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.anything(), session_id, 10);

    // deve arrivare all'ultima versione stream (30)
    expect(state.meta.version).toBe(30);
  });

  it("snapshot assente: usa initial snapshot + replay da version 0", async () => {
    const repo = new InMemorySssRepository();
    const sss = new SssService(repo as any, allowAllRuleEngine, 25);


    const session_id = "S_GETSTATE_B";

    // Senza snapshot, getState richiede che la sessione esista (ruleset presente)
    await repo.insertSessionIfMissing({} as any, session_id, "default");

    // Seed 5 eventi (version 1..5)
    const events: DomainEvent[] = Array.from({ length: 5 }, () => ({
      type: "MODE_SET",
      payload: { mode: "EXPLORATION" },
      version: 0,
    }));

    await repo.appendEvents({} as any, session_id, 0, events);

    const spy = vi.spyOn(repo, "getEventsAfter");

    const state = await sss.getState(session_id);

    // Deve partire da version 0 (initial snapshot)
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.anything(), session_id, 0);

    expect(state.meta.version).toBe(5);
    expect(state.meta.session_id).toBe(session_id);
  });

  it("performance guard: snapshot a version 100 e nessun evento dopo -> applica 0 eventi", async () => {
    const repo = new InMemorySssRepository();
    const sss = new SssService(repo as any, allowAllRuleEngine, 25);


    const session_id = "S_GETSTATE_C";

    // Seed stream fino a 100
    const events: DomainEvent[] = Array.from({ length: 100 }, () => ({
      type: "MODE_SET",
      payload: { mode: "EXPLORATION" },
      version: 0,
    }));
    await repo.appendEvents({} as any, session_id, 0, events);

    // Snapshot esattamente alla testa stream (100)
    const snap = makeInitialSnapshot(session_id, "default");
    snap.meta.version = 100;
    await repo.saveSnapshot({} as any, snap);

    const spy = vi.spyOn(repo, "getEventsAfter");

    const state = await sss.getState(session_id);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.anything(), session_id, 100);

    // Nessun evento dopo 100 => stato = snapshot (meta.version resta 100)
    expect(state.meta.version).toBe(100);
    expect(state).toEqual(snap);
  });
});
