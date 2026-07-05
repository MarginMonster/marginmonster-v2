import { PrismaClient } from "@prisma/client";

declare global {
  var __db__: PrismaClient | undefined;
}

// Prevent multiple PrismaClient instances in dev (hot reload)
const db = global.__db__ || new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__db__ = db;

export { db };
