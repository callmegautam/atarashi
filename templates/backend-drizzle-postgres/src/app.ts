import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import env from "@/config/env";
import globalErrorHandler from "@/middlewares/error-handler";
import { HttpStatus, NodeEnv } from "./types/types";

// Importing routes
import atarashiRoutes from "@/routes";
import { sendSuccess } from "./utils";

const app = express();

const isProduction = env.NODE_ENV === NodeEnv.PRODUCTION;

app.use(
    cors({
        origin: env.CORS_ORIGIN,
        credentials: true,
    })
);
app.use(morgan(isProduction ? "combined" : "dev"));
app.use(express.json());
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", async (_: Request, res: Response) => {
    return sendSuccess(res, "Atarashi is running", HttpStatus.OK);
});

app.use("/api/", atarashiRoutes);

app.use("*", (_: Request, res: Response) => {
    return res.status(404).json({
        success: false,
        message: "API Not Found",
        data: null,
    });
});

app.use(globalErrorHandler);

export { app };
