// Category colour assignment, in one place.
//
// Hues are assigned in FIXED ORDER by the category's position on the
// dashboard and never cycled: a fourth category falls back to neutral rather
// than reusing slot 1, because two categories sharing a colour is worse than
// one category having none. Colour is always paired with the category's name,
// so it is a reinforcement of identity, not the sole carrier of it.
//
// The hex values live in tailwind.config.js; these mirror them for the places
// that need a raw value (SVG gradient stops, canvas). Keep the two in step.

import type { Status } from './types'

export interface CategoryTheme {
  /** Tailwind class fragments, e.g. 'cat1'. */
  key: 'cat1' | 'cat2' | 'cat3' | 'cat4' | 'cat5' | 'cat6' | 'neutral'
  /** Validated mark colour. */
  base: string
  /** Lighter step of the same hue, for accents shown alone. */
  bright: string
  /** One-hue sequential ramp, darkest (near zero) to brightest. */
  ramp: [string, string, string, string, string]
  text: string
  stroke: string
  fill: string
  border: string
  accentClass: string
}

const CAT1: CategoryTheme = {
  key: 'cat1',
  base: '#1295ab',
  bright: '#22d3ee',
  ramp: ['#0c2a33', '#0f4a58', '#116d7f', '#1295ab', '#22d3ee'],
  text: 'text-cat1-bright',
  stroke: 'stroke-cat1',
  fill: 'fill-cat1',
  border: 'border-cat1',
  accentClass: 'panel-accent-1',
}

const CAT2: CategoryTheme = {
  key: 'cat2',
  base: '#8b5cf6',
  bright: '#a78bfa',
  ramp: ['#221a3d', '#3a2a6b', '#5b3fae', '#8b5cf6', '#a78bfa'],
  text: 'text-cat2-bright',
  stroke: 'stroke-cat2',
  fill: 'fill-cat2',
  border: 'border-cat2',
  accentClass: 'panel-accent-2',
}

const CAT3: CategoryTheme = {
  key: 'cat3',
  base: '#ec4899',
  bright: '#f472b6',
  ramp: ['#3a1229', '#61204a', '#a32d70', '#ec4899', '#f472b6'],
  text: 'text-cat3-bright',
  stroke: 'stroke-cat3',
  fill: 'fill-cat3',
  border: 'border-cat3',
  accentClass: 'panel-accent-3',
}

const NEUTRAL: CategoryTheme = {
  key: 'neutral',
  base: '#646d88',
  bright: '#9aa3bd',
  ramp: ['#242838', '#333952', '#4b5470', '#646d88', '#9aa3bd'],
  text: 'text-muted',
  stroke: 'stroke-muted',
  fill: 'fill-muted',
  border: 'border-edge',
  accentClass: '',
}

const CAT4: CategoryTheme = {
  key: 'cat4',
  base: '#5b86f5',
  bright: '#8aaeff',
  ramp: ['#152040', '#213a73', '#3a5fb8', '#5b86f5', '#8aaeff'],
  text: 'text-cat4-bright',
  stroke: 'stroke-cat4',
  fill: 'fill-cat4',
  border: 'border-cat4',
  accentClass: 'panel-accent-4',
}

const CAT5: CategoryTheme = {
  key: 'cat5',
  base: '#7c9a12',
  bright: '#a8c93a',
  ramp: ['#1d240a', '#34420f', '#566c12', '#7c9a12', '#a8c93a'],
  text: 'text-cat5-bright',
  stroke: 'stroke-cat5',
  fill: 'fill-cat5',
  border: 'border-cat5',
  accentClass: 'panel-accent-5',
}

const CAT6: CategoryTheme = {
  key: 'cat6',
  base: '#c5579a',
  bright: '#e583bf',
  ramp: ['#33152a', '#5a2549', '#8e3b72', '#c5579a', '#e583bf'],
  text: 'text-cat6-bright',
  stroke: 'stroke-cat6',
  fill: 'fill-cat6',
  border: 'border-cat6',
  accentClass: 'panel-accent-6',
}

// Six validated slots. A seventh category gets neutral grey rather than
// reusing a hue — two categories sharing a colour is worse than one having none.
const SLOTS = [CAT1, CAT2, CAT3, CAT4, CAT5, CAT6] as const

/** Theme for the category at `index` in dashboard order. */
export function categoryTheme(index: number): CategoryTheme {
  return SLOTS[index] ?? NEUTRAL
}

/** Status colours are reserved and never reused as a category colour. */
export const STATUS_HEX: Record<Status, string> = {
  healthy: '#34d399',
  warning: '#fbbf24',
  critical: '#ea580c',
  none: '#646d88',
}

export const STATUS_TEXT: Record<Status, string> = {
  healthy: 'text-healthy',
  warning: 'text-warn',
  critical: 'text-critical',
  none: 'text-faint',
}

/** Panel treatment for a warning state — border plus a soft glow. */
export const STATUS_PANEL: Record<Status, string> = {
  healthy: 'border-edge',
  warning: 'border-warn/60 shadow-glow-warn',
  critical: 'border-critical/70 shadow-glow-critical animate-pulse-edge',
  none: 'border-edge',
}

/** Day performance banded onto the status scale. */
export function bandFor(percent: number | null): Status {
  if (percent === null) return 'none'
  if (percent >= 80) return 'healthy'
  if (percent >= 50) return 'warning'
  return 'critical'
}

/** Deterministic chip hue for a tag, so a tag keeps its colour everywhere. */
export function tagTone(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0
  const tones = [
    'border-cat1/40 text-cat1-bright bg-cat1/10',
    'border-cat2/40 text-cat2-bright bg-cat2/10',
    'border-cat3/40 text-cat3-bright bg-cat3/10',
    'border-steel/40 text-steel bg-steel/10',
  ]
  return tones[Math.abs(hash) % tones.length]
}
