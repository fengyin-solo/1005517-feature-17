import type { EntryRow } from './types'

// 培训模块的领域规则都收在这一份：岗位目录、排期、限额、合格线、回写清单。
// 查询表单、登记表单、核定表单里的「受训岗位」全部从 POSITION_PLANS 取数，
// 两处（其实三处）用的是同一份岗位目录，不会出现各写一份对不上的情况。

export type PositionPlan = {
  岗位: string
  /** 培训按岗位排期：该岗位下一期培训的日期，登记时自动落到培训日期上。 */
  排期日期: string
  /** 本期该岗位的培训名额上限，排满再报就是超限，挡回。 */
  限额: number
}

export const POSITION_PLANS: PositionPlan[] = [
  { 岗位: '灌装岗位', 排期日期: '2026-10-12', 限额: 3 },
  { 岗位: '灭菌岗位', 排期日期: '2026-10-14', 限额: 3 },
  { 岗位: '灯检岗位', 排期日期: '2026-10-16', 限额: 2 },
  { 岗位: '包装岗位', 排期日期: '2026-10-19', 限额: 2 },
]

export const POSITION_NAMES: string[] = POSITION_PLANS.map((plan) => plan.岗位)

/** 考核成绩的合格线：培训组核定成绩后，达到该分数才允许判定合格。 */
export const PASS_SCORE = 60
export const SCORE_MAX = 100

/** 培训结果回写到批生产记录清单时，在本地存储里用的键。 */
export const TRAINING_WRITEBACK_KEY = 'batchrecord:training-writeback'

/** 状态老次序：待培训 → 培训中 → 已合格/未通过。只允许沿表推进，倒序、越级都拒收。 */
export const TRAINING_FLOW: Record<string, { from: string[]; to: string }> = {
  提交培训: { from: ['待培训'], to: '培训中' },
  判定合格: { from: ['培训中'], to: '已合格' },
  判定未通过: { from: ['培训中'], to: '未通过' },
}

export const TRAINING_FLOW_TEXT = '待培训 → 培训中 → 已合格/未通过'

export function findPositionPlan(岗位: string): PositionPlan | undefined {
  return POSITION_PLANS.find((plan) => plan.岗位 === 岗位)
}

/** 考核成绩统一按数字解读；空着或不是数字都算「尚未核定」，返回 null。 */
export function scoreOf(row: EntryRow): number | null {
  const raw = row['考核成绩']
  if (raw === '' || raw === undefined || raw === null) {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function isValidDateText(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

export function todayText(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** 有效期至要留档：合格日起一年，作为培训有效期的默认算法。 */
export function addOneYear(dateText: string): string {
  const date = new Date(`${dateText}T00:00:00`)
  date.setFullYear(date.getFullYear() + 1)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 生成一条回写到批生产记录清单的记录；同一份培训（按培训编号）只回写一次。 */
export function buildWritebackEntry(row: EntryRow, existing: EntryRow[], 回写时间: string): EntryRow {
  const id = existing.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  return {
    id,
    status: '已回写',
    pending: false,
    abnormal: false,
    培训编号: String(row['培训编号'] ?? ''),
    培训主题: String(row['培训主题'] ?? ''),
    受训岗位: String(row['受训岗位'] ?? ''),
    考核成绩: scoreOf(row) ?? '',
    有效期至: String(row['有效期至'] ?? ''),
    回写时间,
    回写说明: '培训判定合格，结果回写批生产记录清单留档',
  }
}
