import { describe, it, expect } from "vitest";

import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";

describe("Micro: MODE_SET non deve attivare combat", () => {
  it("MODE_SET(COMBAT) cambia solo mode, non combat.active / active_entity", async () => {
    const repo = new InMemorySssRepository();
    const sss = new SssService(repo as any);

    const session_id = "micro-mode-set";
    let state = await sss.appendEvents(session_id, {
      expected_version: 0,
      events: [{ type: "SESSION_CREATED", payload: { ruleset: "5e" } }],
    });

    // precondizioni (snapshot iniziale)
    expect(state.mode).toBe("EXPLORATION");
    expect(state.combat.active).toBe(false);
    expect(state.combat.active_entity).toBeNull();

    // cambia solo la modalità
    state = await sss.appendEvents(session_id, {
      expected_version: state.meta.version,
      events: [{ type: "MODE_SET", payload: { mode: "COMBAT" } }],
    });

    expect(state.mode).toBe("COMBAT");
    expect(state.combat.active).toBe(false);
    expect(state.combat.active_entity).toBeNull();
  });
});
