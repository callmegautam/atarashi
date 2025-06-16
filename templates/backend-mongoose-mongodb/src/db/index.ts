import { connect, connection } from "mongoose";
import env from "@/config/env";

const connectDB = async () => {
    try {
        await connect(`${env.MONGODB_URL}/${env.MONGODB_DATABASE}`);
        console.log("✅ MongoDB connected successfully to :", env.MONGODB_DATABASE);
    } catch (error) {
        console.error("❌ MongoDB connection failed:", error);
        process.exit(1);
    }
};

export { connectDB };
