import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    const statusCode = err.statusCode || 500;
    const env = process.env.NODE_ENV || "DEVELOPMENT";

    if (env !== "PRODUCTION") {
        console.error(err.stack || err);
    }

    if (err instanceof ZodError) {
        return res.status(400).json({
            success: false,
            message: "Validation Error",
            data: err.errors.map((e) => ({
                path: e.path.join("."),
                message: e.message,
            })),
        });
    }

    if (err.statusCode && err.message) {
        return res.status(statusCode).json({
            success: false,
            message: err.message,
            data: null,
        });
    }

    return res.status(500).json({
        success: false,
        message: "Internal Server Error",
        data: null,
    });
};

export default globalErrorHandler;
