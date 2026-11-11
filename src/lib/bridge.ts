import type { ReadingApi } from '../../shared/types.js'

/**
 * 渲染层访问主进程的唯一入口。
 *
 * 组件不直接读 window.api：这一层是以后接 Web / 托管版时的替换点——
 * 只要提供一个实现了 ReadingApi 的对象，界面代码不用改。
 *
 * 用 Proxy 而不是直接保存 window.api，是为了让 Storybook / 测试可以在
 * 组件 import 之后再替换 window.api，桥仍然指向最新的实现。
 */
export const bridge: ReadingApi = new Proxy({} as ReadingApi, {
  get(_target, property) {
    const api = window.api as unknown as Record<string | symbol, unknown>
    const value = api[property]
    return typeof value === 'function' ? value.bind(window.api) : value
  },
  has(_target, property) {
    return property in (window.api as unknown as object)
  },
})
