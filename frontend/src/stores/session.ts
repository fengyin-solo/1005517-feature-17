import { defineStore } from 'pinia'

import { TRAINING_GROUP } from '@/data/positions'

export const ROLE_OPTIONS = [TRAINING_GROUP, '岗位操作人员'] as const

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    // 考核成绩由培训组核定：页面与服务层都按当前身份放行/拒收。
    role: TRAINING_GROUP as string,
    shiftLabel: '白班 08:00-20:00',
    scope: '制药企业洁净区与批生产记录管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isTrainingGroup: (state) => state.role === TRAINING_GROUP,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: string) {
      this.role = role
    },
  },
})
