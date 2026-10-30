import { SVG_NS } from './constants'
import { formatTimePadded, DAY_PROGRESS_MAX_SECONDS } from './stats'
import type { WeekDay } from './stats'

// ─── Generic helpers ──────────────────────────────────────────────────────────

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
    const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K]
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    return node
}

// ─── Icon SVGs ────────────────────────────────────────────────────────────────

type IconType = 'stats' | 'week'

function buildIcon(type: IconType): SVGSVGElement {
    const svg = svgEl('svg', {
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'aria-hidden': 'true', focusable: 'false',
    })
    const paths =
        type === 'week'
            ? ['M7 3v4m10-4v4', 'M4 10h16', 'M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M8 14h2m4 0h2m-8 3h2']
            : ['M5 19V12m7 7V5m7 14V9', 'M3 21h18']
    for (const d of paths) svg.appendChild(svgEl('path', { d }))
    return svg
}

export function createTitleIcon(type: IconType): HTMLDivElement {
    const wrap = el('div', `ym-modal__title-icon ym-modal__title-icon--${type === 'week' ? 'week' : 'stats'}`)
    wrap.appendChild(buildIcon(type))
    return wrap
}

// ─── Buttons ──────────────────────────────────────────────────────────────────

export function createButton(text: string, variant: 'default' | 'danger' | 'ghost' = 'default'): HTMLButtonElement {
    const btn = el('button', 'ym-ui-button', text)
    if (variant === 'danger') btn.classList.add('ym-ui-button--danger')
    if (variant === 'ghost') btn.classList.add('ym-ui-button--ghost')
    return btn
}

export function createCloseButton(onClick: () => void): HTMLButtonElement {
    const btn = el('button', 'ym-modal__close')
    btn.setAttribute('aria-label', 'Закрыть')
    btn.type = 'button'
    const svg = svgEl('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' })
    svg.appendChild(svgEl('use', { href: '/icons/sprite.svg#close_xxs' }))
    btn.appendChild(svg)
    btn.addEventListener('click', onClick)
    return btn
}

export function createActions(extraClass = ''): HTMLDivElement {
    return el('div', `ym-modal__actions ${extraClass}`.trim())
}

// ─── Modal scaling helper ─────────────────────────────────────────────────────

export function fitModal(
    overlay: HTMLElement,
    box: HTMLElement,
    onCleanup: (fn: () => void) => void,
    listenFn: (target: EventTarget, event: string, cb: () => void) => void,
    requestFrame: (cb: FrameRequestCallback) => number,
    cancelFrame: (id: number) => void,
) {
    let rafId: number | null = null

    function measure() {
        rafId = null
        if (!overlay.offsetHeight) return
        const style = getComputedStyle(overlay)
        const w = overlay.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        const h = overlay.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        const scale = Math.max(0, Math.min(1, w / box.offsetWidth, h / box.offsetHeight))
        box.style.setProperty('--ym-modal-scale', String(scale))
    }

    function schedule() {
        if (rafId === null) rafId = requestFrame(measure)
    }

    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(schedule)
        ro.observe(overlay)
        ro.observe(box)
        onCleanup(() => ro.disconnect())
    }
    listenFn(window, 'resize', schedule)
    schedule()
}

// ─── Modal builder ────────────────────────────────────────────────────────────

export interface ModalOptions {
    id: string
    title: string
    subtitle?: string | null
    subtitleId?: string
    icon?: IconType
    modalClass?: string
    boxClass?: string
    onClose: () => void
}

export interface ModalRefs {
    modal: HTMLDivElement
    box: HTMLDivElement
    content: HTMLDivElement
    title: HTMLHeadingElement
    subtitle: HTMLDivElement
}

export function createModal(opts: ModalOptions): ModalRefs {
    const modal = el('div', `ym-modal ${opts.modalClass || ''}`.trim())
    modal.id = opts.id
    const box = el('div', `ym-modal__box ${opts.boxClass || ''}`.trim())
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    box.setAttribute('aria-labelledby', `${opts.id}-title`)
    modal.addEventListener('click', e => { if (e.target === modal) opts.onClose() })

    const header = el('div', 'ym-modal__header')
    const titleWrap = el('div', 'ym-modal__title-wrap')
    const titleRow = el('div', 'ym-modal__title-row')
    if (opts.icon) titleRow.appendChild(createTitleIcon(opts.icon))
    const titleEl = el('h3', 'ym-modal__title', opts.title)
    titleEl.id = `${opts.id}-title`
    titleRow.appendChild(titleEl)

    const subtitleEl = el('div', 'ym-modal__subtitle', opts.subtitle || '')
    if (opts.subtitleId) subtitleEl.id = opts.subtitleId

    titleWrap.appendChild(titleRow)
    if (opts.subtitle !== null) titleWrap.appendChild(subtitleEl)
    header.appendChild(titleWrap)
    header.appendChild(createCloseButton(opts.onClose))

    const content = el('div', 'ym-modal__content')
    box.appendChild(header)
    box.appendChild(content)
    modal.appendChild(box)

    return { modal, box, content, title: titleEl, subtitle: subtitleEl }
}

// ─── Stats card ───────────────────────────────────────────────────────────────

export function createStatsCard(label: string, value: string): HTMLDivElement {
    const card = el('div', 'ym-stats-card')
    const left = el('div', 'ym-stats-card__left')
    left.appendChild(el('div', 'ym-stats-card__label', label))
    card.appendChild(left)
    card.appendChild(el('div', 'ym-stats-card__value', value))
    return card
}

// ─── Week day card ────────────────────────────────────────────────────────────

export function createWeekDayCard(day: WeekDay): HTMLDivElement {
    const card = el('div', 'ym-week-day')
    if (day.isToday) card.classList.add('ym-week-day--today')

    const top = el('div', 'ym-week-day__top')
    const left = el('div', 'ym-week-day__left')
    const text = el('div', 'ym-week-day__text')
    text.appendChild(el('div', 'ym-week-day__title', `${day.label}${day.isToday ? ' · сегодня' : ''}`))
    text.appendChild(el('div', 'ym-week-day__date', day.dateLabel))
    left.appendChild(text)
    top.appendChild(left)
    top.appendChild(el('div', 'ym-week-day__value', formatTimePadded(day.duration)))

    const progress = document.createElement('progress')
    progress.className = 'ym-week-progress'
    progress.max = DAY_PROGRESS_MAX_SECONDS
    progress.value = Math.min(DAY_PROGRESS_MAX_SECONDS, Math.max(0, Number(day.duration) || 0))
    progress.setAttribute('aria-label', `${day.label}: ${formatTimePadded(day.duration)} из 24 часов`)

    card.appendChild(top)
    card.appendChild(progress)
    return card
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastContainer: HTMLDivElement | null = null

function getToastContainer(): HTMLDivElement {
    if (!toastContainer) {
        toastContainer = el('div', 'ym-toast-container')
        toastContainer.id = 'ym-toast-container'
        document.body.appendChild(toastContainer)
    }
    return toastContainer
}

export function showToast(
    message: string,
    _variant = 'default',
    requestFrame: (cb: FrameRequestCallback) => number,
    scheduleTimeout: (fn: () => void, ms: number) => void,
) {
    const container = getToastContainer()
    const toast = el('div', `ym-toast ym-toast--${_variant}`, message)
    container.appendChild(toast)
    requestFrame(() => toast.classList.add('ym-toast--visible'))
    scheduleTimeout(() => {
        toast.classList.remove('ym-toast--visible')
        scheduleTimeout(() => {
            toast.remove()
            if (toastContainer && toastContainer.children.length === 0) {
                toastContainer.remove()
                toastContainer = null
            }
        }, 220)
    }, 2600)
}

export function setHidden(el: HTMLElement | null, hidden: boolean) {
    if (el) el.hidden = hidden
}
