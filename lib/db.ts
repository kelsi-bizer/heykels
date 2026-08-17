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

function client(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Constructed on first property access rather than at import.
 *
 * Importing a module that happens to sit beside a query — a pure ranking function,
 * a type — should not open a connection pool or demand DATABASE_URL. Eager
 * instantiation also makes every Cloud Run cold start pay for a pool the request
 * may never touch.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get: (_t, prop) => Reflect.get(client(), prop),
  has: (_t, prop) => Reflect.has(client(), prop),
});
