import "dotenv/config";
import Fastify from "fastify";
import { env, getMaskedDatabaseLogInfo } from "./config/env";
import { SssService } from "./sss/service/sss.service";
import { sssRoutes } from "./sss/http/routes";
import { ContractRuleEngineGateway } from "./sss/rule-engine/contractRuleEngineGateway";
import { ruleEngine } from "./sss/rule-engine/localContractRuleEngine";
import { createRepositoryFromEnv } from "./sss/db/repoFactory";

async function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  const dbInfo = getMaskedDatabaseLogInfo(env.DATABASE_URL);
  app.log.info(
    `SSS DB connectionString=${dbInfo.connectionString} (db=${dbInfo.db} host=${dbInfo.host} port=${dbInfo.port} user=${dbInfo.user})`
  );

  const { repo, close } = createRepositoryFromEnv();

  const gateway = new ContractRuleEngineGateway(ruleEngine, {
    aiEntityWhitelist: ["ai"],
  });
  const sss = new SssService(repo, gateway);

  await app.register(sssRoutes, { sss });

  if (close) {
    app.addHook("onClose", async () => {
      await close();
    });
  }

  return app;
}

async function main() {
  const app = await buildServer();
  const port = env.PORT;

  await app.listen({ port, host: "127.0.0.1" });
  app.log.info(`listening on http://127.0.0.1:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
