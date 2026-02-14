import { RuleEnginePort, RuleEngineDecision } from "../../ports/ruleEnginePort";
import { mapSnapshot, SssSnapshot } from "./snapshotMapper";
import { mapEvent, SssEvent } from "./eventMapper";

/**
 * Adapter tra SSS e Rule Engine.
 * L'implementazione reale del Rule Engine viene iniettata.
 */
export class RuleEngineAdapter implements RuleEnginePort {
  constructor(private readonly engine: RuleEnginePort) {}

  evaluate(
    snapshot: SssSnapshot,
    event: SssEvent
  ): RuleEngineDecision {
    const ruleSnapshot = mapSnapshot(snapshot);
    const ruleEvent = mapEvent(event);

    return this.engine.evaluate(ruleSnapshot, ruleEvent);
  }
}

