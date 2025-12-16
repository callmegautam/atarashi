import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import env from '@/config/env';
import { NodeEnv } from '@/types/types';

const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const statusCode = err.statusCode || 500;
  const node_env = env.NODE_ENV || NodeEnv.DEVELOPMENT;

  if (node_env !== NodeEnv.PRODUCTION) {
    console.error(err.stack || err);
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      data: err.message,
    });
  }

  if (err.statusCode && err.message) {
    return res.status(statusCode).json({
      success: false,
      message: err.message,
      data: null,
    });
  }

  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    data: err,
  });
};

export default globalErrorHandler;
