import { DAY_MS, DAY_PROGRESS_MAX_SECONDS } from './constants'
import type { Session } from './db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeriodBoundaries {
    startOfDay: number
    startOfWeek: number
    endOfWeek: number
    startOfMonth: number
    startOfYear: number
}

export interface AggregatedStats {
    total: number
    year: number
    month: number
    week: number
    day: number
}

export interface WeekDay {
    index: number
    date: Date
    timestamp: number
    label: string
    dateLabel: string
    duration: number
    isToday: boolean
}

export interface WeekStats {
    days: WeekDay[]
    total: number
    startDate: Date
    endDate: Date
}

// ─── Caches ───────────────────────────────────────────────────────────────────

const aggregateCache = new WeakMap<Session[], { day: number; value: AggregatedStats }>()
const weekCache = new WeakMap<Session[], { day: number; value: WeekStats }>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getPeriodBoundaries(now = new Date()): PeriodBoundaries {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime()
    const dow = now.getDay()
    const mondayOffset = dow === 0 ? 6 : dow - 1
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset, 0, 0, 0, 0).getTime()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime()
    const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0).getTime()
    return { startOfDay, startOfWeek, endOfWeek: startOfWeek + 7 * DAY_MS, startOfMonth, startOfYear }
}

/** Day-of-week label (Mon = 0) */
function dayLabel(index: number): string {
    return ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'][index] || ''
}

export function formatDateShort(date: Date): string {
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export function getStatsFromSessions(sessions: Session[]): AggregatedStats {
    const now = new Date()
    const nowMs = now.getTime()
    const b = getPeriodBoundaries(now)
    const cached = aggregateCache.get(sessions)
    if (cached?.day === b.startOfDay) return { ...cached.value }

    let total = 0, year = 0, month = 0, week = 0, day = 0
    for (const s of sessions) {
        const dur = Number(s.duration) || 0
        const ts = Number(s.timestamp) || 0
        if (dur <= 0) continue
        total += dur
        if (ts <= 0 || ts > nowMs) continue
        if (ts >= b.startOfYear) year += dur
        if (ts >= b.startOfMonth) month += dur
        if (ts >= b.startOfWeek) week += dur
        if (ts >= b.startOfDay) day += dur
    }

    const value = { total, year, month, week, day }
    aggregateCache.set(sessions, { day: b.startOfDay, value })
    return { ...value }
}

export function getWeekStatsFromSessions(sessions: Session[]): WeekStats {
    const now = new Date()
    const nowMs = now.getTime()
    const b = getPeriodBoundaries(now)
    const cached = weekCache.get(sessions)
    if (cached?.day === b.startOfDay) return cloneWeekStats(cached.value)

    const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
        const ts = b.startOfWeek + i * DAY_MS
        const date = new Date(ts)
        return {
            index: i,
            date,
            timestamp: ts,
            label: dayLabel(i),
            dateLabel: formatDateShort(date),
            duration: 0,
            isToday:
                date.getFullYear() === now.getFullYear() &&
                date.getMonth() === now.getMonth() &&
                date.getDate() === now.getDate(),
        }
    })

    for (const s of sessions) {
        const dur = Number(s.duration) || 0
        const ts = Number(s.timestamp) || 0
        if (dur <= 0 || ts <= 0 || ts > nowMs || ts < b.startOfWeek || ts >= b.endOfWeek) continue
        const idx = Math.floor((ts - b.startOfWeek) / DAY_MS)
        if (days[idx]) days[idx].duration += dur
    }

    const value: WeekStats = {
        days,
        total: days.reduce((acc, d) => acc + d.duration, 0),
        startDate: new Date(b.startOfWeek),
        endDate: new Date(b.endOfWeek - 1),
    }
    weekCache.set(sessions, { day: b.startOfDay, value })
    return cloneWeekStats(value)
}

function cloneWeekStats(ws: WeekStats): WeekStats {
    return { ...ws, days: ws.days.map(d => ({ ...d })) }
}

/** Returns the duration of the most recent completed session */
export function getLatestCompletedSession(sessions: Session[]): number {
    let latest: Session | null = null
    for (const s of sessions) {
        if (s.timestamp > 0 && s.duration > 0 && (!latest || s.timestamp > latest.timestamp)) latest = s
    }
    return latest?.duration || 0
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Formats seconds as "Xч Yм Zс" or "Xч Yм" */
export function formatTime(seconds: number, showSeconds = true): string {
    const s = Math.max(0, Number(seconds) || 0)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return showSeconds ? `${h}ч ${m}м ${String(sec).padStart(2, '0')}с` : `${h}ч ${m}м`
}

/** Formats seconds as "XX ч YY м ZZ с" (zero-padded) */
export function formatTimePadded(seconds: number): string {
    const s = Math.max(0, Number(seconds) || 0)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${String(h).padStart(2, '0')} ч ${String(m).padStart(2, '0')} м ${String(sec).padStart(2, '0')} с`
}

export { DAY_PROGRESS_MAX_SECONDS }
