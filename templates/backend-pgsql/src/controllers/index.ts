import { Request, Response } from 'express';
import { asyncHandler, sendSuccess } from '@/utils/index';
import { HttpStatus } from '@/types/types';

export const atarashi = asyncHandler(async (req: Request, res: Response) => {
  return sendSuccess(res, 'hello', HttpStatus.OK);
});
