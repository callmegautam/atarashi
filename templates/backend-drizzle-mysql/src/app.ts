import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import env from "@/config/env";
import globalErrorHandler from "@/middlewares/errorHandler";

// Importing routes
import atarashiRoutes from "@/routes/index.routes";

const app = express();

const isProduction = env.NODE_ENV === "PRODUCTION";

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
    return res.status(200).json({
        success: true,
        message: "Atarashi Backend",
        data: null,
    });
});

app.use("/api/v1/", atarashiRoutes);

app.use("*", (_: Request, res: Response) => {
    return res.status(404).json({
        success: false,
        message: "API Not Found",
        data: null,
    });
});

app.use(globalErrorHandler);

export { app };
