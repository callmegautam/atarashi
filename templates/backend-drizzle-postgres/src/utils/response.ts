import { Response } from "express";
import { ApiResponse } from "@/types/types";

export const sendSuccess = <T>(res: Response, data: T, statusCode = 200) => {
    const payload: ApiResponse<T> = { success: true, data };
    return res.status(statusCode).json(payload);
};

export const sendError = (res: Response, error: string, statusCode = 500) => {
    const payload: ApiResponse<null> = { success: false, error };
    return res.status(statusCode).json(payload);
};
