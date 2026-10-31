import mongoose from 'mongoose';
import { config } from './config';

export async function connectDatabase(): Promise<void> {
  const uri = config.MONGODB_URI;

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2500,
    });
    console.log(`[Database] Connected successfully to MongoDB at ${uri}`);
  } catch (error) {
    console.warn(`[Database] Warning: Could not connect to MongoDB at ${uri} (${(error as Error).message}).`);
    console.warn(`[Database] In-memory persistence fallback is active for local development/testing.`);
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
