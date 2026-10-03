<template>
  <section class="page" data-module="training">
    <header class="page-head">
      <div>
        <h2>人员培训管理</h2>
        <p class="page-desc">
          培训按岗位排期，考核成绩由培训组核定，有效期至留档；状态按老次序流转（待培训 → 培训中 → 已合格/未通过）。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showRegister = !showRegister">
          {{ showRegister ? '收起登记' : '登记培训记录' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出人员培训清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="showRegister" class="panel" @submit.prevent="submitRegister">
      <p class="panel-title">登记培训记录（受训岗位从岗位目录取数，培训日期按岗位排期自动落定）</p>
      <div class="panel-row">
        <label class="filter-item">
          <span>培训主题</span>
          <input v-model="registerForm.培训主题" placeholder="如：无菌更衣操作规范" />
        </label>
        <label class="filter-item">
          <span>受训岗位</span>
          <select v-model="registerForm.受训岗位">
            <option disabled value="">请选择岗位</option>
            <option v-for="plan in positionPlans" :key="plan.岗位" :value="plan.岗位">
              {{ plan.岗位 }}（排期 {{ plan.排期日期 }}，余 {{ remainingQuota(plan) }} 人）
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>培训方式</span>
          <select v-model="registerForm.培训方式">
            <option>线下实操</option>
            <option>线上课程</option>
            <option>师带徒</option>
          </select>
        </label>
        <span class="panel-hint">培训日期：{{ registerPlanText }}</span>
        <button class="btn primary" type="submit">提交登记</button>
      </div>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>培训编号</span>
        <input v-model="query.培训编号" placeholder="按培训编号检索" />
      </label>
      <label class="filter-item">
        <span>培训主题</span>
        <input v-model="query.培训主题" placeholder="按培训主题检索" />
      </label>
      <label class="filter-item">
        <span>受训岗位</span>
        <select v-model="query.受训岗位">
          <option value="">全部岗位</option>
          <option v-for="name in positionNames" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>考核成绩区间</span>
        <span class="range-inputs">
          <input v-model="query.成绩下限" type="number" min="0" max="100" placeholder="下限" />
          <em>~</em>
          <input v-model="query.成绩上限" type="number" min="0" max="100" placeholder="上限" />
        </span>
      </label>
      <label class="filter-item">
        <span>有效期至上下限</span>
        <span class="range-inputs">
          <input v-model="query.有效期起" type="date" />
          <em>~</em>
          <input v-model="query.有效期止" type="date" />
        </span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="!rows.length && blockers.length" class="blocker-list">
      <strong>没有符合条件的培训记录，卡在哪一栏见下：</strong>
      <ul>
        <li v-for="(item, index) in blockers" :key="index">{{ item }}</li>
      </ul>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>培训编号</th>
          <th>培训主题</th>
          <th>受训岗位</th>
          <th>培训方式</th>
          <th class="sortable" @click="toggleSort">
            考核成绩 {{ sortMark }}
          </th>
          <th>培训日期</th>
          <th>有效期至</th>
          <th>核定人</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="String(row.id)">
          <tr>
            <td>{{ row['培训编号'] }}</td>
            <td>{{ row['培训主题'] }}</td>
            <td>{{ row['受训岗位'] }}</td>
            <td>{{ row['培训方式'] }}</td>
            <td>{{ row['考核成绩'] === '' ? '待核定' : row['考核成绩'] }}</td>
            <td>{{ row['培训日期'] }}</td>
            <td>{{ row['有效期至'] || '—' }}</td>
            <td>{{ row['核定人'] || '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="runAction('提交培训', row)">提交培训</button>
              <button class="link" type="button" @click="openVerify(row)">核定成绩</button>
              <button class="link" type="button" @click="runAction('判定合格', row)">判定合格</button>
              <button class="link" type="button" @click="runAction('判定未通过', row)">判定未通过</button>
            </td>
          </tr>
          <tr v-if="verifyFor === Number(row.id)" class="inline-verify">
            <td :colspan="10">
              <form class="panel-row" @submit.prevent="submitVerify(row)">
                <span>培训组核定「{{ row['培训编号'] }}」：</span>
                <label class="filter-item">
                  <span>考核成绩（0~100）</span>
                  <input v-model="verifyForm.score" type="number" min="0" max="100" placeholder="成绩" />
                </label>
                <label class="filter-item">
                  <span>确认受训岗位（与登记取同一份岗位目录）</span>
                  <select v-model="verifyForm.position">
                    <option disabled value="">请选择岗位</option>
                    <option v-for="name in positionNames" :key="name" :value="name">{{ name }}</option>
                  </select>
                </label>
                <button class="btn primary" type="submit">确认核定</button>
                <button class="btn ghost" type="button" @click="verifyFor = null">取消</button>
              </form>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="10" class="empty-state">没有符合条件的培训记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条人员培训记录</span>
      <span v-if="infoMessage" class="info-text">{{ infoMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  emptyQuery,
  queryTraining,
  registerTraining,
  transitionTraining,
  verifyScore,
  type ScoreSort,
} from '@/api/training-service'
import { POSITION_NAMES, POSITION_PLANS, type PositionPlan } from '@/data/training-domain'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const positionPlans = POSITION_PLANS
const positionNames = POSITION_NAMES
const statuses = ['待培训', '培训中', '已合格', '未通过']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const blockers = ref<string[]>([])
const errorMessage = ref('')
const infoMessage = ref('')
const query = ref(emptyQuery())
const scoreSort = ref<ScoreSort>('')

const showRegister = ref(false)
const registerForm = ref({ 培训主题: '', 受训岗位: '', 培训方式: '线下实操' })

const verifyFor = ref<number | null>(null)
const verifyForm = ref({ score: '', position: '' })

const stats = ref([
  { label: '待培训人员', value: 0 },
  { label: '培训中人员', value: 0 },
  { label: '未通过人员数', value: 0 },
])

function refreshStats() {
  const all = listRows('training')
  stats.value = [
    { label: '待培训人员', value: all.filter((row) => row.status === '待培训').length },
    { label: '培训中人员', value: all.filter((row) => row.status === '培训中').length },
    { label: '未通过人员数', value: all.filter((row) => row.status === '未通过').length },
  ]
}

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const sortMark = computed(() => (scoreSort.value === 'asc' ? '↑' : scoreSort.value === 'desc' ? '↓' : '↕'))

const registerPlanText = computed(() => {
  const plan = positionPlans.find((item) => item.岗位 === registerForm.value.受训岗位)
  return plan ? `${plan.排期日期}（按岗位排期）` : '选定岗位后按排期自动落定'
})

function remainingQuota(plan: PositionPlan): number {
  const used = listRows('training').filter((row) => String(row['受训岗位']) === plan.岗位).length
  return Math.max(plan.限额 - used, 0)
}

function toggleSort() {
  scoreSort.value = scoreSort.value === '' ? 'asc' : scoreSort.value === 'asc' ? 'desc' : 'asc'
  reload()
}

function resetFilters() {
  query.value = emptyQuery()
  scoreSort.value = ''
  reload()
}

function exportRows() {
  downloadEntries('training')
}

function showResult(result: { ok: boolean; message: string }) {
  if (result.ok) {
    infoMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

function submitRegister() {
  clearMessages()
  const result = registerTraining(registerForm.value)
  showResult(result)
  if (result.ok) {
    registerForm.value = { 培训主题: '', 受训岗位: '', 培训方式: '线下实操' }
    showRegister.value = false
  }
  reload()
}

function openVerify(row: EntryRow) {
  clearMessages()
  verifyFor.value = Number(row.id)
  verifyForm.value = { score: String(row['考核成绩'] ?? ''), position: '' }
}

function submitVerify(row: EntryRow) {
  clearMessages()
  const result = verifyScore(Number(row.id), verifyForm.value.score, verifyForm.value.position)
  showResult(result)
  if (result.ok) {
    verifyFor.value = null
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  clearMessages()
  const result = transitionTraining(Number(row.id), action)
  showResult(result)
  reload()
}

function clearMessages() {
  errorMessage.value = ''
  infoMessage.value = ''
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = queryTraining(query.value, scoreSort.value)
    rows.value = payload.items
    total.value = payload.total
    blockers.value = payload.blockers
    refreshStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '人员培训列表读取失败'
  }
}

onMounted(reload)
</script>
