import { app } from "@/app";
import env from "@/config/env";
import { connectDB } from "@/db";

const port = env.PORT ?? 3000;

connectDB()
    .then(() => {
        app.listen(port, () => {
            console.log(`✅ Server is running on port ${port}`);
        });
    })
    .catch((error) => {
        console.error("❌ Failed to start the server:", error);
        process.exit(1);
    });
