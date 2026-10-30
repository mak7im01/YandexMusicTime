import { PREV_SESSION_KEY } from './constants'
import { addSession, waitForWrites, getAllSessions, clearAllSessions, invalidateCache } from './db'
import { getStatsFromSessions, getWeekStatsFromSessions, getLatestCompletedSession, formatTime, type AggregatedStats, type WeekStats } from './stats'
import type { StreakManager } from './streak'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimerSettings {
    showTimer: boolean
    showStreak: boolean
    streakFormat: 'text' | 'flame'
    timerPosition: number
    timerStatType: number
    showTimerLabel: boolean
    timerColor: boolean
    customColor: string
    fontSize: number
    showSeconds: boolean
    showIcon: boolean
}

export interface TimerState {
    totalTime: number
    isPlaying: boolean
    startTime: number | null
    timerElement: HTMLDivElement | null
    currentSessionTime: number
    previousSessionTime: number
    statsCache: AggregatedStats
}

export interface TimerManager {
    state: TimerState
    loadTotalTime(): Promise<number>
    refreshStatsCache(): Promise<void>
    start(): void
    stop(): void
    autosaveCurrentSession(): number
    getStats(): Promise<{
        total: number; year: number; month: number; week: number
        day: number; currentSession: number; previousSession: number
    }>
    getWeeklyStats(): Promise<WeekStats>
    resetStats(): Promise<void>
    updateDisplay(s: TimerSettings): void
    saveCurrentSessionAsPrevious(): void
    isPlaying(): boolean
    setPlayingFromUI(playing: boolean): void
    flushForBackup(): Promise<void>
}

// ─── Position class names ─────────────────────────────────────────────────────

function positionClass(pos: number): string {
    return ({ 1: 'ym-timer--top-center', 2: 'ym-timer--top-left', 3: 'ym-timer--bottom-left' } as Record<number, string>)[pos]
        ?? 'ym-timer--top-center'
}

function statLabel(type: number): string {
    return (
        { 2: 'За год', 3: 'За месяц', 4: 'За неделю', 5: 'За день', 6: 'Сессия' } as Record<number, string>
    )[type] ?? 'Время'
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createTimerManager(
    streak: StreakManager,
    logger: { error?: (...a: unknown[]) => void },
    /** Injected flag: is the addon being destroyed? */
    isDestroyed: () => boolean,
): TimerManager {
    const state: TimerState = {
        totalTime: 0,
        isPlaying: false,
        startTime: null,
        timerElement: null,
        currentSessionTime: 0,
        previousSessionTime: parseInt(localStorage.getItem(PREV_SESSION_KEY) || '0', 10) || 0,
        statsCache: { total: 0, year: 0, month: 0, week: 0, day: 0 },
    }

    // ── elapsed since last startTime ──
    function liveElapsed(): number {
        if (!state.isPlaying || !state.startTime) return 0
        return Math.floor((Date.now() - state.startTime) / 1000)
    }

    function currentSessionSeconds(): number {
        return state.currentSessionTime + liveElapsed()
    }

    function totalSeconds(): number {
        return state.totalTime + liveElapsed()
    }

    // ── flush elapsed time into DB ──
    function flushElapsed(opts: { continuePlaying: boolean; minSeconds: number }): number {
        if (!state.startTime) return 0
        const now = Date.now()
        const elapsed = Math.floor((now - state.startTime) / 1000)
        if (elapsed < opts.minSeconds) return 0

        addSession(elapsed).catch(e => logger.error?.('Не удалось сохранить время', e))

        state.totalTime += elapsed
        state.currentSessionTime += elapsed
        state.statsCache.total += elapsed
        state.statsCache.year += elapsed
        state.statsCache.month += elapsed
        state.statsCache.week += elapsed
        state.statsCache.day += elapsed
        state.startTime = opts.continuePlaying && state.isPlaying ? now : null
        return elapsed
    }

    // ── stat value by type ──
    function getStatValue(type: number): number {
        const live = liveElapsed()
        switch (String(type)) {
            case '2': return state.statsCache.year + live
            case '3': return state.statsCache.month + live
            case '4': return state.statsCache.week + live
            case '5': return state.statsCache.day + live
            case '6': return currentSessionSeconds()
            default:  return totalSeconds()
        }
    }

    // ── DOM update ──
    function updateDisplay(s: TimerSettings) {
        if (isDestroyed()) return

        const showTimer = s.showTimer
        const showStreak = s.showStreak

        if (!showTimer && !showStreak) {
            state.timerElement?.remove()
            state.timerElement = null
            return
        }

        if (!state.timerElement) {
            state.timerElement = document.createElement('div')
            state.timerElement.id = 'yandex-music-timer'
            document.body.appendChild(state.timerElement)
        }

        const el = state.timerElement
        const cls = positionClass(s.timerPosition)
        if (!el.classList.contains(cls)) {
            el.classList.remove('ym-timer--top-center', 'ym-timer--top-left', 'ym-timer--bottom-left')
            el.classList.add(cls)
        }

        const color = s.timerColor
            ? s.customColor
            : 'var(--ym-controls-color-primary-text-enabled_variant, #ffffff)'
        if (el.style.getPropertyValue('--ym-timer-color') !== color)
            el.style.setProperty('--ym-timer-color', color)

        const fontSizePx = `${s.fontSize}px`
        if (el.style.getPropertyValue('--ym-timer-font-size') !== fontSizePx)
            el.style.setProperty('--ym-timer-font-size', fontSizePx)

        // ── time value span ──
        let timeSpan = el.querySelector<HTMLSpanElement>('.ym-time-value')
        if (showTimer) {
            if (!timeSpan) {
                timeSpan = document.createElement('span')
                timeSpan.className = 'ym-time-value'
                el.prepend(timeSpan)
            }
            const icon = s.showIcon ? '🎵 ' : ''
            const label = s.showTimerLabel ? `${statLabel(s.timerStatType)}: ` : ''
            const formatted = formatTime(getStatValue(s.timerStatType), s.showSeconds)
            const text = `${icon}${label}${formatted}`
            if (timeSpan.textContent !== text) timeSpan.textContent = text
        } else {
            timeSpan?.remove()
            timeSpan = null
        }

        // ── separator ──
        let sep = el.querySelector<HTMLSpanElement>('.ym-time-separator')
        if (showTimer && showStreak) {
            if (!sep) {
                sep = document.createElement('span')
                sep.className = 'ym-time-separator'
                sep.textContent = ' | '
                sep.setAttribute('aria-hidden', 'true')
            }
            if (timeSpan && timeSpan.nextElementSibling !== sep) timeSpan.after(sep)
        } else {
            sep?.remove()
        }

        // ── streak ──
        const format = s.streakFormat === 'flame' ? 'flame' : 'text'
        if (showStreak) streak.render(el, format, s.showTimerLabel)
        else streak.hide()
    }

    return {
        state,

        async loadTotalTime() {
            const sessions = await getAllSessions()
            const agg = getStatsFromSessions(sessions)
            state.totalTime = agg.total
            state.statsCache = agg
            state.previousSessionTime ||= getLatestCompletedSession(sessions)
            return agg.total
        },

        async refreshStatsCache() {
            const sessions = await getAllSessions()
            if (isDestroyed()) return
            const agg = getStatsFromSessions(sessions)
            state.statsCache = agg
            state.totalTime = agg.total
        },

        start() {
            if (!state.isPlaying) {
                state.isPlaying = true
                state.startTime = Date.now()
            }
        },

        stop() {
            if (state.isPlaying) {
                flushElapsed({ continuePlaying: false, minSeconds: 1 })
                state.isPlaying = false
                state.startTime = null
            }
        },

        autosaveCurrentSession() {
            return state.isPlaying
                ? flushElapsed({ continuePlaying: true, minSeconds: 30 })
                : 0
        },

        async getStats() {
            const sessions = await getAllSessions()
            const agg = getStatsFromSessions(sessions)
            state.statsCache = agg
            const live = liveElapsed()
            return {
                total: agg.total + live,
                year: agg.year + live,
                month: agg.month + live,
                week: agg.week + live,
                day: agg.day + live,
                currentSession: currentSessionSeconds(),
                previousSession: state.previousSessionTime,
            }
        },

        async getWeeklyStats() {
            const sessions = await getAllSessions()
            const week = getWeekStatsFromSessions(sessions)
            const live = liveElapsed()
            if (live > 0) {
                const todayIdx = week.days.findIndex(d => d.isToday)
                if (todayIdx >= 0) {
                    week.days[todayIdx].duration += live
                    week.total += live
                }
            }
            return week
        },

        async resetStats() {
            await clearAllSessions()
            state.totalTime = 0
            state.currentSessionTime = 0
            state.previousSessionTime = 0
            state.statsCache = { total: 0, year: 0, month: 0, week: 0, day: 0 }
            state.startTime = state.isPlaying ? Date.now() : null
        },

        updateDisplay,

        saveCurrentSessionAsPrevious() {
            localStorage.setItem(PREV_SESSION_KEY, String(currentSessionSeconds()))
        },

        isPlaying() {
            return state.isPlaying
        },

        setPlayingFromUI(playing) {
            if (playing) this.start()
            else this.stop()
        },

        async flushForBackup() {
            flushElapsed({ continuePlaying: state.isPlaying, minSeconds: 1 })
            await waitForWrites()
        },
    }
}
