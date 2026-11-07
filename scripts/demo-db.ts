import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";

const migrations = [
  "../prisma/migrations/20240530213853_create_session_table/migration.sql",
  "../prisma/migrations/20261115000000_inventory/migration.sql",
];

export async function prepareDemoDb(db: PrismaClient) {
  const files = await Promise.all(migrations.map(name => readFile(new URL(name, import.meta.url), "utf8")));
  const statements = files.flatMap(sql => sql.split(";").filter(statement => statement.trim()));
  await db.$transaction(statements.map(statement =>
    db.$executeRawUnsafe(statement.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"))));
}
