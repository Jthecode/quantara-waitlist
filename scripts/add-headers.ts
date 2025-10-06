// scripts/add-headers.ts
import { promises as fs } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = process.cwd();
const YEAR = new Date().getFullYear();

const BANNER = (relPath: string) => `/*!
 * Quantara Devnet-0 — Waitlist & Faucet
 * File: ${relPath.replaceAll("\\", "/")}
 * Copyright (c) ${YEAR} Quantara Technology LLC
 * SPDX-License-Identifier: Proprietary
 * Do not remove this header.
 */
`;

const ALLOWED_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "db/migrations"]);

async function walk(dir: string, out: string[] = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    const rel = relative(projectRoot, p);
    if (e.isDirectory()) {
      if ([...SKIP_DIRS].some((d) => rel === d || rel.startsWith(d + "/"))) continue;
      await walk(p, out);
    } else {
      const ext = e.name.slice(e.name.lastIndexOf("."));
      if (ALLOWED_EXT.has(ext)) out.push(p);
    }
  }
  return out;
}

async function ensureBanner(file: string) {
  const rel = relative(projectRoot, file);
  const src = await fs.readFile(file, "utf8");

  // already has our banner?
  if (src.startsWith("/*!\\n * Quantara Devnet-0 — Waitlist & Faucet")) return;

  const banner = BANNER(rel);
  // keep shebangs on top if present
  const shebang = src.startsWith("#!") ? src.split("\n")[0] + "\n" : "";
  const body = shebang ? src.slice(shebang.length) : src;

  await fs.writeFile(file, shebang + banner + "\n" + body, "utf8");
  console.log("Stamped:", rel);
}

(async () => {
  const files = await walk(projectRoot);
  await Promise.all(files.map(ensureBanner));
})();
