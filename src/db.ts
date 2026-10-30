import { DB_NAME, LEGACY_KEY, PREV_SESSION_KEY, STORE_NAME } from './constants'

export interface Session {
    id?: number
    timestamp: number
    duration: number
    date: string
}

// ─── IndexedDB wrapper ────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null
const pendingWrites = new Set<Promise<void>>()

// Cache invalidation token — increments on any write/clear
let cacheVersion = 0
let cachedSessions: Session[] | null = null
let cacheExpiry = 0
let fetchingPromise: Promise<Session[]> | null = null

function invalidateCache() {
    cacheVersion++
    cachedSessions = null
    cacheExpiry = 0
    fetchingPromise = null
}

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = e => {
            const db = (e.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
                store.createIndex('timestamp', 'timestamp')
                store.createIndex('date', 'date')
            }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => {
            dbPromise = null
            reject(req.error)
        }
    })
    return dbPromise
}

async function writeSession(durationSeconds: number): Promise<void> {
    if (durationSeconds <= 0) return
    const db = await openDB()
    const timestamp = Date.now()
    const date = new Date(timestamp).toISOString().slice(0, 10)
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    await new Promise<void>((resolve, reject) => {
        store.add({ timestamp, duration: durationSeconds, date })
        tx.oncomplete = () => resolve()
        tx.onerror = tx.onabort = () => reject(tx.error)
    })
}

export function addSession(durationSeconds: number): Promise<void> {
    invalidateCache()
    const p = writeSession(durationSeconds).catch(() => {})
    pendingWrites.add(p)
    p.finally(() => {
        pendingWrites.delete(p)
        invalidateCache()
    })
    return p
}

export async function waitForWrites(): Promise<void> {
    await Promise.all([...pendingWrites])
}

async function fetchAllFromDB(): Promise<Session[]> {
    try {
        const db = await openDB()
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        return new Promise(resolve => {
            const req = store.getAll()
            req.onsuccess = () => resolve((req.result as Session[]) || [])
            req.onerror = () => resolve([])
        })
    } catch (e) {
        console.warn('[YandexMusicTime] Не удалось прочитать сессии:', e)
        return []
    }
}

export async function getAllSessions(): Promise<Session[]> {
    await Promise.allSettled([...pendingWrites])
    if (cachedSessions && Date.now() < cacheExpiry) return cachedSessions
    if (fetchingPromise) return fetchingPromise

    const snap = cacheVersion
    fetchingPromise = fetchAllFromDB().then(rows => {
        if (cacheVersion === snap) {
            cachedSessions = rows
            cacheExpiry = Date.now() + 10_000
        }
        fetchingPromise = null
        return rows
    })
    return fetchingPromise
}

export async function readForBackup(): Promise<Session[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const req = tx.objectStore(STORE_NAME).getAll()
        tx.oncomplete = () => resolve(req.result as Session[])
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Не удалось прочитать статистику'))
    })
}

export async function clearAllSessions(): Promise<void> {
    invalidateCache()
    try {
        const db = await openDB()
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        await new Promise<void>((resolve, reject) => {
            const req = store.clear()
            req.onsuccess = () => resolve()
            req.onerror = () => reject(req.error)
        })
        localStorage.removeItem(LEGACY_KEY)
        localStorage.removeItem(PREV_SESSION_KEY)
        invalidateCache()
    } catch (e) {
        console.warn('[YandexMusicTime] Не удалось очистить статистику:', e)
    }
}

export async function restoreSessionsToDB(db: IDBDatabase, sessions: Session[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.oncomplete = () => resolve()
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Не удалось восстановить базу статистики'))
        const store = tx.objectStore(STORE_NAME)
        store.clear()
        for (const s of sessions) {
            store.add({ timestamp: s.timestamp, date: s.date, duration: s.duration })
        }
    })
}

/** Migrates old single-key localStorage value into IndexedDB (runs once) */
export async function migrateLegacyTime(): Promise<void> {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return
    const seconds = parseInt(raw, 10)
    if (seconds <= 0) return
    try {
        const db = await openDB()
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const existing = await new Promise<Session[]>(resolve => {
            const req = store.getAll()
            req.onsuccess = () => resolve(req.result || [])
            req.onerror = () => resolve([])
        })
        if (existing.length === 0) {
            await new Promise<void>((resolve, reject) => {
                const req = store.add({ timestamp: 0, duration: seconds, date: '1970-01-01' })
                req.onsuccess = () => resolve()
                req.onerror = () => reject(req.error)
            })
        }
    } catch (e) {
        console.warn('[YandexMusicTime] Ошибка миграции:', e)
    }
    localStorage.removeItem(LEGACY_KEY)
}

export function closeDB(logger?: Console): void {
    dbPromise?.then(db => db.close()).catch(e => logger?.warn('Не удалось закрыть базу статистики', e))
}

export { openDB, invalidateCache }
