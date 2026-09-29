/** Bad client input — missing or oversized image, malformed request body. Maps to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** The AI call succeeded, but its response didn't parse into the shape the caller asked for (path-feeder's strict-JSON contract, specifically). Maps to HTTP 502 — the request was fine, the upstream response wasn't usable. */
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelOutputError';
  }
}
