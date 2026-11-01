(async () => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (check, message, timeout = 15000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const value = check()
      if (value) return value
      await delay(100)
    }
    throw new Error(`等待超时：${message}`)
  }
  await waitFor(() => document.querySelector('.book-card'), '书架书籍')
  await waitFor(() => document.querySelector('.book-card img'), 'PDF 封面')
  document.querySelector('.book-card').click()
  await waitFor(() => document.querySelector('.reader article'), '打开 PDF 阅读器')
  const pdfButton = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '原版 PDF')
  if (!pdfButton) throw new Error('找不到原版 PDF 按钮')
  pdfButton.click()
  const viewer = await waitFor(() => document.querySelector('.pdf-viewer'), '打开原版查看器')
  const canvas = viewer.querySelector('canvas')
  await waitFor(() => canvas && canvas.width > 100, 'PDF 画布渲染')
  const error = viewer.querySelector('.inline-error')
  if (error) throw new Error(error.textContent)
  const pageInput = viewer.querySelector('input[type="number"]')
  if (!pageInput || pageInput.value !== '1') throw new Error('PDF 页码没有从第一章开始')
  const beforeWidth = canvas.style.width
  const zoomIn = [...viewer.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '放大')
  if (!zoomIn) throw new Error('PDF 查看器没有放大按钮')
  zoomIn.click()
  await waitFor(() => canvas.style.width !== beforeWidth, 'PDF 缩放生效')
  return { cover: true, canvas: `${canvas.width}x${canvas.height}`, page: pageInput.value, zoom: true }
})()
