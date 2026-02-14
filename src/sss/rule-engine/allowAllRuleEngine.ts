import { RuleEngineGateway } from "./ruleEngineGateway";

export const allowAllRuleEngine: RuleEngineGateway = {
  evaluate() {
    return { allowed: true };
  },
};
