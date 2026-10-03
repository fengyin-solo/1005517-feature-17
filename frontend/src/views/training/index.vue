<template>
  <section class="page" data-module="training">
    <header class="page-head">
      <div>
        <h2>人员培训管理</h2>
        <p class="page-desc">
          培训按岗位排期；培训编号、培训主题、受训岗位均可检索，考核成绩按区间取、有效期至按上下限卡，列表可按成绩排序；成绩由培训组核定，有效期至留档。
        </p>
      </div>
      <div class="page-actions">
        <label class="role-switch">
          当前身份
          <select :value="store.role" @change="onRoleChange">
            <option v-for="role in roleOptions" :key="role" :value="role">{{ role }}</option>
          </select>
        </label>
        <button class="btn primary" type="button" @click="openCreate">登记培训记录</button>
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
      <span class="legend-item legend-note">
        状态次序：待培训 → 培训中 → 已合格 / 未通过（倒序、跳步拒收，同一份培训重复判定只算一次）
      </span>
    </p>

    <form class="filter-bar filter-bar-training" @submit.prevent="reload">
      <label class="filter-item">
        <span>培训编号</span>
        <input v-model="query.培训编号" placeholder="如 TRAI-000" />
      </label>
      <label class="filter-item">
        <span>培训主题</span>
        <input v-model="query.培训主题" placeholder="按主题关键词检索" />
      </label>
      <label class="filter-item">
        <span>受训岗位</span>
        <input v-model="query.受训岗位" list="position-options" placeholder="按受训岗位检索" />
      </label>
      <datalist id="position-options">
        <option v-for="position in positionList" :key="position" :value="position" />
      </datalist>
      <label class="filter-item">
        <span>成绩下限</span>
        <input v-model="query.成绩下限" type="number" min="0" max="100" placeholder="0" />
      </label>
      <label class="filter-item">
        <span>成绩上限</span>
        <input v-model="query.成绩上限" type="number" min="0" max="100" placeholder="100" />
      </label>
      <label class="filter-item">
        <span>有效期自</span>
        <input v-model="query.有效期起" type="date" />
      </label>
      <label class="filter-item">
        <span>有效期至</span>
        <input v-model="query.有效期止" type="date" />
      </label>
      <button class="btn primary" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">
            <button
              v-if="column === '考核成绩'"
              class="th-sort"
              type="button"
              :title="scoreSortTitle"
              @click="toggleScoreSort"
            >
              考核成绩<span class="sort-mark">{{ sortMark }}</span>
            </button>
            <template v-else>{{ column }}</template>
          </th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '考核成绩'">
              <span v-if="row[column] !== ''">{{ row[column] }}</span>
              <span v-else class="muted-cell">待核定</span>
            </template>
            <template v-else-if="column === '有效期至'">
              <span :class="{ 'date-expired': isExpired(row) }">{{ row[column] ?? '—' }}</span>
            </template>
            <template v-else>{{ row[column] || '—' }}</template>
          </td>
          <td>
            <span class="status-tag" :data-status="row.status">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <template v-if="String(row.status) === '待培训'">
              <button class="link" type="button" @click="doAction('提交培训', row)">提交培训</button>
            </template>
            <template v-else-if="String(row.status) === '培训中'">
              <span class="action-group">
                <input
                  v-model="scoreDraft[Number(row.id)]"
                  class="score-input"
                  type="number"
                  min="0"
                  max="100"
                  :disabled="!store.isTrainingGroup"
                  :title="store.isTrainingGroup ? '成绩由培训组核定' : '仅培训组可核定成绩'"
                  placeholder="成绩"
                />
                <button
                  class="link"
                  type="button"
                  :disabled="!store.isTrainingGroup"
                  @click="verifyScore(row)"
                >
                  核定成绩
                </button>
                <button class="link" type="button" @click="doAction('判定合格', row)">判定合格</button>
                <button class="link danger" type="button" @click="doAction('判定未通过', row)">
                  判定未通过
                </button>
              </span>
            </template>
            <span v-else class="muted-cell">终态，不再判定</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            <div class="empty-title">没有符合条件的培训记录</div>
            <ul v-if="emptyReasons.length" class="empty-reasons">
              <li v-for="reason in emptyReasons" :key="reason">{{ reason }}</li>
            </ul>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条培训记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <form class="modal-panel" @submit.prevent="submitCreate">
        <h3 class="modal-title">登记培训记录（按岗位排期）</h3>
        <label class="modal-field">
          <span>培训编号 *</span>
          <input v-model="draft.培训编号" placeholder="如 TRAI-0009" />
        </label>
        <label class="modal-field">
          <span>培训主题 *</span>
          <input v-model="draft.培训主题" placeholder="本次培训的主题" />
        </label>
        <label class="modal-field">
          <span>受训岗位 *（限岗位名册，{{ positionMaxLength }} 字以内）</span>
          <select v-model="draft.受训岗位">
            <option value="" disabled>请选择受训岗位</option>
            <option v-for="position in positionList" :key="position" :value="position">
              {{ position }}
            </option>
          </select>
        </label>
        <label class="modal-field">
          <span>培训方式 *</span>
          <select v-model="draft.培训方式">
            <option value="" disabled>请选择培训方式</option>
            <option v-for="method in methodList" :key="method" :value="method">{{ method }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>培训日期 *</span>
          <input v-model="draft.培训日期" type="date" />
        </label>
        <label class="modal-field">
          <span>有效期至 *（必须留档，须晚于培训日期）</span>
          <input v-model="draft.有效期至" type="date" />
        </label>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="submit">确认排期</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  approveScore,
  downloadEntries,
  positionOptions,
  queryTraining,
  runAction as applyAction,
  scheduleTraining,
  trainingMethodOptions,
} from '@/api/local-service'
import { POSITION_MAX_LENGTH } from '@/data/positions'
import type { EntryRow } from '@/data/types'
import { ROLE_OPTIONS, useSessionStore } from '@/stores/session'

const store = useSessionStore()
const roleOptions = [...ROLE_OPTIONS]

const columns = [
  '培训编号',
  '培训主题',
  '受训岗位',
  '培训方式',
  '考核成绩',
  '培训日期',
  '有效期至',
  '成绩核定人',
]
const statuses = ['待培训', '培训中', '已合格', '未通过']
const positionList = positionOptions()
const methodList = trainingMethodOptions()
const positionMaxLength = POSITION_MAX_LENGTH

const rows = ref<EntryRow[]>([])
const allRowsForStats = ref<EntryRow[]>([])
const total = ref(0)
const emptyReasons = ref<string[]>([])
const errorMessage = ref('')
const noticeMessage = ref('')
const scoreDraft = reactive<Record<number, string>>({})

const query = reactive({
  培训编号: '',
  培训主题: '',
  受训岗位: '',
  成绩下限: '',
  成绩上限: '',
  有效期起: '',
  有效期止: '',
  成绩排序: '' as '' | 'asc' | 'desc',
})

const stats = computed(() => [
  {
    label: '待培训人员',
    value: allRowsForStats.value.filter((row) => String(row.status) === '待培训').length,
  },
  {
    label: '培训中人员',
    value: allRowsForStats.value.filter((row) => String(row.status) === '培训中').length,
  },
  {
    label: '已合格人员',
    value: allRowsForStats.value.filter((row) => String(row.status) === '已合格').length,
  },
  {
    label: '未通过人员数',
    value: allRowsForStats.value.filter((row) => String(row.status) === '未通过').length,
  },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const sortMark = computed(() =>
  query.成绩排序 === 'asc' ? ' ↑' : query.成绩排序 === 'desc' ? ' ↓' : '',
)
const scoreSortTitle = computed(() =>
  query.成绩排序 === 'asc'
    ? '当前成绩升序，点击切换降序'
    : query.成绩排序 === 'desc'
      ? '当前成绩降序，点击取消排序'
      : '点击按成绩升序',
)

function toggleScoreSort() {
  query.成绩排序 = query.成绩排序 === 'asc' ? 'desc' : query.成绩排序 === 'desc' ? '' : 'asc'
  reload()
}

function isExpired(row: EntryRow): boolean {
  const until = String(row.有效期至 ?? '')
  const today = new Date().toISOString().slice(0, 10)
  return Boolean(until) && until < today
}

function onRoleChange(event: Event) {
  store.setRole((event.target as HTMLSelectElement).value)
}

function resetFilters() {
  Object.assign(query, {
    培训编号: '',
    培训主题: '',
    受训岗位: '',
    成绩下限: '',
    成绩上限: '',
    有效期起: '',
    有效期止: '',
    成绩排序: '',
  })
  reload()
}

function exportRows() {
  downloadEntries('training')
}

// 登记排期弹窗
const creating = ref(false)
const createError = ref('')
const emptyDraft = () => ({
  培训编号: '',
  培训主题: '',
  受训岗位: '',
  培训方式: '',
  培训日期: '',
  有效期至: '',
})
const draft = reactive(emptyDraft())

function openCreate() {
  Object.assign(draft, emptyDraft())
  createError.value = ''
  creating.value = true
}

function submitCreate() {
  createError.value = ''
  const result = scheduleTraining({ ...draft })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  noticeMessage.value = result.message
  reload()
}

function verifyScore(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = approveScore(Number(row.id), {
    score: scoreDraft[Number(row.id)] ?? '',
    verifier: store.operator,
    role: store.role,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function doAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(
    'training',
    Number(row.id),
    action,
    { role: store.role, operator: store.operator, score: scoreDraft[Number(row.id)] ?? '' },
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = queryTraining({ ...query })
    rows.value = payload.items
    total.value = payload.total
    emptyReasons.value = payload.emptyReasons
    // 统计始终看全量，不被当前筛选条件影响。
    allRowsForStats.value = queryTraining({}).items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '人员培训列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.role-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.role-switch select {
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
}
.filter-bar-training .filter-item {
  min-width: 128px;
}
.filter-item input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.th-sort {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  font-weight: 600;
}
.sort-mark {
  color: var(--brand);
}
.muted-cell {
  color: var(--muted);
  font-size: 12px;
}
.date-expired {
  color: #b42318;
}
.status-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: #eef2f7;
}
.status-tag[data-status='已合格'] {
  background: #e7f6ec;
  color: #177245;
}
.status-tag[data-status='未通过'] {
  background: #fdecec;
  color: #b42318;
}
.status-tag[data-status='培训中'] {
  background: #e8f0fe;
  color: #1f6feb;
}
.action-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.score-input {
  width: 64px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.link.danger {
  color: #b42318;
}
.notice-text {
  color: #177245;
}
.legend-note {
  background: #fff7e6;
  color: #8a5a00;
}
.empty-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.empty-reasons {
  margin: 0;
  padding-left: 18px;
  text-align: left;
  display: inline-block;
}
.empty-reasons li {
  margin: 2px 0;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-panel {
  width: 460px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2);
}
.modal-title {
  margin: 0 0 12px;
  font-size: 16px;
}
.modal-field {
  display: block;
  margin-bottom: 10px;
}
.modal-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.modal-field input,
.modal-field select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
