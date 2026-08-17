/**
 * Playwright configuration for the FinAlly E2E suite.
 *
 * The suite drives the real stack: uvicorn serving the FastAPI app *and* the
 * Next.js static export on one origin, exactly as the container does. This is
 * the default path — it needs no Docker and rebuilds the frontend from the
 * working tree. `docker-compose.test.yml` runs the same specs against the
 * shipped image; both are verified.
 *
 * Two things make a run reproducible:
 *
 *   - `DB_PATH` points at a fresh SQLite file under `test/.tmp/run-<ts>/`, so
 *     every run starts from the seeded default state and the developer's own
 *     `db/finally.db` is never touched.
 *   - `LLM_MOCK=true` and a blanked `OPENROUTER_API_KEY` mean the chat flow is
 *     deterministic and physically cannot reach OpenRouter.
 *
 * Because the backend is single-user with one shared SQLite database, the specs
 * share state. They run on one worker, in filename order (`01-`, `02-`, …), and
 * each spec asserts on *deltas* rather than absolute balances wherever a
 * previous spec could have moved them.
 */

import fs from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const TEST_DIR = __dirname;
const REPO_ROOT = path.resolve(TEST_DIR, "..");
const BACKEND_DIR = path.join(REPO_ROOT, "backend");
/**
 * `scripts/prepare.mjs` copies the freshly built export here. Serving the copy
 * rather than `frontend/out` keeps a run isolated from a `next build` that
 * starts while it is in flight — that build empties `out/` and every page load
 * 404s until it finishes.
 */
const STATIC_SNAPSHOT = path.join(TEST_DIR, ".static");
const EXPORT_DIR = fs.existsSync(path.join(STATIC_SNAPSHOT, "index.html"))
  ? STATIC_SNAPSHOT
  : path.join(REPO_ROOT, "frontend", "out");

const PORT = Number(process.env.E2E_PORT ?? 8000);

/**
 * `E2E_EXTERNAL_SERVER=1` means something else already runs the stack — the
 * `docker-compose.test.yml` path, or a developer who started uvicorn by hand.
 * The suite then only points a browser at `E2E_BASE_URL` and starts nothing.
 */
const EXTERNAL_SERVER = process.env.E2E_EXTERNAL_SERVER === "1";
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/** A throwaway database directory for this run, pruned after a day. */
function runDir(): string {
  const tmpRoot = path.join(TEST_DIR, ".tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });

  const dayMs = 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(tmpRoot)) {
    if (!entry.startsWith("run-")) continue;
    const full = path.join(tmpRoot, entry);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs > dayMs) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {
      /* a run still holding the file open; leave it alone */
    }
  }

  const dir = path.join(tmpRoot, `run-${Date.now()}-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const DB_PATH = EXTERNAL_SERVER ? "" : path.join(runDir(), "finally.db");

export default defineConfig({
  testDir: "./specs",
  outputDir: "./.playwright/results",
  // One backend, one database: the specs are a sequence, not a set.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    // Prices tick every ~500ms but the portfolio only re-polls every 5s, so
    // some post-trade assertions need more than the 5s default.
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { outputFolder: "./.playwright/report", open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 950 } },
    },
  ],

  webServer: EXTERNAL_SERVER
    ? undefined
    : {
        command: `uv run uvicorn app.main:app --host 127.0.0.1 --port ${PORT}`,
        cwd: BACKEND_DIR,
        url: `${BASE_URL}/api/health`,
        // Never reuse: a leftover server would carry a dirty database into the run.
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          DB_PATH,
          STATIC_DIR: EXPORT_DIR,
          LLM_MOCK: "true",
          // Whitespace rather than "": Windows drops empty environment
          // variables, which would let the developer's real .env values
          // through. The backend strips both settings, so " " reads as unset.
          OPENROUTER_API_KEY: " ",
          MASSIVE_API_KEY: " ",
          PYTHONUNBUFFERED: "1",
        },
      },
});
