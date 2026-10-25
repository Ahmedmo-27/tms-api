/**
 * Integration harness: the real Express app against an in-memory mongod
 * replica set (a replica set, not a standalone, because the app's writes run
 * in transactions).
 *
 * Suites under src/tests/integration/** use this; they are excluded from the
 * unit run and have a CI job of their own.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";

let replSet: MongoMemoryReplSet;
let app: Express;

export async function startHarness(): Promise<Express> {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-secret";
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  // app.ts uses `module.exports = app`, so this must be a require.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  app = require("../../app") as Express;
  return app;
}

export async function stopHarness(): Promise<void> {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

export function api() {
  return request(app);
}

export async function clearDb(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  for (const c of collections) await c.deleteMany({});
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
