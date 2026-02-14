export class SssError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 400) {
    super(message);
  }
}

export class NotFoundError extends SssError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
  }
}

export class ConflictError extends SssError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}

export class SnapshotMissingError extends SssError {
  constructor(message: string) {
    super(message, "SNAPSHOT_MISSING", 409);
  }
}

export class ValidationError extends SssError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class DomainError extends SssError {
  constructor(message: string) {
    super(message, "DOMAIN_ERROR", 400);
  }
}
