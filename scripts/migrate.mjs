// Runs `prisma migrate deploy` using the persistent secrets file so migrations
// apply with the correct DATABASE_URL/DIRECT_URL even when the host's build
// environment injects stale values. Mirrors src/lib/load-persistent-env.ts.
import { readFileSync, existsSync } from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";

const candidates = [
  process.env.PERSISTENT_ENV_FILE,
  path.join(os.homedir(), "portal-secrets.env"),
  path.join(process.cwd(), "..", "public_html", "portal-secrets.env"),
].filter(Boolean);

for (const file of candidates) {
  try {
    if (!existsSync(file)) continue;
    let applied = 0;
    for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
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
      console.log(`[migrate] applied ${applied} secrets from ${file}`);
      break;
    }
  } catch (err) {
    console.warn(`[migrate] could not read ${file}: ${err.message}`);
  }
}

execSync("prisma migrate deploy", { stdio: "inherit", env: process.env });
