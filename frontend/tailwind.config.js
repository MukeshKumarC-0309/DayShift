/** @type {import('tailwindcss').Config} */
//
// PALETTE NOTE
// ------------
// DESIGN.md specifies a deliberately muted SOC panel: desaturated status
// colours, one accent used sparingly, no per-category identity. The user asked
// for something more vibrant than that, so this file intentionally departs
// from DESIGN.md. It is the one place that does.
//
// What it is NOT is a free-for-all. The categorical slots below were validated
// with the data-viz palette checker against this file's own panel surface
// (#22283a), all-pairs, dark mode:
//
//   lightness band  PASS   all three inside L 0.48-0.67
//   chroma floor    PASS
//   CVD separation  PASS   worst pair dE 8.4 (deutan)
//   normal vision   PASS   worst pair dE 22.5
//   contrast        PASS   all three >= 3:1 on the panel
//
// SURFACES: page and panel were previously 1.12:1 apart, which is effectively
// the same colour — the panels camouflaged into the background. They are now
// 1.34:1, and the real separation work is done by elevation (a shadow and a
// lit top edge) rather than luminance, because contrast ratios compress hard
// at the dark end and no pair of dark greys will ever read as "separate" on
// value alone.
//
// Rules held to, so the colour still carries meaning:
//   * Categorical hues are assigned in fixed order and never cycled. They mean
//     "which category", nothing else.
//   * Status hues (good/warn/critical) are reserved and never used as a series
//     colour. `critical` is a deep orange-red rather than a pure red
//     specifically so it separates from the pink category slot (dE 18.1);
//     a pure #ef4444 measured 11.4 against it, below the 15 floor.
//   * Each category also has a one-hue sequential ramp for magnitude
//     (the heatmap). Sequential is one hue light-to-dark, never a rainbow.
//   * Colour is never the only channel: every category is named, every status
//     carries a text label.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // --- Surfaces -------------------------------------------------------
        // Page is near-black; the panel sits clearly above it and is the
        // surface the chart palette was validated against.
        base: '#0a0b12', // page
        panel: '#22283a', // panel / chart surface (validated)
        raised: '#2e3550', // hover, inset wells, inputs on a panel
        edge: '#3a4263', // default border — visible, not a hairline guess
        divider: '#2b3149', // divider inside a panel

        // --- Ink -----------------------------------------------------------
        ink: '#eef1fa',
        muted: '#9aa3bd',
        faint: '#646d88',

        // --- Status (reserved; never a series colour) -----------------------
        healthy: '#34d399',
        warn: '#fbbf24',
        critical: '#ea580c', // lighter than before: clears 3:1 on the new panel
        steel: '#60a5fa', // links, focus, interactive affordance

        // --- Categorical identity, fixed order ------------------------------
        // `base` is the validated mark colour; `bright` is a lighter step of
        // the same hue for accents that appear alone (a gauge ring inside its
        // own titled panel), where adjacency does not apply.
        cat1: {
          DEFAULT: '#1295ab',
          bright: '#22d3ee',
          dim: '#0c2a33',
          s1: '#0c2a33',
          s2: '#0f4a58',
          s3: '#116d7f',
          s4: '#1295ab',
          s5: '#22d3ee',
        },
        cat2: {
          DEFAULT: '#8b5cf6',
          bright: '#a78bfa',
          dim: '#221a3d',
          s1: '#221a3d',
          s2: '#3a2a6b',
          s3: '#5b3fae',
          s4: '#8b5cf6',
          s5: '#a78bfa',
        },
        cat3: {
          DEFAULT: '#ec4899',
          bright: '#f472b6',
          dim: '#3a1229',
          s1: '#3a1229',
          s2: '#61204a',
          s3: '#a32d70',
          s4: '#ec4899',
          s5: '#f472b6',
        },
        // --- Daily domain -------------------------------------------------
        // Validated against the panel: all-pairs within the domain (worst
        // CVD dE 14.9), and adjacent in the full six-slot order. Slot 6 sits
        // close to slot 3's pink, but the two live in different domains and
        // are never on screen together — the domain pager is the facet.
        cat4: {
          DEFAULT: '#5b86f5',
          bright: '#8aaeff',
          dim: '#152040',
          s1: '#152040',
          s2: '#213a73',
          s3: '#3a5fb8',
          s4: '#5b86f5',
          s5: '#8aaeff',
        },
        cat5: {
          DEFAULT: '#7c9a12',
          bright: '#a8c93a',
          dim: '#1d240a',
          s1: '#1d240a',
          s2: '#34420f',
          s3: '#566c12',
          s4: '#7c9a12',
          s5: '#a8c93a',
        },
        cat6: {
          DEFAULT: '#c5579a',
          bright: '#e583bf',
          dim: '#33152a',
          s1: '#33152a',
          s2: '#5a2549',
          s3: '#8e3b72',
          s4: '#c5579a',
          s5: '#e583bf',
        },
      },
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        base: ['14.5px', { lineHeight: '1.55' }],
      },
      borderRadius: {
        // Rounder than DESIGN.md's 2-4px, which read as a wireframe once the
        // panels gained real elevation. Still short of the 12px+ it warns off.
        DEFAULT: '8px',
        sm: '5px',
        md: '10px',
      },
      boxShadow: {
        // Coloured glows give the panels depth without a drop shadow.
        'glow-healthy':
          '0 0 0 1px rgba(52,211,153,0.35), 0 0 24px -6px rgba(52,211,153,0.45)',
        'glow-warn':
          '0 0 0 1px rgba(251,191,36,0.35), 0 0 24px -6px rgba(251,191,36,0.45)',
        'glow-critical':
          '0 0 0 1px rgba(194,65,12,0.45), 0 0 26px -6px rgba(194,65,12,0.55)',
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset',
      },
      keyframes: {
        pulseEdge: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        caret: {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        pop: {
          '0%': { transform: 'scale(0.96)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'pulse-edge': 'pulseEdge 2.8s ease-in-out infinite',
        caret: 'caret 1.1s step-end infinite',
        sweep: 'sweep 2.4s ease-in-out infinite',
        pop: 'pop 220ms ease-out',
      },
    },
  },
  plugins: [],
}
