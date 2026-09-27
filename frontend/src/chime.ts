// A soft two-note chime for the focus timer, synthesised with the Web Audio
// API — no sound files, nothing fetched. Browsers only allow audio after the
// page has been interacted with, which starting a timer always is; if it is
// still blocked, the chime is silently skipped.

let context: AudioContext | null = null

export function chime(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return
    context = context ?? new Ctor()
    const now = context.currentTime
    for (const [offset, frequency] of [
      [0, 660],
      [0.18, 880],
    ] as const) {
      const osc = context.createOscillator()
      const gain = context.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.9)
      osc.connect(gain).connect(context.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 1)
    }
  } catch {
    /* No audio available — the on-screen change still says the block ended. */
  }
}
