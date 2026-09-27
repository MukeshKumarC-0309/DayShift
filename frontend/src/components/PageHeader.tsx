import { Link } from 'react-router'
import type { ReactNode } from 'react'

import Brand from './Brand'

/** The sticky header used by the secondary pages: brand, page name, links. */
export default function PageHeader({
  page,
  children,
}: {
  page: string
  children?: ReactNode
}) {
  return (
    <header className="app-header">
      <Brand subtitle={page} />
      <nav className="flex flex-wrap items-center gap-1" aria-label="Pages">
        {children}
        <Link to="/" className="btn-quiet whitespace-nowrap font-mono">
          Dashboard
        </Link>
      </nav>
    </header>
  )
}
