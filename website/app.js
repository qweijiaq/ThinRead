const DOWNLOAD_URL =
  'https://github.com/qweijiaq/ThinRead/releases/latest/download/ThinRead-0.1.4-mac-arm64.dmg'
const LIKE_BASE = 'https://abacus.jasoncameron.dev'
const LIKE_KEY = 'thinread/website-likes'
const LIKED_STORAGE = 'thinread-website-liked'
const FEEDBACK_STORAGE = 'thinread-website-feedback'
// 本机留言台。部署到公网时，把它改成留言台的公网地址。
const FEEDBACK_API = 'http://127.0.0.1:8787'
const FEEDBACK_PROJECT = 'thinread'
const MAX_NOTES = 30
const FEEDBACK_STATUS_LABEL = {
  new: '待处理',
  accepted: '已采纳',
  fixing: '修复中',
  integrating: '接入中',
  rejected: '已拒绝',
}

const roadmap = [
  {
    title: '阅读计划',
    status: 'accepted',
    date: '2026.11.06',
    summary: '按每天阅读分钟数把章节排到各天，勾选已读；书架顶部显示今日计划，可直接继续。',
  },
  {
    title: '应用锁',
    status: 'accepted',
    date: '2026.11.06',
    summary: '可选的本地密码锁，启动先锁定，验证通过才加载书、笔记和设置。它是界面隐私层，不是数据库加密。',
  },
  {
    title: '知识地图「未归类」',
    status: 'accepted',
    date: '2026.11.06',
    summary: '没有标签的笔记会汇总到「未归类」节点，按书连边，点击后还能看到具体笔记。',
  },
  {
    title: '笔记审计与 Markdown 导出',
    status: 'accepted',
    date: '2026.11.05',
    summary: '引用核对、无引用、人工修改和章节覆盖度；可按当前筛选导出带 YAML frontmatter 的 Markdown 文件夹。',
  },
  {
    title: '版本 diff 与按段重写',
    status: 'accepted',
    date: '2026.11.05',
    summary: '读薄稿、成稿和报告的历史版本可做行级 diff；选中一段只重写这一段，应用前先看差异。',
  },
  {
    title: '千问 TTS 2.0 与 MP3 导出',
    status: 'accepted',
    date: '2026.11.05',
    summary: 'A/B 音色、英文音色、睡眠定时、断点续听、迷你播放器、整章 MP3 和段落间隔。',
  },
  {
    title: '分享卡 / 小红书重构',
    status: 'accepted',
    date: '2026.11.06',
    summary: '深色编辑排版、纸/墨/苔绿三套主题、重点句高亮、可选署名，以及按章/按书切换。',
  },
  {
    title: '多模型对比',
    status: 'accepted',
    date: '2026.11.06',
    summary: '同一章用另一个模型重跑，保存为内容库快照并直接打开 diff，不覆盖当前笔记或成稿。',
  },
  {
    title: '完整英文界面',
    status: 'fixing',
    date: '进行中',
    summary: '主要界面已支持英文，但工作台、概念合并、出题等仍有硬编码中文；目标在 v0.2 继续迁移。',
  },
  {
    title: '任务级取消',
    status: 'fixing',
    date: '进行中',
    summary: '关系图和长报告目前只能全局取消；计划改成按任务取消，并支持排队。',
  },
  {
    title: 'PDF 内搜索',
    status: 'fixing',
    date: '未排期',
    summary: 'PDF 阅读器目前按页渲染，需要补文本层和命中定位；当前替代是章节搜索和全局搜索。',
  },
  {
    title: '保存筛选',
    status: 'fixing',
    date: '未排期',
    summary: '笔记库和内容库的筛选条件还不能保存为预设；命令面板已经支持快速操作。',
  },
  {
    title: '加密同步 / 跨设备',
    status: 'integrating',
    date: '方案评估',
    summary: '需要同步协议、冲突合并和端到端密钥，不能只加一个上传按钮；当前替代是整库导出/导入和手动备份。',
  },
  {
    title: '数据库加密',
    status: 'integrating',
    date: '方案评估',
    summary: '应用锁只是界面隐私层，SQLite 仍是明文；需要数据库迁移和系统钥匙串绑定方案。',
  },
  {
    title: 'Windows / Linux',
    status: 'integrating',
    date: '评估中',
    summary: 'Electron 构建已有，但扫描版 OCR 依赖 macOS Vision；跨平台需要新引擎和实机验证。',
  },
  {
    title: '播客片头与章节标记',
    status: 'integrating',
    date: '未排期',
    summary: '双人播客已有 A/B 脚本和 MP3 段落间隔；片头和章节标记还没进入音频管线。',
  },
  {
    title: '间隔重复 / 记忆卡复习',
    status: 'rejected',
    date: '长期不考虑',
    summary: '与产品定位不符。',
    reason: '页边是读书笔记和写作工具，不做复习系统、记忆卡或考试队列。后续优先围绕“笔记是否可信、是否覆盖全书、是否可复用”。',
  },
  {
    title: '云端账号 / 多人协作',
    status: 'rejected',
    date: '长期不考虑',
    summary: '本地优先，不引入账号和云端正文。',
    reason: '当前架构是单机本地数据库；引入云端账号会改变隐私边界和迁移成本，暂不投入。',
  },
  {
    title: '内置书源 / 盗版下载',
    status: 'rejected',
    date: '长期不考虑',
    summary: '版权与合规风险。',
    reason: '项目只处理用户自己导入的文件和合法笔记来源，不提供书籍下载或破解。',
  },
  {
    title: '全自动替用户读书',
    status: 'rejected',
    date: '长期不考虑',
    summary: '保留原文引用和人工判断。',
    reason: '页边不提供“跳过阅读”的自动摘要；AI 只做读薄草稿，引用仍要回到原文核对。',
  },
]

const STATUS_LABEL = {
  accepted: '已采纳',
  fixing: '修复中',
  integrating: '接入中',
  rejected: '已拒绝',
}

const roadmapGrid = document.querySelector('#roadmapGrid')
const roadmapTabs = [...document.querySelectorAll('.roadmap-tab')]
let activeStatus = 'all'
let observer = null
let remoteRoadmap = null
let remoteFeedback = null
let feedbackServiceOnline = false

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderRoadmap() {
  if (!roadmapGrid) return
  const source = feedbackServiceOnline && Array.isArray(remoteRoadmap) ? remoteRoadmap : roadmap
  const items = activeStatus === 'all' ? source : source.filter((item) => item.status === activeStatus)
  roadmapGrid.innerHTML = items
    .map(
      (item) => `
      <article class="roadmap-card reveal">
        <div class="roadmap-card-top">
          <span class="status status-${escapeHtml(item.status)}">${STATUS_LABEL[item.status] || escapeHtml(item.status)}</span>
          <span class="roadmap-card-meta">
            ${item.source === 'user' ? '<span class="roadmap-source">来自用户建议</span>' : ''}
            <span class="roadmap-date">${escapeHtml(item.date || '')}</span>
          </span>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.summary || '')}</p>
        ${item.reason ? `<span class="reason">拒绝原因：${escapeHtml(item.reason)}</span>` : ''}
      </article>
    `,
    )
    .join('')
  revealVisible()
}

roadmapTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    activeStatus = tab.dataset.status || 'all'
    roadmapTabs.forEach((button) => {
      button.classList.toggle('is-active', button === tab)
      button.setAttribute('aria-selected', button === tab ? 'true' : 'false')
    })
    renderRoadmap()
  })
})
renderRoadmap()

function setupDownload() {
  document.querySelectorAll('[data-download]').forEach((link) => {
    if (link instanceof HTMLAnchorElement && DOWNLOAD_URL) link.href = DOWNLOAD_URL
  })
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json()
}

async function loadLikes() {
  const count = document.querySelector('#likeCount')
  try {
    const data = await fetchJson(`${LIKE_BASE}/get/${LIKE_KEY}`, { cache: 'no-store' })
    if (count) count.textContent = Number(data.value || 0).toLocaleString('zh-CN')
  } catch {
    if (count) count.textContent = '—'
  }
}

function setFeedbackStatus(message) {
  const status = document.querySelector('#feedbackStatus')
  if (status) status.textContent = message
}

function setRoadmapNote(online) {
  const note = document.querySelector('#roadmapNote')
  if (!note) return
  note.textContent = online
    ? '路线图由内测留言台同步；用户建议被处理后会自动出现在这里。'
    : '路线图根据开发记录和已知限制整理；已完成项写落地时间，未完成项只标当前阶段，不写虚构排期，也不代表承诺交付。'
}

async function loadFeedbackService() {
  try {
    const data = await fetchJson(`${FEEDBACK_API}/api/public/projects/${FEEDBACK_PROJECT}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    feedbackServiceOnline = true
    remoteRoadmap = Array.isArray(data.roadmap) ? data.roadmap : null
    remoteFeedback = Array.isArray(data.feedback) ? data.feedback : []
    renderRoadmap()
    renderNotes()
    setRoadmapNote(true)
    setFeedbackStatus('留言会送到内测留言台；勾选「允许公开展示」后会出现在右侧。')
    return true
  } catch {
    feedbackServiceOnline = false
    remoteRoadmap = null
    remoteFeedback = null
    renderRoadmap()
    renderNotes()
    setRoadmapNote(false)
    setFeedbackStatus('留言台暂时未连接；留言会先保存在本机浏览器。')
    return false
  }
}

function setupLike() {
  const button = document.querySelector('#likeButton')
  const label = document.querySelector('#likeLabel')
  if (!(button instanceof HTMLButtonElement)) return
  let liked = false
  try {
    liked = localStorage.getItem(LIKED_STORAGE) === '1'
  } catch {
    // 本地存储不可用时每次都可以点。
  }
  if (liked) {
    button.setAttribute('aria-pressed', 'true')
    if (label) label.textContent = '已点赞'
  }
  button.addEventListener('click', async () => {
    if (button.getAttribute('aria-pressed') === 'true') return
    button.disabled = true
    if (label) label.textContent = '点赞中…'
    try {
      const data = await fetchJson(`${LIKE_BASE}/hit/${LIKE_KEY}`)
      const count = document.querySelector('#likeCount')
      if (count) count.textContent = Number(data.value || 0).toLocaleString('zh-CN')
      button.setAttribute('aria-pressed', 'true')
      if (label) label.textContent = '已点赞'
      try {
        localStorage.setItem(LIKED_STORAGE, '1')
      } catch {
        // 忽略。
      }
    } catch {
      if (label) label.textContent = '稍后再试'
      window.setTimeout(() => {
        if (label) label.textContent = '点赞'
      }, 1800)
    } finally {
      button.disabled = false
    }
  })
}

let memoryNotes = []

function readNotes() {
  try {
    const raw = localStorage.getItem(FEEDBACK_STORAGE)
    if (!raw) return memoryNotes
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return memoryNotes
    return parsed
      .filter((note) => note && typeof note.title === 'string' && typeof note.body === 'string')
      .slice(0, MAX_NOTES)
  } catch {
    return memoryNotes
  }
}

function saveNotes(notes) {
  const trimmed = notes.slice(0, MAX_NOTES)
  try {
    localStorage.setItem(FEEDBACK_STORAGE, JSON.stringify(trimmed))
    memoryNotes = trimmed
    return true
  } catch {
    // 本地存储不可用时，本次页面仍会显示留言。
    memoryNotes = trimmed
    return false
  }
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function renderNotes() {
  const list = document.querySelector('#feedbackList')
  if (!list) return
  const label = document.querySelector('#feedbackListLabel')
  const copyButton = document.querySelector('#copyFeedback')
  const online = feedbackServiceOnline && Array.isArray(remoteFeedback)
  const notes = online ? remoteFeedback : readNotes()
  if (label) label.textContent = online ? '最近公开留言' : '本机留言'
  if (copyButton) copyButton.hidden = online

  if (notes.length === 0) {
    list.innerHTML = online
      ? `
        <div class="note-empty">
          <span aria-hidden="true">+</span>
          <h3>还没有公开留言</h3>
          <p>写下建议时勾选「允许公开展示」，它会出现在这里。</p>
        </div>
      `
      : `
        <div class="note-empty">
          <span aria-hidden="true">+</span>
          <h3>留言台未连接</h3>
          <p>留言会先保存在这台设备上；服务恢复后可以再发送。</p>
          <button class="text-link" data-action="retry-feedback" type="button">重试连接</button>
        </div>
      `
    return
  }

  list.innerHTML = notes
    .map((note) => {
      const status =
        note.status && note.status !== 'new' && FEEDBACK_STATUS_LABEL[note.status]
          ? `<span class="note-status status-${escapeHtml(note.status)}">${FEEDBACK_STATUS_LABEL[note.status]}</span>`
          : ''
      return `
      <article class="note-card">
        <div class="note-card-top">
          <span class="note-card-badges">
            <span class="note-kind">${escapeHtml(note.kind || '建议')}</span>
            ${status}
          </span>
          <time class="note-date">${escapeHtml(formatDate(note.createdAt))}</time>
        </div>
        <h3>${escapeHtml(note.title)}</h3>
        <p>${escapeHtml(note.body)}</p>
        ${!online && note.remote ? '<span class="note-remote">已提交到在线留言板</span>' : ''}
      </article>
    `
    })
    .join('')
}

async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('copy failed')
}

function setupCopyFeedback() {
  const button = document.querySelector('#copyFeedback')
  if (!(button instanceof HTMLButtonElement)) return
  button.addEventListener('click', async () => {
    const notes = readNotes()
    const original = button.textContent
    if (notes.length === 0) {
      button.textContent = '暂无留言'
      window.setTimeout(() => {
        button.textContent = original
      }, 1600)
      return
    }
    const text = notes
      .map((note) => {
        const head = `${formatDate(note.createdAt)} · ${note.kind || '建议'} · ${note.title}`
        return `${head}\n${note.body}`
      })
      .join('\n\n')
    try {
      await copyText(`页边 ThinRead 内测留言\n\n${text}`)
      button.textContent = '已复制'
    } catch {
      button.textContent = '复制失败'
    }
    window.setTimeout(() => {
      button.textContent = original
    }, 1800)
  })
}

function setupFeedbackForm() {
  const form = document.querySelector('#feedbackForm')
  if (!(form instanceof HTMLFormElement)) return
  const submit = form.querySelector('button[type="submit"]')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const kind = document.querySelector('#feedbackKind')
    const title = document.querySelector('#feedbackTitle')
    const body = document.querySelector('#feedbackBody')
    const publicCheckbox = document.querySelector('#feedbackPublic')
    const website = document.querySelector('#feedbackWebsite')
    if (!(title instanceof HTMLInputElement) || !(body instanceof HTMLTextAreaElement)) return
    const note = {
      id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
      kind: kind instanceof HTMLSelectElement ? kind.value : '建议',
      title: title.value.trim(),
      body: body.value.trim(),
      public: publicCheckbox instanceof HTMLInputElement ? publicCheckbox.checked : true,
      createdAt: new Date().toISOString(),
      remote: false,
    }
    if (!note.title || !note.body) {
      setFeedbackStatus('标题和具体场景都要填。')
      return
    }

    if (submit instanceof HTMLButtonElement) {
      submit.disabled = true
      submit.textContent = '发送中…'
    }

    let delivered = false
    let remoteError = ''
    try {
      const response = await fetch(
        `${FEEDBACK_API}/api/public/projects/${FEEDBACK_PROJECT}/feedback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            kind: note.kind,
            title: note.title,
            body: note.body,
            public: note.public,
            website: website instanceof HTMLInputElement ? website.value : '',
          }),
        },
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        remoteError = data.error || `提交失败（${response.status}）`
      } else {
        delivered = true
      }
    } catch {
      // 服务没启动或网络不可达：回退到本机保存。
    }

    if (delivered) {
      form.reset()
      feedbackServiceOnline = true
      await loadFeedbackService()
      setFeedbackStatus('已送达内测留言台，谢谢。')
    } else if (remoteError) {
      setFeedbackStatus(remoteError)
    } else {
      const saved = saveNotes([note, ...readNotes()])
      feedbackServiceOnline = false
      remoteFeedback = null
      renderNotes()
      setFeedbackStatus(
        saved
          ? '留言台暂时未连接；这条留言已保存在本机浏览器。'
          : '浏览器禁止本地存储；这条留言只保留在本次页面里。',
      )
    }

    if (submit instanceof HTMLButtonElement) {
      submit.disabled = false
      submit.textContent = delivered ? '已送达' : '已记录'
      window.setTimeout(() => {
        submit.textContent = '发送留言'
      }, 2000)
    }
  })
}

function setupFeedbackListActions() {
  const list = document.querySelector('#feedbackList')
  if (!list) return
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="retry-feedback"]')
    if (!(button instanceof HTMLButtonElement)) return
    button.disabled = true
    button.textContent = '连接中…'
    void loadFeedbackService().then((online) => {
      if (!online) {
        button.disabled = false
        button.textContent = '重试连接'
      }
    })
  })
}

function revealVisible() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach((element) => element.classList.add('is-visible'))
    return
  }
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
  }
  document.querySelectorAll('.reveal:not(.is-visible)').forEach((element) => observer.observe(element))
}

document.querySelectorAll('.section-head, .feature-card, .shot, .shot-note, .download-section, .timeline li').forEach((element) => {
  element.classList.add('reveal')
})

window.addEventListener('storage', (event) => {
  if (event.key === FEEDBACK_STORAGE) renderNotes()
})

function boot() {
  setupDownload()
  setupLike()
  setupFeedbackForm()
  setupFeedbackListActions()
  setupCopyFeedback()
  renderNotes()
  revealVisible()
  loadLikes()
  void loadFeedbackService()
}

boot()
