import { describe, expect, it } from "vitest";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import { SssService } from "../src/sss/service/sss.service";

describe("dev seed combat", () => {
  it("seeds a session into COMBAT ACTION_WINDOW and persists snapshot", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo as any);

    const created = await svc.createSession("5e");
    const seeded = await svc.devSeedCombat(created.session_id, {
      actorId: "e1",
      enemyId: "m1",
      seed: 1,
      positions: {
        actor: { x: 0, y: 0 },
        enemy: { x: 1, y: 0 },
      },
    });

    expect(seeded.session_id).toBe(created.session_id);
    expect(seeded.mode).toBe("COMBAT");
    expect(seeded.phase).toBe("ACTION_WINDOW");
    expect(seeded.active_entity).toBe("e1");

    const state = await svc.getState(created.session_id);
    expect(state.mode).toBe("COMBAT");
    expect(state.combat.active).toBe(true);
    expect(state.combat.phase).toBe("ACTION_WINDOW");
    expect(state.combat.action_used).toBe(false);
    expect(state.combat.movement_remaining).toBe(6);
    expect(state.combat.active_entity).toBe("e1");
    expect(state.combat.turn_actions_used).toBe(0);
    expect(state.combat.initiative.length).toBeGreaterThanOrEqual(2);
    expect((state.combat.initiative_entries ?? []).length).toBeGreaterThanOrEqual(2);

    const latestSnapshot = await repo.withTx((client) =>
      repo.getLatestSnapshot(client as any, created.session_id)
    );
    expect(latestSnapshot).toBeTruthy();
    expect(latestSnapshot?.meta.version).toBe(state.meta.version);
  });

  it("is soft-idempotent when already in valid combat state", async () => {
    const repo = new InMemorySssRepository();
    const svc = new SssService(repo as any);

    const created = await svc.createSession("5e");
    const first = await svc.devSeedCombat(created.session_id, { actorId: "e1", enemyId: "m1" });
    const second = await svc.devSeedCombat(created.session_id, { actorId: "e1", enemyId: "m1" });

    expect(second.version).toBe(first.version);
    expect(second.active_entity).toBe("e1");
    expect(second.phase).toBe("ACTION_WINDOW");
  });
});
