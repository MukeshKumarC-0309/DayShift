import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Component and unit tests. End-to-end tests live in e2e/ and run under
// Playwright instead (`npm run e2e`).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
