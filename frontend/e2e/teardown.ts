import { rmSync } from 'node:fs'

/** Delete the throwaway data folder the e2e backend used. */
export default function teardown(): void {
  const dir = process.env.DAYSHIFT_E2E_DATA
  if (dir && dir.includes('dayshift-e2e-')) rmSync(dir, { recursive: true, force: true })
}
