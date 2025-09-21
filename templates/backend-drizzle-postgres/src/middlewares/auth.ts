import { AuthRequest, HttpStatus } from "@/types/types";
import { getCookie, sendError, verifyToken } from "@/utils";
import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = getCookie(req, "token");

    if (!token) {
        return sendError(res, "No token provided", HttpStatus.UNAUTHORIZED);
    }

    try {
        const payload = verifyToken(token) as { id: number; username: string };
        req.user = payload;
        next();
    } catch (error) {
        return sendError(res, "Invalid token", HttpStatus.UNAUTHORIZED);
    }
};
