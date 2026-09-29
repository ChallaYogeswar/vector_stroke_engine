export interface VercelRequest {
  method?: string;
  body?: unknown;
}

export interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): VercelResponse;
}