export class BrainError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "BrainError";
  }
}

export interface RevisionConflictDetail {
  path: string;
  expectedRevision?: string;
  currentRevision: string | null;
  /** Latest vault markdown for three-way merge on the client/agent. */
  markdown?: string;
}

export class NotFoundError extends BrainError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

export class ForbiddenError extends BrainError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

export class BadRequestError extends BrainError {
  constructor(message = "Bad request") {
    super(message, 400);
  }
}

export class UnauthorizedError extends BrainError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

export class ConflictError extends BrainError {
  constructor(message = "Conflict", public detail?: RevisionConflictDetail) {
    super(message, 409);
  }
}
