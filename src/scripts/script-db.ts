import path from "path";
import dotenv from "dotenv";

/**
 * Resolves the database an account script should write to.
 *
 * These scripts used to call bare `dotenv.config()`, which looks for `.env` —
 * a file this repo does not have — and then fell back to a local
 * `tms_test` database. The script reported success while the account landed in
 * a throwaway database, so the new account could not log in anywhere.
 *
 * Env files are loaded by path, and a missing MONGO_URI is fatal rather than
 * silently redirected. Set MONGO_URI in the environment to target another
 * deployment, or pass TMS_ENV_FILE to load a different env file (e.g. prod.env).
 */
export function resolveScriptMongoUri(): string {
  const envFile = process.env.TMS_ENV_FILE || "dev.env";
  dotenv.config({ path: path.join(__dirname, "..", "..", envFile) });

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error(
      `MONGO_URI is not set. Add it to ${envFile}, export it in the shell, ` +
        "or point TMS_ENV_FILE at the env file for the deployment you mean.",
    );
  }
  return mongoUri;
}

/** Host and database name only — safe to print, never the credentials. */
export function describeMongoTarget(mongoUri: string): string {
  try {
    const { host, pathname } = new URL(mongoUri);
    return `${host}${pathname}`;
  } catch {
    return "(unparseable MONGO_URI)";
  }
}
