import { readFileSync, existsSync } from "fs";
import os from "os";
import path from "path";

/**
 * Reads a persistent secrets file and returns its KEY=value pairs.
 *
 * Why this exists: on Hostinger's Node hosting the launcher injects env vars
 * from a store that the panel doesn't reliably update — after a Supabase
 * password reset the running app kept a stale DATABASE_URL and every redeploy
 * re-applied it. The secrets file lives in a location that survives redeploys
 * (the home dir, and the persistent public_html sibling of the rebuilt app
 * dir) and outside git.
 *
 * IMPORTANT: consumers should call getPersistentSecrets() explicitly and read
 * the returned value, rather than relying on a bare side-effect import — under
 * bundling the import order relative to Prisma client creation is not
 * guaranteed, which previously let a stale process.env.DATABASE_URL win.
 */

export type Secrets = Record<string, string>;

let cache: Secrets | null = null;

function candidatePaths(): string[] {
  const paths: string[] = [];
  if (process.env.PERSISTENT_ENV_FILE) paths.push(process.env.PERSISTENT_ENV_FILE);
  try {
    paths.push(path.join(os.homedir(), "portal-secrets.env"));
  } catch {
    /* ignore */
  }
  paths.push(path.join(process.cwd(), "..", "public_html", "portal-secrets.env"));
  return paths;
}

function parseEnv(contents: string): Secrets {
  const out: Secrets = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Parsed secrets (memoized). Empty object when no file is found. */
export function getPersistentSecrets(): Secrets {
  if (cache) return cache;
  for (const filePath of candidatePaths()) {
    try {
      if (!filePath || !existsSync(filePath)) continue;
      const parsed = parseEnv(readFileSync(filePath, "utf8"));
      if (Object.keys(parsed).length > 0) {
        cache = parsed;
        return cache;
      }
    } catch {
      /* try next candidate */
    }
  }
  cache = {};
  return cache;
}

/** Applies the persistent secrets over process.env and returns them. */
export function applyPersistentEnv(): Secrets {
  const secrets = getPersistentSecrets();
  for (const [key, value] of Object.entries(secrets)) {
    process.env[key] = value;
  }
  return secrets;
}

// Also apply on import as a belt-and-suspenders for consumers that read
// process.env directly (uploads, resend, auth).
applyPersistentEnv();
