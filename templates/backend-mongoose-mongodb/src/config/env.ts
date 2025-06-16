import { z } from "zod";

const schema = z.object({
    NODE_ENV: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
    PORT: z.coerce.number().default(3000),
    CORS_ORIGIN: z.string(),
    DB_URL: z.string(),
    JWT_SECRET: z.string(),
    JWT_EXPIRY: z.string(),
    MONGODB_URL: z.string(),
    MONGODB_DATABASE: z.string(),
});

export default schema.parse(process.env);
