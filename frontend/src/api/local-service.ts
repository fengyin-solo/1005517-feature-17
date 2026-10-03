import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  POSITION_MAX_LENGTH,
  POSITIONS,
  SCORE_MAX,
  SCORE_MIN,
  SCORE_PASS_LINE,
  TRAINING_GROUP,
  TRAINING_METHODS,
  TRAINING_STATUSES,
  TRAINING_TERMINAL_STATUSES,
  isPosition,
  trainingStamp,
} from '@/data/positions'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 培训状态按老次序流转：动作只能从指定前置状态发起，倒序、跳步一律拒收。
const TRAINING_FLOW: Record<string, { from: string[]; to: string }> = {
  提交培训: { from: ['待培训'], to: '培训中' },
  判定合格: { from: ['培训中'], to: '已合格' },
  判定未通过: { from: ['培训中'], to: '未通过' },
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// ---------------------------------------------------------------------------
// 人员培训：条件定位
// ---------------------------------------------------------------------------

export type TrainingQuery = {
  培训编号?: string
  培训主题?: string
  受训岗位?: string
  成绩下限?: string
  成绩上限?: string
  有效期起?: string
  有效期止?: string
  成绩排序?: '' | 'asc' | 'desc'
}

export type TrainingResult = PageResult & {
  /** 查不到时逐栏给出原因，讲清究竟是哪一栏把记录卡掉了。 */
  emptyReasons: string[]
}

type Criterion = {
  field: string
  label: string
  test: (row: EntryRow) => boolean
}

function numberScore(row: EntryRow): number {
  const raw = String(row.考核成绩 ?? '').trim()
  if (raw === '') {
    return NaN
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : NaN
}

export function queryTraining(query: TrainingQuery): TrainingResult {
  const rows = listRows('training')
  const criteria: Criterion[] = []
  const 编号 = query.培训编号?.trim() ?? ''
  const 主题 = query.培训主题?.trim() ?? ''
  const 岗位 = query.受训岗位?.trim() ?? ''
  const 下限 = query.成绩下限?.trim() ?? ''
  const 上限 = query.成绩上限?.trim() ?? ''
  const 有效期起 = query.有效期起?.trim() ?? ''
  const 有效期止 = query.有效期止?.trim() ?? ''

  if (编号) {
    criteria.push({
      field: '培训编号',
      label: `培训编号包含「${编号}」`,
      test: (row) => String(row.培训编号 ?? '').includes(编号),
    })
  }
  if (主题) {
    criteria.push({
      field: '培训主题',
      label: `培训主题包含「${主题}」`,
      test: (row) => String(row.培训主题 ?? '').includes(主题),
    })
  }
  if (岗位) {
    criteria.push({
      field: '受训岗位',
      label: `受训岗位包含「${岗位}」`,
      test: (row) => String(row.受训岗位 ?? '').includes(岗位),
    })
  }

  const low = 下限 === '' ? null : Number(下限)
  const high = 上限 === '' ? null : Number(上限)
  if (low !== null && high !== null && (Number.isNaN(low) || Number.isNaN(high) || low > high)) {
    return {
      items: [],
      total: 0,
      page: 1,
      size: 0,
      emptyReasons: ['考核成绩区间上下限填反了：下限不能大于上限'],
    }
  }
  if (low !== null && !Number.isNaN(low)) {
    criteria.push({
      field: '考核成绩',
      label:
        high !== null && !Number.isNaN(high)
          ? `考核成绩落在 ${low} ~ ${high} 之间`
          : `考核成绩不低于 ${low}`,
      test: (row) => {
        const score = numberScore(row)
        if (Number.isNaN(score)) {
          return false
        }
        return high !== null && !Number.isNaN(high)
          ? score >= low && score <= high
          : score >= low
      },
    })
  } else if (high !== null && !Number.isNaN(high)) {
    criteria.push({
      field: '考核成绩',
      label: `考核成绩不高于 ${high}`,
      test: (row) => {
        const score = numberScore(row)
        return !Number.isNaN(score) && score <= high
      },
    })
  }

  if (有效期起 && 有效期止 && 有效期起 > 有效期止) {
    return {
      items: [],
      total: 0,
      page: 1,
      size: 0,
      emptyReasons: ['有效期至区间上下限填反了：下限日期不能晚于上限日期'],
    }
  }
  if (有效期起) {
    criteria.push({
      field: '有效期至',
      label: 有效期止
        ? `有效期至落在 ${有效期起} ~ ${有效期止} 之间`
        : `有效期至不早于 ${有效期起}`,
      test: (row) => {
        const value = String(row.有效期至 ?? '')
        return 有效期止 ? value >= 有效期起 && value <= 有效期止 : value >= 有效期起
      },
    })
  } else if (有效期止) {
    criteria.push({
      field: '有效期至',
      label: `有效期至不晚于 ${有效期止}`,
      test: (row) => String(row.有效期至 ?? '') <= 有效期止,
    })
  }

  // 逐栏收窄：每一栏都报告在当前剩余记录里卡掉多少条，最后一档为空时能讲清是哪一栏卡住。
  const emptyReasons: string[] = []
  if (rows.length === 0) {
    emptyReasons.push('暂无任何培训记录，可先按岗位登记排期')
  } else {
    let remaining = rows
    for (const criterion of criteria) {
      const before = remaining.length
      remaining = remaining.filter(criterion.test)
      if (remaining.length === 0) {
        emptyReasons.push(
          `卡在「${criterion.field}」栏：${criterion.label} 在前 ${before} 条记录里没有匹配项`,
        )
      }
    }
    if (remaining.length === 0 && criteria.length === 0) {
      emptyReasons.push('暂无任何培训记录，可先按岗位登记排期')
    }
  }

  const matched = criteria.reduce(
    (remaining, criterion) => remaining.filter(criterion.test),
    rows,
  )
  const sorted = [...matched]
  if (query.成绩排序 === 'asc' || query.成绩排序 === 'desc') {
    // 无成绩的记录排到最后，不参与区间比较也不打乱有成绩的顺序。
    sorted.sort((a, b) => {
      const sa = numberScore(a)
      const sb = numberScore(b)
      const na = Number.isNaN(sa)
      const nb = Number.isNaN(sb)
      if (na && nb) {
        return 0
      }
      if (na) {
        return 1
      }
      if (nb) {
        return -1
      }
      return query.成绩排序 === 'asc' ? sa - sb : sb - sa
    })
  }
  return { items: sorted, total: sorted.length, page: 1, size: sorted.length, emptyReasons }
}

// ---------------------------------------------------------------------------
// 人员培训：按岗位排期登记、成绩核定、状态流转、回写批生产记录
// ---------------------------------------------------------------------------

export type TrainingDraft = {
  培训编号: string
  培训主题: string
  受训岗位: string
  培训方式: string
  培训日期: string
  有效期至: string
}

export type ScoreDraft = {
  score: string
  verifier: string
  role?: string
}

export type ActionContext = {
  role?: string
  operator?: string
  score?: string
}

export function positionOptions(): string[] {
  return [...POSITIONS]
}

export function trainingMethodOptions(): string[] {
  return [...TRAINING_METHODS]
}

export function scheduleTraining(draft: TrainingDraft): ActionResult {
  const 编号 = draft.培训编号.trim()
  const 主题 = draft.培训主题.trim()
  const 岗位 = draft.受训岗位.trim()
  const 方式 = draft.培训方式.trim()
  const 培训日期 = draft.培训日期.trim()
  const 有效期至 = draft.有效期至.trim()

  if (!编号) {
    return { ok: false, message: '培训编号为必填，空编号无法排期' }
  }
  if (!/^[A-Za-z0-9-]+$/.test(编号)) {
    return { ok: false, message: '培训编号只能包含字母、数字与连字符' }
  }
  if (!主题) {
    return { ok: false, message: '培训主题为必填，空主题无法排期' }
  }
  // 同一份培训重复判定只算一次：编号排期阶段就拒绝重复。
  if (listRows('training').some((row) => String(row.培训编号) === 编号)) {
    return { ok: false, message: `培训编号「${编号}」已排期，同一份培训不得重复登记` }
  }
  if (!岗位) {
    return { ok: false, message: '受训岗位为必填，培训必须按岗位排期' }
  }
  // 受训岗位越界（不在岗位名册）或超限（超长）的挡回。
  if (岗位.length > POSITION_MAX_LENGTH) {
    return {
      ok: false,
      message: `受训岗位「${岗位}」超过 ${POSITION_MAX_LENGTH} 个字，超限已挡回`,
    }
  }
  if (!isPosition(岗位)) {
    return {
      ok: false,
      message: `受训岗位「${岗位}」不在岗位名册内，越界已挡回；可选：${POSITIONS.join('、')}`,
    }
  }
  if (!(TRAINING_METHODS as readonly string[]).includes(方式)) {
    return {
      ok: false,
      message: `培训方式「${方式}」不在允许范围内，可选：${TRAINING_METHODS.join('、')}`,
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(培训日期)) {
    return { ok: false, message: '培训日期格式应为 YYYY-MM-DD' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(有效期至)) {
    return { ok: false, message: '有效期至必须留档，格式应为 YYYY-MM-DD' }
  }
  if (有效期至 <= 培训日期) {
    return { ok: false, message: '有效期至必须晚于培训日期，否则无法留档' }
  }

  const rows = listRows('training')
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id,
    status: '待培训',
    pending: true,
    abnormal: false,
    培训编号: 编号,
    培训主题: 主题,
    受训岗位: 岗位,
    培训方式: 方式,
    考核成绩: '',
    培训日期,
    有效期至,
    培训状态: '待培训',
    成绩核定人: '',
  }
  saveRows('training', [...rows, row])
  return { ok: true, message: `已按「${岗位}」排期培训「${编号}」，当前状态「待培训」` }
}

// 考核成绩由培训组核定：非培训组、区间越界一律拒收。
export function approveScore(id: number, draft: ScoreDraft): ActionResult {
  if (draft.role !== TRAINING_GROUP) {
    return { ok: false, message: `考核成绩由${TRAINING_GROUP}核定，当前身份无权核定成绩` }
  }
  const rows = listRows('training')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的培训记录` }
  }
  const status = String(rows[index].status)
  if (status !== '培训中') {
    return {
      ok: false,
      message: `仅「培训中」的记录需要核定成绩，当前状态「${status}」，核定已拒收`,
    }
  }
  const score = draft.score.trim()
  if (score === '') {
    return { ok: false, message: '考核成绩不能为空，核定被挡回' }
  }
  const value = Number(score)
  if (!Number.isFinite(value) || value < SCORE_MIN || value > SCORE_MAX) {
    return {
      ok: false,
      message: `考核成绩必须在 ${SCORE_MIN} ~ ${SCORE_MAX} 之间，「${score}」越界已挡回`,
    }
  }
  const verifier = draft.verifier.trim() || TRAINING_GROUP
  const next = [...rows]
  next[index] = {
    ...rows[index],
    考核成绩: String(value),
    成绩核定人: `${verifier}（${TRAINING_GROUP}）`,
  }
  saveRows('training', next)
  return { ok: true, message: `成绩 ${value} 已由${TRAINING_GROUP}核定并留档` }
}

// 结论回写到批生产记录清单：按受训岗位匹配，同岗位取已合格且最晚到期的一份。
function writeBackToBatchRecords(): number {
  const trainings = listRows('training')
  const batches = listRows('batchrecord')
  const latestQualified = new Map<string, EntryRow>()
  for (const item of trainings) {
    if (String(item.status) !== '已合格') {
      continue
    }
    const position = String(item.受训岗位)
    const current = latestQualified.get(position)
    if (!current || String(item.有效期至) > String(current.有效期至)) {
      latestQualified.set(position, item)
    }
  }
  let touched = 0
  const next = batches.map((batch) => {
    // 批记录清单按受训岗位与培训结论对账；没有登记受训岗位的批记录不参与。
    if (!batch.受训岗位) {
      return batch
    }
    const qualified = latestQualified.get(String(batch.受训岗位 ?? ''))
    const stamp = qualified ? trainingStamp(qualified) : '未核对'
    if (String(batch.岗位培训核对 ?? '') === stamp) {
      return batch
    }
    touched += 1
    return { ...batch, 岗位培训核对: stamp }
  })
  saveRows('batchrecord', next)
  return touched
}

export function runAction(
  key: string,
  id: number,
  action: string,
  context: ActionContext = {},
): ActionResult {
  if (key === 'training') {
    return runTrainingAction(id, action, context)
  }

  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function runTrainingAction(id: number, action: string, context: ActionContext): ActionResult {
  const flow = TRAINING_FLOW[action]
  if (!flow) {
    return { ok: false, message: `培训记录没有登记「${action}」这个动作` }
  }
  const rows = listRows('training')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的培训记录` }
  }
  const row = rows[index]
  const current = String(row.status)

  // 终态重复判定只算一次：已合格/未通过的记录再次判定一律拒收。
  if (TRAINING_TERMINAL_STATUSES.includes(current as (typeof TRAINING_TERMINAL_STATUSES)[number])) {
    return {
      ok: false,
      message: `培训记录已是终态「${current}」，同一份培训重复判定只算一次`,
    }
  }
  // 状态按老次序流转：不是该动作的前置状态即为倒序或跳步，拒收。
  if (!flow.from.includes(current)) {
    return {
      ok: false,
      message: `状态需按 ${TRAINING_STATUSES.join(' → ')} 次序流转，「${current}」不能直接${action}（应先到「${flow.from.join('/')}」），倒序/跳步已拒收`,
    }
  }

  let updated: EntryRow = { ...row, status: flow.to, 培训状态: flow.to }

  if (action === '判定合格' || action === '判定未通过') {
    // 考核成绩由培训组核定，非培训组的判定拒收。
    if (context.role !== TRAINING_GROUP) {
      return { ok: false, message: `考核成绩由${TRAINING_GROUP}核定，当前身份无权${action}` }
    }
    const rawScore = context.score?.trim() ?? String(row.考核成绩 ?? '').trim()
    const value = Number(rawScore)
    if (rawScore === '' || !Number.isFinite(value) || value < SCORE_MIN || value > SCORE_MAX) {
      return {
        ok: false,
        message: `判定前须先由${TRAINING_GROUP}核定 ${SCORE_MIN} ~ ${SCORE_MAX} 之间的考核成绩`,
      }
    }
    if (action === '判定合格' && value < SCORE_PASS_LINE) {
      return {
        ok: false,
        message: `考核成绩 ${value} 低于合格线 ${SCORE_PASS_LINE}，不能判定合格`,
      }
    }
    if (action === '判定未通过' && value >= SCORE_PASS_LINE) {
      return {
        ok: false,
        message: `考核成绩 ${value} 已达合格线 ${SCORE_PASS_LINE}，不能判定未通过`,
      }
    }
    const verifier = String(
      row.成绩核定人 ?? `${context.operator?.trim() || TRAINING_GROUP}（${TRAINING_GROUP}）`,
    )
    updated = {
      ...updated,
      考核成绩: String(value),
      成绩核定人: verifier,
      pending: false,
      abnormal: false,
    }
  } else {
    updated.pending = flow.to !== '已合格' && flow.to !== '未通过'
  }

  const next = [...rows]
  next[index] = updated
  saveRows('training', next)

  // 判定结论回写到批生产记录的清单。
  if (action === '判定合格' || action === '判定未通过') {
    const touched = writeBackToBatchRecords()
    const writeBack =
      action === '判定合格'
        ? `，结论已回写到批生产记录清单（更新 ${touched} 条同岗位核对栏）`
        : '，结论为未通过，批生产记录清单中该岗位维持/回退为未核对'
    return { ok: true, message: `培训记录已${action}，当前状态「${flow.to}」${writeBack}` }
  }
  return { ok: true, message: `培训记录已${action}，当前状态「${flow.to}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
