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
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
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
    throw new Error(
      "No database configured. Set DATABASE_URL, or CLOUD_SQL_CONNECTION_NAME + DB_USER for Cloud SQL.",
    );
  }
  return url;
}
