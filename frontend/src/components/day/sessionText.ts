import type { SessionChange, WorkSession } from '../../types'

/** "09:30" from a stored timestamp. */
export function clockOf(iso: string): string {
  return iso.slice(11, 16)
}

/** Finished and with a real time of day: what the server can merge. A session
 *  added without a time is stored at exactly midnight. */
export function canMerge(session: WorkSession): boolean {
  const untimed =
    session.source !== 'timer' && session.started_at.slice(11, 19) === '00:00:00'
  return !session.is_running && !untimed
}

/** One line saying what a change did, for the Undo bar. */
export function describeChange(change: SessionChange): string {
  const where = change.category_name
  switch (change.action) {
    case 'delete':
      return `Deleted a ${change.minutes_before}-min ${where} session.`
    case 'merge':
      return `Merged ${change.sessions_before} ${where} sessions.`
    case 'split':
      return `Split a ${where} session in two.`
    default:
      return change.minutes_before === change.minutes_after
        ? `Edited a ${where} session.`
        : `Changed a ${where} session from ${change.minutes_before} to ${change.minutes_after} min.`
  }
}
