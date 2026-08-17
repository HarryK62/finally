/**
 * Build the Next.js static export the E2E suite serves from.
 *
 * Runs as `pretest`, so `npm test` always exercises the frontend that is in the
 * working tree rather than whatever `frontend/out` happened to contain.
 *
 * The export is then snapshotted into `test/.static`, and that is what uvicorn
 * serves. `next build` empties and rewrites `frontend/out`, so serving it
 * directly means a rebuild started while the suite is running (another
 * developer, another agent, a watch task) can make `/` 404 mid-run. The copy
 * makes a run immune to whatever happens to the working tree after it starts.
 *
 * Env:
 *   E2E_SKIP_BUILD=1   reuse the existing `frontend/out` and skip the build.
 *
 * The Next binary is invoked through `node .../next/dist/bin/next` rather than
 * `npm --prefix ../frontend run build`: the frontend's `node_modules/.bin`
 * shims are not guaranteed to be Windows shims, and this path works everywhere.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(TEST_DIR, "..");
const FRONTEND = path.join(REPO_ROOT, "frontend");
const EXPORT_DIR = path.join(FRONTEND, "out");
const EXPORT_ENTRY = path.join(EXPORT_DIR, "index.html");
const NEXT_BIN = path.join(FRONTEND, "node_modules", "next", "dist", "bin", "next");
const STATIC_SNAPSHOT = path.join(TEST_DIR, ".static");

function log(message) {
  process.stdout.write(`[prepare] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[prepare] ${message}\n`);
  process.exit(1);
}

/** Replace `test/.static` with a copy of the export; nothing writes it after this. */
function snapshotExport() {
  fs.rmSync(STATIC_SNAPSHOT, { recursive: true, force: true });
  fs.cpSync(EXPORT_DIR, STATIC_SNAPSHOT, { recursive: true });
  log(`serving ${STATIC_SNAPSHOT} (snapshot of ${EXPORT_DIR})`);
}

if (process.env.E2E_SKIP_BUILD === "1") {
  if (!fs.existsSync(EXPORT_ENTRY)) {
    fail(`E2E_SKIP_BUILD=1 but there is no export at ${EXPORT_ENTRY}. Run without it once.`);
  }
  log(`skipping build, reusing ${EXPORT_DIR}`);
  snapshotExport();
  process.exit(0);
}

if (!fs.existsSync(NEXT_BIN)) {
  fail(
    `${NEXT_BIN} is missing. Run \`npm install\` in ${FRONTEND} first, ` +
      `or set E2E_SKIP_BUILD=1 to reuse an existing export.`,
  );
}

log("building the frontend static export (next build)…");
const result = spawnSync(process.execPath, [NEXT_BIN, "build"], {
  cwd: FRONTEND,
  stdio: "inherit",
});

if (result.status !== 0) {
  // A stale-but-present export still lets the suite run; refusing to start would
  // hide real product failures behind a toolchain problem. Say so loudly.
  if (fs.existsSync(EXPORT_ENTRY)) {
    process.stderr.write(
      "[prepare] WARNING: next build failed. Falling back to the EXISTING export at " +
        `${EXPORT_DIR}, which may be stale. Test results below may not reflect the ` +
        "current frontend sources.\n",
    );
    snapshotExport();
    process.exit(0);
  }
  fail("next build failed and there is no existing export to fall back to.");
}

if (!fs.existsSync(EXPORT_ENTRY)) {
  fail(`next build reported success but ${EXPORT_ENTRY} does not exist.`);
}

log(`export ready at ${EXPORT_DIR}`);
snapshotExport();
