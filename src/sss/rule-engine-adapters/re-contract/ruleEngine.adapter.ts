import type { RuleEngineDecision } from "../../rule-engine/ruleEngineGateway";
import type { RuleEngine as ContractRuleEngine } from "../../rule-engine/reContract";
import { ReasonCode } from "../../rule-engine/reContract";
import { mapSnapshot, SssSnapshot } from "./snapshot.mapper";
import { mapEvent, SssEvent } from "./event.mapper";

/**
 * Adapter tra SSS e Rule Engine.
 * L'implementazione reale del Rule Engine viene iniettata.
 */
export class RuleEngineAdapter {
  constructor(private readonly engine: ContractRuleEngine) {}

  evaluate(
    snapshot: SssSnapshot,
    event: SssEvent
  ): RuleEngineDecision {
    const ruleSnapshot = mapSnapshot(snapshot);
    const ruleEvent = mapEvent(event);
    if (!ruleEvent) {
      return { allowed: false, code: ReasonCode.UNKNOWN_EVENT };
    }

    return this.engine.evaluate(ruleSnapshot, ruleEvent);
  }
}
