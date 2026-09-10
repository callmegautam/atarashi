import type { Response } from 'express';

export const HttpStatus = Object.freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
});

export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus];

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: string;
  details?: unknown;
}

export function sendSuccess<T>(res: Response, data: T, status: number = HttpStatus.OK) {
  const body: ApiSuccess<T> = { success: true, data };
  return res.status(status).json(body);
}

export function sendError(
  res: Response,
  error: string,
  status: number = HttpStatus.INTERNAL_SERVER_ERROR,
  details?: unknown,
) {
  const body: ApiFailure = { success: false, error, ...(details === undefined ? {} : { details }) };
  return res.status(status).json(body);
}
