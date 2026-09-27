import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig } from '@playwright/test'

/**
 * End-to-end: a real sign-up → log → dashboard run against a throwaway copy of
 * the app (its own ports and its own data directory — never your real data).
 *
 * It drives a Chromium browser you already have instead of downloading one:
 * E2E_BROWSER if set, otherwise Brave or Chrome in their usual macOS places.
 * With none found, the run is skipped rather than failed.
 */

const CANDIDATES = [
  process.env.E2E_BROWSER,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter((p): p is string => Boolean(p))

const browser = CANDIDATES.find((p) => existsSync(p))
const API_PORT = 8011
const WEB_PORT = 5181
const DATA_DIR = join(tmpdir(), `dayshift-e2e-${process.pid}`)
// Read by e2e/teardown.ts, which deletes the folder after the run.
process.env.DAYSHIFT_E2E_DATA = DATA_DIR

export default defineConfig({
  testDir: 'e2e',
  globalTeardown: './e2e/teardown.ts',
  // Nothing to run without a browser; --pass-with-no-tests keeps that green.
  testIgnore: browser ? [] : ['**/*'],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: browser ? { executablePath: browser } : {},
  },
  webServer: browser
    ? [
        {
          command: `rm -rf "${DATA_DIR}" && mkdir -p "${DATA_DIR}" && cd ../backend && DATA_DIR="${DATA_DIR}" JWT_SECRET=e2e-secret-long-enough-for-startup-validation TRACKING_START_DATE=2026-01-01 ../.venv/bin/uvicorn app:app --port ${API_PORT}`,
          url: `http://127.0.0.1:${API_PORT}/api/health`,
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: `DAYSHIFT_API_PORT=${API_PORT} DAYSHIFT_WEB_PORT=${WEB_PORT} npx vite --strictPort`,
          url: `http://localhost:${WEB_PORT}`,
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ]
    : undefined,
})
