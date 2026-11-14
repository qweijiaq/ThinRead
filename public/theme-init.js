try {
  var theme = localStorage.getItem('reading-notes-theme')
  if (theme && /^(folio|paper|plain|warm|night)$/.test(theme)) {
    document.documentElement.className = 'theme-' + theme
  }
} catch (error) {
  // localStorage 不可用时保留默认主题。
}
