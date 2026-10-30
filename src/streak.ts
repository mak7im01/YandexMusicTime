import { DAY_MS, STREAK_KEY, SVG_NS } from './constants'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreakState {
    version: 1
    count: number
    best: number
    lastDate: string | null
}

export interface FlameLevel {
    min: number
    max: number
    level: number
    kind: number
    rank: number
    color: string
    inner: string
}

// ─── Date utilities ───────────────────────────────────────────────────────────

/** Returns 'YYYY-MM-DD' for a local date */
export function todayString(now = new Date()): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Converts a 'YYYY-MM-DD' string to a UTC day-index (ms / DAY_MS), or null if invalid */
function parseDateToDay(date: string): number | null {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
    const [y, m, d] = date.split('-').map(Number)
    const utc = new Date(Date.UTC(y, m - 1, d))
    return utc.toISOString().slice(0, 10) === date ? utc.getTime() / DAY_MS : null
}

/** Returns updated streak state after recording a visit on `visitDate` */
export function updateStreak(current: StreakState | null, visitDate: string): StreakState {
    const visitDay = parseDateToDay(visitDate)
    if (visitDay === null) throw new TypeError('Invalid visit date')

    const state: StreakState =
        current?.version === 1 &&
        Number.isSafeInteger(current.count) &&
        current.count > 0 &&
        Number.isSafeInteger(current.best) &&
        current.best >= current.count &&
        parseDateToDay(current.lastDate!) !== null
            ? current
            : { version: 1, count: 0, best: 0, lastDate: null }

    const lastDay = state.lastDate !== null ? parseDateToDay(state.lastDate) : null

    // Same or earlier day — no update
    if (lastDay !== null && visitDay <= lastDay) return state

    // Consecutive day continues streak, otherwise reset to 1
    const newCount = lastDay !== null && visitDay - lastDay === 1 ? Math.min(2 ** 53 - 1, state.count + 1) : 1

    return {
        version: 1,
        count: newCount,
        best: Math.max(state.best, newCount),
        lastDate: visitDate,
    }
}

// ─── Flame level ──────────────────────────────────────────────────────────────

/** Returns visual level info for a given number of streak days */
export function getFlameLevel(days: number): FlameLevel {
    if (!Number.isSafeInteger(days) || days < 0) throw new TypeError('Days must be a non-negative safe integer')
    if (days < 10) return { min: 1, max: 9, level: 1, kind: 0, rank: 0, color: days ? '#ff9248' : '#808080', inner: '#ffdc83' }
    if (days < 50) return { min: 10, max: 49, level: 2, kind: 1, rank: 0, color: '#ff5c48', inner: '#ffb65c' }
    if (days < 100) return { min: 50, max: 99, level: 3, kind: 2, rank: 0, color: '#c18aff', inner: '#f3bfff' }
    const hundreds = Math.floor(days / 100)
    const hue = hundreds === 1 ? 192 : (252 + (hundreds - 2) * 137.508) % 360
    return {
        min: hundreds * 100,
        max: hundreds * 100 + 99,
        level: hundreds + 3,
        kind: 3 + ((hundreds - 1) % 4),
        rank: hundreds,
        color: `hsl(${hue.toFixed(3)} 92% 70%)`,
        inner: `hsl(${hue.toFixed(3)} 100% 89%)`,
    }
}

/** Builds the flame SVG icon for a given number of days */
export function buildFlameIcon(doc: Document, days: number): SVGSVGElement {
    const lvl = getFlameLevel(days)
    const svg = doc.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 32 36')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')

    const addPath = (attrs: Record<string, string | number>) => {
        const el = doc.createElementNS(SVG_NS, 'path')
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
        svg.appendChild(el)
    }

    // Decorative sparkle rays for high levels
    if (lvl.kind >= 4) {
        addPath({ d: 'M5 7 2 4m25 3 3-3M2 16H0m30 0h2', fill: 'none', stroke: lvl.color, 'stroke-width': 1.5, 'stroke-linecap': 'round' })
    }

    // Flame shape variants per kind
    const flamePaths = [
        'M18 3c1 8-7 9-6 15-3-1-4-4-3-6C1 20 6 33 16 33c12 0 17-14 8-23 0 5-2 7-4 8 3-7 1-11-2-15Z',
        'M17 2c3 8-5 11-3 16 2-1 4-4 4-7 8 5 12 11 8 17-5 9-19 6-21-3-2-7 2-12 5-16-1 5 0 7 2 8-2-6 5-9 5-15Z',
        'M17 2c4 7 1 11-3 15-1-4-3-5-5-6 1 6-6 9-4 15 2 10 19 11 23 0 2-6-2-12-6-16 1 5-1 8-4 9 4-7 3-11-1-17Z',
        'M17 3c0 7-6 9-5 15-3-2-4-5-3-8-7 7-8 14-3 19 5 6 17 6 22-2 3-6-1-12-4-15 0 5-2 7-5 8 2-6 2-11-2-17Z',
        'M16 3c3 6-1 8-1 12 4-2 5-5 5-8 4 4 5 8 3 13 4-2 5-5 4-7 8 13 1 21-11 21C3 34-3 21 7 11c-1 6 1 8 4 9-3-8 5-10 5-17Z',
        'M16 2c4 6 6 9 4 14 4-1 5-4 4-8 8 9 7 18 1 23-5 5-15 4-20-2-4-6-2-13 2-17 0 4 2 6 5 6-2-7 5-9 4-16Z',
        'M16 2c5 5 7 11 4 16 4-1 5-4 5-7 8 10 5 20-5 23-10 3-18-4-17-12 1-5 4-8 7-11-2 6 0 8 3 9-3-8 5-11 3-18Z',
    ]
    addPath({ d: flamePaths[lvl.kind], fill: lvl.color })
    addPath({ d: 'M17 18c2 4-2 5-1 8 2-1 3-2 3-4 5 5 3 10-2 10-6 0-9-6-5-11 0 3 1 4 2 4-1-3 2-4 3-7Z', fill: lvl.inner })

    if (lvl.kind >= 2) addPath({ d: 'm5 2 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z', fill: lvl.inner })
    if (lvl.rank >= 2) addPath({ d: 'm26 0 1.2 2.8L30 4l-2.8 1.2L26 8l-1.2-2.8L22 4l2.8-1.2Z', fill: lvl.color })
    if (lvl.kind === 5) addPath({ d: 'm11 11 2-5 3 3 3-3 2 5', fill: 'none', stroke: lvl.inner, 'stroke-width': 1.5, 'stroke-linejoin': 'round' })
    if (lvl.kind === 6) addPath({ d: 'M8 29c4 5 12 5 16 0', fill: 'none', stroke: lvl.inner, 'stroke-width': 1.5, 'stroke-linecap': 'round' })

    return svg
}

// ─── Streak manager ───────────────────────────────────────────────────────────

export interface StreakManager {
    start(): void
    visit(force?: boolean): void
    getStats(): { current: number; best: number }
    exportState(): StreakState | null
    restoreState(state: StreakState | null): void
    render(container: HTMLElement, format: 'text' | 'flame', showLabel: boolean): void
    hide(): void
    destroy(): void
    readonly api: {
        preview(days: number): object
        restore(): object
        status(): object
        levels(count?: number): object[]
    }
}

export function createStreakManager(
    win: Window,
    onChange: () => void,
    logger: Console = console,
): StreakManager {
    let state: StreakState | null = null
    let previewDays: number | null = null
    let active = false
    let prevPublicApi: unknown
    let lastVisitDate: string | null = null
    let streakEl: HTMLSpanElement | null = null
    let lastRenderKey: string | null = null

    function readState(): StreakState | null {
        try {
            return JSON.parse(win.localStorage.getItem(STREAK_KEY) || 'null')
        } catch {
            return null
        }
    }

    function recordVisit(force = false) {
        if (!active || win.document.visibilityState === 'hidden') return
        const today = todayString()
        if (force !== true && lastVisitDate === today) return

        const prev = readState()
        const updated = updateStreak(prev, today)
        lastVisitDate = today

        if (JSON.stringify(prev) !== JSON.stringify(updated)) {
            try {
                win.localStorage.setItem(STREAK_KEY, JSON.stringify(updated))
            } catch (e) {
                logger.warn('Не удалось сохранить стрик', e)
            }
        }

        const changed = JSON.stringify(state) !== JSON.stringify(updated)
        state = updated
        if (changed) onChange()
    }

    const forceVisit = () => recordVisit(true)
    const onStorage = (e: StorageEvent) => {
        if (e.key === STREAK_KEY || e.key === null) forceVisit()
    }

    // Public API exposed on window.YMTimeStreak
    const publicApi = Object.freeze({
        preview(days: number) {
            getFlameLevel(days) // validates
            previewDays = days
            onChange()
            return { days, ...getFlameLevel(days), preview: true }
        },
        restore() {
            previewDays = null
            onChange()
            return publicApi.status()
        },
        status() {
            return { ...state, previewDays, level: getFlameLevel(previewDays ?? state?.count ?? 0) }
        },
        levels(count = 8) {
            if (!Number.isInteger(count) || count < 1 || count > 100) throw new TypeError('Use 1–100 levels')
            return [1, 10, 50, ...Array.from({ length: count }, (_, i) => (i + 1) * 100)].map(days => ({ days, ...getFlameLevel(days) }))
        },
    })

    function onPreviewEvent(e: Event) {
        const detail = (e as CustomEvent).detail
        try {
            if (detail === null || detail === undefined) publicApi.restore()
            else publicApi.preview(detail)
        } catch (e) {
            logger.warn('Предпросмотр огонька: укажите целое число дней от 0', e)
        }
    }

    return {
        start() {
            active = true
            state = readState()
            prevPublicApi = (win as any).YMTimeStreak
            ;(win as any).YMTimeStreak = publicApi
            win.addEventListener('focus', forceVisit)
            win.addEventListener('storage', onStorage as EventListener)
            win.document.addEventListener('visibilitychange', forceVisit)
            win.document.addEventListener('ymtime:streak:preview', onPreviewEvent)
            recordVisit()
        },

        visit: recordVisit,

        getStats() {
            return { current: state?.count ?? 0, best: state?.best ?? 0 }
        },

        exportState() {
            return state ? { ...state } : null
        },

        restoreState(newState) {
            if (newState) {
                win.localStorage.setItem(STREAK_KEY, JSON.stringify(newState))
            } else {
                win.localStorage.removeItem(STREAK_KEY)
            }
            state = newState ? { ...newState } : null
            lastVisitDate = null
            previewDays = null
            recordVisit()
            onChange()
        },

        render(container, format, showLabel) {
            const days = previewDays ?? state?.count ?? 0
            streakEl ??= (() => {
                const el = win.document.createElement('span')
                el.className = 'ym-streak'
                el.setAttribute('role', 'img')
                return el
            })()

            const key = `${days}:${previewDays !== null}:${format}:${showLabel}`
            if (lastRenderKey !== key) {
                lastRenderKey = key
                const lvl = getFlameLevel(days)
                const countEl = win.document.createElement('span')
                countEl.className = 'ym-streak__count'
                countEl.textContent = String(days)

                streakEl.dataset.format = format
                if (format === 'text') {
                    streakEl.replaceChildren(
                        showLabel ? win.document.createTextNode('Дней подряд: ') : win.document.createTextNode(''),
                        countEl,
                    )
                    streakEl.removeAttribute('role')
                } else {
                    streakEl.replaceChildren(buildFlameIcon(win.document, days), countEl)
                    streakEl.setAttribute('role', 'img')
                }

                streakEl.dataset.level = String(lvl.level)
                streakEl.dataset.preview = String(previewDays !== null)
                streakEl.style.setProperty('--ym-streak-color', lvl.color)

                const ariaLabel = `Серия ежедневных входов: ${days}. Уровень ${lvl.level}${previewDays === null ? '' : ' · Предпросмотр'}`
                streakEl.setAttribute('aria-label', ariaLabel)
                streakEl.title = ariaLabel
            }

            if (streakEl.parentElement !== container) container.appendChild(streakEl)
        },

        hide() {
            streakEl?.remove()
        },

        destroy() {
            active = false
            win.removeEventListener('focus', forceVisit)
            win.removeEventListener('storage', onStorage as EventListener)
            win.document.removeEventListener('visibilitychange', forceVisit)
            win.document.removeEventListener('ymtime:streak:preview', onPreviewEvent)
            if ((win as any).YMTimeStreak === publicApi) {
                if (prevPublicApi === undefined) delete (win as any).YMTimeStreak
                else (win as any).YMTimeStreak = prevPublicApi
            }
            streakEl?.remove()
        },

        get api() {
            return publicApi
        },
    }
}
