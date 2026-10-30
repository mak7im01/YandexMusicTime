import { defineAddon } from '@pulsesync/addon-sdk'

import addonConfig from '../addon.config.mjs'
import { settings } from './settings'

import './styles.css'
import { createStreakManager } from './streak'
import { createTimerManager } from './timer'
import { createThemeDetector } from './theme'
import { createNavbarManager } from './navbar'
import { createShareHelpers, createWeeklyModal, createBackupModal, createStatsModal, type ModalEnv } from './modals'
import { migrateLegacyTime, closeDB } from './db'
import type { TimerSettings } from './timer'

export default defineAddon({
    id: addonConfig.id,
    name: addonConfig.name,
    settings,

    async start(api) {
        // ── Lifecycle flags ──
        let destroyed = false
        let restoring = false
        const isDestroyed = () => destroyed
        const isRestoring = () => restoring
        const setRestoring = (v: boolean) => { restoring = v }

        // Mark as destroyed immediately if PulseSync disposes the addon
        // before our async init completes
        if (api.signal?.aborted) return () => {}
        api.signal?.addEventListener('abort', () => { destroyed = true }, { once: true })

        // ── Cleanup registry ──
        const cleanups: Array<() => void> = []
        function onCleanup(fn: () => void) { cleanups.push(fn) }

        // ── Timer/RAF wrappers (tracked for cleanup) ──
        const activeTimeouts = new Set<number>()
        const activeIntervals = new Set<number>()
        const activeRafs = new Set<number>()

        function scheduleTimeout(fn: () => void, ms: number): number {
            const id = window.setTimeout(() => { activeTimeouts.delete(id); if (!destroyed) fn() }, ms)
            activeTimeouts.add(id)
            return id
        }
        function clearScheduledTimeout(id: number) { window.clearTimeout(id); activeTimeouts.delete(id) }

        function addInterval(fn: () => void, ms: number): number {
            const id = window.setInterval(() => { if (!destroyed) fn() }, ms)
            activeIntervals.add(id)
            return id
        }
        function removeInterval(id: number) { window.clearInterval(id); activeIntervals.delete(id) }

        function requestFrame(cb: FrameRequestCallback): number {
            const id = window.requestAnimationFrame(ts => { activeRafs.delete(id); if (!destroyed) cb(ts) })
            activeRafs.add(id)
            return id
        }
        function cancelFrame(id: number) { window.cancelAnimationFrame(id); activeRafs.delete(id) }

        // ── Event listener helper ──
        function listen(target: EventTarget, event: string, cb: (...a: any[]) => any) {
            target.addEventListener(event, cb)
            onCleanup(() => target.removeEventListener(event, cb))
        }

        // ── Settings accessor ──
        function getSettings(): TimerSettings {
            const raw = api.settings?.getCurrent() ?? {}
            const get = (key: string, def: unknown) => {
                const v = (raw as any)[key]
                if (v !== undefined) return typeof v === 'object' && v !== null
                    ? (v as any).value ?? (v as any).default ?? def
                    : v
                return def
            }
            return {
                showTimer: Boolean(get('showTimer', true)),
                showStreak: Boolean(get('showStreak', true)),
                streakFormat: String(get('streakFormat', 'text')) === 'flame' ? 'flame' : 'text',
                timerPosition: Number(get('timerPosition', 1)),
                timerStatType: Number(get('timerStatType', 1)),
                showTimerLabel: Boolean(get('showTimerLabel', true)),
                timerColor: Boolean(get('timerColor', false)),
                customColor: String(get('customColor', '#ffffff')),
                fontSize: Number(get('fontSize', 12)),
                showSeconds: Boolean(get('showSeconds', true)),
                showIcon: Boolean(get('showIcon', false)),
                showNavbarButton: Boolean(get('showNavbarButton', true)),
            }
        }

        // ── Streak ──
        const streak = createStreakManager(
            window,
            () => { if (!destroyed) timer.updateDisplay(getSettings()) },
            api.logger ?? console,
        )

        // ── Timer ──
        const timer = createTimerManager(streak, api.logger ?? console, isDestroyed)

        // ── Theme detector ──
        const theme = createThemeDetector(requestFrame, cancelFrame, addInterval, removeInterval)

        // ── Stats modal & friends (forward refs via closures) ──
        let statsModal: ReturnType<typeof createStatsModal>

        const modalEnv: ModalEnv = {
            isDestroyed,
            isRestoring,
            setRestoring,
            getSettings,
            getLogin: async () => {
                const login = await api.user?.getLogin?.()
                return login ?? ''
            },
            timer,
            streak,
            onCleanup,
            listen,
            scheduleTimeout,
            clearScheduledTimeout,
            requestFrame,
            cancelFrame,
            onModalsUpdated: () => statsModal?.updateOpenModals(),
        }

        const share = createShareHelpers(modalEnv)
        const weekly = createWeeklyModal(modalEnv, share)
        const backupModal = createBackupModal(modalEnv, weekly, {
            updateStats: async () => statsModal?.updateStats(),
        })
        statsModal = createStatsModal(modalEnv, weekly, backupModal, share)

        // ── Navbar ──
        const navbar = createNavbarManager(
            () => statsModal.open(),
            scheduleTimeout,
            clearScheduledTimeout,
            addInterval,
            removeInterval,
            requestFrame,
            cancelFrame,
        )

        // ── Player listener ──
        let unsubPlayer: (() => void) | null = null
        function initPlayer() {
            unsubPlayer = api.player.onChange(state => {
                if (!destroyed && !restoring) timer.setPlayingFromUI(!!state?.isPlaying)
            })
            try {
                const snap = api.player.getSnapshot()
                if (!destroyed && !restoring) timer.setPlayingFromUI(!!snap?.isPlaying)
            } catch {
                // addon may have been disposed between awaits
            }
        }
        function destroyPlayer() { unsubPlayer?.(); unsubPlayer = null }

        // ── Settings change listener ──
        let unsubSettings: (() => void) | null = null
        function initSettings() {
            const addonSettings = api.settings ?? { getCurrent: () => ({}), onChange: () => () => {} }
            unsubSettings = addonSettings.onChange(raw => {
                if (destroyed) return
                const s = getSettings()
                timer.updateDisplay(s)
                navbar.updateVisibility(s.showNavbarButton)
                statsModal.updateOpenModals()
            })
        }

        // ── Tickers ──
        let tickSecond = 0
        let tickRefresh = 0
        let tickModals: number | null = null
        let tickMain: number | null = null

        function startTickers() {
            tickMain = addInterval(() => {
                if (restoring) return
                streak.visit()
                timer.updateDisplay(getSettings())
                tickSecond++; tickRefresh++
                if (tickRefresh >= 30) {
                    tickRefresh = 0
                    timer.autosaveCurrentSession()
                }
                if (tickSecond >= 10) {
                    tickSecond = 0
                    timer.refreshStatsCache().then(() => { if (!destroyed) timer.updateDisplay(getSettings()) })
                }
            }, 1000)

            tickModals = addInterval(() => {
                if (!destroyed && !restoring) statsModal.updateOpenModals()
            }, 1000)
        }

        function stopTickers() {
            if (tickMain !== null) { removeInterval(tickMain); tickMain = null }
            if (tickModals !== null) { removeInterval(tickModals); tickModals = null }
        }

        // ── Save on unload ──
        listen(window, 'beforeunload', () => { timer.stop(); timer.saveCurrentSessionAsPrevious() })
        listen(window, 'pagehide', () => { timer.stop(); timer.saveCurrentSessionAsPrevious() })

        // ── Destroy function ──
        function destroy() {
            if (destroyed) return
            destroyed = true
            streak.destroy()
            timer.stop()
            if (tickMain !== null || tickModals !== null) stopTickers()
            destroyPlayer()
            unsubSettings?.()
            navbar.destroy()
            theme.destroy()
            closeDB(api.logger ?? console)

            for (const id of activeTimeouts) window.clearTimeout(id)
            for (const id of activeIntervals) window.clearInterval(id)
            for (const id of activeRafs) window.cancelAnimationFrame(id)
            activeTimeouts.clear(); activeIntervals.clear(); activeRafs.clear()

            for (const fn of cleanups) { try { fn() } catch {} }
            cleanups.length = 0

            // Remove all DOM elements
            for (const id of [
                'yandex-music-timer', 'ym-stats-modal', 'ym-weekly-stats-modal',
                'ym-reset-confirm-modal', 'ym-backup-modal', 'ym-toast-container', 'ym-stats-tooltip',
            ]) document.getElementById(id)?.remove()
            document.getElementById('ym-stats-button')?.closest('li')?.remove()
        }

        // ── Initialise ──
        try {
            theme.init()
            initSettings()

            await migrateLegacyTime()
            if (destroyed) return destroy

            await timer.loadTotalTime()
            if (destroyed) return destroy

            streak.start()
            initPlayer()
            navbar.init()
            timer.updateDisplay(getSettings())
            navbar.updateVisibility(getSettings().showNavbarButton)
            startTickers()

            return destroy
        } catch (e) {
            destroy()
            throw e
        }
    },
})
