import { PrismaClient } from "@prisma/client";
import { prepareDemoDb } from "./demo-db";

const db = new PrismaClient();
try {
  await prepareDemoDb(db);
} finally {
  await db.$disconnect();
}
