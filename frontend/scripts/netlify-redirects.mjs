// Writes dist/_redirects for Netlify after `vite build`.
//
// netlify.toml cannot read environment variables, so the backend URL is
// injected here instead. Two rules:
//   1. /api/*  -> the FastAPI backend (a proxy, so the session cookie stays
//                 first-party on the Netlify domain)
//   2. /*      -> index.html, so client-side routes like /login survive a reload

import { writeFileSync } from 'node:fs'

const backend = (process.env.BACKEND_URL ?? '').trim().replace(/\/+$/, '')

if (!/^https:\/\//.test(backend)) {
  console.error(
    "BACKEND_URL must be set to the backend's https:// URL " +
      '(e.g. https://dayshift-api.fly.dev). Set it in Netlify -> Site ' +
      'configuration -> Environment variables, then redeploy.',
  )
  process.exit(1)
}

const rules = [`/api/*  ${backend}/api/:splat  200!`, `/*  /index.html  200`]

writeFileSync('dist/_redirects', rules.join('\n') + '\n')
console.log(`Wrote dist/_redirects proxying /api/* to ${backend}`)
