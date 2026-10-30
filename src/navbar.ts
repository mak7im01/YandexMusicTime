import { SVG_NS } from './constants'
import { el, svgEl } from './dom-utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavbarManager {
    init(): void
    destroy(): void
    ensureButton(): void
    syncSidebarState(): void
    updateVisibility(showNavbarButton: boolean): void
}

// ─── Navbar button ────────────────────────────────────────────────────────────

export function createNavbarManager(
    onStatsClick: () => void,
    scheduleTimeout: (fn: () => void, ms: number) => number,
    clearScheduledTimeout: (id: number) => void,
    setInterval: (fn: () => void, ms: number) => number,
    clearIntervalFn: (id: number) => void,
    requestFrame: (cb: FrameRequestCallback) => number,
    cancelFrame: (id: number) => void,
): NavbarManager {
    // Tracks MutationObservers per navbar element
    const navObservers = new Map<Element, MutationObserver>()
    let navObserver: MutationObserver | null = null
    let bodyObserver: MutationObserver | null = null
    let navRoot: Element | null = null
    let pollInterval: number | null = null
    let ensureRafId: number | null = null
    let isCollapsed = false

    // Tooltip state
    let tooltipEl: HTMLDivElement | null = null
    let tooltipHoverTarget: HTMLElement | null = null
    let showDelayId: number | null = null
    let hideDelayId: number | null = null

    // ── Stats button SVG icon ──
    function buildNavIcon(): SVGSVGElement {
        const svg = document.createElementNS(SVG_NS, 'svg')
        svg.setAttribute('viewBox', '0 0 24 24')
        svg.setAttribute('width', '24')
        svg.setAttribute('height', '24')
        svg.setAttribute('fill', 'none')
        svg.setAttribute('stroke', 'currentColor')
        svg.setAttribute('stroke-width', '2')
        svg.setAttribute('stroke-linecap', 'round')
        svg.setAttribute('stroke-linejoin', 'round')

        const topPath = document.createElementNS(SVG_NS, 'path')
        topPath.setAttribute('d', 'M21 12v-2a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v2')
        svg.appendChild(topPath)

        const rects: [string, string, string, string][] = [['3', '12', '4', '8'], ['10', '8', '4', '12'], ['17', '10', '4', '10']]
        for (const [x, y, w, h] of rects) {
            const rect = document.createElementNS(SVG_NS, 'rect')
            rect.setAttribute('x', x); rect.setAttribute('y', y)
            rect.setAttribute('width', w); rect.setAttribute('height', h)
            rect.setAttribute('rx', '1')
            svg.appendChild(rect)
        }
        return svg
    }

    // ── Find the nav group ──
    function findNavGroup(): Element | null {
        return (
            document.querySelector('.NavbarDesktop_navigationGroup__eexLF, ul[class*="NavbarDesktop_navigationGroup"]') ||
            document.querySelector('[class*="NavbarDesktop_root"] ul')
        )
    }

    // ── Detect if sidebar is collapsed ──
    function detectCollapsed(group: Element, buttonLi: Element): boolean {
        const navbar = document.querySelector('[data-test-id="NAVBAR"]')
        if (navbar) return navbar.className.includes('Navbar_root_collapsed')
        const other = [...group.children].find(c => c !== buttonLi && c.querySelector('a .nxMXCBiVfgH4oxds3f2y span'))
        if (!other) return false
        const anchor = other.querySelector('a')
        const span = other.querySelector('.nxMXCBiVfgH4oxds3f2y span')
        return !!(
            other.className.includes('e1KYSvMXXv0FD4s_yCuw') ||
            anchor?.className.includes('uw57VJ37U4rAAHDs0zJR') ||
            span?.className.includes('NavbarDesktop_title_collapsed')
        )
    }

    // ── Apply collapsed styles ──
    function applyCollapsed(anchor: HTMLElement, collapsed: boolean) {
        const titleWrap = anchor.querySelector<HTMLElement>('.nxMXCBiVfgH4oxds3f2y')
        const titleSpan = titleWrap?.querySelector<HTMLElement>('span')
        anchor.dataset.ymCollapsed = collapsed ? 'true' : 'false'
        if (titleWrap) {
            if (collapsed) {
                titleWrap.style.marginInlineStart = '0px'
                titleWrap.style.maxWidth = '0px'
                titleWrap.style.opacity = '0'
                titleWrap.style.overflow = 'hidden'
            } else {
                titleWrap.style.marginInlineStart = ''
                titleWrap.style.maxWidth = ''
                titleWrap.style.opacity = ''
                titleWrap.style.overflow = ''
            }
        }
        if (titleSpan) {
            titleSpan.classList.toggle('NavbarDesktop_title_collapsed__IH9Bc', collapsed)
            if (collapsed) {
                titleSpan.style.opacity = '0'; titleSpan.style.visibility = 'hidden'
                titleSpan.style.maxWidth = '0px'; titleSpan.style.overflow = 'hidden'
                titleSpan.style.pointerEvents = 'none'
            } else {
                titleSpan.style.opacity = ''; titleSpan.style.visibility = ''
                titleSpan.style.maxWidth = ''; titleSpan.style.overflow = ''
                titleSpan.style.pointerEvents = ''
            }
        }
    }

    // ── Tooltip ──
    function getTooltip(): HTMLDivElement {
        if (!tooltipEl) {
            tooltipEl = el('div', 'ym-stats-tooltip')
            tooltipEl.id = 'ym-stats-tooltip'
            tooltipEl.setAttribute('role', 'tooltip')
            tooltipEl.textContent = 'Статистика'
            document.body.appendChild(tooltipEl)
        }
        return tooltipEl
    }

    function positionTooltip(anchor: HTMLElement) {
        if (!tooltipEl || !anchor) return
        const r = anchor.getBoundingClientRect()
        tooltipEl.style.left = `${Math.round(r.right + 6)}px`
        tooltipEl.style.top = `${Math.round(r.top + r.height / 2)}px`
    }

    function clearShowDelay() {
        if (showDelayId !== null) { clearScheduledTimeout(showDelayId); showDelayId = null }
    }

    function hideTooltip() {
        clearShowDelay()
        tooltipHoverTarget = null
        if (tooltipEl) {
            tooltipEl.classList.remove('ym-stats-tooltip--visible')
            if (hideDelayId !== null) clearScheduledTimeout(hideDelayId)
            hideDelayId = scheduleTimeout(() => {
                if (tooltipEl && !tooltipEl.classList.contains('ym-stats-tooltip--visible')) {
                    tooltipEl.remove()
                    tooltipEl = null
                }
            }, 180)
        }
    }

    function showTooltipFor(anchor: HTMLElement) {
        if (!anchor || anchor.offsetParent === null) return
        if (hideDelayId !== null) { clearScheduledTimeout(hideDelayId); hideDelayId = null }
        const tip = getTooltip()
        positionTooltip(anchor)
        tip.classList.add('ym-stats-tooltip--visible')
    }

    function scheduleShowTooltip(anchor: HTMLElement) {
        clearShowDelay()
        tooltipHoverTarget = anchor
        if (!isCollapsed || anchor.offsetParent === null) return
        showDelayId = scheduleTimeout(() => {
            showDelayId = null
            if (tooltipHoverTarget === anchor && isCollapsed && anchor.offsetParent !== null) {
                showTooltipFor(anchor)
            }
        }, 280)
    }

    // ── Build & inject button ──
    function injectButton(group: Element): HTMLLIElement {
        const existing = document.getElementById('ym-stats-button')
        if (existing) return existing.closest('li') as HTMLLIElement

        const li = document.createElement('li')
        li.className = 'HcfYy4VfnRHqgXzIdL7w kRmUIkcHKD5AgtpPo8wT'
        li.setAttribute('aria-current', 'false')

        const anchor = document.createElement('a')
        anchor.className = 'buOTZq_TKQOVyjMLrXvB ZfF8mQ3Iftpwu0aZgDtG yWJHrpNsBvchs9Jjyokk'
        anchor.setAttribute('role', 'link')
        anchor.setAttribute('tabindex', '0')
        anchor.setAttribute('aria-disabled', 'false')
        anchor.setAttribute('aria-label', 'Статистика')
        anchor.setAttribute('data-ym-tooltip', 'Статистика')
        anchor.id = 'ym-stats-button'
        anchor.href = '#'
        anchor.addEventListener('click', e => { e.preventDefault(); hideTooltip(); onStatsClick() })
        anchor.addEventListener('mouseenter', () => scheduleShowTooltip(anchor))
        anchor.addEventListener('mouseleave', hideTooltip)
        anchor.addEventListener('focus', () => scheduleShowTooltip(anchor))
        anchor.addEventListener('blur', hideTooltip)

        const iconWrap = el('div', '_YzsXZGNK8KeaUFC4Ja1')
        iconWrap.appendChild(buildNavIcon())

        const textWrap = el('div', 'nxMXCBiVfgH4oxds3f2y')
        const span = el('span', '_MWOVuZRvUQdXKTMcOPx LezmJlldtbHWqU7l1950 oyQL2RSmoNbNQf3Vc6YI tk7ahHRDYXJMMB879KUA _3_Mxw7Si7j2g4kWjlpR NavbarDesktop_title_animate__XLxaQ', 'Статистика')
        span.setAttribute('title', 'Статистика')
        textWrap.appendChild(span)
        anchor.appendChild(iconWrap)
        anchor.appendChild(textWrap)
        li.appendChild(anchor)

        const children = group.children
        if (children.length > 0) group.insertBefore(li, children[children.length - 1])
        else group.appendChild(li)

        syncSidebarState()
        return li
    }

    // ── Sync collapsed state ──
    function syncSidebarState() {
        const anchor = document.getElementById('ym-stats-button')
        if (!anchor) return
        const li = anchor.closest('li')
        const group = li?.parentElement || navRoot || findNavGroup()
        if (!li || !group) return

        const collapsed = detectCollapsed(group, li)
        if (isCollapsed !== collapsed || anchor.dataset.ymCollapsed !== String(collapsed)) {
            isCollapsed = collapsed
            li.classList.toggle('e1KYSvMXXv0FD4s_yCuw', collapsed)
            anchor.classList.toggle('uw57VJ37U4rAAHDs0zJR', collapsed)
            anchor.classList.toggle('ym-sidebar-collapsed', collapsed)
            applyCollapsed(anchor, collapsed)
            if (!collapsed) hideTooltip()
        }
    }

    // ── Observe a nav group for DOM changes ──
    function observeNavGroup(group: Element) {
        if (!group || group === navRoot) return
        navObserver?.disconnect()
        navRoot = group
        navObserver = new MutationObserver(mutations => {
            const selfMutation = mutations.every(m => {
                const t = m.target as Element
                const btn = document.getElementById('ym-stats-button')
                return (
                    t === btn || t === btn?.closest('li') ||
                    t === btn?.querySelector('.nxMXCBiVfgH4oxds3f2y') ||
                    t === btn?.querySelector('.nxMXCBiVfgH4oxds3f2y span')
                )
            })
            if (!selfMutation) { ensureButton(); syncSidebarState() }
        })
        navObserver.observe(group, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })

        const navbar = document.querySelector('[data-test-id="NAVBAR"]')
        if (navbar && !navObservers.has(navbar)) {
            const obs = new MutationObserver(() => syncSidebarState())
            obs.observe(navbar, { attributes: true, attributeFilter: ['class'] })
            navObservers.set(navbar, obs)
        }
    }

    // ── Ensure button exists ──
    function ensureButton() {
        const group = findNavGroup()
        if (!group) return
        observeNavGroup(group)
        if (!document.getElementById('ym-stats-button')) injectButton(group)
        syncSidebarState()
        updateVisibility(_lastShowNavbarButton)
    }

    // ── Schedule a lazy ensure ──
    function scheduleEnsure() {
        if (ensureRafId === null) {
            ensureRafId = requestFrame(() => { ensureRafId = null; ensureButton() })
        }
    }

    // ── Observe body for navigation changes ──
    function observeBody() {
        if (!document.body || bodyObserver) return
        bodyObserver = new MutationObserver(mutations => {
            const selfOnly = mutations.every(m => {
                const t = m.target as Element
                return (
                    t === tooltipEl || !!t?.closest?.('#ym-stats-tooltip, #yandex-music-timer, .ym-modal, .ym-toast-container')
                )
            })
            if (!selfOnly) scheduleEnsure()
        })
        bodyObserver.observe(document.body, { childList: true, subtree: true })
    }

    let _lastShowNavbarButton = true

    function updateVisibility(show: boolean) {
        _lastShowNavbarButton = show
        const anchor = document.getElementById('ym-stats-button')
        if (!anchor) return
        const li = anchor.closest<HTMLElement>('li')
        if (!li) return
        const display = show ? '' : 'none'
        if (li.style.display !== display) li.style.display = display
        if (!show) hideTooltip()
    }

    return {
        init() {
            observeBody()
            ensureButton()
            pollInterval = setInterval(() => ensureButton(), 2000)
        },

        destroy() {
            for (const obs of navObservers.values()) obs.disconnect()
            navObservers.clear()
            navObserver?.disconnect()
            bodyObserver?.disconnect()
            if (pollInterval !== null) clearIntervalFn(pollInterval)
            if (ensureRafId !== null) cancelFrame(ensureRafId)
            hideTooltip()
            navObserver = null
            bodyObserver = null
            navRoot = null
            pollInterval = null
            ensureRafId = null
        },

        ensureButton,
        syncSidebarState,
        updateVisibility,
    }
}
