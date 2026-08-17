import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveDatabaseUrl } from "./db-url";

// Prisma 7 takes its connection through a driver adapter rather than a `url` in
// the schema. The pg pool also gives Cloud Run a place to cap connections —
// Cloud SQL has a hard connection limit and each Cloud Run instance holds its own
// pool, so an unbounded default will exhaust the instance under concurrency.
function createClient() {
  const adapter = new PrismaPg({
    connectionString: resolveDatabaseUrl(),
    max: Number(process.env.DB_POOL_MAX ?? 5),
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Next.js dev server hot-reloads modules; without this every reload would open a
// new pool and leak connections until Postgres refuses them.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
