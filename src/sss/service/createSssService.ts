import type { RuleEngineGateway } from "../rule-engine/ruleEngineGateway";
import { allowAllRuleEngine } from "../rule-engine/allowAllRuleEngine";
import { createRepositoryFromEnv } from "../db/repoFactory";
import type { SssRepository } from "../db/repository";
import { SssService } from "./sss.service";
import { env } from "../../config/env";

export function createSssService(options?: {
  repo?: SssRepository;
  ruleEngine?: RuleEngineGateway;
  snapshotEvery?: number;
}): { sss: SssService; close?: () => Promise<void> } {
  if (options?.repo) {
    return {
      sss: new SssService(
        options.repo,
        options.ruleEngine ?? allowAllRuleEngine,
        options.snapshotEvery ?? env.SNAPSHOT_EVERY
      ),
    };
  }

  const { repo, close } = createRepositoryFromEnv();
  const sss = new SssService(
    repo,
    options?.ruleEngine ?? allowAllRuleEngine,
    options?.snapshotEvery ?? env.SNAPSHOT_EVERY
  );

  return { sss, close };
}
