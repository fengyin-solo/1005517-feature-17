import { listRows, saveRows } from '@/data/local-store'
import {
  PASS_SCORE,
  SCORE_MAX,
  TRAINING_FLOW,
  TRAINING_FLOW_TEXT,
  TRAINING_WRITEBACK_KEY,
  addOneYear,
  buildWritebackEntry,
  findPositionPlan,
  isValidDateText,
  scoreOf,
  todayText,
} from '@/data/training-domain'
import type { ActionResult, EntryRow } from '@/data/types'

// 培训模块的业务入口：条件定位、登记、核定、判定、回写都走这里，
// 不套用通用 runAction —— 状态老次序、重复判定、岗位越界/超限这些规则是培训自己的。

const KEY = 'training'

// ---------- 条件定位 ----------

export type TrainingQuery = {
  培训编号: string
  培训主题: string
  受训岗位: string
  成绩下限: string
  成绩上限: string
  有效期起: string
  有效期止: string
}

export type ScoreSort = '' | 'asc' | 'desc'

export type TrainingQueryResult = {
  items: EntryRow[]
  total: number
  /** 查不到时的诊断：讲清是哪一栏条件把结果卡没的。 */
  blockers: string[]
}

export function emptyQuery(): TrainingQuery {
  return { 培训编号: '', 培训主题: '', 受训岗位: '', 成绩下限: '', 成绩上限: '', 有效期起: '', 有效期止: '' }
}

type Condition = { label: string; test: (row: EntryRow) => boolean }

function buildConditions(query: TrainingQuery): Condition[] {
  const conditions: Condition[] = []
  const 编号 = query.培训编号.trim()
  if (编号) {
    conditions.push({ label: `培训编号包含「${编号}」`, test: (row) => String(row['培训编号'] ?? '').includes(编号) })
  }
  const 主题 = query.培训主题.trim()
  if (主题) {
    conditions.push({ label: `培训主题包含「${主题}」`, test: (row) => String(row['培训主题'] ?? '').includes(主题) })
  }
  if (query.受训岗位) {
    const 岗位 = query.受训岗位
    conditions.push({ label: `受训岗位 = 「${岗位}」`, test: (row) => String(row['受训岗位'] ?? '') === 岗位 })
  }
  const 下限 = query.成绩下限.trim()
  const 上限 = query.成绩上限.trim()
  if (下限 || 上限) {
    const min = 下限 ? Number(下限) : -Infinity
    const max = 上限 ? Number(上限) : Infinity
    const rangeText = `${下限 || '不限'} ~ ${上限 || '不限'}`
    conditions.push({
      label: `考核成绩在 ${rangeText}`,
      test: (row) => {
        const score = scoreOf(row)
        return score !== null && score >= min && score <= max
      },
    })
  }
  const 起 = query.有效期起
  const 止 = query.有效期止
  if (起 || 止) {
    const rangeText = `${起 || '不限'} 至 ${止 || '不限'}`
    conditions.push({
      label: `有效期至在 ${rangeText}`,
      test: (row) => {
        const date = row['有效期至']
        if (!isValidDateText(date)) {
          return false
        }
        return (!起 || date >= 起) && (!止 || date <= 止)
      },
    })
  }
  return conditions
}

function sortByScore(rows: EntryRow[], order: Exclude<ScoreSort, ''>): EntryRow[] {
  const direction = order === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const sa = scoreOf(a)
    const sb = scoreOf(b)
    // 没有成绩的记录无论升序降序都排在最后。
    if (sa === null && sb === null) return 0
    if (sa === null) return 1
    if (sb === null) return -1
    return (sa - sb) * direction
  })
}

export function queryTraining(query: TrainingQuery, sort: ScoreSort): TrainingQueryResult {
  const rows = listRows(KEY)
  const conditions = buildConditions(query)
  let matched = rows.filter((row) => conditions.every((condition) => condition.test(row)))
  if (sort) {
    matched = sortByScore(matched, sort)
  }

  const blockers: string[] = []
  if (matched.length === 0 && conditions.length > 0) {
    // 按顺序逐个叠加条件，第一个把结果卡成 0 条的就是「卡住的那一栏」。
    let rest = rows
    for (const condition of conditions) {
      const next = rest.filter(condition.test)
      if (next.length === 0) {
        blockers.push(`卡在「${condition.label}」：叠加该条件前还有 ${rest.length} 条，叠加后一条不剩`)
        break
      }
      rest = next
    }
    // 再把每一栏单独过筛的命中数列出来，方便判断哪一栏收得太紧。
    for (const condition of conditions) {
      blockers.push(`「${condition.label}」单独命中 ${rows.filter(condition.test).length} 条`)
    }
  }
  return { items: matched, total: matched.length, blockers }
}

// ---------- 登记：岗位越界/超限挡回，培训日期按岗位排期 ----------

export type RegisterInput = {
  培训主题: string
  受训岗位: string
  培训方式: string
}

export function registerTraining(input: RegisterInput): ActionResult {
  const 主题 = input.培训主题.trim()
  if (!主题) {
    return { ok: false, message: '培训主题不能为空' }
  }
  const plan = findPositionPlan(input.受训岗位)
  if (!plan) {
    return { ok: false, message: `受训岗位「${input.受训岗位 || '空'}」不在岗位目录内（越界），已挡回` }
  }
  const rows = listRows(KEY)
  const used = rows.filter((row) => String(row['受训岗位']) === plan.岗位).length
  if (used >= plan.限额) {
    return { ok: false, message: `「${plan.岗位}」本期名额 ${plan.限额} 人已排满（超限），已挡回` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const 编号序号 = rows.reduce((max, row) => {
    const match = /^TRAI-(\d+)$/.exec(String(row['培训编号'] ?? ''))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  const row: EntryRow = {
    id,
    status: '待培训',
    pending: true,
    abnormal: false,
    培训编号: `TRAI-${String(编号序号).padStart(4, '0')}`,
    培训主题: 主题,
    受训岗位: plan.岗位,
    培训方式: input.培训方式 || '线下实操',
    考核成绩: '',
    培训日期: plan.排期日期,
    有效期至: '',
    培训状态: '待培训',
    核定人: '',
    核定日期: '',
  }
  saveRows(KEY, [...rows, row])
  return { ok: true, message: `已登记 ${row['培训编号']}（${plan.岗位}，按岗位排期定于 ${plan.排期日期}）` }
}

// ---------- 核定成绩：考核成绩由培训组核定，受训岗位两处取来须为同一份 ----------

export function verifyScore(id: number, scoreInput: string, confirmedPosition: string): ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的培训记录` }
  }
  const row = rows[index]
  if (String(row.status) !== '培训中') {
    return { ok: false, message: `只有「培训中」的记录才能核定成绩，当前状态「${row.status}」` }
  }
  const 登记岗位 = String(row['受训岗位'] ?? '')
  if (confirmedPosition !== 登记岗位) {
    return {
      ok: false,
      message: `受训岗位两处取来的不一致：登记为「${登记岗位}」，核实时选为「${confirmedPosition || '空'}」，已挡回`,
    }
  }
  const score = Number(scoreInput)
  if (!scoreInput.trim() || !Number.isFinite(score) || score < 0 || score > SCORE_MAX) {
    return { ok: false, message: `考核成绩须为 0~${SCORE_MAX} 的数字` }
  }
  const next = [...rows]
  next[index] = { ...row, 考核成绩: score, 核定人: '培训组', 核定日期: todayText() }
  saveRows(KEY, next)
  return { ok: true, message: `考核成绩 ${score} 分已由培训组核定（${todayText()}）` }
}

// ---------- 状态流转：按老次序，倒序拒收；同一份培训重复判定只算一次 ----------

export function transitionTraining(id: number, action: string): ActionResult {
  const rule = TRAINING_FLOW[action]
  if (!rule) {
    return { ok: false, message: `培训记录没有登记「${action}」这个动作` }
  }
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的培训记录` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (action.startsWith('判定') && (current === '已合格' || current === '未通过')) {
    return { ok: false, message: `该培训已判定为「${current}」，同一份培训重复判定只算一次` }
  }
  if (!rule.from.includes(current)) {
    return {
      ok: false,
      message: `状态按老次序流转（${TRAINING_FLOW_TEXT}），当前「${current}」不能执行「${action}」，倒序/越级拒收`,
    }
  }
  if (action.startsWith('判定')) {
    const score = scoreOf(row)
    if (score === null || String(row['核定人'] ?? '') === '') {
      return { ok: false, message: '考核成绩尚未经培训组核定，不能判定' }
    }
    if (action === '判定合格' && score < PASS_SCORE) {
      return { ok: false, message: `核定成绩 ${score} 未达合格线 ${PASS_SCORE}，不能判定合格` }
    }
  }

  const updated: EntryRow = {
    ...row,
    status: rule.to,
    培训状态: rule.to,
    pending: rule.to === '待培训' || rule.to === '培训中',
    abnormal: rule.to === '未通过',
  }
  const messages = [`已${action}，当前状态「${rule.to}」`]
  if (action === '判定合格') {
    // 有效期至要留档：合格时落定有效期，已有留档的不覆盖。
    if (!isValidDateText(updated['有效期至'])) {
      const base = isValidDateText(updated['核定日期']) ? String(updated['核定日期']) : todayText()
      updated['有效期至'] = addOneYear(base)
      messages.push(`有效期至 ${updated['有效期至']} 已留档`)
    }
    const writeback = writeBackToBatchRecord(updated)
    messages.push(writeback.message)
  }
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  return { ok: true, message: messages.join('；') }
}

// ---------- 结果回写到批生产记录的清单 ----------

export function writeBackToBatchRecord(row: EntryRow): ActionResult {
  const list = listRows(TRAINING_WRITEBACK_KEY)
  if (list.some((item) => item['培训编号'] === row['培训编号'])) {
    return { ok: true, message: '回写清单中已有该培训，重复判定只算一次，未重复回写' }
  }
  const entry = buildWritebackEntry(row, list, todayText())
  saveRows(TRAINING_WRITEBACK_KEY, [...list, entry])
  return { ok: true, message: `结果已回写到批生产记录的清单（第 ${entry.id} 条）` }
}

export function listTrainingWritebacks(): EntryRow[] {
  return listRows(TRAINING_WRITEBACK_KEY)
}
