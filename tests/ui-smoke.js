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
  const setInput = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const shell = await waitFor(() => document.querySelector('.app'), '应用外壳')
  assert(Boolean(shell), '应用没有渲染')
  const bookCards = await waitFor(() => document.querySelectorAll('.book-card').length, '书架书籍')
  assert(bookCards >= 1, '示例书没有出现在书架')

  const books = await window.api.listBooks()
  const book = books[0]
  assert(book, '示例书没有写入数据库')
  for (let index = 0; index < 15; index++) {
    await window.api.createNote({
      bookId: book.id,
      kind: 'thought',
      title: `专注训练 ${index + 1}`,
      content: `专注训练记录 ${index + 1}：把走神拉回来。`,
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
    () => document.querySelector('.search-pager')?.textContent.includes('2 / 2'),
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
    horizontalOverflow: overflow,
  }
})()
