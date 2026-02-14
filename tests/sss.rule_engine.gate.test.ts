import { describe, it, expect, vi } from "vitest";
import { SssService } from "../src/sss/service/sss.service";
import { InMemorySssRepository } from "../src/sss/db/__mocks__/inMemorySssRepository";
import type { RuleEngineGateway } from "../src/sss/rule-engine/ruleEngineGateway";
import type { DomainEvent } from "../src/sss/domain/types";

describe("RuleEngine gate", () => {
  it("denied event must NOT be persisted", async () => {
    const repo = new InMemorySssRepository();
    const appendSpy = vi.spyOn(repo, "appendEvents");

    const denyGateway: RuleEngineGateway = {
      evaluate(_snapshot, event) {
        // Permettiamo bootstrap, neghiamo l'evento che vogliamo testare
        if (event.type === "SESSION_CREATED") return { allowed: true };
        return { allowed: false, code: "TEST_DENIED" };
      },
    };

    const sss = new SssService(repo as any, denyGateway, 999_999);

    const sessionId = "test-session";

    const events: DomainEvent[] = [
      { type: "SESSION_CREATED", payload: { ruleset: "dnd5e" } } as any,
      { type: "MODE_SET", payload: { mode: "COMBAT" } } as any,
    ];

    await expect(
      sss.appendEvents(sessionId, { expected_version: 0, events })
    ).rejects.toThrow(/TEST_DENIED|RULE_DENIED/i);

    // Deve NON aver scritto eventi nello stream
    const persisted = await repo.withTx((client) =>
      repo.getEventsInRange(client as any, sessionId)
    );
    expect(persisted).toHaveLength(0);

    // E idealmente non dovrebbe nemmeno aver chiamato appendEvents (dipende da dove hai messo il gate)
    expect(appendSpy).not.toHaveBeenCalled();
  });
});
