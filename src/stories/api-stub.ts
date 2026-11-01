import type { ReadingApi } from '../../shared/types.js'

/**
 * Storybook 预览没有 Electron preload。用 Proxy 兜底所有 IPC 方法，避免只在交互时才调用
 * window.api 的组件（ShareDialog、Library 等）在挂载阶段报错。
 */
export function createApiStub(): ReadingApi {
  return new Proxy(
    {},
    {
      get: (target, property) => {
        if (property === 'then') return undefined
        if (property in target) return Reflect.get(target, property)
        return async () => undefined
      },
    },
  ) as ReadingApi
}
