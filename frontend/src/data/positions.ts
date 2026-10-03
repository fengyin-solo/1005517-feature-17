import type { EntryRow } from './types'

/**
 * 受训岗位名册：培训排期与批生产记录两处都从这里取岗位，
 * 保证两边认的是同一份岗位，不允许各自填各自的。
 */
export const POSITIONS = [
  '无菌灌装岗',
  '胶塞清洗岗',
  '配液岗',
  '灯检岗',
  '包装岗',
  '洁净区监测岗',
  '物料称量岗',
  '设备维护岗',
] as const

export type Position = (typeof POSITIONS)[number]

export function isPosition(value: string): value is Position {
  return (POSITIONS as readonly string[]).includes(value)
}

/** 登记/排期时的边界：不在名册内（越界）或超出长度（超限）的受训岗位一律挡回。 */
export const POSITION_MAX_LENGTH = 12

export const TRAINING_METHODS = ['线下授课', '现场带教', '线上学习', '应急演练'] as const

export const TRAINING_GROUP = '培训组'

export const SCORE_MIN = 0
export const SCORE_MAX = 100
/** 合格线：由培训组按此线判定。 */
export const SCORE_PASS_LINE = 60

export const TRAINING_STATUSES = ['待培训', '培训中', '已合格', '未通过'] as const
export const TRAINING_TERMINAL_STATUSES = ['已合格', '未通过'] as const

/** 回写到批生产记录清单上的培训结论戳记，两处显示保持同一格式。 */
export function trainingStamp(row: EntryRow): string {
  return `${row.status}（${row.培训编号}，有效期至 ${row.有效期至}）`
}
