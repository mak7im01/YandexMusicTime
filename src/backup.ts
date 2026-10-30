import type { Session } from './db'
import type { StreakState } from './streak'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackupV1 {
    format: 'YandexMusicTimeBackup'
    version: 1
    exportedAt: string
    sessions: Session[]
    streak: StreakState | null
    currentSessionSeconds: number
    previousSessionSeconds: number
}

export interface BackupV2 extends Omit<BackupV1, 'version'> {
    version: 2
    owner: {
        scheme: 'ym-login-sha256-v1'
        salt: string
        digest: string
    }
}

export type Backup = BackupV1 | BackupV2

// ─── Validation helpers ───────────────────────────────────────────────────────

const invalid = (): never => {
    throw new Error('Файл не является корректной резервной копией YandexMusicTime')
}

const requireNonNegInt = (v: unknown): number => {
    if (!Number.isSafeInteger(v) || (v as number) < 0) invalid()
    return v as number
}

const requireDateString = (v: unknown): string => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) invalid()
    const d = new Date((v as string) + 'T00:00:00Z')
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== v) invalid()
    return v as string
}

function validateV1Body(raw: unknown): BackupV1 {
    const e = raw as any
    if (!e || e.format !== 'YandexMusicTimeBackup' || e.version !== 1) invalid()
    if (typeof e.exportedAt !== 'string' || !Number.isFinite(Date.parse(e.exportedAt))) invalid()
    if (!Array.isArray(e.sessions)) invalid()

    let totalDur = 0
    const sessions: Session[] = e.sessions.map((s: any) => {
        if (!s || !Number.isSafeInteger(s.timestamp) || s.timestamp < 0 || s.timestamp > 864e13) invalid()
        const dur = requireNonNegInt(s.duration)
        if (!dur) invalid()
        totalDur += dur
        if (!Number.isSafeInteger(totalDur)) invalid()
        return { timestamp: s.timestamp, duration: dur, date: requireDateString(s.date) }
    })

    let streak: StreakState | null = null
    if (e.streak !== null) {
        const st = e.streak
        if (!st || st.version !== 1 || requireNonNegInt(st.count) < 1 || requireNonNegInt(st.best) < st.count) invalid()
        streak = { version: 1, count: st.count, best: st.best, lastDate: requireDateString(st.lastDate) }
    }

    return {
        format: 'YandexMusicTimeBackup',
        version: 1,
        exportedAt: e.exportedAt,
        sessions,
        streak,
        currentSessionSeconds: requireNonNegInt(e.currentSessionSeconds),
        previousSessionSeconds: requireNonNegInt(e.previousSessionSeconds),
    }
}

// ─── Serialisation ────────────────────────────────────────────────────────────

/** Serialises backup data as JSON string (v1, no owner binding) */
export function serializeBackupV1(data: Omit<BackupV1, 'format' | 'version' | 'exportedAt'>): string {
    const body = validateV1Body({ ...data, format: 'YandexMusicTimeBackup', version: 1, exportedAt: new Date().toISOString() })
    const json = JSON.stringify(body, null, 2)
    if (new TextEncoder().encode(json).byteLength > 104_857_600) throw new Error('Резервная копия превышает 100 МБ')
    return json
}

// ─── Owner binding (SHA-256) ──────────────────────────────────────────────────

const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

function requireLogin(login: unknown): string {
    if (typeof login !== 'string' || !login.trim()) {
        throw new Error('Войдите в аккаунт Яндекс Музыки, чтобы сохранить или восстановить копию')
    }
    return login.trim().toLowerCase()
}

async function computeDigest(login: string, salt: string): Promise<string> {
    const canonical = requireLogin(login)
    const data = new TextEncoder().encode(`YandexMusicTime:backup-owner:v2\0${salt}\0${canonical}`)
    return toHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data)))
}

/** Creates a v2 backup JSON string with owner binding */
export async function exportBackup(
    data: Omit<BackupV1, 'format' | 'version' | 'exportedAt'>,
    login: string,
): Promise<string> {
    requireLogin(login)
    const v1 = JSON.parse(serializeBackupV1(data))
    const salt = toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))
    const digest = await computeDigest(login, salt)
    const v2 = JSON.stringify({ ...v1, version: 2, owner: { scheme: 'ym-login-sha256-v1', salt, digest } }, null, 2)
    if (new TextEncoder().encode(v2).byteLength > 104_857_600) throw new Error('Резервная копия превышает 100 МБ')
    return v2
}

async function verifyOwner(raw: unknown, login: string): Promise<void> {
    requireLogin(login)
    const e = raw as any
    if (e?.format === 'YandexMusicTimeBackup' && e.version === 1) {
        throw new Error('Старая копия не привязана к аккаунту. Создайте новую копию в обновлённом аддоне')
    }
    const owner = e?.owner
    if (
        e?.format !== 'YandexMusicTimeBackup' ||
        e.version !== 2 ||
        owner?.scheme !== 'ym-login-sha256-v1' ||
        typeof owner.salt !== 'string' ||
        !/^[0-9a-f]{64}$/.test(owner.salt) ||
        typeof owner.digest !== 'string' ||
        !/^[0-9a-f]{64}$/.test(owner.digest)
    ) invalid()

    const expected = await computeDigest(login, owner.salt)
    let diff = 0
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ owner.digest.charCodeAt(i)
    if (diff) throw new Error('Эта резервная копия принадлежит другому аккаунту Яндекс Музыки')
}

/** Parses and validates a v2 backup JSON string, verifying owner */
export async function importBackup(jsonText: string, login: string): Promise<BackupV2> {
    let raw: unknown
    try {
        raw = JSON.parse(jsonText)
    } catch {
        invalid()
    }
    await verifyOwner(raw, login)
    const v1 = validateV1Body({ ...(raw as any), version: 1 })
    return { ...v1, version: 2, owner: (raw as any).owner }
}
