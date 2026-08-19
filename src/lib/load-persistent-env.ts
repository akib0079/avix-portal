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
  // The override exists purely for the production host. In local dev the
  // developer's ~/portal-secrets.env (kept for deploys) must NOT hijack
  // DATABASE_URL — that points dev at the production database.
  if (process.env.NODE_ENV === "development") {
    cache = {};
    return cache;
  }
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

/**
 * Whether a value from the secrets file may override the host's environment.
 *
 * The file is hand-maintained on the server, and the whole point of it is to
 * WIN over the panel — which means a half-filled one silently breaks whatever
 * it half-fills. Two values must never win: an empty string (a key left blank,
 * or a line truncated to `KEY=`) and an unfilled template placeholder like
 * `<key-from-resend-dashboard>`, which is what shipped in the template and is
 * easy to leave behind. Both are indistinguishable from "not configured", and
 * "not configured" should defer to the panel rather than overwrite it.
 *
 * This is not hypothetical: a placeholder RESEND_API_KEY here overrode a
 * perfectly good panel key and made every outbound email fail with
 * "API key is invalid", while the panel still showed the correct value.
 */
function isUsable(value: string): boolean {
  if (!value) return false;
  if (/^<.*>$/.test(value.trim())) return false;
  return true;
}

/** Applies the persistent secrets over process.env and returns them. */
export function applyPersistentEnv(): Secrets {
  const secrets = getPersistentSecrets();
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(secrets)) {
    if (!isUsable(value)) {
      skipped.push(key);
      continue;
    }
    process.env[key] = value;
  }
  if (skipped.length > 0) {
    console.warn(
      `[env] ignoring blank/placeholder values in the persistent secrets file: ${skipped.join(", ")} — using the host environment for these instead.`,
    );
  }
  return secrets;
}

// Also apply on import as a belt-and-suspenders for consumers that read
// process.env directly (uploads, resend, auth).
applyPersistentEnv();
