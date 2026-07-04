import { readFileSync, existsSync } from "fs";
import os from "os";
import path from "path";

/**
 * Loads environment variables from a persistent secrets file and OVERRIDES
 * process.env for the keys it defines.
 *
 * Why this exists: on Hostinger's Node hosting the app launcher injects env
 * vars from a store that the panel doesn't reliably update — after a Supabase
 * password reset the running app kept a stale DATABASE_URL and every redeploy
 * re-applied it. This file is read from a location that survives redeploys
 * (the home dir, and the persistent public_html sibling of the rebuilt app
 * dir), so the correct secrets are applied on every boot regardless of the
 * launcher. The secrets live outside git and outside the app directory.
 *
 * Format: standard dotenv-ish `KEY=value` lines. `#` comments and blank lines
 * are ignored. Values may be optionally wrapped in single or double quotes.
 * Missing file = no-op (local dev uses .env as usual).
 *
 * This module runs its side effect once on import. Import it before anything
 * that reads process.env for DB/storage/mail config (see prisma.ts).
 */

function candidatePaths(): string[] {
  const paths: string[] = [];
  const override = process.env.PERSISTENT_ENV_FILE;
  if (override) paths.push(override);
  try {
    paths.push(path.join(os.homedir(), "portal-secrets.env"));
  } catch {
    /* os.homedir can throw in exotic runtimes; ignore */
  }
  // Sibling of the rebuilt app dir on Hostinger: <domain>/nodejs is cwd,
  // <domain>/public_html persists across redeploys.
  paths.push(path.join(process.cwd(), "..", "public_html", "portal-secrets.env"));
  return paths;
}

function parseEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
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

function load(): void {
  for (const filePath of candidatePaths()) {
    try {
      if (!filePath || !existsSync(filePath)) continue;
      const parsed = parseEnv(readFileSync(filePath, "utf8"));
      const keys = Object.keys(parsed);
      if (keys.length === 0) continue;
      for (const key of keys) process.env[key] = parsed[key];
      // Intentionally overrides — the persistent file is the source of truth.
      console.log(
        `[persistent-env] applied ${keys.length} vars from ${filePath}`,
      );
      return;
    } catch (err) {
      console.warn(
        `[persistent-env] could not read ${filePath}: ${(err as Error).message}`,
      );
    }
  }
}

load();
