/**
 * Resolves the Postgres connection string.
 *
 * Two shapes, one function, so local dev and Cloud Run don't drift:
 *
 *  - Local / any TCP host: DATABASE_URL is used verbatim.
 *  - Cloud Run → Cloud SQL: the Cloud SQL Auth proxy is mounted as a unix socket at
 *    /cloudsql/<connection-name>. There is no TCP host to point at, so the URL is
 *    built from the instance connection name and credentials instead.
 *
 * Cloud SQL wins when CLOUD_SQL_CONNECTION_NAME is set, because on Cloud Run the
 * socket is the only reachable path to the database.
 */
/**
 * A syntactically valid URL that cannot resolve.
 *
 * Schema-only Prisma commands (`generate`, `validate`, `format`) never open a
 * connection but still load the config, so demanding a real URL would break them
 * anywhere the environment isn't populated — CI, a fresh clone, the Docker build.
 * Anything that does try to connect fails against a self-describing host rather
 * than a confusing default like localhost.
 */
export const UNCONFIGURED_DATABASE_URL =
  "postgresql://unset:unset@database-not-configured.invalid:5432/unset?schema=public";

/** Only a handful of keys are read, so the parameter is typed to that rather than the full ProcessEnv. */
type EnvLike = Record<string, string | undefined>;

export function resolveDatabaseUrl(
  env: EnvLike = process.env,
  { required = true }: { required?: boolean } = {},
): string {
  const socket = env.CLOUD_SQL_CONNECTION_NAME;

  if (socket) {
    const user = env.DB_USER;
    const password = env.DB_PASSWORD;
    const name = env.DB_NAME ?? "heykels";
    if (!user) {
      throw new Error(
        "CLOUD_SQL_CONNECTION_NAME is set but DB_USER is missing — cannot build the Cloud SQL connection string.",
      );
    }
    const auth = password
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
      : encodeURIComponent(user);
    // The socket directory goes in the `host` query parameter, not the authority.
    return `postgresql://${auth}@localhost/${name}?host=/cloudsql/${socket}`;
  }

  const url = env.DATABASE_URL;
  if (!url) {
    if (!required) return UNCONFIGURED_DATABASE_URL;
    throw new Error(
      "No database configured. Set DATABASE_URL, or CLOUD_SQL_CONNECTION_NAME + DB_USER for Cloud SQL.",
    );
  }
  return url;
}
