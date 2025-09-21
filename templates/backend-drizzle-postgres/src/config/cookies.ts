import { NodeEnv } from "@/types/types";
import env from "./env";
import { CookieOptions } from "express";

export const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === NodeEnv.PRODUCTION,
    maxAge: 1000 * 60 * 60 * 24 * 1,
    sameSite: "strict" as const,
    // domain: only set in production if needed
    path: "/",
};
