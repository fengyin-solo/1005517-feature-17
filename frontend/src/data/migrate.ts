import {
  POSITION_PLANS,
  TRAINING_WRITEBACK_KEY,
  addOneYear,
  buildWritebackEntry,
  findPositionPlan,
  isValidDateText,
  scoreOf,
} from './training-domain'
import type { EntryRow } from './types'

// 存量迁移：旧记录里 考核成绩/有效期至/受训岗位 可能是占位文本或空值，
// 打开页面时按旧记录自身的数据回填成新结构。迁移是幂等的，跑多次结果一样。
// 注意：越界/超限挡回只针对新登记，存量数据不按限额卡，只把越界岗位回填进目录。

function migrateTrainingRow(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row }
  const notes: string[] = []
  const status = String(next.status ?? '')

  // 受训岗位：不在岗位目录里的算越界，按记录 id 确定性回填到目录内岗位。
  const 岗位 = String(next['受训岗位'] ?? '')
  if (!findPositionPlan(岗位)) {
    const id = Number(next.id) || 0
    const fallback = POSITION_PLANS[Math.abs(id - 1) % POSITION_PLANS.length]
    next['受训岗位'] = fallback.岗位
    notes.push(`原受训岗位「${岗位 || '空'}」越界，按旧记录回填为「${fallback.岗位}」`)
  }

  // 考核成绩：旧记录里的非数字成绩无法参与区间筛选。已合格的按合格线回填，其余留空待培训组核定。
  if (scoreOf(next) === null && String(next['考核成绩'] ?? '') !== '') {
    if (status === '已合格') {
      next['考核成绩'] = 60
      notes.push('原考核成绩无法识别，已合格记录按合格线 60 回填')
    } else {
      next['考核成绩'] = ''
      notes.push('原考核成绩无法识别，清空待培训组核定')
    }
  }

  // 有效期至要留档：已合格的旧记录缺有效期时，按旧记录的培训日期顺延一年回填。
  if (!isValidDateText(next['有效期至'])) {
    if (status === '已合格' && isValidDateText(next['培训日期'])) {
      next['有效期至'] = addOneYear(next['培训日期'])
      notes.push(`有效期至缺失，按旧记录培训日期顺延一年回填为「${next['有效期至']}」`)
    } else if (String(next['有效期至'] ?? '') !== '') {
      next['有效期至'] = ''
      notes.push('原有效期至无法识别，已清空')
    }
  }

  // 已判定的旧记录补上核定留痕：考核成绩由培训组核定，核定人/核定日期不能空。
  if ((status === '已合格' || status === '未通过') && String(next['核定人'] ?? '') === '') {
    next['核定人'] = '培训组'
    next['核定日期'] = isValidDateText(next['培训日期']) ? next['培训日期'] : ''
    notes.push('补登核定人「培训组」及核定日期')
  }

  // 培训状态字段与当前状态保持一致。
  if (String(next['培训状态'] ?? '') !== status) {
    next['培训状态'] = status
  }

  if (notes.length > 0) {
    next['迁移备注'] = notes.join('；')
  }
  return next
}

export function migrateStorage(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next = { ...data }
  const trainings = (next['training'] ?? []).map(migrateTrainingRow)
  next['training'] = trainings

  // 结果回写：已合格的旧记录按旧记录回填进批生产记录的清单，同一份培训只回写一次。
  const writebacks = [...(next[TRAINING_WRITEBACK_KEY] ?? [])]
  for (const row of trainings) {
    if (String(row.status) !== '已合格') {
      continue
    }
    if (writebacks.some((item) => item['培训编号'] === row['培训编号'])) {
      continue
    }
    const 回写时间 = isValidDateText(row['核定日期']) ? row['核定日期'] : String(row['培训日期'] ?? '')
    writebacks.push(buildWritebackEntry(row, writebacks, 回写时间))
  }
  next[TRAINING_WRITEBACK_KEY] = writebacks
  return next
}
