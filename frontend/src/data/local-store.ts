import { migrateV1 } from './migration'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pharma-cleanroom:entries'
const VERSION_KEY = 'pharma-cleanroom:schema-version'
const CURRENT_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type Stored = {
  data: Record<string, EntryRow[]>
  version: number
}

function seedStored(): Stored {
  return { data: clone(SEED_ROWS), version: CURRENT_VERSION }
}

function readStorage(): Stored {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedStored()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = seedStored()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded.data))
    window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const version = Number(window.localStorage.getItem(VERSION_KEY) ?? '1')
    // 版本低于当前：走存量迁移，按旧记录回填后再落库。
    if (version < CURRENT_VERSION) {
      const { data } = migrateV1({ ...clone(SEED_ROWS), ...parsed })
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
      return { data, version: CURRENT_VERSION }
    }
    return { data: { ...clone(SEED_ROWS), ...parsed }, version }
  } catch {
    const seeded = seedStored()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded.data))
    window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
    return seeded
  }
}

let cache: Stored | null = null

function stored(): Stored {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return stored().data
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const nextData = { ...allRows(), [key]: rows }
  cache = { data: nextData, version: CURRENT_VERSION }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextData))
    window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 仅供测试：丢弃内存缓存，下次读取重新走 localStorage（含迁移）。 */
export function __resetCacheForTest(): void {
  cache = null
}
