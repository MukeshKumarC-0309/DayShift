import { DomainSlider, DomainSwitcher } from '../DomainSwitcher'
import GaugeIndicator from '../GaugeIndicator'
import PaceStrip from '../PaceStrip'
import type { Domain } from '../../domains'
import type { QuickNote } from '../../hooks/useDashboardData'
import type { Category, Dashboard, Pace } from '../../types'

/**
 * The top half of the dashboard: this week's pace and today's dials, one
 * domain at a time, with the `‹ ›` switcher that slides between domains.
 */

interface Props {
  data: Dashboard
  pace: Pace[]
  domains: Domain[]
  index: number
  onPrev: () => void
  onNext: () => void
  onGoTo: (index: number) => void
  status: { done: number; total: number }[]
  domainCategories: Category[]
  colourOf: (categoryId: number) => number
  beforeTracking: boolean
  quickAdd: (categoryId: number, minutes: number, questions: number) => void
  quickBusy: number | null
  quickNote: QuickNote | null
}

export default function DomainWindow({
  data,
  pace,
  domains,
  index,
  onPrev,
  onNext,
  onGoTo,
  status,
  domainCategories,
  colourOf,
  beforeTracking,
  quickAdd,
  quickBusy,
  quickNote,
}: Props) {
  return (
    <>
      <DomainSwitcher
        domains={domains}
        index={index}
        onPrev={onPrev}
        onNext={onNext}
        onGoTo={onGoTo}
        status={status}
        caption={domainCategories.map((c) => c.name).join(' · ')}
      />

      <div className="mb-8">
        <DomainSlider
          index={index}
          count={Math.max(1, domains.length)}
          onSwipeNext={onNext}
          onSwipePrev={onPrev}
        >
          {(slide) => {
            const ids = domains[slide]?.categoryIds ?? []
            const slidePace = pace.filter((p) => ids.includes(p.category_id))
            const slideProgress = data.progress.filter((p) => ids.includes(p.category_id))
            return (
              <div className="space-y-4">
                {slidePace.length > 0 && (
                  <PaceStrip pace={slidePace} colourOf={colourOf} />
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {slideProgress.map((progress) => {
                    const par = data.par.find(
                      (p) => p.category_id === progress.category_id,
                    )!
                    return (
                      <GaugeIndicator
                        key={progress.category_id}
                        progress={progress}
                        par={par}
                        index={colourOf(progress.category_id)}
                        untracked={beforeTracking}
                        onQuickAdd={(minutes, questions) =>
                          quickAdd(progress.category_id, minutes, questions)
                        }
                        busy={quickBusy === progress.category_id}
                        note={
                          quickNote?.categoryId === progress.category_id
                            ? quickNote
                            : undefined
                        }
                      />
                    )
                  })}
                </div>
              </div>
            )
          }}
        </DomainSlider>
      </div>
    </>
  )
}
