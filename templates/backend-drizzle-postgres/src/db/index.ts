import { drizzle } from "drizzle-orm/node-postgres";
import env from "@/config/env";
import { Pool } from "pg";

const pool = new Pool({ connectionString: env.DB_URL });
const db = drizzle(pool);

// const db = drizzle(env.DB_URL);

async function testDBConnection() {
    try {
        const result = await db.execute(`SELECT NOW()`);
        console.log("✅ Database connection works. Current time:", result.rows[0].now);
    } catch (error) {
        console.error("❌ Database connection failed:", error);
    }
}

testDBConnection();

export default db;
