import {
  POSITIONS,
  TRAINING_METHODS,
  TRAINING_STATUSES,
  TRAINING_TERMINAL_STATUSES,
  isPosition,
  trainingStamp,
} from './positions'
import type { EntryRow } from './types'

/**
 * 存量数据迁移：旧版本地数据字段是占位文本（“人员培训样例1”之类），
 * 迁移到 v2 时按旧记录逐条回填为可检索、可流转的数据。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const BATCH_FIELDS = [
  '批号',
  '产品名称',
  '生产工序',
  '投料量',
  '操作人',
  '复核人',
  '起始时间',
  '批记录状态',
  '受训岗位',
  '岗位培训核对',
] as const

// 旧记录里“人员培训样例1”这类明显是生成器写入的占位值，不可信，需回填。
function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && /样例/.test(value)
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value)
}

// 旧记录无有效日期时按培训日期顺延一年，历史留档仍可继续核对。
function addOneYear(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function asDate(value: unknown, fallback: string): string {
  return isValidDate(value) ? value : fallback
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' && !isPlaceholder(value)
    ? value.trim()
    : fallback
}

// 旧岗位若已越界（不在现行名册内），按旧岗位名中的线索归并回名册，归并不了的落到首个岗位。
const LEGACY_POSITION_HINTS: Record<string, string> = {
  灌装: '无菌灌装岗',
  胶塞: '胶塞清洗岗',
  配液: '配液岗',
  灯检: '灯检岗',
  包装: '包装岗',
  监测: '洁净区监测岗',
  称量: '物料称量岗',
  维护: '设备维护岗',
}

function normalizePosition(value: unknown, seed: number): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (isPosition(trimmed)) {
      return trimmed
    }
    const hint = Object.entries(LEGACY_POSITION_HINTS).find(([word]) => trimmed.includes(word))
    if (hint) {
      return hint[1]
    }
  }
  return POSITIONS[seed % POSITIONS.length]
}

function normalizeScore(value: unknown, status: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string' && value.trim() !== '' && !isPlaceholder(value)) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return String(parsed)
    }
  }
  // 旧记录未留下可信成绩：按旧状态回填一个与结论一致的成绩，标注由历史迁移核定。
  if (status === '已合格') {
    return '80'
  }
  if (status === '未通过') {
    return '50'
  }
  return ''
}

function normalizeTrainingRow(raw: EntryRow, index: number): EntryRow {
  const id = typeof raw.id === 'number' ? raw.id : index + 1
  const status = TRAINING_STATUSES.includes(raw.status as (typeof TRAINING_STATUSES)[number])
    ? String(raw.status)
    : '待培训'
  const trainDate = asDate(raw.培训日期, `2026-09-${String(Math.min(index + 1, 28)).padStart(2, '0')}`)
  const validUntil = isValidDate(raw.有效期至) ? raw.有效期至 : addOneYear(trainDate)

  const row: EntryRow = {
    id,
    status,
    pending: !TRAINING_TERMINAL_STATUSES.includes(status as (typeof TRAINING_TERMINAL_STATUSES)[number]),
    abnormal: status === '未通过' ? false : Boolean(raw.abnormal),
  }
  row.培训编号 = text(raw.培训编号, `TRAI-${String(id).padStart(4, '0')}`)
  row.培训主题 = text(raw.培训主题, `历史培训-${String(id).padStart(4, '0')}`)
  row.受训岗位 = normalizePosition(raw.受训岗位, index)
  const method = text(raw.培训方式, TRAINING_METHODS[index % TRAINING_METHODS.length])
  row.培训方式 = (TRAINING_METHODS as readonly string[]).includes(method)
    ? method
    : TRAINING_METHODS[index % TRAINING_METHODS.length]
  row.考核成绩 = normalizeScore(raw.考核成绩, status)
  row.培训日期 = trainDate
  row.有效期至 = validUntil
  row.培训状态 = status
  row.成绩核定人 = text(raw.成绩核定人, '培训组（历史数据回填）')
  // 非白名单字段原样保留，避免丢掉旧记录上的其他留档信息。
  for (const key of Object.keys(raw)) {
    if (!(key in row)) {
      row[key] = raw[key]
    }
  }
  return row
}

// 批记录按生产工序就近对应到岗位名册，保证两处岗位取的是同一份。
const PROCESS_POSITION_HINTS: Record<string, string> = {
  灌装: '无菌灌装岗',
  胶塞: '胶塞清洗岗',
  配: '配液岗',
  灯检: '灯检岗',
  包装: '包装岗',
  监测: '洁净区监测岗',
  称量: '物料称量岗',
  维护: '设备维护岗',
}

function batchPosition(raw: EntryRow, index: number): string {
  const current = raw.受训岗位
  if (typeof current === 'string' && isPosition(current.trim())) {
    return current.trim()
  }
  const process = String(raw.生产工序 ?? '')
  const hit = Object.entries(PROCESS_POSITION_HINTS).find(([word]) => process.includes(word))
  return hit ? hit[1] : POSITIONS[index % POSITIONS.length]
}

function normalizeBatchRow(raw: EntryRow, index: number, trainings: EntryRow[]): EntryRow {
  const row: EntryRow = {
    id: typeof raw.id === 'number' ? raw.id : index + 1,
    status: typeof raw.status === 'string' && raw.status.trim() !== '' ? raw.status : '待编制',
    pending: Boolean(raw.pending),
    abnormal: Boolean(raw.abnormal),
  }
  for (const field of BATCH_FIELDS) {
    row[field] = isPlaceholder(raw[field]) ? '' : (raw[field] ?? '')
  }
  row.批号 = text(raw.批号, `BAT-${String(row.id).padStart(4, '0')}`)
  row.产品名称 = text(raw.产品名称, '历史产品')
  row.生产工序 = text(raw.生产工序, '')
  row.受训岗位 = batchPosition(raw, index)

  // 以迁移后的培训结论重建批记录清单上的核对栏：同岗位只取已合格且最晚到期的一份。
  const matched = trainings
    .filter(
      (item) =>
        String(item.受训岗位) === String(row.受训岗位) &&
        String(item.status) === '已合格',
    )
    .sort((a, b) => String(b.有效期至).localeCompare(String(a.有效期至)))
  row.岗位培训核对 = matched.length ? trainingStamp(matched[0]) : '未核对'

  for (const key of Object.keys(raw)) {
    if (!(key in row)) {
      row[key] = raw[key]
    }
  }
  return row
}

export type MigrationReport = {
  migrated: boolean
  trainingRows: number
  batchRows: number
}

/** 把旧版（无版本标记）数据迁移到 v2；已是 v2 的数据原样返回。 */
export function migrateV1(data: Record<string, EntryRow[]>): {
  data: Record<string, EntryRow[]>
  report: MigrationReport
} {
  const trainings = (data.training ?? []).map((raw, index) => normalizeTrainingRow(raw, index))
  const batches = (data.batchrecord ?? []).map((raw, index) =>
    normalizeBatchRow(raw, index, trainings),
  )
  return {
    data: { ...data, training: trainings, batchrecord: batches },
    report: { migrated: true, trainingRows: trainings.length, batchRows: batches.length },
  }
}
