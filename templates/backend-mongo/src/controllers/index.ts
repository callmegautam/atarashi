import { Request, Response } from "express";
import { asyncHandler } from "@/utils/index";

export const atarashi = asyncHandler(async (req: Request, res: Response) => {
    return res.status(200).json({
        success: true,
        message: "Atarashi Backend",
        data: null,
    });
});
