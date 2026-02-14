// src/sss/db/__mocks__/inMemoryRepository.ts

// NOTE: potresti dover adattare questi type/import ai tuoi reali file.
// L'obiettivo è: stream version authoritative + optimistic concurrency.

export type StreamId = string;

// Adatta questo tipo al tuo DomainEvent reale (src/sss/domain/types.ts)
export type DomainEvent = {
  type: string;
  payload?: unknown;
  meta?: Record<string, unknown>;
  version?: number; // importante: la version viene assegnata dal repo
};

export class ConcurrencyConflictError extends Error {
  constructor(message = "Optimistic concurrency conflict") {
    super(message);
    this.name = "ConcurrencyConflictError";
  }
}

export class InMemoryRepository {
  private streams = new Map<StreamId, DomainEvent[]>();

  /**
   * Ritorna tutti gli eventi persistiti per lo stream, in ordine.
   */
  async loadEvents(streamId: StreamId): Promise<DomainEvent[]> {
    return (this.streams.get(streamId) ?? []).map(e => ({ ...e }));
  }

  /**
   * Appende eventi allo stream con optimistic concurrency:
   * - expectedVersion deve corrispondere alla last persisted version (o -1 se vuoto)
   * - assegna version sequenziale agli eventi inseriti
   * - ritorna gli eventi persistiti (con version)
   */
  async appendEvents(
    streamId: StreamId,
    events: DomainEvent[],
    expectedVersion: number
  ): Promise<DomainEvent[]> {
    const current = this.streams.get(streamId) ?? [];
    const lastVersion = current.length ? (current[current.length - 1].version ?? -1) : -1;

    if (expectedVersion !== lastVersion) {
      throw new ConcurrencyConflictError(
        `expected_version=${expectedVersion} does not match stream_version=${lastVersion}`
      );
    }

    let nextVersion = lastVersion;
    const persisted = events.map(e => {
      nextVersion += 1;
      return { ...e, version: nextVersion };
    });

    this.streams.set(streamId, [...current, ...persisted]);
    return persisted.map(e => ({ ...e }));
  }

  /**
   * Utility: versione attuale dello stream.
   */
  async getStreamVersion(streamId: StreamId): Promise<number> {
    const current = this.streams.get(streamId) ?? [];
    return current.length ? (current[current.length - 1].version ?? -1) : -1;
  }
}
