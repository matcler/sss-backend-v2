import { Snapshot, DomainEvent } from "./types";
import { validateEvent } from "./validate";
import { applyEvent } from "./apply";

export function reduce(snapshot: Snapshot, events: DomainEvent[]): Snapshot {
  let current = snapshot;
  for (const ev of events) {
    validateEvent(current, ev);
    current = applyEvent(current, ev);
  }
  return current;
}
