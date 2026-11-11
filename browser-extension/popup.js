let tab = null
let selection = ''
let currentLink = ''

const titleEl = document.getElementById('page-title')
const urlEl = document.getElementById('page-url')
const statusEl = document.getElementById('status')
const pageButton = document.getElementById('capture-page')
const selectionButton = document.getElementById('capture-selection')
const copyButton = document.getElementById('copy-link')

function setStatus(text, error = false) {
  statusEl.textContent = text
  statusEl.classList.toggle('error', error)
}

function buildLink(includeSelection) {
  const params = new URLSearchParams({
    url: tab.url,
    title: tab.title || tab.url,
  })
  if (includeSelection && selection.trim()) params.set('selection', selection.trim().slice(0, 20000))
  return `thinread://capture?${params.toString()}`
}

async function openThinRead(link) {
  currentLink = link
  try {
    await chrome.tabs.create({ url: link })
    setStatus('已发送到 ThinRead；如果系统询问，请允许打开。')
    window.setTimeout(() => window.close(), 900)
  } catch {
    await navigator.clipboard.writeText(link)
    setStatus('无法直接打开 ThinRead，链接已复制，可粘贴到地址栏。', true)
  }
}

async function init() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!active || !/^https?:/i.test(active.url || '')) {
    setStatus('当前页面不是网页，无法收录。', true)
    return
  }
  tab = active
  titleEl.textContent = active.title || '(无标题)'
  urlEl.textContent = active.url
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: active.id },
      func: () => window.getSelection()?.toString() ?? '',
    })
    selection = result?.result ?? ''
    if (selection.trim()) selectionButton.disabled = false
  } catch {
    setStatus('无法读取当前选区，仍可收录整页。')
  }
}

pageButton.addEventListener('click', () => void openThinRead(buildLink(false)))
selectionButton.addEventListener('click', () => void openThinRead(buildLink(true)))
copyButton.addEventListener('click', async () => {
  const link = currentLink || buildLink(false)
  await navigator.clipboard.writeText(link)
  setStatus('收录链接已复制。')
})

void init()
