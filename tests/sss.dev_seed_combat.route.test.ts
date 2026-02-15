import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { sssRoutes } from "../src/sss/http/routes";
import { env } from "../src/config/env";

const originalNodeEnv = env.NODE_ENV;

afterEach(() => {
  (env as any).NODE_ENV = originalNodeEnv;
});

describe("POST /sessions/:id/dev/seed-combat route", () => {
  it("returns 404 in production", async () => {
    (env as any).NODE_ENV = "production";
    const app = Fastify();
    await app.register(sssRoutes, {
      sss: {
        devSeedCombat: async () => {
          throw new Error("should not be called");
        },
      } as any,
    });

    const res = await app.inject({
      method: "POST",
      url: "/sessions/s1/dev/seed-combat",
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 200 in dev when service succeeds", async () => {
    (env as any).NODE_ENV = "development";
    const app = Fastify();
    await app.register(sssRoutes, {
      sss: {
        devSeedCombat: async (sessionId: string) => ({
          session_id: sessionId,
          version: 42,
          mode: "COMBAT",
          phase: "ACTION_WINDOW",
          active_entity: "e1",
        }),
      } as any,
    });

    const res = await app.inject({
      method: "POST",
      url: "/sessions/s1/dev/seed-combat",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.active_entity).toBe("e1");
    await app.close();
  });
});
