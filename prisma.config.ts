import { defineConfig } from "prisma/config";
import { resolveDatabaseUrl } from "./lib/db-url";

// Prisma 7 no longer loads .env implicitly, and the CLI evaluates this file before
// Next.js is ever involved — so load it here or every CLI command runs unconfigured.
try {
  process.loadEnvFile();
} catch {
  // No .env on disk (CI, Cloud Run) — the environment already carries the values.
}

// Prisma 7 reads migrate/introspect connection details from here rather than
// from a `url` in schema.prisma.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Not required here: this file is loaded by every Prisma command, including the
    // schema-only ones that never connect. Commands that do connect surface a clear
    // failure against the placeholder host instead.
    url: resolveDatabaseUrl(process.env, { required: false }),
  },
});
