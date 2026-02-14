import type { Snapshot, DomainEvent } from "../domain/types";

export type RuleEngineDecision =
  | { allowed: true }
  | { allowed: false; code: string; message?: string };

export interface RuleEngineGateway {
  evaluate(snapshot: Snapshot, event: DomainEvent): RuleEngineDecision;
}

