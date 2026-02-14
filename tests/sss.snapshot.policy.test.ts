import { describe, it, expect, vi } from "vitest";
import { shouldTakeSnapshot } from "../src/sss/domain/snapshot";
import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import type { DomainEvent } from "../src/sss/domain/types";
import { makeInitialSnapshot } from "../src/sss/domain/snapshot";
import { allowAllRuleEngine } from "../src/sss/rule-engine/allowAllRuleEngine";



describe("Snapshot policy", () => {
  it("shouldTakeSnapshot: version<=0 => false; multiple of N => true", () => {
    expect(shouldTakeSnapshot(0, 25)).toBe(false);
    expect(shouldTakeSnapshot(-1, 25)).toBe(false);

    expect(shouldTakeSnapshot(1, 3)).toBe(false);
    expect(shouldTakeSnapshot(2, 3)).toBe(false);
    expect(shouldTakeSnapshot(3, 3)).toBe(true);
    expect(shouldTakeSnapshot(6, 3)).toBe(true);

    expect(shouldTakeSnapshot(10, 0)).toBe(false);
    expect(shouldTakeSnapshot(10, -5)).toBe(false);
  });

  it("shouldTakeSnapshot: event-driven => true su COMBAT_ENDED anche se non multiplo di N", () => {
  // Non multiplo
  expect(shouldTakeSnapshot(7, 25, "COMBAT_ENDED")).toBe(true);

  // Evento non chiave => false (se non periodico)
  expect(shouldTakeSnapshot(7, 25, "ZONE_ADDED" as any)).toBe(false);

  // Periodico continua a funzionare
  expect(shouldTakeSnapshot(25, 25, "ZONE_ADDED" as any)).toBe(true);
});

it("service: COMBAT_ENDED forza snapshot anche se non multiplo di SNAPSHOT_EVERY", async () => {
  const repo = new InMemorySssRepository();
  const snapshotEvery = 25;
  const sss = new SssService(repo as any, allowAllRuleEngine, snapshotEvery)
;

  const session_id = "S_SNAP_EVENT_DRIVEN";

  // spiamo saveSnapshot: deve scattare al COMBAT_ENDED
  const saveSpy = vi.spyOn(repo, "saveSnapshot");

  // Mettiamo lo stream a version 24 (non snapshotta)
  const filler: DomainEvent[] = Array.from({ length: 24 }, () => ({
    type: "MODE_SET",
    payload: { mode: "EXPLORATION" },
    version: 0,
  }));

  await repo.appendEvents({} as any, session_id, 0, filler);

  // Ora appendiamo COMBAT_ENDED come evento 25? No: vogliamo che scatti anche NON multiplo.
  // Quindi facciamo arrivare a 26 con COMBAT_ENDED a version 26:
  const oneMore: DomainEvent[] = [
    { type: "MODE_SET", payload: { mode: "EXPLORATION" }, version: 0 },
  ];
  await repo.appendEvents({} as any, session_id, 24, oneMore); // stream -> 25

  // Append tramite service (così passa dalla policy snapshot)
  const reqEvents: DomainEvent[] = [
  { type: "COMBAT_STARTED", payload: { participant_ids: ["e1", "e2"] }, version: 0 },
  { type: "COMBAT_ENDED", payload: {}, version: 0 },
];

await repo.insertSessionIfMissing({} as any, session_id, "default");

const initial = makeInitialSnapshot(session_id, "default");
initial.meta.version = 0;

// serve per validare COMBAT_STARTED (participant_ids devono esistere)
(initial as any).entities = {
  ...(initial as any).entities,
  e1: { id: "e1" },
  e2: { id: "e2" },
};

await repo.saveSnapshot({} as any, initial);

saveSpy.mockClear();


  // expected_version=25 => COMBAT_ENDED diventa version 26 (non multiplo di 25)
  await sss.appendEvents(session_id, {
  expected_version: 25,
  events: reqEvents,
});


  expect(saveSpy).toHaveBeenCalledTimes(1);

  const saved = saveSpy.mock.calls[0]![1];
  expect(saved.meta.session_id).toBe(session_id);
  expect(saved.meta.version).toBe(27);
});

  it("SssService: saveSnapshot scatta solo ogni N (N=3 nel test)", async () => {
    const repo = new InMemorySssRepository();
    const saveSpy = vi.spyOn(repo, "saveSnapshot");

    // N basso per far scattare la policy in pochi eventi
    const sss = new SssService(repo as any, allowAllRuleEngine, 3)
;

    const session_id = "S_SNAPSHOT_1";

    // La sessione nasce col primo append che deve includere SESSION_CREATED
    let state = await sss.appendEvents(session_id, {
      expected_version: 0,
      events: [
        {
          type: "SESSION_CREATED",
          payload: { ruleset: "test" },
        },
      ],
    });

    // Dopo la creazione, azzeriamo il contatore: ora verifichiamo solo gli snapshot "periodici"
    saveSpy.mockClear();

    const startVersion = state.meta.version;
    const mod = startVersion % 3;
    const stepsToNextMultiple = mod === 0 ? 3 : 3 - mod;
    const target = startVersion + stepsToNextMultiple;

    // Appendiamo eventi finché non raggiungiamo target-1: non deve scattare
    while (state.meta.version < target - 1) {
      state = await sss.appendEvents(session_id, {
        expected_version: state.meta.version,
        events: [
          {
            type: "ZONE_ADDED",
            payload: {
              zone_id: `Z_${state.meta.version}`,
              name: "Zone",
            },
          },
        ],
      });
    }

    expect(saveSpy).toHaveBeenCalledTimes(0);

    // Append che porta a target: qui deve scattare una volta
    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [
        {
          type: "ZONE_ADDED",
          payload: {
            zone_id: `Z_${state.meta.version}`,
            name: "Zone",
          },
        },
      ],
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const lastSaved = saveSpy.mock.calls[0]?.[1];
    expect(lastSaved.meta.version).toBe(state.meta.version);
    expect(state.meta.version).toBe(target);
  });
});
