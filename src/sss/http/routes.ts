import { FastifyInstance } from "fastify";
import { SssService } from "../service/sss.service";
import { SssError, ValidationError } from "../domain/errors";

export async function sssRoutes(app: FastifyInstance, opts: { sss: SssService }) {
  const sss = opts.sss;

  app.post("/sessions", async (req, reply) => {
    try {
      const body = req.body as { ruleset?: string } | undefined;
      const result = await sss.createSession(body?.ruleset ?? "5e");
      return reply.status(200).send({ ok: true, ...result });
    } catch (e: any) {
      if (e instanceof SssError) {
        return reply.status(e.statusCode).send({ ok: false, code: e.code, message: e.message });
      }
      req.log.error(e);
      return reply.status(500).send({ ok: false, code: "INTERNAL", message: "internal error" });
    }
  });

  app.get("/sessions/:id/state", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const state = await sss.getState(id);
      return reply.send(state);
    } catch (e: any) {
      if (e instanceof SssError) {
        return reply.status(e.statusCode).send({ ok: false, code: e.code, message: e.message });
      }
      req.log.error(e);
      return reply.status(500).send({ ok: false, code: "INTERNAL", message: "internal error" });
    }
  });

  app.get("/sessions/:id/events", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const q = req.query as any;

      const from = q?.from != null ? Number(q.from) : undefined;
      const to = q?.to != null ? Number(q.to) : undefined;

      if (q?.from != null && Number.isNaN(from)) throw new ValidationError(`invalid query param: from`);
      if (q?.to != null && Number.isNaN(to)) throw new ValidationError(`invalid query param: to`);

      const events = await sss.getEvents(id, from, to);

      return reply.send({
        ok: true,
        session_id: id,
        from: from ?? null,
        to: to ?? null,
        count: events.length,
        events,
      });
    } catch (e: any) {
      if (e instanceof SssError) {
        return reply.status(e.statusCode).send({ ok: false, code: e.code, message: e.message });
      }
      req.log.error(e);
      return reply.status(500).send({ ok: false, code: "INTERNAL", message: "internal error" });
    }
  });

  // ⭐ NUOVO — Punto B Step 1.2 (Replay deterministico)
  app.get("/sessions/:id/replay", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const q = req.query as any;

      const from = q?.from != null ? Number(q.from) : undefined;
      const to = q?.to != null ? Number(q.to) : undefined;

      if (q?.from != null && Number.isNaN(from)) throw new ValidationError(`invalid query param: from`);
      if (q?.to != null && Number.isNaN(to)) throw new ValidationError(`invalid query param: to`);
      if (from != null && to != null && from > to) {
        throw new ValidationError(`invalid range: from (${from}) > to (${to})`);
      }

      const result = await sss.replay(id, from, to);

      return reply.send({
        ok: true,
        session_id: id,
        ...result,
      });
    } catch (e: any) {
      if (e instanceof SssError) {
        return reply.status(e.statusCode).send({ ok: false, code: e.code, message: e.message });
      }
      req.log.error(e);
      return reply.status(500).send({ ok: false, code: "INTERNAL", message: "internal error" });
    }
  });

  app.post("/sessions/:id/events", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as any;

      const state = await sss.appendEvents(id, {
        expected_version: body?.expected_version,
        events: body?.events,
      });

      return reply.status(201).send({ ok: true, state });
    } catch (e: any) {
      if (e instanceof SssError) {
        return reply.status(e.statusCode).send({ ok: false, code: e.code, message: e.message });
      }
      req.log.error(e);
      return reply.status(500).send({ ok: false, code: "INTERNAL", message: "internal error" });
    }
  });
}
