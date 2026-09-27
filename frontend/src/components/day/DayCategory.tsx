import { categoryTheme } from '../../theme'
import type { Category, DayCategoryDetail, Deadline } from '../../types'
import SessionRow from './SessionRow'
import { canMerge } from './sessionText'

/**
 * One category's panel in the day view: totals against target, how they
 * split between typed and timed, any override, then its sessions. Merge
 * mode (one category at a time) adds tick boxes and a Merge bar.
 */

interface Props {
  category: DayCategoryDetail
  colour: number
  busy: boolean
  exams: Deadline[]
  refCommits: Record<number, number | null>
  editorCategories: (sessionCategoryId: number) => Category[]
  tagSuggestions: string[]
  editingId: number | null
  onToggleEdit: (sessionId: number) => void
  onEdited: () => void
  onDelete: (sessionId: number) => void
  merging: boolean
  picked: Set<number>
  onPick: (picked: Set<number>) => void
  onStartMerge: () => void
  onCancelMerge: () => void
  onMerge: () => void
  mergeError: string | null
  onSessionExpired: () => void
}

export default function DayCategory(props: Props) {
  const { category, merging, picked } = props
  const theme = categoryTheme(props.colour)
  const mergeable = category.sessions.filter(canMerge)

  return (
    <section className={`panel ${theme.accentClass} mb-4 px-5 py-4`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-sans text-sm text-ink">
          <span
            className="dot"
            style={{ backgroundColor: theme.bright }}
            aria-hidden="true"
          />
          {category.category_name}
        </h2>
        <span className="font-mono text-[13px] text-muted">
          {category.is_active ? (
            <>
              {category.total_minutes}
              <span className="text-faint"> / {category.target_minutes} min</span>
              {category.percent !== null && (
                <span
                  className={`ml-2 ${
                    category.percent >= 80
                      ? 'text-healthy'
                      : category.percent >= 50
                        ? 'text-warn'
                        : 'text-critical'
                  }`}
                >
                  {category.percent.toFixed(0)}%
                </span>
              )}
            </>
          ) : (
            <span className="text-faint">Rest day</span>
          )}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 font-mono text-[11px] text-faint">
        <span>
          {category.manual_minutes} entered · {category.timed_minutes} timed
          {category.question_target !== null && category.question_target > 0 && (
            <span className="ml-2 text-muted">
              · {category.questions_solved}/{category.question_target} questions
            </span>
          )}
          {category.has_override && (
            <span className="ml-2 text-steel">
              * override
              {category.override_reason ? `: ${category.override_reason}` : ''}
            </span>
          )}
        </span>
        {mergeable.length >= 2 && !merging && (
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onStartMerge}
            className="btn-quiet font-mono"
            title="Combine several of these sessions into one"
          >
            merge…
          </button>
        )}
      </div>

      {category.sessions.length === 0 ? (
        <p className="font-sans text-[11px] text-faint">No sessions recorded.</p>
      ) : (
        <ul className="divide-y divide-divider">
          {category.sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              exam={props.exams.find((d) => d.id === session.deadline_id)}
              commits={
                session.id in props.refCommits ? props.refCommits[session.id] : undefined
              }
              busy={props.busy}
              merging={merging}
              picked={picked.has(session.id)}
              onTogglePick={(on) => {
                const next = new Set(picked)
                if (on) next.add(session.id)
                else next.delete(session.id)
                props.onPick(next)
              }}
              editing={props.editingId === session.id}
              onToggleEdit={() => props.onToggleEdit(session.id)}
              onDelete={() => props.onDelete(session.id)}
              categories={props.editorCategories(session.category_id)}
              exams={props.exams}
              tagSuggestions={props.tagSuggestions}
              onSaved={props.onEdited}
              onSessionExpired={props.onSessionExpired}
            />
          ))}
        </ul>
      )}

      {merging && (
        <div className="mt-2 border-t border-divider pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-sans text-[11px] text-faint">
              Minutes add up; notes, tags and branches are combined.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={props.onCancelMerge}
                disabled={props.busy}
                className="btn-quiet font-mono"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={props.onMerge}
                disabled={props.busy || picked.size < 2}
                className="btn"
              >
                {props.busy
                  ? 'Merging…'
                  : picked.size >= 2
                    ? `Merge ${picked.size} sessions`
                    : 'Merge sessions'}
              </button>
            </div>
          </div>
          {props.mergeError && (
            <p role="alert" className="mt-2 font-mono text-xs text-critical">
              {props.mergeError}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
