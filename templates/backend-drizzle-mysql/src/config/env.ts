import { z } from "zod";

const schema = z.object({
    NODE_ENV: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
    PORT: z.coerce.number().default(3000),
    CORS_ORIGIN: z.string(),
    JWT_SECRET: z.string(),
    JWT_EXPIRY: z.string(),

    DB_HOST: z.string().optional(),
    DB_PORT: z.coerce.number().optional(),
    DB_USER: z.string().optional(),
    DB_PASSWORD: z.string().optional(),
    DB_DATABASE: z.string().optional(),
});

export default schema.parse(process.env);
