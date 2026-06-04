import mongoose from "mongoose";
import logger from "./logger";
import { InternalError } from "../core/ApiError";

const connectDB = async () => {
  try{
    logger.info("Connecting DB", {
      url: process.env.MONGO_URI,
    })
    const url = process.env.MONGO_URI
    if(!url){
      throw new InternalError("DB_CONNECTION_ERROR", "MONGOOSE_URL is not defined in environment variables")
    }
    await mongoose.connect(url)
    logger.info("DB Connected")
    logger.info("DB Connected on url: ", url)
  }catch(error){
    logger.error("DB connection failed", {
      message: (error as Error).message,
      stack: (error as Error).stack,
    })
    process.exit(1);
  }
};

export default connectDB;