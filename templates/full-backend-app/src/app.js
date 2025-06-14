import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { asyncHandler, ApiResponse } from './utils/index.js';
import errorHandler from './middlewares/errorHandler.middleware.js';
const app = express();

//* Middleware
app.use(express.json());
app.use(
    cors({
        origin: process.env.CORS_ORIGIN,
        credentials: true,
    })
);
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(cookieParser());

app.use(
    '/',
    asyncHandler(async (req, res) => {
        return res
            .send('Atarashi API')
            .status(200)
            .json(new ApiResponse(200, {}, 'Welcome to the Atarashi API'));
    })
);

//* Global Error Handler
app.use(errorHandler);

export { app };
