import { getLocale, t } from './i18n.js'

interface FriendlyError {
  test: RegExp
  zh: string
  en: string
}

const FRIENDLY: FriendlyError[] = [
  {
    test: /invalid.*(api.?key|token)|unauthorized|401|authentication|鉴权|密钥/i,
    zh: 'API Key 无效或已过期。请打开设置 → 模型服务重新填写，并点「测试连接」。',
    en: 'The API key is invalid or expired. Open Settings → Model provider, enter it again, and test the connection.',
  },
  {
    test: /insufficient|quota|balance|402|余额不足|额度|欠费/i,
    zh: '模型账户余额或额度不足。请到服务商控制台充值/检查额度。',
    en: 'The model account has insufficient balance or quota. Check the provider console.',
  },
  {
    test: /model.*(not found|does not exist|unsupported)|404|unknown model|模型不存在/i,
    zh: '当前模型不可用。请在设置里刷新模型列表，或换一个模型。',
    en: 'The model is unavailable. Refresh the model list in Settings or choose another model.',
  },
  {
    test: /rate.?limit|too many requests|429|请求过于频繁/i,
    zh: '请求过于频繁，服务商限流了。稍等一会儿再试，或换一个模型。',
    en: 'The provider is rate limiting requests. Wait a moment and retry, or switch models.',
  },
  {
    test: /context.*(length|window)|maximum.*token|too many tokens|上下文.*(长度|超)/i,
    zh: '本章内容超过模型上下文。请改用「快速」档、缩短章节，或换上下文更大的模型。',
    en: 'This chapter exceeds the model context. Try Fast mode, shorten the chapter, or use a larger-context model.',
  },
  {
    test: /image|vision|multimodal|media.*type/i,
    zh: '当前模型不支持图片输入。请在设置 → 图片理解里关闭图片，或换一个视觉模型。',
    en: 'The model does not support image input. Turn off image understanding in Settings or use a vision model.',
  },
  {
    test: /timeout|timed?\s*out|超时/i,
    zh: '模型响应超时。请重试，或换一个更快的模型/更小的章节范围。',
    en: 'The model timed out. Retry, use a faster model, or work on a smaller chapter.',
  },
  {
    test: /fetch failed|network|ECONN|ENOTFOUND|socket|连接失败/i,
    zh: '网络连接失败。请检查 Base URL、代理和网络后重试。',
    en: 'Network request failed. Check the base URL, proxy, and connection, then retry.',
  },
]

/** 去掉 Electron IPC 包装前缀，把常见技术错误翻译成下一步能做什么。 */
export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  for (const rule of FRIENDLY) {
    if (rule.test.test(message)) return getLocale() === 'en' ? rule.en : rule.zh
  }
  return getLocale() === 'zh' ? message : t(message)
}
