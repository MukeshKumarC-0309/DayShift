import type { ReactNode } from 'react'

/**
 * A panel when standing alone, a plain wrapper when embedded in a tab block —
 * so a component can live in either place without nesting one panel inside
 * another.
 */
export default function Frame({
  embedded,
  children,
}: {
  embedded: boolean
  children: ReactNode
}) {
  if (embedded) return <div>{children}</div>
  return <section className="panel px-5 py-4">{children}</section>
}
