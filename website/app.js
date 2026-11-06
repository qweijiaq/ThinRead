const GITHUB_REPO = 'qweijiaq/ThinRead'
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`
const LATEST_RELEASE_PAGE = `${GITHUB_URL}/releases/latest`
const LIKE_BASE = 'https://abacus.jasoncameron.dev'
const LIKE_KEY = 'thinread/website-likes'
const LIKED_STORAGE = 'thinread-website-liked'

const roadmap = [
  {
    title: '阅读计划',
    status: 'accepted',
    date: '2026.11.06',
    summary: '按每天阅读分钟数把章节排到各天，勾选已读，书架顶部显示今日计划。',
  },
  {
    title: '应用锁与本地隐私',
    status: 'accepted',
    date: '2026.11.06',
    summary: '本地密码锁，启动先锁定；数据仍保存在本机，数据库加密仍在评估。',
  },
  {
    title: '笔记审计与 Markdown 导出',
    status: 'accepted',
    date: '2026.11.05',
    summary: '引用核对、无引用、人工修改、章节覆盖度；可导出带 frontmatter 的 Markdown 文件夹。',
  },
  {
    title: '版本 diff 与按段重写',
    status: 'accepted',
    date: '2026.11.05',
    summary: '读薄稿、成稿、报告的历史版本可做行级 diff；选中一段只重写这一段。',
  },
  {
    title: '千问 TTS 与 MP3 导出',
    status: 'accepted',
    date: '2026.11.05',
    summary: 'A/B 音色、英文音色、睡眠定时、断点续听、整章 MP3 和段落间隔。',
  },
  {
    title: '分享卡 / 小红书重构',
    status: 'accepted',
    date: '2026.11.06',
    summary: '参考 daily-post 的编辑排版，深色网格纸、等宽标签、重点句高亮。',
  },
  {
    title: 'English Beta 完整化',
    status: 'fixing',
    date: '进行中',
    summary: '主要界面已支持英文，工作台、设置和导出文案仍在迁移，目标 v0.2.0。',
  },
  {
    title: '任务级取消',
    status: 'fixing',
    date: '进行中',
    summary: '当前工作台一次只允许一个 AI 任务，计划改成按任务取消和排队。',
  },
  {
    title: 'PDF 内搜索',
    status: 'fixing',
    date: '排期中',
    summary: 'PDF 阅读器目前按页渲染，需要补文本层搜索和命中定位。',
  },
  {
    title: '保存筛选',
    status: 'fixing',
    date: '排期中',
    summary: '笔记库和内容库的筛选条件还不能保存为预设，后续会和命令面板一起做。',
  },
  {
    title: '加密同步 / 跨设备',
    status: 'integrating',
    date: '方案评估',
    summary: 'WebDAV / iCloud 的同步协议、冲突合并和端到端密钥需要先定方案。',
  },
  {
    title: '数据库加密',
    status: 'integrating',
    date: '方案评估',
    summary: '应用锁只是界面隐私层；数据库本身仍是明文 SQLite，需要迁移和系统钥匙串绑定方案。',
  },
  {
    title: 'Windows / Linux',
    status: 'integrating',
    date: '评估中',
    summary: 'Electron 构建已配置，但 OCR 依赖 macOS Vision，跨平台需要新引擎和实机验证。',
  },
  {
    title: '播客片头与章节标记',
    status: 'integrating',
    date: '接入中',
    summary: '双人播客已有 A/B 脚本和 MP3 段落间隔，片头、章节标记还在音频管线里。',
  },
  {
    title: '间隔重复 / 记忆卡复习',
    status: 'rejected',
    date: '已拒绝',
    summary: '与产品定位不符。',
    reason: '页边是读书笔记和写作工具，不做复习系统、记忆卡或考试队列。',
  },
  {
    title: '云端账号 / 多人协作',
    status: 'rejected',
    date: '已拒绝',
    summary: '本地优先，不引入账号和云端正文。',
    reason: '当前架构是单机本地数据库；引入云端账号会改变隐私边界和迁移成本，暂不投入。',
  },
  {
    title: '内置书源 / 盗版下载',
    status: 'rejected',
    date: '已拒绝',
    summary: '版权与合规风险。',
    reason: '项目只处理用户自己导入的文件和合法笔记来源，不提供书籍下载或破解。',
  },
  {
    title: '全自动替用户读书',
    status: 'rejected',
    date: '已拒绝',
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

function renderRoadmap() {
  if (!roadmapGrid) return
  const items = activeStatus === 'all' ? roadmap : roadmap.filter((item) => item.status === activeStatus)
  roadmapGrid.innerHTML = items
    .map(
      (item) => `
      <article class="roadmap-card reveal">
        <div class="roadmap-card-top">
          <span class="status status-${item.status}">${STATUS_LABEL[item.status]}</span>
          <span class="roadmap-date">${item.date}</span>
        </div>
        <h3>${item.title}</h3>
        <p>${item.summary}</p>
        ${item.reason ? `<span class="reason">拒绝原因：${item.reason}</span>` : ''}
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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json()
}

function setDownloadLinks(url) {
  document.querySelectorAll('#headerDownload, #heroDownload, #finalDownload').forEach((link) => {
    if (link instanceof HTMLAnchorElement) link.href = url
  })
}

async function loadRelease() {
  try {
    const release = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
    const dmg = (release.assets || []).find((asset) => /mac-arm64\.dmg$/i.test(asset.name))
    const url = dmg?.browser_download_url || release.html_url || LATEST_RELEASE_PAGE
    setDownloadLinks(url)
    const label = document.querySelector('#releaseLabel')
    if (label) {
      const version = release.tag_name || 'latest'
      label.textContent = `${version} · macOS arm64`
    }
    const downloads = document.querySelector('#downloadCount')
    if (downloads && dmg) downloads.textContent = Number(dmg.download_count || 0).toLocaleString('zh-CN')
  } catch {
    setDownloadLinks(LATEST_RELEASE_PAGE)
  }
}

async function loadRepoStats() {
  try {
    const repo = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}`)
    const stars = document.querySelector('#starCount')
    if (stars) stars.textContent = Number(repo.stargazers_count || 0).toLocaleString('zh-CN')
  } catch {
    // GitHub API 限流时保留占位符。
  }
}

async function loadLikes() {
  const count = document.querySelector('#likeCount')
  try {
    const data = await fetchJson(`${LIKE_BASE}/get/${LIKE_KEY}`)
    if (count) count.textContent = Number(data.value || 0).toLocaleString('zh-CN')
  } catch {
    if (count) count.textContent = '—'
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
    } finally {
      button.disabled = false
    }
  })
}

function issueSnippet(body) {
  const text = String(body || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[#>*_`-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 120 ? `${text.slice(0, 120)}…` : text || '没有补充描述。'
}

async function loadIssues() {
  const list = document.querySelector('#issueList')
  if (!list) return
  try {
    const issues = await fetchJson(
      `https://api.github.com/repos/${GITHUB_REPO}/issues?state=open&per_page=6&sort=updated&direction=desc`,
    )
    const feedback = issues.filter((issue) => !issue.pull_request)
    if (feedback.length === 0) {
      list.innerHTML = `
        <div class="issue-empty">
          <span aria-hidden="true">+</span>
          <h3>还没有公开留言</h3>
          <p>左侧写一条建议或问题，发布后会出现在这里。也可以直接去 GitHub 参与讨论。</p>
          <a class="text-link" href="${GITHUB_URL}/issues" target="_blank" rel="noreferrer">打开 GitHub Issues ↗</a>
        </div>
      `
      return
    }
    list.innerHTML = feedback
      .map(
        (issue) => `
        <a class="issue-card" href="${issue.html_url}" target="_blank" rel="noreferrer">
          <div class="issue-card-top">
            <h3>${escapeHtml(issue.title)}</h3>
            <span class="issue-meta issue-reactions">♥ ${Number(issue.reactions?.total_count || 0)}</span>
          </div>
          <p>${escapeHtml(issueSnippet(issue.body))}</p>
          <div class="issue-meta">
            <span>#${issue.number}</span>
            <span>${new Date(issue.updated_at).toLocaleDateString('zh-CN')}</span>
            <span>${(issue.labels || []).slice(0, 2).map((label) => `#${typeof label === 'string' ? label : label.name}`).join(' ')}</span>
          </div>
        </a>
      `,
    )
      .join('')
  } catch {
    list.innerHTML = `<p class="loading">读取留言失败，可能触发了 GitHub API 限流。<a class="text-link" href="${GITHUB_URL}/issues" target="_blank" rel="noreferrer">直接去 GitHub 查看 ↗</a></p>`
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function setupFeedbackForm() {
  const form = document.querySelector('#feedbackForm')
  if (!(form instanceof HTMLFormElement)) return
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const title = document.querySelector('#feedbackTitle')
    const body = document.querySelector('#feedbackBody')
    const submit = form.querySelector('button[type="submit"]')
    if (!(title instanceof HTMLInputElement) || !(body instanceof HTMLTextAreaElement)) return
    const issueTitle = `[建议] ${title.value.trim()}`
    const issueBody = `${body.value.trim()}\n\n---\n来源：官网留言\n版本：${document.querySelector('#releaseLabel')?.textContent || ''}`
    const url = `${GITHUB_URL}/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(issueBody)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    if (submit instanceof HTMLButtonElement) {
      const original = submit.textContent
      submit.textContent = '已打开 GitHub ↗'
      window.setTimeout(() => {
        submit.textContent = original
      }, 2200)
    }
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

document.querySelectorAll('.section-head, .feature-card, .shot, .download-section, .timeline li').forEach((element) => {
  element.classList.add('reveal')
})

async function boot() {
  setupLike()
  setupFeedbackForm()
  revealVisible()
  await Promise.allSettled([loadRelease(), loadRepoStats(), loadLikes(), loadIssues()])
}

boot()
