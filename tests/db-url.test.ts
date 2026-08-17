import { describe, expect, it } from "vitest";
import { UNCONFIGURED_DATABASE_URL, resolveDatabaseUrl } from "@/lib/db-url";

describe("resolveDatabaseUrl", () => {
  it("uses DATABASE_URL verbatim", () => {
    const url = "postgresql://me:secret@db.example.com:5432/heykels?schema=public";
    expect(resolveDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  });

  describe("Cloud SQL", () => {
    it("builds a unix-socket URL, since Cloud Run has no TCP host to point at", () => {
      const url = resolveDatabaseUrl({
        CLOUD_SQL_CONNECTION_NAME: "proj:us-central1:heykels-db",
        DB_USER: "heykels",
        DB_PASSWORD: "pw",
        DB_NAME: "heykels",
      });
      // The socket directory belongs in the host query param, not the authority.
      expect(url).toBe(
        "postgresql://heykels:pw@localhost/heykels?host=/cloudsql/proj:us-central1:heykels-db",
      );
    });

    it("wins over DATABASE_URL, because the socket is the only reachable path", () => {
      const url = resolveDatabaseUrl({
        DATABASE_URL: "postgresql://localhost:5432/ignored",
        CLOUD_SQL_CONNECTION_NAME: "p:r:i",
        DB_USER: "u",
      });
      expect(url).toContain("host=/cloudsql/p:r:i");
      expect(url).not.toContain("ignored");
    });

    it("percent-encodes credentials so a password with symbols cannot corrupt the URL", () => {
      const url = resolveDatabaseUrl({
        CLOUD_SQL_CONNECTION_NAME: "p:r:i",
        DB_USER: "user@corp",
        DB_PASSWORD: "p@ss:word/!",
      });
      expect(url).toContain("user%40corp:p%40ss%3Aword%2F!@localhost");
    });

    it("fails loudly when the user is missing rather than building a broken URL", () => {
      expect(() => resolveDatabaseUrl({ CLOUD_SQL_CONNECTION_NAME: "p:r:i" })).toThrow(/DB_USER/);
    });
  });

  describe("when nothing is configured", () => {
    it("throws by default", () => {
      expect(() => resolveDatabaseUrl({})).toThrow(/No database configured/);
    });

    it("yields an unresolvable placeholder when not required", () => {
      // Schema-only Prisma commands load the config but never connect. Demanding a
      // real URL there breaks `prisma generate` in CI and in the Docker build.
      expect(resolveDatabaseUrl({}, { required: false })).toBe(UNCONFIGURED_DATABASE_URL);
      // It must be parseable, or Prisma rejects the config before it can be used.
      expect(() => new URL(UNCONFIGURED_DATABASE_URL)).not.toThrow();
      // …and it must not silently point somewhere real.
      expect(UNCONFIGURED_DATABASE_URL).toContain(".invalid");
    });
  });
});
