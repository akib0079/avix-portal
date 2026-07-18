// Build-time step for the fragile host:
//  1. Reads the persistent secrets file (~/portal-secrets.env) so migrations
//     apply with the correct DATABASE_URL/DIRECT_URL.
//  2. Writes .env.production.local + .env.local into the app dir so the running
//     Next.js server loads the correct DB URL at runtime — this is the ONLY
//     mechanism that reliably overrides Hostinger's (corrupted) panel env,
//     which LiteSpeed injects and which no server-side patch could beat.
import { readFileSync, writeFileSync, existsSync } from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";

const candidates = [
  process.env.PERSISTENT_ENV_FILE,
  path.join(os.homedir(), "portal-secrets.env"),
  path.join(process.cwd(), "..", "public_html", "portal-secrets.env"),
].filter(Boolean);

let secretsFileContents = null;

for (const file of candidates) {
  try {
    if (!existsSync(file)) continue;
    const contents = readFileSync(file, "utf8");
    let applied = 0;
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
      process.env[key] = value;
      applied++;
    }
    if (applied > 0) {
      secretsFileContents = contents;
      console.log(`[migrate] applied ${applied} secrets from ${file}`);
      break;
    }
  } catch (err) {
    console.warn(`[migrate] could not read ${file}: ${err.message}`);
  }
}

// The secrets file is the ONLY trustworthy source of the DB URL here —
// Hostinger's panel injects a corrupted env. If we could not read it, abort
// rather than risk running migrations against the wrong (or no) database.
if (!secretsFileContents) {
  console.error(
    "[migrate] FATAL: no secrets file found. Looked in:\n" +
      candidates.map((c) => `  - ${c}`).join("\n") +
      "\nRefusing to migrate with the panel-injected env.",
  );
  process.exit(1);
}

// Persist the DB env for the runtime server (survives this deploy; regenerated
// on every deploy so it never goes stale).
if (secretsFileContents) {
  try {
    for (const envFile of [".env.production.local", ".env.local"]) {
      writeFileSync(path.join(process.cwd(), envFile), secretsFileContents, {
        mode: 0o600,
      });
    }
    console.log("[migrate] wrote .env.production.local + .env.local for runtime");
  } catch (err) {
    console.warn(`[migrate] could not write runtime env files: ${err.message}`);
  }
}

execSync("prisma migrate deploy", { stdio: "inherit", env: process.env });
