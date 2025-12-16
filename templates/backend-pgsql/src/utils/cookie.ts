import { Request, Response } from 'express';
import { cookieOptions } from '@/config/cookies';

export const setCookie = (res: Response, key: string, data: any) => {
  res.cookie(key, data, cookieOptions);
};

export const getCookie = (req: Request, key: string) => {
  return req.cookies?.[key];
};

export const removeCookie = (res: Response, key: string) => {
  res.clearCookie(key);
};
