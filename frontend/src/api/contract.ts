// Compile-time contract between the hand-written frontend types
// (src/types/index.ts) and the backend's actual responses (src/api/schema.d.ts,
// generated from FastAPI's OpenAPI by `make api-types`).
//
// For each pair: the same field names, and every hand-written type fits the
// backend's. Hand-written types may be narrower — `'raise' | 'lower'` where the
// backend says `string` — and keep their comments. If a field is added,
// renamed or changes type on either side, `tsc` fails here, naming the pair.
//
// Nothing here runs; it only exists to be type-checked.

import type { components } from './schema'
import type * as T from '../types'

type S = components['schemas']

type SameKeys<A, B> = [Exclude<keyof A, keyof B>, Exclude<keyof B, keyof A>] extends [
  never,
  never,
]
  ? true
  : {
      onlyInFrontend: Exclude<keyof A, keyof B>
      onlyInBackend: Exclude<keyof B, keyof A>
    }
type Fits<A, B> = [A] extends [B] ? true : { doesNotFit: A; backend: B }
type Match<A, B> = SameKeys<A, B> extends true ? Fits<A, B> : SameKeys<A, B>
type Ok<X extends true> = X

export type Contract = [
  Ok<Match<T.AuthStatus, S['AuthStatus']>>,
  Ok<Match<T.Category, S['CategoryOut']>>,
  Ok<Match<T.CategoryTarget, S['TargetOut']>>,
  Ok<Match<T.LogEntry, S['LogOut']>>,
  Ok<Match<T.WorkSession, S['SessionOut']>>,
  Ok<Match<T.TodayProgress, S['TodayProgress']>>,
  Ok<Match<T.ParScore, S['ParScore']>>,
  Ok<Match<T.WeeklyDay, S['WeeklyDay']>>,
  Ok<Match<T.WeeklyCategory, S['WeeklyCategory']>>,
  Ok<Match<T.Dashboard, S['DashboardOut']>>,
  Ok<Match<T.Setting, S['SettingOut']>>,
  Ok<Match<T.DayCategoryDetail, S['DayCategoryDetail']>>,
  Ok<Match<T.DayDetail, S['DayDetail']>>,
  Ok<Match<T.SearchHit, S['SearchHit']>>,
  Ok<Match<T.SessionChange, S['SessionChangeOut']>>,
  Ok<Match<T.RefCommits, S['RefCommits']>>,
  Ok<Match<T.FocusStats, S['FocusStats']>>,
  Ok<Match<T.TagRollup, S['TagRollup']>>,
  Ok<Match<T.TagRollupRow, S['TagRollupRow']>>,
  Ok<Match<T.Tag, S['TagOut']>>,
  Ok<Match<T.CalendarDay, S['CalendarDay']>>,
  Ok<Match<T.CalendarCategory, S['CalendarCategory']>>,
  Ok<Match<T.RangePoint, S['RangePoint']>>,
  Ok<Match<T.WeekdayStat, S['WeekdayStat']>>,
  Ok<Match<T.HourStat, S['HourStat']>>,
  Ok<Match<T.ConsistencyStat, S['ConsistencyStat']>>,
  Ok<Match<T.RangeCategory, S['RangeCategory']>>,
  Ok<Match<T.PeriodSummary, S['PeriodSummary']>>,
  Ok<Match<T.CategoryComparison, S['CategoryComparison']>>,
  Ok<Match<T.Insights, S['InsightsOut']>>,
  Ok<Match<T.Pace, S['PaceOut']>>,
  Ok<Match<T.CategoryRecords, S['RecordsOut']>>,
  Ok<Match<T.Commitment, S['CommitmentOut']>>,
  Ok<Match<T.WeekCategorySummary, S['WeekCategorySummary']>>,
  Ok<Match<T.WeeklyReview, S['WeeklyReviewOut']>>,
  Ok<Match<T.LedgerEntry, S['LedgerEntry']>>,
  Ok<Match<T.HonestyLedger, S['HonestyLedger']>>,
  Ok<Match<T.ProblemReview, S['ReviewOut']>>,
  Ok<Match<T.Problem, S['ProblemOut']>>,
  Ok<Match<T.TopicStat, S['TopicStatOut']>>,
  Ok<Match<T.PracticeSummary, S['PracticeSummary']>>,
  Ok<Match<T.CheckIn, S['CheckInOut']>>,
  Ok<Match<T.CheckInDay, S['CheckInDay']>>,
  Ok<Match<T.CheckInBucket, S['CheckInBucket']>>,
  Ok<Match<T.CheckInInsights, S['CheckInInsights']>>,
  Ok<Match<T.DeadlineOverride, S['DeadlineOverrideIn']>>,
  Ok<Match<T.Deadline, S['DeadlineOut']>>,
  Ok<Match<T.TodaySummary, S['TodaySummary']>>,
  Ok<Match<T.Milestone, S['MilestoneOut']>>,
  Ok<Match<T.Habit, S['HabitOut']>>,
  Ok<Match<T.PlanTask, S['PlanTaskOut']>>,
  Ok<Match<T.DayPlan, S['DayPlan']>>,
  Ok<Match<T.Letter, S['LetterOut']>>,
  Ok<Match<T.ExamPrep, S['ExamPrep']>>,
  Ok<Match<T.YearReview, S['YearOut']>>,
  Ok<Match<T.PlanSuggestion, S['PlanSuggestion']>>,
  Ok<Match<T.TargetSuggestion, S['TargetSuggestion']>>,
  Ok<Match<T.GitRepo, S['GitRepoOut']>>,
  Ok<Match<T.GitCategory, S['GitCategoryOut']>>,
  Ok<Match<T.IcsEvent, S['IcsEventOut']>>,
]
