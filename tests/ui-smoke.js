(async () => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const waitFor = async (check, message, timeout = 6000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const value = check()
      if (value) return value
      await delay(80)
    }
    throw new Error(`等待超时：${message}`)
  }
  const setInput = (field, value) => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const shell = await waitFor(() => document.querySelector('.app'), '应用外壳')
  assert(Boolean(shell), '应用没有渲染')
  const bookCards = await waitFor(() => document.querySelectorAll('.book-card').length, '书架书籍')
  assert(bookCards >= 1, '示例书没有出现在书架')
  const actionButtons = [...document.querySelectorAll('.book-action-buttons button')]
  assert(actionButtons.length >= 3, '书架卡片动作按钮不完整')
  for (const button of actionButtons) {
    const range = document.createRange()
    range.selectNodeContents(button)
    assert(range.getClientRects().length <= 1, `书架按钮文字换行：${button.textContent.trim()}`)
  }

  const books = await window.api.listBooks()
  const book = books[0]
  assert(book, '示例书没有写入数据库')
  for (let index = 0; index < 35; index++) {
    await window.api.createNote({
      bookId: book.id,
      kind: 'thought',
      title: `专注训练 ${index + 1}`,
      content: `专注训练记录 ${index + 1}：把走神拉回来。`,
      tags: index % 3 === 0 ? ['专注'] : index % 3 === 1 ? ['环境'] : ['习惯'],
    })
    await window.api.saveLabArtifact({
      tool: 'book-club',
      scope: 'latest',
      title: `生成内容 ${index + 1}`,
      content: `第 ${index + 1} 条生成内容，讨论专注、环境和注意力。${index === 7 ? '独特词条' : ''}`,
      bookId: book.id,
    })
  }

  const searchButton = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '搜索')
  assert(searchButton, '找不到搜索按钮')
  searchButton.focus()
  searchButton.click()

  const modal = await waitFor(() => document.querySelector('.search-modal'), '搜索弹窗')
  assert(modal.getAttribute('role') === 'dialog' && modal.getAttribute('aria-modal') === 'true', '搜索弹窗缺少对话框语义')
  const input = modal.querySelector('input')
  assert(input, '搜索弹窗没有输入框')
  await waitFor(() => document.activeElement === input, '搜索输入框自动聚焦')

  setInput(input, '专注')
  await waitFor(() => document.querySelectorAll('.search-result').length > 0, '搜索「专注」的结果')
  const results = [...document.querySelectorAll('.search-result')]
  assert(
    results.some((result) => result.textContent.includes('专注')),
    '搜索结果没有命中示例书',
  )
  assert(modal.querySelector('.search-filter[aria-pressed="true"]'), '筛选按钮缺少选中状态')
  const pager = await waitFor(() => modal.querySelector('.search-pager'), '搜索结果分页')
  assert(pager.textContent.includes('/'), '分页器没有页码')

  const noteFilter = [...modal.querySelectorAll('.search-filter')].find((button) =>
    button.textContent.trim().startsWith('笔记'),
  )
  assert(noteFilter, '找不到笔记筛选')
  noteFilter.click()
  await waitFor(() => document.querySelectorAll('.search-result').length === 12, '笔记筛选第一页')
  const nextPage = [...modal.querySelectorAll('.search-pager button')].find(
    (button) => button.textContent.trim() === '下一页',
  )
  assert(nextPage && !nextPage.disabled, '分页器没有下一页')
  nextPage.click()
  await waitFor(
    () => document.querySelector('.search-pager')?.textContent.includes('2 /'),
    '翻到第二页',
  )

  const chapterFilter = [...modal.querySelectorAll('.search-filter')].find((button) =>
    button.textContent.trim().startsWith('章节'),
  )
  assert(chapterFilter, '找不到章节筛选')
  chapterFilter.click()
  await waitFor(() => {
    const kinds = [...document.querySelectorAll('.search-result-kind')]
    return kinds.length > 0 && kinds.every((kind) => kind.textContent.trim() === '章节')
  }, '章节筛选生效')
  assert(chapterFilter.getAttribute('aria-pressed') === 'true', '章节筛选没有按下状态')

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  const active = await waitFor(
    () => document.querySelector('.search-result[aria-current="true"]'),
    '键盘选中结果',
  )
  assert(Boolean(active), '方向键没有选中结果')

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await waitFor(() => !document.querySelector('.search-modal'), 'Esc 关闭搜索')
  await waitFor(() => document.activeElement === searchButton, '关闭后焦点回到搜索按钮')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }))
  const shortcutModal = await waitFor(() => document.querySelector('.search-modal'), '⌘K 打开搜索')
  const shortcutInput = shortcutModal.querySelector('input')
  setInput(shortcutInput, '绝不存在的词组xyz')
  await waitFor(
    () => document.querySelector('.search-empty')?.textContent.includes('没有找到'),
    '空搜索结果提示',
  )
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }))
  await waitFor(() => !document.querySelector('.search-modal'), '⌘K 关闭搜索')

  const settingsButton = document.querySelector('button[aria-label="设置"]')
  assert(settingsButton, '找不到设置按钮')
  settingsButton.focus()
  settingsButton.click()
  const settingsModal = await waitFor(
    () => document.querySelector('[role="dialog"][aria-label="设置"]'),
    '设置弹窗',
  )
  await waitFor(() => settingsModal.contains(document.activeElement), '设置弹窗获得焦点')
  assert(settingsModal.textContent.includes('Beatra AI 配音'), '设置里没有 Beatra 配音配置')
  const guideButton = [...settingsModal.querySelectorAll('button')].find((button) => button.textContent.trim() === '查看教程')
  assert(guideButton, '设置里没有 Beatra 教程入口')
  guideButton.click()
  const guide = await waitFor(() => document.querySelector('[role="dialog"][aria-label="Beatra 使用教程"]'), 'Beatra 教程弹窗')
  assert(guide.textContent.includes('Device Token') && guide.textContent.includes('Beatra is ready'), 'Beatra 教程内容不完整')
  const closeGuide = guide.querySelector('button[aria-label="关闭"]')
  assert(closeGuide, 'Beatra 教程没有关闭按钮')
  closeGuide.click()
  await waitFor(() => !document.querySelector('[role="dialog"][aria-label="Beatra 使用教程"]'), '关闭 Beatra 教程')
  assert(document.querySelector('[role="dialog"][aria-label="设置"]'), '关闭教程时误关了设置')
  const unnamedButtons = [...document.querySelectorAll('button')].filter(
    (button) => !button.textContent.trim() && !button.getAttribute('aria-label') && !button.getAttribute('title'),
  )
  assert(unnamedButtons.length === 0, `${unnamedButtons.length} 个按钮没有可访问名称`)
  const imagesWithoutAlt = [...document.images].filter((image) => !image.alt)
  assert(imagesWithoutAlt.length === 0, `${imagesWithoutAlt.length} 张图片缺少 alt`)
  const selectTrigger = settingsModal.querySelector('.ui-select-trigger')
  assert(selectTrigger, '设置里没有下拉选择器')
  selectTrigger.click()
  const popover = await waitFor(() => document.querySelector('.ui-select-popover'), '下拉弹层')
  const option = popover.querySelector('.ui-select-option')
  assert(option, '下拉弹层没有选项')
  option.focus()
  option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await waitFor(() => !document.querySelector('.ui-select-popover'), 'Esc 只关闭下拉弹层')
  assert(document.querySelector('[role="dialog"][aria-label="设置"]'), '按 Esc 误关了设置弹窗')
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await waitFor(() => !document.querySelector('[role="dialog"][aria-label="设置"]'), 'Esc 关闭设置')
  await waitFor(() => document.activeElement === settingsButton, '设置关闭后焦点归还')

  const libraryCard = document.querySelector('.book-card')
  assert(libraryCard, '书架缺少书籍卡片')
  libraryCard.click()
  await waitFor(() => document.querySelector('.reader article'), '打开阅读器')
  const chapterItems = [...document.querySelectorAll('.chapter-item')]
  if (chapterItems.length > 1) {
    chapterItems[1].click()
    await delay(350)
    await waitFor(() => document.querySelector('.reader article'), '切换章节')
  }
  const paragraph = document.querySelector('.chapter-html p, .chapter-plain p')
  assert(paragraph, '阅读器没有正文段落')
  const textNode = [...paragraph.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length >= 6)
  assert(textNode, '正文段落没有可选文字')
  const range = document.createRange()
  range.setStart(textNode, 0)
  range.setEnd(textNode, Math.min(24, textNode.textContent.length))
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  document.querySelector('.reader').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  const selectionToolbar = await waitFor(() => document.querySelector('.selection-toolbar'), '划词工具栏')
  assert(selectionToolbar.querySelectorAll('button').length >= 8, '划词工具栏缺少动作')
  const highlightButton = [...selectionToolbar.querySelectorAll('button')].find((button) => button.textContent.trim() === '高亮')
  assert(highlightButton, '划词工具栏没有高亮按钮')
  highlightButton.click()
  await waitFor(() => !document.querySelector('.selection-toolbar'), '划词操作完成')
  await delay(250)
  const opened = await window.api.openBook(book.id)
  const currentChapterId = opened.book.currentChapterId
  assert(currentChapterId, '阅读进度没有记录当前章')
  const readerMarks = await window.api.listChapterMarks(currentChapterId)
  assert(readerMarks.length > 0, '划词高亮没有写入数据库')
  const streamed = []
  const streamedAnswer = await window.api.askChapterStream(
    currentChapterId,
    '这一章主要讲了什么？',
    [],
    'answer',
    (text) => streamed.push(text),
  )
  assert(streamedAnswer.answer.length > 0, '流式问答没有返回答案')
  assert(streamed.length > 0 && streamed.at(-1) === streamedAnswer.answer, '流式问答没有推送增量')

  const firstChapter = document.querySelector('.chapter-item')
  if (firstChapter) {
    firstChapter.click()
    await delay(350)
  }
  const noteCard = await waitFor(() => document.querySelector('.note-card'), '章节笔记卡片')
  const editNoteButton = [...noteCard.querySelectorAll('button')].find((button) => button.textContent.trim() === '编辑')
  assert(editNoteButton, '笔记卡片没有编辑按钮')
  editNoteButton.click()
  const noteTextarea = await waitFor(() => document.querySelector('.note-textarea'), '笔记编辑框')
  setInput(noteTextarea, 'UI 自动化修改后的笔记内容。')
  await delay(80)
  const insertMermaid = [...document.querySelectorAll('.note-card button')].find(
    (button) => button.textContent.trim() === '插入 Mermaid',
  )
  assert(insertMermaid, '笔记编辑没有插入 Mermaid 入口')
  const previewNoteButton = [...document.querySelectorAll('.note-card button')].find(
    (button) => button.textContent.trim() === '预览 Markdown',
  )
  assert(previewNoteButton, '笔记编辑没有 Markdown 预览入口')
  insertMermaid.click()
  const notePreview = await waitFor(() => document.querySelector('.note-editor-preview'), '笔记 Markdown 预览')
  assert(notePreview.querySelector('.markdown'), '笔记预览没有渲染 Markdown')
  assert(
    notePreview.querySelector('.mermaid-diagram, code.language-mermaid'),
    '笔记预览没有识别 Mermaid 代码块',
  )
  const saveNoteButton = [...document.querySelectorAll('.note-card button')].find((button) => button.textContent.trim() === '保存')
  assert(saveNoteButton, '笔记编辑没有保存按钮')
  saveNoteButton.click()
  await waitFor(() => !document.querySelector('.note-textarea'), '笔记保存完成')
  const noteBook = await window.api.openBook(book.id)
  const noteChapterId = noteBook.book.currentChapterId
  const chapterNotes = noteChapterId ? await window.api.listNotes(book.id, noteChapterId) : []
  assert(chapterNotes.some((note) => note.content.includes('UI 自动化修改后的笔记内容')), '笔记编辑没有写入数据库')

  const bookmarkButton = [...document.querySelectorAll('.chapter-head-actions button')].find(
    (button) => button.textContent.trim() === '书签',
  )
  assert(bookmarkButton, '章节头部没有书签入口')
  bookmarkButton.click()
  const bookmarkRows = await waitFor(
    () => (document.querySelectorAll('.sidebar-bookmark').length ? document.querySelectorAll('.sidebar-bookmark') : null),
    '创建书签后的侧栏书签',
  )
  assert(bookmarkRows.length >= 1, '书签没有出现在侧栏')
  const bookmarkLabel = bookmarkRows[0].textContent.trim()
  assert(bookmarkLabel.length > 0, '书签没有标签')

  const xhsButton = [...document.querySelectorAll('.chapter-head-actions button')].find(
    (button) => button.textContent.trim() === '小红书',
  )
  assert(xhsButton, '章节头部没有小红书入口')
  xhsButton.click()
  const xhsModal = await waitFor(() => document.querySelector('.xhs-modal'), '打开小红书图文', 10000)
  const xhsPreview = await waitFor(
    () => xhsModal.querySelector('.xhs-preview-frame img'),
    '小红书图文预览',
    10000,
  )
  assert(xhsPreview, '小红书图文没有生成预览图')
  const xhsCoverage = await waitFor(() => xhsModal.querySelector('.xhs-coverage'), '小红书知识点覆盖报告')
  assert(xhsCoverage.textContent.includes('/'), '小红书覆盖报告没有知识点数量')
  const xhsThumbs = xhsModal.querySelectorAll('.xhs-thumb')
  assert(xhsThumbs.length >= 2, '小红书图文没有封面和内容页')
  const closeXhs = xhsModal.querySelector('button[aria-label="关闭"]')
  assert(closeXhs, '小红书图文没有关闭按钮')
  closeXhs.click()
  await waitFor(() => !document.querySelector('.xhs-modal'), '关闭小红书图文')

  const mapButton = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '地图')
  assert(mapButton, '找不到地图按钮')
  mapButton.click()
  await waitFor(() => document.querySelector('.map-view'), '打开知识地图')
  const mapNodes = await waitFor(() => document.querySelectorAll('.map-node').length, '知识地图节点', 10000)
  assert(mapNodes > 0, '带有标签的笔记没有生成地图节点')
  const mapSearch = document.querySelector('input.map-search')
  assert(mapSearch, '知识地图没有搜索框')
  setInput(mapSearch, '专注')
  await delay(60)
  mapSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  const mapDetail = await waitFor(() => document.querySelector('.map-detail'), '搜索定位地图节点')
  assert(mapDetail.textContent.includes('专注'), '搜索回车没有定位到匹配的书')
  const copyMermaid = document.querySelector('button[aria-label="复制 Mermaid 图"]')
  assert(copyMermaid, '知识地图没有复制 Mermaid 入口')
  copyMermaid.click()
  await waitFor(
    () => document.querySelector('.map-copy-notice')?.textContent.includes('Mermaid 已复制'),
    '复制知识地图 Mermaid',
  )
  assert(document.querySelector('button[aria-label="导出地图图片"]'), '知识地图没有导出图片入口')

  const backToLibrary = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '书架')
  assert(backToLibrary, '地图页找不到返回书架按钮')
  backToLibrary.click()
  await waitFor(() => document.querySelector('.book-card'), '返回书架')

  const composeButton = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '成书')
  assert(composeButton, '找不到成书按钮')
  composeButton.click()
  await waitFor(() => document.querySelector('.compose-view'), '打开成书页')
  const mergeButton = await waitFor(
    () => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '合并整本书' && !button.disabled),
    '成书页没有可用的合并按钮',
    10000,
  )
  mergeButton.click()
  const publishButton = await waitFor(
    () => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '发布包'),
    '生成发布包入口',
    15000,
  )
  assert(
    [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '导出排版 PDF'),
    '成书页没有导出 PDF 入口',
  )
  publishButton.click()
  const publishDialog = await waitFor(() => document.querySelector('.publish-dialog'), '发布包弹窗')
  assert(publishDialog.getAttribute('aria-modal') === 'true', '发布包弹窗缺少对话框语义')
  const closePublish = publishDialog.querySelector('button[aria-label="关闭"]')
  assert(closePublish, '发布包弹窗没有关闭按钮')
  closePublish.click()
  await waitFor(() => !document.querySelector('.publish-dialog'), '关闭发布包弹窗')
  const composeBack = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '书架')
  assert(composeBack, '成书页找不到返回书架按钮')
  composeBack.click()
  await waitFor(() => document.querySelector('.book-card'), '从成书页返回书架')

  const importButton = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '导入')
  assert(importButton, '找不到导入按钮')
  importButton.click()
  const importModal = await waitFor(() => document.querySelector('.import-modal'), '打开导入弹窗')
  const highlightTab = [...importModal.querySelectorAll('[role="tab"]')].find(
    (button) => button.textContent.trim() === '划线 / 标注',
  )
  assert(highlightTab, '导入弹窗没有划线入口')
  highlightTab.click()
  const wechatButton = await waitFor(
    () => [...importModal.querySelectorAll('button')].find((button) => button.textContent.trim() === '导入微信读书笔记'),
    '微信读书导入入口',
  )
  assert(wechatButton, '划线入口没有微信读书导入')
  const textTab = [...importModal.querySelectorAll('[role="tab"]')].find((button) => button.textContent.trim() === '粘贴文本')
  assert(textTab, '导入弹窗没有粘贴文本入口')
  textTab.click()
  const textField = await waitFor(() => importModal.querySelector('.import-pane textarea'), '粘贴文本输入框')
  const titleField = importModal.querySelectorAll('.import-pane input')[0]
  const authorField = importModal.querySelectorAll('.import-pane input')[1]
  assert(titleField && authorField && textField, '导入弹窗字段不完整')
  setInput(titleField, 'UI 导入测试')
  setInput(authorField, '测试作者')
  setInput(
    textField,
    '第一章\n\n这是通过界面导入的正文，用来验证粘贴文本、切章和打开阅读器的完整流程。\n\n第二章\n\n这是第二章的正文，长度足够被识别成一个独立章节。',
  )
  await delay(100)
  assert(titleField.value === 'UI 导入测试', `导入标题输入没有生效：${titleField.value}`)
  const importTextButton = [...importModal.querySelectorAll('button')].find((button) => button.textContent.trim() === '导入文本')
  assert(importTextButton, '找不到导入文本按钮')
  await waitFor(() => !importTextButton.disabled, '导入文本按钮可用')
  importTextButton.click()
  await waitFor(() => !document.querySelector('.import-modal'), '导入弹窗关闭', 10000)
  const afterImport = await window.api.listBooks()
  assert(afterImport.some((item) => item.title === 'UI 导入测试'), `UI 导入没有写入书籍：${afterImport.map((item) => item.title).join(' / ')}`)
  await waitFor(() => document.body.innerText.includes('UI 导入测试'), '导入后打开新书', 8000)

  const notesButton = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '笔记')
  assert(notesButton, '找不到笔记库按钮')
  notesButton.click()
  await waitFor(() => document.querySelector('.notes-library'), '打开笔记库')
  const notesPager = await waitFor(() => document.querySelector('.library-pager'), '笔记库分页')
  assert(notesPager.textContent.includes('/'), '笔记库分页缺少页码')
  const trashButton = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '回收站')
  assert(trashButton, '笔记库没有回收站入口')
  trashButton.click()
  const trashDialog = await waitFor(() => document.querySelector('.trash-modal'), '打开笔记回收站')
  assert(trashDialog.getAttribute('aria-modal') === 'true', '回收站缺少对话框语义')
  const closeTrash = trashDialog.querySelector('button[aria-label="关闭"]')
  assert(closeTrash, '回收站没有关闭按钮')
  closeTrash.click()
  await waitFor(() => !document.querySelector('.trash-modal'), '关闭笔记回收站')

  const contentButton = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '内容库')
  assert(contentButton, '找不到内容库按钮')
  contentButton.click()
  await waitFor(() => document.querySelector('.content-view'), '打开内容库')
  await waitFor(() => document.querySelectorAll('.content-row').length > 0, '内容库列表')
  const contentPager = await waitFor(() => document.querySelector('.content-pager'), '内容库分页')
  assert(contentPager.textContent.includes('/'), '内容库分页缺少页码')
  const contentSearch = document.querySelector('.content-toolbar input')
  assert(contentSearch, '内容库没有搜索框')
  setInput(contentSearch, '独特词条')
  await waitFor(
    () => document.querySelectorAll('.content-row').length === 1 && document.querySelector('.content-row')?.textContent.includes('生成内容 8'),
    '内容库索引搜索',
  )

  const labButton = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '工作台')
  assert(labButton, '找不到工作台按钮')
  labButton.click()
  await waitFor(() => document.querySelector('.lab-view'), '打开工作台')
  const podcastNav = [...document.querySelectorAll('.lab-rail button')].find((button) => button.textContent.trim() === '双人播客')
  assert(podcastNav, '工作台没有双人播客入口')
  podcastNav.click()
  await waitFor(() => document.querySelector('.lab-tool-head h2')?.textContent.trim() === '双人播客', '切换到双人播客')
  const podcastPane = await waitFor(() => document.querySelector('.lab-tool-pane.is-active'), '双人播客面板')
  const runPodcast = [...podcastPane.querySelectorAll('button')].find((button) => button.textContent.trim() === '运行')
  assert(runPodcast, '双人播客没有运行按钮')
  await waitFor(() => !runPodcast.disabled, '双人播客准备就绪')
  runPodcast.click()
  const listenPodcast = await waitFor(
    () => [...podcastPane.querySelectorAll('button')].find((button) => button.textContent.trim() === '听'),
    '生成播客脚本',
    10000,
  )
  listenPodcast.click()
  const listenPanel = await waitFor(() => document.querySelector('.listen-panel'), '打开双人播客')
  const speakerBadges = listenPanel.querySelectorAll('.listen-speaker').length
  assert(speakerBadges > 0, '双人播客没有区分说话人')
  assert(listenPanel.querySelector('.listen-foot')?.textContent.includes('中文普通话'), '双人播客没有标明语言')
  assert(
    [...listenPanel.querySelectorAll('.listen-sentence-text')].every(
      (item) => !/^[AB]\s*[：:]/.test(item.textContent.trim()),
    ),
    '说话人标签被带进了朗读文本',
  )
  const engineBar = listenPanel.querySelector('.listen-engine-bar')
  assert(engineBar && engineBar.textContent.includes('系统语音'), '听读面板没有音色引擎选择')
  assert(listenPanel.querySelector('.listen-full-audio'), '听读面板没有整章音频入口')
  const engineTrigger = engineBar.querySelector('.ui-select-trigger')
  assert(engineTrigger, '音色引擎没有下拉入口')
  engineTrigger.click()
  const enginePopover = await waitFor(() => document.querySelector('.ui-select-popover'), '音色引擎选项')
  assert(enginePopover.textContent.includes('Edge 在线') && enginePopover.textContent.includes('Kokoro 本地') && enginePopover.textContent.includes('Beatra 付费'), '音色引擎没有说明全部选项')
  const kokoroOption = [...enginePopover.querySelectorAll('.ui-select-option')].find((option) =>
    option.textContent.includes('Kokoro 本地'),
  )
  assert(kokoroOption, '找不到 Kokoro 选项')
  kokoroOption.click()
  await waitFor(
    () => listenPanel.querySelector('.listen-kokoro-setup') || listenPanel.querySelector('[aria-label="Kokoro A 音色"]'),
    'Kokoro 状态',
  )
  const kokoroSetup = Boolean(listenPanel.querySelector('.listen-kokoro-setup'))
  const kokoroReady = Boolean(listenPanel.querySelector('[aria-label="Kokoro A 音色"]'))
  assert(kokoroSetup || kokoroReady, 'Kokoro 既没有音色选择，也没有模型说明')
  if (kokoroSetup) {
    assert(
      listenPanel.querySelector('.listen-kokoro-setup')?.textContent.includes('未就绪'),
      'Kokoro 未就绪时没有提示',
    )
  }
  engineTrigger.click()
  const beatraPopover = await waitFor(() => document.querySelector('.ui-select-popover'), 'Beatra 选项')
  const beatraOption = [...beatraPopover.querySelectorAll('.ui-select-option')].find((option) =>
    option.textContent.includes('Beatra 付费'),
  )
  assert(beatraOption, '找不到 Beatra 选项')
  beatraOption.click()
  await waitFor(
    () => listenPanel.querySelector('.listen-kokoro-setup')?.textContent.includes('Beatra 还没有配置'),
    'Beatra 未配置提示',
  )
  const closeListen = listenPanel.querySelector('button[aria-label="关闭"]')
  assert(closeListen, '双人播客没有关闭按钮')
  closeListen.click()
  await waitFor(() => !document.querySelector('.listen-panel'), '关闭双人播客')

  assert(window.axe, 'axe-core 没有注入，无法执行无障碍检查')
  const a11y = await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
  })
  const seriousViolations = a11y.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  )
  assert(
    seriousViolations.length === 0,
    `无障碍问题：${seriousViolations
      .map((violation) => `${violation.id}(${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`)
      .join('、')}`,
  )

  const overflow = document.documentElement.scrollWidth - window.innerWidth
  assert(overflow <= 1, `页面出现横向滚动：${overflow}px`)

  return {
    books: bookCards,
    results: results.length,
    pager: true,
    filter: 'chapter',
    keyboardActive: true,
    focusRestored: true,
    shortcut: true,
    emptyState: true,
    settingsFocusTrap: true,
    selectEscape: true,
    readerMarks: readerMarks.length,
    streaming: true,
    noteEdited: true,
    mapNodes,
    publishDialog: true,
    importTitle: 'UI 导入测试',
    wechatImport: true,
    notesPager: true,
    contentPager: true,
    contentSearch: true,
    podcastSpeakers: speakerBadges,
    podcastLanguage: true,
    ttsEngines: true,
    fullAudio: true,
    xhsPages: xhsThumbs.length,
    xhsCoverage: true,
    bookmarks: bookmarkRows.length,
    kokoroSetup,
    kokoroReady,
    beatraSetup: true,
    beatraGuide: true,
    bookshelfButtons: actionButtons.length,
    horizontalOverflow: overflow,
    a11yViolations: a11y.violations.length,
  }
})()
