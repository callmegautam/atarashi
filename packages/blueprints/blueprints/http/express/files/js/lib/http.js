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

export function sendSuccess(res, data, status = HttpStatus.OK) {
  return res.status(status).json({ success: true, data });
}

export function sendError(res, error, status = HttpStatus.INTERNAL_SERVER_ERROR, details) {
  return res.status(status).json({
    success: false,
    error,
    ...(details === undefined ? {} : { details }),
  });
}
