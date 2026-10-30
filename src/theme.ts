// Detects light/dark theme by reading a CSS custom property value
// and sets data-ym-addon-theme on <html>.

const ATTR = 'data-ym-addon-theme'

export interface ThemeDetector {
    init(): void
    destroy(): void
}

export function createThemeDetector(
    requestFrame: (cb: FrameRequestCallback) => number,
    cancelFrame: (id: number) => void,
    setInterval: (cb: () => void, ms: number) => number,
    clearInterval: (id: number) => void,
): ThemeDetector {
    let probeEl: HTMLSpanElement | null = null
    let observer: MutationObserver | null = null
    let intervalId: number | null = null
    let rafId: number | null = null
    let currentTheme: 'light' | 'dark' | null = null

    function getProbe(): HTMLElement {
        if (!probeEl?.isConnected) {
            probeEl = document.createElement('span')
            probeEl.setAttribute('aria-hidden', 'true')
            probeEl.style.cssText =
                'position:fixed;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;' +
                'color:var(--ym-controls-color-primary-text-enabled_variant,rgb(255,255,255))'
            ;(document.body || document.documentElement).appendChild(probeEl)
        }
        return probeEl
    }

    function parseRgb(color: string): [number, number, number] | null {
        const m = color.match(/rgba?\(\s*([\d.]+)%?[,\s]+([\d.]+)%?[,\s]+([\d.]+)%?/i)
        if (m) {
            const scale = color.includes('%') ? 2.55 : 1
            return [Number(m[1]) * scale, Number(m[2]) * scale, Number(m[3]) * scale]
        }
        const m2 = color.match(/color\(\s*(?:srgb|display-p3)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i)
        if (m2) return [Number(m2[1]) * 255, Number(m2[2]) * 255, Number(m2[3]) * 255]
        return null
    }

    function relativeLuminance([r, g, b]: [number, number, number]): number {
        const [rs, gs, bs] = [r, g, b].map(c => {
            const v = Math.min(255, Math.max(0, c)) / 255
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
    }

    function detectTheme(): 'light' | 'dark' {
        const color = getComputedStyle(getProbe()).color
        const rgb = parseRgb(color)
        return rgb ? (relativeLuminance(rgb) < 0.5 ? 'light' : 'dark') : currentTheme || 'dark'
    }

    function applyTheme(theme: 'light' | 'dark') {
        const root = document.documentElement
        if (currentTheme !== theme || root.getAttribute(ATTR) !== theme) {
            currentTheme = theme
            root.setAttribute(ATTR, theme)
        }
    }

    function onFrame() {
        rafId = null
        applyTheme(detectTheme())
    }

    function scheduleUpdate() {
        if (rafId === null) rafId = requestFrame(onFrame)
    }

    function init() {
        scheduleUpdate()
        observer = new MutationObserver(scheduleUpdate)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
        if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
        intervalId = setInterval(scheduleUpdate, 1000)
    }

    function destroy() {
        observer?.disconnect()
        if (intervalId !== null) clearInterval(intervalId)
        if (rafId !== null) cancelFrame(rafId)
        probeEl?.remove()
        observer = null
        intervalId = null
        rafId = null
        probeEl = null
        currentTheme = null
        document.documentElement.removeAttribute(ATTR)
    }

    return { init, destroy }
}
