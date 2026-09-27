/**
 * `dayshift share` — the addresses your phone can open Dayshift on, and a QR
 * code for one of them, drawn in the terminal so the phone can scan it.
 *
 *   node scripts/share.mjs              QR for the Wi-Fi address
 *   node scripts/share.mjs tailscale    QR for the Tailscale address
 *
 * Wi-Fi addresses work on the same network as this Mac. Tailscale addresses
 * (100.64.0.0/10, and the device's *.ts.net name) work from anywhere your
 * phone is signed in to the same tailnet. Everything here is read locally:
 * the network interfaces, and the Tailscale app's own status command.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'

import { encodeQr } from './qr.mjs'

const PORT = Number(process.env.DAYSHIFT_WEB_PORT ?? 5173)
const want = process.argv[2] === 'tailscale' ? 'tailscale' : 'wifi'

/** 100.64.0.0/10 — the range Tailscale gives out. */
function isTailscale(ip) {
  const [a, b] = ip.split('.').map(Number)
  return a === 100 && b >= 64 && b <= 127
}

function interfaceAddresses() {
  const wifi = []
  const tailscale = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (entry.address.startsWith('169.254.')) continue // no network yet
      ;(isTailscale(entry.address) ? tailscale : wifi).push(entry.address)
    }
  }
  return { wifi, tailscale }
}

/** This Mac's Tailscale name (e.g. my-mac.tail1234.ts.net), if it has one. */
function tailscaleName() {
  const candidates = [
    'tailscale',
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  ]
  for (const bin of candidates) {
    if (bin.startsWith('/') && !existsSync(bin)) continue
    try {
      const out = execFileSync(bin, ['status', '--json'], {
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const name = JSON.parse(out.toString()).Self?.DNSName
      if (name) return name.replace(/\.$/, '')
    } catch {
      // Not installed here, not running, or signed out — try the next.
    }
  }
  return null
}

function printQr(text) {
  const { size, modules } = encodeQr(text)
  const quiet = 2
  const at = (r, c) => (r < 0 || r >= size || c < 0 || c >= size ? 0 : modules[r][c])
  const lines = []
  for (let row = -quiet; row < size + quiet; row += 2) {
    let line = '  '
    for (let col = -quiet; col < size + quiet; col += 1) {
      const top = at(row, col)
      const bottom = at(row + 1, col)
      // Printed black-on-white, so a dark module has to render as ink.
      if (top && bottom) line += '█'
      else if (top) line += '▀'
      else if (bottom) line += '▄'
      else line += ' '
    }
    lines.push(line)
  }
  console.log(`\x1b[47m\x1b[30m${lines.join('\x1b[0m\n\x1b[47m\x1b[30m')}\x1b[0m`)
}

const { wifi, tailscale } = interfaceAddresses()
const name = tailscale.length ? tailscaleName() : null
const url = (host) => `http://${host}:${PORT}`

const rows = [
  ...wifi.map((ip) => [url(ip), 'same Wi-Fi as this Mac']),
  ...(name ? [[url(name), 'anywhere, via Tailscale']] : []),
  ...tailscale.map((ip) => [url(ip), 'anywhere, via Tailscale']),
]
const width = Math.max(0, ...rows.map(([u]) => u.length)) + 2
console.log('\n  DAYSHIFT — open on your phone\n')
for (const [u, label] of rows) console.log(`  ${u.padEnd(width)}${label}`)
if (!wifi.length && !tailscale.length) {
  console.log('  No network found — connect this Mac to Wi-Fi first.\n')
  process.exit(1)
}
if (!tailscale.length) {
  console.log('\n  To open it away from home too: install Tailscale on this Mac and your')
  console.log('  phone, sign both in, then run `dayshift share` again.')
}

const pick =
  want === 'tailscale'
    ? name ?? tailscale[0] ?? wifi[0]
    : wifi[0] ?? name ?? tailscale[0]
console.log(`\n  Scan to open ${url(pick)}\n`)
printQr(url(pick))
if (want === 'wifi' && tailscale.length) {
  console.log('\n  For the away-from-home QR: dayshift share tailscale')
}
console.log('\n  Sign in with your usual username and passcode. On iPhone, Share →')
console.log('  Add to Home Screen gives it an icon.\n')
