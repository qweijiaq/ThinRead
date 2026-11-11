import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const files = ['README.md', 'src/assets/user-manual.md']
const errors = []

const forbidden = [
  ['1.98 行高', '默认行高已经改成 1.86'],
  ['并列项变列表', '读薄稿不再强制拆成列表'],
  ['并列项改成列表', '读薄稿不再强制拆成列表'],
  ['并列内容改成列表', '读薄稿不再强制拆成列表'],
  ['✦ 生成笔记', '按钮已经改名为「✦ 读薄并提炼」'],
]

for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  for (const [needle, reason] of forbidden) {
    if (text.includes(needle)) errors.push(`${file}: 仍包含「${needle}」；${reason}`)
  }
}

const notesPanel = fs.readFileSync(path.join(root, 'src/components/NotesPanel.tsx'), 'utf8')
if (notesPanel.includes('并列改列表')) errors.push('NotesPanel 仍提示「并列改列表」')

if (errors.length > 0) {
  console.error('[check:docs] 失败')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log('[check:docs] PASSED')
