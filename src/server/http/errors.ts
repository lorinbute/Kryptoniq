// HTTP-mapped error types (404 / 409); validation errors live in settings.ts, auth errors carry their status.
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
