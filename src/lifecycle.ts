const REPLACE_EVENT = 'ymtime:replace-instance'
const OWNER_ATTRIBUTE = 'data-ymtime-instance'
export interface InstanceLease {
    isCurrent(): boolean
    release(): void
}
const ELEMENT_IDS = [
    'yandex-music-timer', 'ym-stats-modal', 'ym-weekly-stats-modal',
    'ym-reset-confirm-modal', 'ym-backup-modal', 'ym-toast-container', 'ym-stats-tooltip',
]

export function removeAddonElements(doc: Document = document): void {
    // querySelectorAll also removes ghosts left by older versions with duplicate IDs.
    for (const id of ELEMENT_IDS) {
        for (const element of doc.querySelectorAll(`[id="${id}"]`)) element.remove()
    }
    for (const button of doc.querySelectorAll('[id="ym-stats-button"]')) {
        const item = button.closest('li')
        if (item) item.remove()
        else button.remove()
    }
}

export function claimAddonInstance(dispose: () => void): InstanceLease {
    // DOM events reach previous WebHost worlds; window globals are isolated.
    document.dispatchEvent(new Event(REPLACE_EVENT))
    removeAddonElements()
    const owner = crypto.randomUUID()
    document.documentElement.setAttribute(OWNER_ATTRIBUTE, owner)
    const isCurrent = () => document.documentElement.getAttribute(OWNER_ATTRIBUTE) === owner
    const replaced = () => dispose()
    document.addEventListener(REPLACE_EVENT, replaced)
    return {
        isCurrent,
        release() {
            document.removeEventListener(REPLACE_EVENT, replaced)
            if (isCurrent()) document.documentElement.removeAttribute(OWNER_ATTRIBUTE)
        },
    }
}
