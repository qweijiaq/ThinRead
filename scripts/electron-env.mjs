/**
 * Electron 在 ELECTRON_RUN_AS_NODE=1 时会以 Node 模式启动，主进程里的
 * `app`/`BrowserWindow` 都不存在。这个变量经常从外部 shell 或 IDE 泄漏进来，
 * 所以所有启动 Electron 的脚本都从这里取环境，显式清掉它。
 */
export function electronEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
