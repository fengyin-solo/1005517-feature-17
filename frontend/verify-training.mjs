// 端到端核验培训模块业务规则：迁移、条件定位、流转拒收、权限、回写。
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const harness = `
const mem = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
}
export function dump() {
  return Object.fromEntries(mem)
}
export function load(raw, version) {
  mem.clear()
  if (raw) {
    mem.set('pharma-cleanroom:entries', JSON.stringify(raw))
    if (version) mem.set('pharma-cleanroom:schema-version', String(version))
  }
}
`
mkdirSync('.testtmp', { recursive: true })
writeFileSync('.testtmp/harness.ts', harness)

const testSrc = `
import { load, dump } from './harness'
import {
  queryTraining, scheduleTraining, approveScore, runAction, positionOptions,
} from '@/api/local-service'
import { listRows, resetRows } from '@/data/local-store'
import { __resetCacheForTest } from '@/data/local-store'
import { migrateV1 } from '@/data/migration'
import { TRAINING_GROUP } from '@/data/positions'

let passed = 0
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('PASS', name) }
  else { console.log('FAIL', name, detail); process.exitCode = 1 }
}

// 1) 存量迁移：旧占位记录回填
const legacy = {
  training: [
    { id: 1, status: '待培训', pending: true, abnormal: false,
      培训编号: 'TRAI-0001', 培训主题: '人员培训样例1', 受训岗位: '灌装线操作',
      培训方式: '现场带教', 考核成绩: '人员培训样例1', 培训日期: '2026-01-10', 有效期至: '人员培训样例1' },
    { id: 2, status: '已合格', pending: false, abnormal: false,
      培训编号: 'TRAI-0002', 培训主题: '配液岗位复训', 受训岗位: '配液岗',
      培训方式: '线下授课', 考核成绩: '乱码', 培训日期: '2026-02-10', 有效期至: '2026-03-01' },
    { id: 3, status: '待培训', pending: true, abnormal: false,
      培训编号: 'TRAI-0003', 培训主题: '无岗位线索的旧记录', 受训岗位: '不存在的岗位XYZ',
      培训方式: '线上学习', 考核成绩: '', 培训日期: '2026-03-10', 有效期至: '乱填值' },
  ],
  batchrecord: [
    { id: 9, status: '编制中', pending: true, abnormal: false,
      批号: '批生产记录样例9', 产品名称: '批生产记录样例9', 生产工序: '浓配工序',
      投料量: 'x', 操作人: 'x', 复核人: 'x', 起始时间: '2026-09-01', 批记录状态: 'x' },
  ],
}
const { data: migrated } = migrateV1(legacy)
const t1 = migrated.training[0]
check('迁移-占位成绩待培训回填为空', t1.考核成绩 === '', JSON.stringify(t1.考核成绩))
check('迁移-无有效期按培训日顺延一年', t1.有效期至 === '2027-01-10', t1.有效期至)
check('迁移-旧岗位线索归位到名册', t1.受训岗位 === '无菌灌装岗', t1.受训岗位)
check('迁移-已合格旧记录回填合格成绩', migrated.training[1].考核成绩 === '80', migrated.training[1].考核成绩)
check('迁移-越界岗位无线索时按序号落到名册', migrated.training[2].受训岗位 === positionOptions()[2], migrated.training[2].受训岗位)
check('迁移-无有效期顺延一年(第3条)', migrated.training[2].有效期至 === '2027-03-10', migrated.training[2].有效期至)
const b9 = migrated.batchrecord[0]
check('迁移-批记录按工序对应受训岗位', b9.受训岗位 === '配液岗', b9.受训岗位)
check('迁移-批记录核对栏按同岗位已合格回写', String(b9.岗位培训核对).includes('TRAI-0002'), b9.岗位培训核对)

// 载入旧版（无版本号）数据，local-store 首次读取应自动迁移
load(legacy)
__resetCacheForTest()
const rows = listRows('training')
check('存储-旧数据自动迁移到v2', rows[0].有效期至 === '2027-01-10', JSON.stringify(dump()['pharma-cleanroom:schema-version']))
check('存储-版本号写为2', dump()['pharma-cleanroom:schema-version'] === '2')

// 2) 条件定位（使用全新种子数据）
load()
__resetCacheForTest()
const all = queryTraining({})
check('查询-无条件返回全部种子', all.items.length >= 8, String(all.items.length))
check('查询-空库/全量时无空结果原因或提示无记录', all.emptyReasons.length === 0)

const byCode = queryTraining({ 培训编号: 'TRAI-0003' })
check('查询-编号检索', byCode.items.length === 1 && byCode.items[0].受训岗位 === '无菌灌装岗')

const byTheme = queryTraining({ 培训主题: '灯检' })
check('查询-主题检索', byTheme.items.length >= 1 && byTheme.items.every(r => String(r.培训主题).includes('灯检')))

const byPosition = queryTraining({ 受训岗位: '包装岗' })
check('查询-岗位检索', byPosition.items.length === 1)

const scoreRange = queryTraining({ 成绩下限: '80', 成绩上限: '100' })
check('查询-成绩区间取', scoreRange.items.length === 3, scoreRange.items.map(r => r.考核成绩).join(','))
const scores = scoreRange.items.map(r => Number(r.考核成绩))
check('查询-区间内无越界成绩', scores.every(s => s >= 80 && s <= 100))

const dateRange = queryTraining({ 有效期起: '2027-01-01', 有效期止: '2027-06-30' })
check('查询-有效期上下限卡', dateRange.items.length === 5, dateRange.items.map(r => r.有效期至).join(','))
check('查询-区间内日期均在上下限内', dateRange.items.every(r => {
  const d = String(r.有效期至); return d >= '2027-01-01' && d <= '2027-06-30'
}))

const asc = queryTraining({ 成绩排序: 'asc' })
const ascScores = asc.items.map(r => String(r.考核成绩 ?? '').trim() === '' ? NaN : Number(r.考核成绩)).filter(n => !Number.isNaN(n))
check('查询-成绩升序', ascScores.every((v, i) => i === 0 || ascScores[i-1] <= v), ascScores.join(','))
const desc = queryTraining({ 成绩排序: 'desc' })
const descScores = desc.items.map(r => String(r.考核成绩 ?? '').trim() === '' ? NaN : Number(r.考核成绩)).filter(n => !Number.isNaN(n))
check('查询-成绩降序', descScores[0] >= descScores[1])
check('查询-无成绩记录排序末尾', asc.items.slice(-2).every(r => String(r.考核成绩 ?? '').trim() === ''), asc.items.map(r => r.考核成绩).join(','))

// 空结果定位
const none1 = queryTraining({ 培训编号: 'NO-SUCH' })
check('查询-空结果讲清哪栏卡住(编号)', none1.emptyReasons.some(r => r.includes('培训编号')), JSON.stringify(none1.emptyReasons))
const none2 = queryTraining({ 受训岗位: '包装岗', 成绩下限: '95' })
check('查询-多栏收窄报告卡住的成绩栏', none2.emptyReasons.some(r => r.includes('考核成绩')), JSON.stringify(none2.emptyReasons))
check('查询-包装岗那条先通过岗位栏不报岗位原因', !none2.emptyReasons.some(r => r.includes('受训岗位')))
const reversedScore = queryTraining({ 成绩下限: '90', 成绩上限: '10' })
check('查询-成绩区间填反明确报错', reversedScore.emptyReasons.some(r => r.includes('下限不能大于上限')))
const reversedDate = queryTraining({ 有效期起: '2027-12-31', 有效期止: '2027-01-01' })
check('查询-有效期填反明确报错', reversedDate.emptyReasons.some(r => r.includes('下限日期不能晚于上限日期')))

// 3) 登记排期：岗位越界/超限挡回
const okCreate = scheduleTraining({ 培训编号: 'TRAI-0900', 培训主题: '新培训', 受训岗位: '配液岗', 培训方式: '线下授课', 培训日期: '2026-11-01', 有效期至: '2027-11-01' })
check('登记-正常排期', okCreate.ok, okCreate.message)
const dupCode = scheduleTraining({ 培训编号: 'TRAI-0900', 培训主题: '再排一次', 受训岗位: '配液岗', 培训方式: '线下授课', 培训日期: '2026-11-02', 有效期至: '2027-11-02' })
check('登记-同编号重复挡回', !dupCode.ok && dupCode.message.includes('重复'))
const badPosition = scheduleTraining({ 培训编号: 'TRAI-0901', 培训主题: '越界', 受训岗位: '宇航员岗', 培训方式: '线下授课', 培训日期: '2026-11-01', 有效期至: '2027-11-01' })
check('登记-岗位越界挡回', !badPosition.ok && badPosition.message.includes('越界'), badPosition.message)
const tooLong = scheduleTraining({ 培训编号: 'TRAI-0902', 培训主题: '超限', 受训岗位: '一二三四五六七八九十一二三四五', 培训方式: '线下授课', 培训日期: '2026-11-01', 有效期至: '2027-11-01' })
check('登记-岗位超长挡回', !tooLong.ok && tooLong.message.includes('超限'), tooLong.message)
const noValidUntil = scheduleTraining({ 培训编号: 'TRAI-0903', 培训主题: '不留有效期', 受训岗位: '配液岗', 培训方式: '线下授课', 培训日期: '2026-11-01', 有效期至: '' })
check('登记-有效期必填留档', !noValidUntil.ok && noValidUntil.message.includes('留档'))
const badOrderDate = scheduleTraining({ 培训编号: 'TRAI-0904', 培训主题: '日期倒挂', 受训岗位: '配液岗', 培训方式: '线下授课', 培训日期: '2026-11-01', 有效期至: '2026-10-31' })
check('登记-有效期早于培训日挡回', !badOrderDate.ok && badOrderDate.message.includes('晚于培训日期'))

// 4) 成绩核定权限
const inProgress = listRows('training').find(r => String(r.培训编号) === 'TRAI-0002')
const nonGroup = approveScore(Number(inProgress.id), { score: '90', verifier: '张三', role: '岗位操作人员' })
check('核定-非培训组拒收', !nonGroup.ok && nonGroup.message.includes('无权'))
const groupOk = approveScore(Number(inProgress.id), { score: '90', verifier: '张三', role: TRAINING_GROUP })
check('核定-培训组核定成功', groupOk.ok, groupOk.message)
const overScore = approveScore(Number(listRows('training').find(r => String(r.培训编号) === 'TRAI-0001').id), { score: '120', verifier: '张三', role: TRAINING_GROUP })
// TRAI-0001 是待培训，核定应因状态拒收
check('核定-待培训状态核定拒收', !overScore.ok && overScore.message.includes('培训中'), overScore.message)

// 5) 状态老次序流转，倒序/跳步拒收
const id3 = Number(listRows('training').find(r => String(r.培训编号) === 'TRAI-0003').id)
const back = runAction('training', id3, '提交培训', { role: TRAINING_GROUP })
check('流转-终态倒序提交拒收', !back.ok && back.message.includes('重复判定只算一次'), back.message)
const judgeAgain = runAction('training', id3, '判定合格', { role: TRAINING_GROUP, score: '95' })
check('流转-终态重复判定只算一次', !judgeAgain.ok && judgeAgain.message.includes('只算一次'))

// 待培训直接判定合格 = 跳步
const id1 = Number(listRows('training').find(r => String(r.培训编号) === 'TRAI-0001').id)
const skip = runAction('training', id1, '判定合格', { role: TRAINING_GROUP, score: '90' })
check('流转-跳步判定拒收', !skip.ok && skip.message.includes('次序'), skip.message)
// 非培训组判定拒收
const id2 = Number(inProgress.id)
const notGroupJudge = runAction('training', id2, '判定合格', { role: '岗位操作人员' })
check('流转-非培训组判定拒收', !notGroupJudge.ok && notGroupJudge.message.includes('无权'))
// 低分判合格拒收
const lowFail = runAction('training', id2, '判定合格', { role: TRAINING_GROUP, score: '55' })
check('流转-低分判合格拒收', !lowFail.ok && lowFail.ok !== undefined && lowFail.message.includes('合格线'), lowFail.message)
// 正确流转：判合格 -> 回写批记录
const pass = runAction('training', id2, '判定合格', { role: TRAINING_GROUP, score: '90', operator: '张三' })
check('流转-设备维护岗判合格成功', pass.ok && pass.message.includes('批生产记录清单'), pass.message)
const batchesAfter = listRows('batchrecord')
check('回写-成绩核定人留档', String(listRows('training').find(r => Number(r.id) === id2).成绩核定人).includes('培训组'))

// 灯检岗 TRAI-0004 未通过 -> 批记录 BAT-260910 应为未核对；设备维护岗无批记录不影响其他
const lampBatch = batchesAfter.find(b => b.批号 === 'BAT-260910')
check('回写-未通过岗位批记录为未核对', lampBatch.岗位培训核对 === '未核对', String(lampBatch.岗位培训核对))

// 无菌灌装岗 TRAI-0003 已合格，批记录核对栏带编号与有效期
const fillBatch = batchesAfter.find(b => b.批号 === 'BAT-260901')
check('回写-合格结论带编号与有效期', String(fillBatch.岗位培训核对).includes('TRAI-0003') && String(fillBatch.岗位培训核对).includes('2027-06-15'), String(fillBatch.岗位培训核对))

// 新判一条灯检岗合格，回写应即时更新
resetRows('training')
const newLamp = scheduleTraining({ 培训编号: 'TRAI-0990', 培训主题: '灯检复测', 受训岗位: '灯检岗', 培训方式: '线下授课', 培训日期: '2026-10-01', 有效期至: '2027-10-01' })
check('复测-排期成功', newLamp.ok)
const lampId = Number(listRows('training').find(r => String(r.培训编号) === 'TRAI-0990').id)
runAction('training', lampId, '提交培训', {})
approveScore(lampId, { score: '88', verifier: '李四', role: TRAINING_GROUP })
const r2 = runAction('training', lampId, '判定合格', { role: TRAINING_GROUP, score: '88' })
check('复测-判定合格并回写', r2.ok && r2.message.includes('回写'), r2.message)
const lampBatch2 = listRows('batchrecord').find(b => b.批号 === 'BAT-260910')
check('回写-灯检岗复测后批记录即时更新', String(lampBatch2.岗位培训核对).includes('TRAI-0990'), String(lampBatch2.岗位培训核对))

console.log('\\n共通过 ' + passed + ' 项检查')
`
writeFileSync('.testtmp/test.ts', testSrc)

await build({
  entryPoints: ['.testtmp/test.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: '.testtmp/test.mjs',
  alias: { '@': new URL('./src', import.meta.url).pathname },
  logLevel: 'warning',
})
await import(new URL('.testtmp/test.mjs', import.meta.url).pathname)
