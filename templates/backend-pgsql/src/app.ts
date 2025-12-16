import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import env from '@/config/env';
import globalErrorHandler from '@/middlewares/error-handler';
import { sendError, sendSuccess } from '@/utils';
import { HttpStatus } from '@/types/types';

const app = express();

const isProduction = env.NODE_ENV === 'PRODUCTION';

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);
app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.all('/', async (_: Request, res: Response) => {
  return sendSuccess(res, 'backend is running', HttpStatus.OK);
});

app.use('*', (_: Request, res: Response) => {
  return sendError(res, 'Api not found', HttpStatus.NOT_FOUND);
});

app.use(globalErrorHandler);

export { app };
