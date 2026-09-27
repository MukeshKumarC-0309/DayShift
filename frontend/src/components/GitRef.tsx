/**
 * A session's git branch or issue reference, shown the same way everywhere:
 * a small branch icon and the text in mono. Plain text — nothing is looked up.
 */

export const GIT_REF_MAX = 120

export default function GitRef({
  value,
  children,
}: {
  value: string
  children?: React.ReactNode
}) {
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[11px] text-muted"
      title={`Branch or issue: ${value}`}
    >
      <BranchIcon />
      <span className="sr-only">Branch or issue:</span>
      <span>{children ?? value}</span>
    </span>
  )
}

/** A git branch, drawn rather than taken from a font (the ⎇ glyph renders
 *  inconsistently across fonts). */
export function BranchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="4" cy="3" r="1.6" />
      <circle cx="4" cy="13" r="1.6" />
      <circle cx="12" cy="5" r="1.6" />
      <path d="M4 4.6v6.8M12 6.6c0 2.6-2.2 3.4-6.6 4.9" />
    </svg>
  )
}
