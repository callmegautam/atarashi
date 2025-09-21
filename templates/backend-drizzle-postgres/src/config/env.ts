import { NodeEnv } from "@/types/types";
import { z } from "zod";

const schema = z.object({
    NODE_ENV: z.nativeEnum(NodeEnv).default(NodeEnv.DEVELOPMENT),
    PORT: z.coerce.number().default(3000),
    CORS_ORIGIN: z.string(),
    DB_URL: z.string(),
    JWT_SECRET: z.string(),
    JWT_EXPIRY: z.string(),
});

export default schema.parse(process.env);
