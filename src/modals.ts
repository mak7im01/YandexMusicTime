import {
    el, createButton, createActions, createModal, createStatsCard,
    createWeekDayCard, fitModal, showToast, setHidden,
} from './dom-utils'
import { formatTimePadded, formatDateShort, formatTime } from './stats'
import { getFlameLevel, buildFlameIcon } from './streak'
import type { TimerManager } from './timer'
import type { StreakManager } from './streak'
import type { TimerSettings } from './timer'
import type { BackupV2 } from './backup'
import { exportBackup, importBackup, serializeBackupV1 } from './backup'
import { openDB, restoreSessionsToDB, invalidateCache } from './db'
import { LEGACY_KEY, PREV_SESSION_KEY } from './constants'

// ─── Shared timing helpers injected from main ─────────────────────────────────

export interface ModalEnv {
    isDestroyed: () => boolean
    isRestoring: () => boolean
    setRestoring: (v: boolean) => void
    getSettings: () => TimerSettings
    getLogin: () => Promise<string>
    timer: TimerManager
    streak: StreakManager
    onCleanup: (fn: () => void) => void
    listen: (target: EventTarget, event: string, cb: (...a: any[]) => any) => void
    scheduleTimeout: (fn: () => void, ms: number) => number
    clearScheduledTimeout: (id: number) => void
    requestFrame: (cb: FrameRequestCallback) => number
    cancelFrame: (id: number) => void
    onModalsUpdated: () => void
}

// ─── Clipboard helper ─────────────────────────────────────────────────────────

async function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return
    }
    const ta = el('textarea', 'ym-clipboard-fallback')
    ta.value = text
    document.body.appendChild(ta)
    ta.focus(); ta.select()
    document.execCommand('copy')
    ta.remove()
}

// ─── Share helpers ────────────────────────────────────────────────────────────

function buildStatsText(stats: Awaited<ReturnType<TimerManager['getStats']>>): string {
    return [
        'Моя статистика Яндекс Музыки', '',
        `Прослушано всего: ${formatTimePadded(stats.total)}`,
        `За год: ${formatTimePadded(stats.year)}`,
        `За месяц: ${formatTimePadded(stats.month)}`,
        `За неделю: ${formatTimePadded(stats.week)}`,
        `За день: ${formatTimePadded(stats.day)}`,
        `В текущей сессии: ${formatTimePadded(stats.currentSession)}`,
        `В предыдущей сессии: ${formatTimePadded(stats.previousSession)}`,
        '', 'Собрано через Yandex Music Time',
    ].join('\n')
}

function buildWeekText(week: Awaited<ReturnType<TimerManager['getWeeklyStats']>>): string {
    const range = `${formatDateShort(week.startDate)} — ${formatDateShort(week.endDate)}`
    const lines = week.days.map(d => `${d.label}, ${d.dateLabel}: ${formatTimePadded(d.duration)}`)
    return [
        'Моя статистика Яндекс Музыки за неделю', `Неделя: ${range}`, '',
        ...lines, '', `Итого за неделю: ${formatTimePadded(week.total)}`,
        '', 'Собрано через Yandex Music Time',
    ].join('\n')
}

export function createShareHelpers(env: ModalEnv) {
    async function shareStats() {
        try {
            await copyToClipboard(buildStatsText(await env.timer.getStats()))
            showToast('Статистика скопирована', 'success', env.requestFrame, env.scheduleTimeout)
        } catch (e) {
            console.warn('[YandexMusicTime] Не удалось скопировать статистику:', e)
            showToast('Не удалось скопировать статистику', 'error', env.requestFrame, env.scheduleTimeout)
        }
    }
    async function shareWeeklyStats() {
        try {
            await copyToClipboard(buildWeekText(await env.timer.getWeeklyStats()))
            showToast('Статистика за неделю скопирована', 'success', env.requestFrame, env.scheduleTimeout)
        } catch (e) {
            console.warn('[YandexMusicTime] Не удалось скопировать статистику за неделю:', e)
            showToast('Не удалось скопировать статистику за неделю', 'error', env.requestFrame, env.scheduleTimeout)
        }
    }
    return { shareStats, shareWeeklyStats }
}

// ─── Weekly stats modal ───────────────────────────────────────────────────────

export function createWeeklyModal(env: ModalEnv, share: ReturnType<typeof createShareHelpers>) {
    let modalEl: HTMLDivElement | null = null
    let subtitleEl: HTMLDivElement | null = null
    let listEl: HTMLDivElement | null = null
    let totalEl: HTMLDivElement | null = null
    let lastWeekStart: number | null = null
    let updating = false

    function close() { setHidden(modalEl, true) }

    async function update() {
        if (env.isRestoring() || !modalEl || modalEl.hidden || !listEl || !subtitleEl || !totalEl || updating) return
        updating = true
        try {
            const week = await env.timer.getWeeklyStats()
            if (env.isDestroyed() || env.isRestoring() || modalEl.hidden) return

            const rangeText = `${formatDateShort(week.startDate)} — ${formatDateShort(week.endDate)} · Шкала дня — 24 часа`
            if (subtitleEl.textContent !== rangeText) subtitleEl.textContent = rangeText

            const weekStart = week.startDate.getTime()
            if (lastWeekStart === weekStart) {
                // Update existing cards in-place
                week.days.forEach((day, i) => {
                    const card = listEl!.children[i] as HTMLElement
                    if (!card) return
                    card.classList.toggle('ym-week-day--today', day.isToday)
                    const titleEl = card.querySelector<HTMLElement>('.ym-week-day__title')
                    const newTitle = day.label + (day.isToday ? ' · сегодня' : '')
                    if (titleEl && titleEl.textContent !== newTitle) titleEl.textContent = newTitle
                    const valEl = card.querySelector<HTMLElement>('.ym-week-day__value')
                    const valText = formatTimePadded(day.duration)
                    if (valEl && valEl.textContent !== valText) valEl.textContent = valText
                    const progress = card.querySelector<HTMLProgressElement>('progress')
                    if (progress) {
                        const val = Math.min(86400, Math.max(0, day.duration))
                        if (progress.value !== val) {
                            progress.value = val
                            progress.setAttribute('aria-label', `${day.label}: ${valText} из 24 часов`)
                        }
                    }
                })
            } else {
                listEl.replaceChildren(...week.days.map(d => createWeekDayCard(d)))
                lastWeekStart = weekStart
            }

            const totalText = formatTimePadded(week.total)
            const totalValueEl = totalEl.querySelector<HTMLElement>('.ym-week-total__value')
            if (totalValueEl) {
                if (totalValueEl.textContent !== totalText) totalValueEl.textContent = totalText
            } else {
                const labelEl = el('div', 'ym-week-total__label', 'Итого за неделю')
                const valEl = el('div', 'ym-week-total__value', totalText)
                totalEl.replaceChildren(labelEl, valEl)
            }
        } finally {
            updating = false
        }
    }

    function open() {
        if (modalEl) { setHidden(modalEl, false); update(); return }

        const refs = createModal({
            id: 'ym-weekly-stats-modal', title: 'Статистика за неделю',
            subtitle: 'С понедельника по воскресенье', subtitleId: 'ym-weekly-stats-subtitle',
            modalClass: 'ym-modal--weekly', icon: 'week',
            onClose: close,
        })
        modalEl = refs.modal
        subtitleEl = refs.subtitle

        listEl = el('div', 'ym-week-list')
        listEl.id = 'ym-weekly-stats-content'
        refs.content.appendChild(listEl)

        totalEl = el('div', 'ym-week-total')
        totalEl.id = 'ym-weekly-stats-total'
        refs.content.appendChild(totalEl)

        const actions = createActions()
        const copyBtn = createButton('Скопировать')
        copyBtn.classList.add('ym-ui-button--wide')
        copyBtn.addEventListener('click', share.shareWeeklyStats)
        actions.appendChild(copyBtn)
        refs.box.appendChild(actions)

        document.body.appendChild(modalEl)
        fitModal(modalEl, refs.box, env.onCleanup, env.listen, env.requestFrame, env.cancelFrame)
        update()
    }

    return {
        open,
        close,
        update,
        isOpen: () => !(!modalEl || modalEl.hidden),
    }
}

// ─── Backup modal ─────────────────────────────────────────────────────────────

export function createBackupModal(
    env: ModalEnv,
    weekly: ReturnType<typeof createWeeklyModal>,
    statsModal: { updateStats(): Promise<void> },
) {
    let modalEl: HTMLDivElement | null = null
    let descEl: HTMLDivElement | null = null
    let fileInput: HTMLInputElement | null = null
    let actionsEl: HTMLDivElement | null = null
    let busy = false
    const revokeSet = new Set<string>()
    env.onCleanup(() => { for (const url of revokeSet) URL.revokeObjectURL(url) })

    function setBusy(state: boolean) {
        busy = state
        if (actionsEl) for (const b of actionsEl.querySelectorAll('button')) (b as HTMLButtonElement).disabled = state
    }

    async function collectBackupData() {
        await env.timer.flushForBackup()
        return {
            sessions: await (await import('./db')).readForBackup(),
            streak: env.streak.exportState(),
            currentSessionSeconds: env.timer.state.currentSessionTime,
            previousSessionSeconds: env.timer.state.previousSessionTime,
        }
    }

    async function doRestore(backup: BackupV2) {
        await importBackup(JSON.stringify(backup), await env.getLogin()) // re-verify
        env.setRestoring(true)
        env.timer.stop()
        try {
            await (await import('./db')).waitForWrites()
            const prevSessions = await (await import('./db')).readForBackup()
            const prevStreak = env.streak.exportState()
            const prevItems = [LEGACY_KEY, PREV_SESSION_KEY].map(k => [k, localStorage.getItem(k)] as [string, string | null])

            const db = await openDB()
            await restoreSessionsToDB(db, backup.sessions)
            invalidateCache()

            try {
                localStorage.removeItem(LEGACY_KEY)
                localStorage.setItem(PREV_SESSION_KEY, String(backup.previousSessionSeconds))
                env.streak.restoreState(backup.streak)
            } catch (e) {
                await restoreSessionsToDB(db, prevSessions)
                invalidateCache()
                for (const [key, val] of prevItems) {
                    if (val === null) localStorage.removeItem(key)
                    else localStorage.setItem(key, val)
                }
                env.streak.restoreState(prevStreak)
                throw e
            }

            const { getStatsFromSessions } = await import('./stats')
            const agg = getStatsFromSessions(backup.sessions)
            env.timer.state.totalTime = agg.total
            env.timer.state.statsCache = agg
            env.timer.state.currentSessionTime = backup.currentSessionSeconds
            env.timer.state.previousSessionTime = backup.previousSessionSeconds
        } finally {
            env.setRestoring(false)
            if (!env.isDestroyed()) {
                env.timer.setPlayingFromUI(false)
                env.timer.updateDisplay(env.getSettings())
                env.onModalsUpdated()
            }
        }
    }

    function showConfirm(backup: BackupV2) {
        const n = backup.sessions.reduce((s, x) => s + x.duration, 0)
        descEl!.textContent =
            `В копии: ${backup.sessions.length} записей, ${formatTime(n)} прослушивания. Рекорд стрика: ${backup.streak?.best ?? 0} дней.\n\n` +
            `Восстановление заменит текущую историю и стрики данными из файла. Продолжить?`

        const cancelBtn = createButton('Отмена', 'ghost')
        cancelBtn.addEventListener('click', resetView)

        const confirmBtn = createButton('Восстановить', 'danger')
        confirmBtn.dataset.action = 'backupConfirm'
        confirmBtn.addEventListener('click', async () => {
            if (busy) return
            setBusy(true)
            try {
                await doRestore(backup)
                if (env.isDestroyed()) return
                resetView()
                descEl!.textContent = 'Статистика и стрики восстановлены. Повторный импорт этого файла не добавляет дубликаты.'
            } catch (e: any) {
                resetView()
                descEl!.textContent = `Не удалось восстановить: ${e.message}`
            } finally {
                setBusy(false)
            }
        })
        actionsEl!.replaceChildren(cancelBtn, confirmBtn)
    }

    function resetView() {
        descEl!.textContent =
            'Копия сохраняет историю и стрики и привязывается к текущему аккаунту Яндекс Музыки. ' +
            'Для восстановления войдите в тот же аккаунт. Настройки оформления не изменяются.'

        const exportBtn = createButton('Экспортировать')
        exportBtn.dataset.action = 'backupExport'
        exportBtn.addEventListener('click', doExport)

        const importBtn = createButton('Восстановить из файла')
        importBtn.dataset.action = 'backupImport'
        importBtn.addEventListener('click', () => { if (!busy) fileInput?.click() })

        actionsEl!.replaceChildren(exportBtn, importBtn)
    }

    async function doExport() {
        if (busy) return
        setBusy(true)
        try {
            const login = await env.getLogin()
            if (!login?.trim()) throw new Error('Войдите в аккаунт Яндекс Музыки перед экспортом')

            const data = await collectBackupData()
            if (env.isDestroyed()) return

            const filename = `YandexMusicTime-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
            let fileHandle: FileSystemFileHandle | null = null

            if (typeof (window as any).showSaveFilePicker === 'function') {
                try {
                    fileHandle = await (window as any).showSaveFilePicker({
                        suggestedName: filename,
                        types: [{ description: 'Резервная копия YandexMusicTime', accept: { 'application/json': ['.json'] } }],
                    })
                } catch (e: any) {
                    if (e.name === 'AbortError') { descEl!.textContent = 'Экспорт отменён.'; return }
                    if (!['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(e.name)) throw e
                }
            }

            const json = await exportBackup(data, login)
            if (env.isDestroyed()) return

            if (fileHandle) {
                const writable = await fileHandle.createWritable()
                try {
                    await writable.write(json)
                    await writable.close()
                } catch (e) {
                    await writable.abort().catch(() => {})
                    throw e
                }
                descEl!.textContent = `Резервная копия сохранена: ${fileHandle.name}. Она содержит историю прослушивания и стрики.`
                return
            }

            const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
            revokeSet.add(url)
            const link = document.createElement('a')
            link.href = url; link.download = filename; link.hidden = true
            document.body.appendChild(link); link.click(); link.remove()
            env.scheduleTimeout(() => { URL.revokeObjectURL(url); revokeSet.delete(url) }, 60_000)
            descEl!.textContent =
                'Файл резервной копии подготовлен. Сохраните его вне папки аддона: ' +
                'он содержит всю историю прослушивания, текущую сессию и рекорд стрика.'
        } catch (e: any) {
            descEl!.textContent = `Не удалось экспортировать: ${e.message}`
        } finally {
            setBusy(false)
        }
    }

    function open() {
        if (modalEl) { setHidden(modalEl, false); return }

        const refs = createModal({
            id: 'ym-backup-modal', title: 'Резервная копия', subtitle: 'Статистика и стрики',
            modalClass: 'ym-modal--backup',
            onClose: () => setHidden(modalEl, true),
        })
        modalEl = refs.modal

        descEl = el('div', 'ym-backup-description')
        refs.content.appendChild(descEl)

        fileInput = document.createElement('input')
        fileInput.type = 'file'; fileInput.accept = '.json,application/json'
        fileInput.hidden = true; fileInput.dataset.action = 'backupFile'
        refs.content.appendChild(fileInput)

        fileInput.addEventListener('change', async () => {
            const file = fileInput!.files?.[0]
            if (!file || busy) return
            setBusy(true)
            try {
                if (file.size > 104_857_600) throw new Error('Размер файла превышает 100 МБ')
                const backup = await importBackup(await file.text(), await env.getLogin())
                if (!env.isDestroyed()) showConfirm(backup)
            } catch (e: any) {
                descEl!.textContent = `Файл не загружен: ${e.message}. Текущие данные не изменены.`
            } finally {
                fileInput!.value = ''
                setBusy(false)
            }
        })

        actionsEl = createActions()
        refs.box.appendChild(actionsEl)
        resetView()
        document.body.appendChild(modalEl)
    }

    return { open }
}

// ─── Stats modal ──────────────────────────────────────────────────────────────

export function createStatsModal(
    env: ModalEnv,
    weekly: ReturnType<typeof createWeeklyModal>,
    backup: { open(): void },
    share: ReturnType<typeof createShareHelpers>,
) {
    let modalEl: HTMLDivElement | null = null
    let listEl: HTMLDivElement | null = null
    let confirmModal: HTMLDivElement | null = null
    let updating = false

    const cardCache = new Map<string, HTMLDivElement>()

    function upsertCard(id: string, label: string, value: string): HTMLDivElement {
        let card = cardCache.get(id)
        if (!card) {
            card = createStatsCard(label, value)
            card.dataset.stat = id
            cardCache.set(id, card)
        } else {
            const valEl = card.querySelector<HTMLElement>('.ym-stats-card__value')
            if (valEl?.firstChild && valEl.firstChild.nodeValue !== value) valEl.firstChild.nodeValue = value
        }
        return card
    }

    function close() { setHidden(modalEl, true) }

    async function updateStats() {
        if (env.isRestoring() || !modalEl || modalEl.hidden || !listEl || updating) return
        updating = true
        try {
            const stats = await env.timer.getStats()
            if (env.isDestroyed() || env.isRestoring() || modalEl.hidden) return

            const statRows: [string, string, string][] = [
                ['total', 'Прослушано всего', formatTimePadded(stats.total)],
                ['year', 'Прослушано за год', formatTimePadded(stats.year)],
                ['month', 'Прослушано за месяц', formatTimePadded(stats.month)],
                ['week', 'Прослушано за неделю', formatTimePadded(stats.week)],
                ['day', 'Прослушано за день', formatTimePadded(stats.day)],
                ['currentSession', 'Прослушано в текущей сессии', formatTimePadded(stats.currentSession)],
                ['previousSession', 'Прослушано в предыдущей сессии', formatTimePadded(stats.previousSession)],
            ]
            const cards = statRows.map(([id, label, val]) => upsertCard(id, label, val))

            const streakStats = env.streak.getStats()
            const pluralDays = (n: number) => {
                const t = n % 100; const u = n % 10
                return `${n} ${t >= 11 && t <= 14 ? 'дней' : u === 1 ? 'день' : u >= 2 && u <= 4 ? 'дня' : 'дней'}`
            }

            const currentCard = upsertCard('streakCurrent', 'Текущий стрик', pluralDays(streakStats.current))
            const bestCard = upsertCard('streakBest', 'Рекорд стрика', pluralDays(streakStats.best))

            // Flame icon on best streak card
            const showFlame = streakStats.best > 0 &&
                (env.getSettings() as TimerSettings).streakFormat === 'flame'
            const valEl = bestCard.querySelector<HTMLElement>('.ym-stats-card__value')!
            let iconEl = valEl.querySelector<HTMLElement>('.ym-stats-streak-icon')
            if (!showFlame) {
                iconEl?.remove()
                valEl.classList.remove('ym-stats-card__value--streak')
            } else if (iconEl?.dataset.best !== String(streakStats.best)) {
                iconEl?.remove()
                const lvl = getFlameLevel(streakStats.best)
                const wrap = el('span', 'ym-stats-streak-icon')
                wrap.dataset.level = String(lvl.level)
                wrap.dataset.best = String(streakStats.best)
                wrap.setAttribute('role', 'img')
                const ariaLabel = `Максимальный уровень огонька: ${lvl.level}. Рекорд: ${pluralDays(streakStats.best)}`
                wrap.setAttribute('aria-label', ariaLabel); wrap.title = ariaLabel
                wrap.appendChild(buildFlameIcon(document, streakStats.best))
                valEl.classList.add('ym-stats-card__value--streak')
                valEl.appendChild(wrap)
            }

            cards.push(currentCard, bestCard)
            if ([...cards].some((c, i) => listEl!.children[i] !== c)) listEl!.replaceChildren(...cards)
        } finally {
            updating = false
        }
    }

    function openResetConfirm() {
        if (confirmModal) { setHidden(confirmModal, false); return }

        const overlay = el('div', 'ym-modal ym-modal--confirm')
        overlay.id = 'ym-reset-confirm-modal'
        overlay.addEventListener('click', e => { if (e.target === overlay) closeResetConfirm() })

        const box = el('div', 'ym-modal__box ym-modal__box--confirm')
        const title = el('h3', 'ym-modal__title ym-modal__title--confirm', 'Сбросить статистику?')
        const text = el('div', 'ym-modal__text', 'Это действие удалит всё накопленное время прослушивания. Отменить сброс после подтверждения не получится.')

        const actions = createActions('ym-modal__actions--confirm')
        const cancelBtn = createButton('Отмена', 'ghost')
        const confirmBtn = createButton('Да, сбросить', 'danger')
        confirmBtn.classList.add('ym-ui-button--confirm')

        cancelBtn.addEventListener('click', closeResetConfirm)
        confirmBtn.addEventListener('click', async () => {
            confirmBtn.disabled = true; confirmBtn.textContent = 'Сбрасываю...'
            await env.timer.resetStats()
            env.timer.updateDisplay(env.getSettings())
            await updateStats()
            if (weekly.isOpen()) await weekly.update()
            closeResetConfirm()
            confirmBtn.disabled = false; confirmBtn.textContent = 'Да, сбросить'
            showToast('Статистика сброшена', 'success', env.requestFrame, env.scheduleTimeout)
        })

        actions.appendChild(cancelBtn); actions.appendChild(confirmBtn)
        box.appendChild(title); box.appendChild(text); box.appendChild(actions)
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        fitModal(overlay, box, env.onCleanup, env.listen, env.requestFrame, env.cancelFrame)
        confirmModal = overlay
    }

    function closeResetConfirm() { setHidden(confirmModal, true) }

    function open() {
        if (modalEl) { setHidden(modalEl, false); updateStats(); return }

        const refs = createModal({
            id: 'ym-stats-modal', title: 'Статистика прослушиваний',
            subtitle: 'Твоё время в Яндекс Музыке', icon: 'stats',
            onClose: close,
        })
        modalEl = refs.modal

        listEl = el('div', 'ym-stats-list')
        listEl.id = 'ym-stats-content'
        refs.content.appendChild(listEl)

        const actions = createActions()
        const weekBtn = createButton('За неделю'); weekBtn.classList.add('ym-ui-button--wide')
        weekBtn.addEventListener('click', weekly.open)
        const copyBtn = createButton('Скопировать'); copyBtn.classList.add('ym-ui-button--wide')
        copyBtn.addEventListener('click', share.shareStats)
        const backupBtn = createButton('Резервная копия'); backupBtn.dataset.action = 'backupOpen'
        backupBtn.addEventListener('click', backup.open)
        const resetBtn = createButton('Сбросить', 'danger')
        resetBtn.addEventListener('click', openResetConfirm)

        actions.appendChild(weekBtn); actions.appendChild(copyBtn)
        actions.appendChild(backupBtn); actions.appendChild(resetBtn)
        refs.box.appendChild(actions)
        document.body.appendChild(modalEl)
        fitModal(modalEl, refs.box, env.onCleanup, env.listen, env.requestFrame, env.cancelFrame)
        updateStats()
    }

    return {
        open,
        close,
        updateStats,
        updateOpenModals() {
            updateStats()
            if (weekly.isOpen()) weekly.update()
        },
    }
}
