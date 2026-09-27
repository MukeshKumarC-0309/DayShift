import GitRef from '../GitRef'
import SessionEditor from '../SessionEditor'
import { tagTone } from '../../theme'
import type { Category, Deadline, WorkSession } from '../../types'
import { canMerge, clockOf } from './sessionText'

/**
 * One session in the day view: its time, minutes and how they were recorded,
 * then exam, note, branch and tags. Edit/delete on the right, or a tick box
 * while its category is being merged. The editor opens underneath.
 */

interface Props {
  session: WorkSession
  exam?: Deadline
  /** Commits on its branch/issue that day; undefined = no linked repo. */
  commits?: number | null
  busy: boolean
  merging: boolean
  picked: boolean
  onTogglePick: (on: boolean) => void
  editing: boolean
  onToggleEdit: () => void
  onDelete: () => void
  // For the editor:
  categories: Category[]
  exams: Deadline[]
  tagSuggestions: string[]
  onSaved: () => void
  onSessionExpired: () => void
}

export default function SessionRow(props: Props) {
  const { session, exam, busy, merging, editing } = props
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2.5">
          {merging && (
            <input
              type="checkbox"
              disabled={!canMerge(session)}
              checked={props.picked}
              onChange={(e) => props.onTogglePick(e.target.checked)}
              className="h-3.5 w-3.5 translate-y-0.5 accent-steel"
              aria-label={`Merge the ${clockOf(session.started_at)} session`}
              title={
                canMerge(session)
                  ? undefined
                  : 'Running, or has no time of day — can’t be merged'
              }
            />
          )}
          <div className="min-w-0">
            <div className="font-mono text-[12px] text-ink">
              {clockOf(session.started_at)}
              {session.ended_at ? `–${clockOf(session.ended_at)}` : ' · running'}
              <span className="ml-2 text-muted">{session.minutes} min</span>
              {session.source === 'manual' &&
                (session.measured_minutes !== null ? (
                  <span
                    className="ml-2 text-warn"
                    title={`Edited by hand — the timer measured ${session.measured_minutes} min`}
                  >
                    (edited · timer {session.measured_minutes})
                  </span>
                ) : (
                  <span className="ml-2 text-faint" title="Entered by hand, not measured">
                    (manual)
                  </span>
                ))}
            </div>
            {exam && (
              <div className="font-mono text-[11px] text-steel">for {exam.title}</div>
            )}
            {session.note && (
              <div className="font-sans text-[11px] text-muted">{session.note}</div>
            )}
            {session.git_ref && (
              <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                <GitRef value={session.git_ref} />
                {props.commits !== undefined && (
                  <span
                    className="font-mono text-[11px] text-faint"
                    title="Your commits that day on this branch, or mentioning this issue, in the category's linked repositories"
                  >
                    {props.commits === null
                      ? 'no such branch in the linked repos'
                      : props.commits === 1
                        ? '1 commit that day'
                        : `${props.commits} commits that day`}
                  </span>
                )}
              </div>
            )}
            {session.tags.length > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {session.tags.map((tag) => (
                  <span key={tag} className={`chip ${tagTone(tag)}`}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {!merging && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={props.onToggleEdit}
              aria-expanded={editing}
              className="btn-quiet whitespace-nowrap font-mono"
            >
              {editing ? 'close' : 'edit'}
            </button>
            <button
              type="button"
              disabled={busy || session.is_running}
              onClick={props.onDelete}
              className="btn-quiet whitespace-nowrap font-mono"
              title={
                session.is_running
                  ? 'Stop or discard the timer instead'
                  : 'Delete this session (you can undo it)'
              }
            >
              delete
            </button>
          </div>
        )}
      </div>
      {editing && (
        <SessionEditor
          session={session}
          categories={props.categories}
          exams={props.exams}
          tagSuggestions={props.tagSuggestions}
          onSaved={props.onSaved}
          onCancel={props.onToggleEdit}
          onSessionExpired={props.onSessionExpired}
        />
      )}
    </li>
  )
}
