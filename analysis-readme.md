# README.md Review Findings

Review of `/home/user/finally/README.md` against the actual repository contents as of 2026-08-14. This is an analysis only — no changes were made.

## Summary

The README is well-written and accurately mirrors the target architecture described in `planning/PLAN.md`. However, it describes the project as if it were fully built and runnable today. In reality, per `CLAUDE.md`, only the market-data subsystem has been completed (`backend/app/market/`) — the rest of the platform (API layer, database, frontend, Docker packaging, scripts, E2E tests) does not exist yet. This creates a significant gap between what the README promises a reader can do and what the repo currently supports.

## Specific Discrepancies

1. **Quick Start is not runnable yet**
   - `cp .env.example .env` — no `.env.example` file exists in the repo root.
   - `docker build -t finally .` — no `Dockerfile` exists.
   - `docker run -v finally-data:/app/db ...` — no `db/` directory, no Docker packaging, and no FastAPI app entrypoint that serves `/api/*` or static files.
   - A new reader following these steps verbatim will hit failures immediately.

2. **Project Structure diagram lists directories that don't exist yet**
   - `frontend/` — does not exist (no Next.js project has been started).
   - `test/` — does not exist (no Playwright E2E setup).
   - `db/` — does not exist (no runtime volume mount target, no `.gitkeep`).
   - `scripts/` — does not exist (no start/stop scripts for Mac or Windows).
   - Only `backend/` and `planning/` currently exist at the top level (plus `.github/`, `.claude/`, standard repo files).

3. **Backend is far less complete than implied**
   - `backend/app/` contains only the `market/` subsystem (simulator, cache, interface, Massive client, factory, SSE stream module, seed prices).
   - There is no FastAPI application entrypoint, no `/api/portfolio`, `/api/watchlist`, `/api/chat`, or `/api/health` routes, and no database layer (`backend/db/` schema/seed logic referenced in the plan doesn't exist).
   - The README's "Features" and "Architecture" sections describe these as present/working (portfolio trading, AI chat, watchlist management, heatmap/P&L charts), which isn't yet true.

4. **No status/progress indicator**
   - The README doesn't tell a reader that this is a work-in-progress capstone project with only one subsystem complete. Given the gap between described features and actual state, a brief "Status" or "Project Status" section (e.g., pointing to `planning/MARKET_DATA_SUMMARY.md` and noting what's done vs. pending) would set expectations correctly. `CLAUDE.md` already contains this framing internally, but it isn't surfaced in the public-facing README.

5. **Environment variable table is accurate but currently underused**
   - `OPENROUTER_API_KEY` and `LLM_MOCK` are documented but not yet referenced anywhere in the codebase (no LLM integration exists yet).
   - `MASSIVE_API_KEY` is accurate and matches actual usage in `backend/app/market/factory.py`.

6. **Minor / non-blocking observations**
   - `LICENSE` file exists and the link target is valid.
   - The License, Environment Variables, and Architecture sections are otherwise consistent with `planning/PLAN.md`'s intent.
   - `backend/README.md` (the backend-local README) is accurate for what actually exists and could be a useful cross-reference from the root README once more subsystems land.
   - Root README doesn't mention `planning/` as a place to learn about project intent/history, which could help orient new contributors/graders given this is a course capstone.

## Suggested Follow-ups (not implemented — for future work)

- Add a short "Status" section noting the project is under active development and linking to `planning/PLAN.md` / `planning/MARKET_DATA_SUMMARY.md` for current progress.
- Either update the Quick Start to reflect what can actually be run today (e.g., backend market-data demo/tests) or clearly label the Docker instructions as the target end-state, not yet functional.
- Update the Project Structure diagram to reflect only existing directories, or annotate planned-but-not-yet-created ones.
