/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * The commit this bundle was built from.
 *
 * Without it there is no way to tell a stale deployment from a real bug: a
 * figure that looks wrong on the live site and right locally has two very
 * different explanations, and guessing between them has already cost several
 * round trips. Vercel exposes the SHA as an environment variable; the git call
 * is the local fallback, and an unknown value is not worth failing a build over.
 */
function buildCommit(): string {
  const fromCi = process.env.VERCEL_GIT_COMMIT_SHA
  if (fromCi) return fromCi.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built assets resolve correctly under any subpath
  // (e.g. a GitHub Pages project site at /HLPL-BI-Dashboard/). Combined with
  // the hash router, this makes the build portable to any static host.
  base: './',
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // The suite runs on India time because the business does, and because a
    // UTC test machine cannot see a whole class of date bug. Storing an
    // imported order date via `toISOString()` is correct at UTC+0 and a day
    // early at UTC+5:30 — it moved every Amazon USA month into the previous
    // one in production while every test here passed for months.
    env: { TZ: 'Asia/Kolkata' },
  },
})
