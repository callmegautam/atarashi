import { cookieOptions } from "@/config/cookies";
import { Request, Response } from "express";

export const setCookie = (res: Response, key: string, data: any) => {
    res.cookie(key, data, cookieOptions);
};

export const getCookie = (req: Request, key: string) => {
    return req.cookies?.[key];
};
