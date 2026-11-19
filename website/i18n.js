/* ThinRead website — Chinese / English copy switch.
   Static text is translated in place; user feedback keeps its original language. */
(() => {
  const STORAGE_KEY = 'thinread-lang'
  const EN = {
    '页边 ThinRead · 把一本书读成能发出去的稿子': 'ThinRead · read a book down to a publishable draft',
    '跳到正文': 'Skip to content',
    '页边': 'ThinRead',
    '完整链路': 'How it works',
    '能力': 'Capabilities',
    '界面': 'Screens',
    '更新': 'Updates',
    '下载': 'Download',
    '下载 macOS': 'Download for macOS',
    'macOS · 本地优先 · MIT 开源': 'macOS · local-first · MIT',
    '把一本书，读成': 'Read a book into',
    '能发出去的稿子。': 'a draft you can publish.',
    '页边把每一章读薄成可编辑的底稿，从底稿提炼带原文依据的卡片，再把章节、卡片和跨书关联整理成文章、分享卡或播客。书和笔记留在本机。': 'ThinRead condenses each chapter into an editable draft, distills cards with traceable quotes, and turns chapters, cards, and cross-book links into articles, share cards, or podcasts. Books and notes stay on your machine.',
    '下载 macOS 版': 'Download for macOS',
    '看完整链路': 'See how it works',
    '无需账号': 'No account',
    '阅读器 · 本章笔记': 'Reader · chapter notes',
    '真实界面': 'Real app',
    '引用可以回到原文，卡片不会被模型改写冒充原句。': 'Every quote links back to the source; cards never pass model rewrites off as original text.',
    '本地优先': 'Local-first',
    '书、笔记、设置都在本机': 'Books, notes and settings stay on-device',
    '引用可核对': 'Quotes are verifiable',
    '逐字匹配原文，错标待核对': 'Matched against the source; mismatches are flagged',
    '一条完整产出链': 'One complete output chain',
    '读薄 → 卡片 → 成书': 'Condense → cards → compose',
    'MIT 开源': 'MIT licensed',
    '无账号，无遥测': 'No account, no telemetry',
    '读进来，写出去': 'Read in, write out',
    '每读完一章，页边都会留下点能继续用的东西：一篇底稿、几张卡片、一条跨书关联，或者一张能直接发的图。': 'Finish a chapter and you keep something usable: a draft, a few cards, a cross-book link, or an image ready to post.',
    '先把书和划线收进来': 'Bring in books and highlights',
    '文件、网页、Readwise、Kindle 和微信读书都能进。扫描版 PDF 在本机 OCR，目录、版权页和广告页会自动隐藏。': 'Import files, web pages, Readwise, Kindle and WeChat Reading. Scanned PDFs run OCR locally; TOCs, copyright pages and ads are hidden automatically.',
    '网页正文抓取与图片下载': 'Web article extraction with local images',
    'Readwise / Kindle / 微信读书划线': 'Readwise / Kindle / WeChat Reading highlights',
    'macOS 扫描版 OCR，单次最多 300 页': 'macOS scanned-PDF OCR, up to 300 pages per run',
    '导入': 'Import',
    '文件 / 网页 / 划线': 'Files / web / highlights',
    '把阅读器调成适合长文的样子': 'Tune the reader for long-form reading',
    '字体、字号、行距、段距、首行缩进和版心都能改。高亮、划线、书签、专注模式与阅读计划，让注意力留在正文。': 'Adjust typeface, size, leading, paragraph spacing, indentation and measure. Highlights, bookmarks, focus mode and reading plans keep attention on the page.',
    '字体、字号、行距、段距、版心': 'Typeface, size, leading, spacing, measure',
    '高亮、划线、删除线、书签、专注模式': 'Highlight, underline, strikethrough, bookmarks, focus',
    'PDF 原版查看、页码记忆、自动续读': 'Original PDF view, page memory, resume reading',
    '阅读计划、连续天数与月度 / 年度统计': 'Reading plans, streaks, monthly and annual stats',
    '阅读': 'Read',
    '排版 / 高亮 / 计划': 'Typography / marks / plans',
    '把一章读成能继续改的底稿': 'Turn a chapter into a draft you can keep editing',
    '按断言重写整章，保留观点与原文依据；再按篇幅提炼真正影响理解的卡片。依据逐字匹配，待核对和无依据可以直接筛出来。': 'Rewrite the chapter around its claims while keeping the evidence; distill only the cards that change understanding. Quotes are matched verbatim and unverified cards are filterable.',
    '按断言重写整章，保留原文引用': 'Rewrite around claims, keep source quotes',
    '核心卡片：作用、引用、有限延伸': 'Core cards: role, quote, limited extension',
    '依据逐字匹配、待核对 / 无依据筛选': 'Verbatim matching; filter unverified or unsupported',
    '版本 diff、按段重写、多模型对比': 'Version diff, section rewrite, model comparison',
    '读薄': 'Condense',
    '底稿 / 卡片 / 依据': 'Draft / cards / evidence',
    '让这本书和读过的书发生关系': 'Connect this book to the ones you have read',
    '页边回声把其他书里的相近笔记放到旁边；知识地图连接书、标签与概念；人物关系图留下小说和传记里的身份、阵营与事件。': 'Echoes put related notes from other books beside the page; the knowledge map links books, tags and concepts; the relationship graph keeps identities, factions and events for fiction and biography.',
    '页边回声：跨书语义相近的笔记对读': 'Echoes: read semantically related notes across books',
    '知识地图：书、标签、概念共现': 'Knowledge map: books, tags, concept co-occurrence',
    '人物关系图：身份、阵营、章节来源': 'Relationship graph: identity, faction, chapter source',
    '导出 Markdown / Mermaid / PNG': 'Export Markdown / Mermaid / PNG',
    '连接': 'Connect',
    '回声 / 地图 / 关系': 'Echoes / map / relations',
    '最后，把它变成能发出去的东西': 'Finally, turn it into something you can publish',
    '章节底稿可以合成整本书，也可以变成分享卡、小红书图文或双人播客。文字、图片和音频都从同一份笔记里长出来。': 'Compose chapter drafts into a book, or turn them into share cards, Xiaohongshu posts or a two-person podcast. Text, images and audio all grow from the same notes.',
    '整本成书：合并章节、补过渡、去 AI 味': 'Compose a book: merge chapters, add transitions, remove AI tone',
    'Markdown / HTML / 排版 PDF / 发布包': 'Markdown / HTML / print PDF / release bundle',
    '6 种分享卡、3 套主题、小红书 3:4 图文': '6 share cards, 3 themes, 3:4 Xiaohongshu posts',
    '千问 TTS 听读、A/B 双人播客、MP3 导出': 'Qwen TTS, A/B podcast, MP3 export',
    '发布': 'Publish',
    '成书 / 分享卡 / 播客': 'Book / share card / podcast',
    '每个阶段能做什么': 'What each stage can do',
    '按阶段列清楚。不必每天全用上，但每一步都走得通。': 'Laid out stage by stage. You do not have to use everything every day, but every step works.',
    '看界面截图': 'See the screens',
    '导入与阅读': 'Import and reading',
    '从文件、网页和划线记录进来，先把书读顺。': 'Start with files, web pages or highlights, and make the book comfortable to read.',
    '8 种文件格式；网页正文与图片下载': '8 file formats; web extraction with local images',
    'PDF 原版查看、页码记忆、缩放翻页': 'Original PDF view, page memory, zoom and paging',
    '高亮、书签、专注模式、自动续读': 'Highlights, bookmarks, focus mode, auto-resume',
    '读薄与卡片': 'Condense and cards',
    '把一章读成能继续改的稿子，再拆成少量真正有用的卡片。': 'Turn a chapter into a draft you can keep editing, then distill a small set of genuinely useful cards.',
    '按断言重写整章，保留观点和依据': 'Rewrite around claims, keep arguments and evidence',
    '卡片就地编辑、扩展、删除': 'Edit, extend or delete cards in place',
    '读薄报告：字数、档位、耗时、token': 'Condense report: length, mode, time, tokens',
    '多模型对比：重跑、快照并 diff': 'Model comparison: rerun, snapshot, diff',
    '笔记与审计': 'Notes and audit',
    '笔记不仅留在应用里，也要能核对、能带走。': 'Notes should be verifiable and portable, not trapped in the app.',
    '读薄稿、摘要、论点、知识点、想法、划线': 'Condensed draft, summary, claim, point, thought, highlight',
    '[[标题]]': '[[Title]]',
    '互链、反向链接、相关笔记': 'links, backlinks, related notes',
    '按书 / 类型 / 标签 / 关键词筛选': 'Filter by book / kind / tag / keyword',
    'AI / 人工、已核对 / 待核对 / 无引用': 'AI / human, verified / pending / no quote',
    '行级 diff：读薄稿 / 成稿 / 报告': 'Line diff: draft / composition / report',
    '导出 Markdown + frontmatter + index.md': 'Export Markdown + frontmatter + index.md',
    '知识连接': 'Knowledge connections',
    '书不是孤岛。概念、人物和跨书笔记都可以连起来。': 'A book is not an island. Concepts, people and cross-book notes can all connect.',
    '页边回声：本地语义模型找相近笔记': 'Echoes: local semantic model finds related notes',
    '未归类节点：没有标签的笔记不会消失': 'Unlabeled node: untagged notes do not disappear',
    '人物关系图：两阶段抽取人物与事件': 'Relationship graph: two-stage people and events extraction',
    '关系详情：身份、阵营、章节来源': 'Relationship detail: identity, faction, chapter source',
    '成书与发布': 'Compose and publish',
    '把章节底稿合成为一本可以读、可以发的书。': 'Turn chapter drafts into a book you can read and publish.',
    '合并章节、补过渡、去 AI 味': 'Merge chapters, add transitions, remove AI tone',
    '精炼 / 完整；三种叙述倾向': 'Concise / complete; three editorial stances',
    '一键补齐未完成章节、整本重新生成': 'Fill unfinished chapters or regenerate the book',
    '成稿历史最多 40 个版本，可恢复': 'Up to 40 composition versions, restorable',
    'BibTeX / RIS / APA 引用格式': 'BibTeX / RIS / APA citations',
    '分享与听读': 'Sharing and listening',
    '把一条笔记变成一张图，或把一章变成一段可以听的内容。': 'Turn a note into an image, or a chapter into something you can listen to.',
    '6 种分享卡、3 套主题、重点句高亮': '6 share cards, 3 themes, highlight key lines',
    '小红书按章 / 按书，3:4 多页图文': 'Xiaohongshu by chapter / book, 3:4 multi-page posts',
    '千问 TTS 逐句朗读，句子高亮': 'Qwen TTS sentence reading with highlighting',
    'A/B 双人对谈、英文音色、睡眠定时': 'A/B conversation, English voices, sleep timer',
    '断点续听、迷你播放器、整章 MP3': 'Resume listening, mini player, full-chapter MP3',
    '覆盖检查：正文 → 卡片漏点': 'Coverage check: source → missing card points',
    'AI 工作台': 'AI workbench',
    '19 个研究、深读、练习和整理工具，共用同一份书与笔记。': '19 research, deep-reading, practice and organizing tools share the same books and notes.',
    '全库研究、作者圆桌、魔鬼代言人': 'Library research, author roundtable, devil’s advocate',
    '多角色读书会、跨书综述、阅读路径': 'Multi-role book club, cross-book synthesis, reading path',
    '每周复盘、年度报告、论证地图': 'Weekly review, annual report, argument map',
    '全章批注、观点演变、知识缺口': 'Chapter annotations, idea evolution, knowledge gaps',
    '事实核查、扫描页 / 图表理解': 'Fact check, scanned page / chart understanding',
    '双人播客、自适应出题、合并与去重': 'Two-person podcast, adaptive quiz, merge and dedupe',
    '同步与备份': 'Sync and backup',
    '换一台电脑，书和笔记仍然跟着你。': 'Move to another Mac and your books and notes come with you.',
    '整库导出 / 导入 zip，换机可迁移': 'Export / import the whole library as zip',
    '每日自动备份，保留 8 份': 'Daily automatic backups, keep 8',
    'WebDAV 快照，可选加密与合并': 'WebDAV snapshots, optional encryption and merge',
    '文件夹同步：iCloud / Dropbox / NAS': 'Folder sync: iCloud / Dropbox / NAS',
    '恢复前自动安全备份': 'Safety backup before restore',
    '书文件按内容哈希去重': 'Book files deduplicated by content hash',
    '数据与边界': 'Data and boundaries',
    '书和笔记先属于你，再谈 AI 和分享。': 'Books and notes belong to you before AI or sharing enters the picture.',
    '书、笔记、生成内容在本机 SQLite + 文件': 'Books, notes and generated content in local SQLite + files',
    'API Key 使用系统钥匙串加密': 'API keys encrypted in the system keychain',
    '可选应用锁；数据库加密仍在评估': 'Optional app lock; database encryption under evaluation',
    '诊断包只含版本 / 系统 / 脱敏设置 / 日志': 'Diagnostics contain version / system / redacted settings / logs',
    '使用在线模型时只发送必要正文': 'Only necessary text is sent when using an online model',
    '语义向量在本机计算，笔记不出网': 'Embeddings run locally; notes never leave the device',
    '18 张界面': '18 screens',
    '从书架、阅读器到知识地图、听读、分享卡和设置。点开看大图。': 'From library and reader to knowledge map, listening, share cards and settings. Click to enlarge.',
    '全部': 'All',
    '创作': 'Make',
    '数据': 'Data',
    '书架': 'Library',
    '今日计划、进度与最近阅读': 'Today’s plan, progress and recent reads',
    '阅读器': 'Reader',
    '正文、本章笔记与读薄稿': 'Body, chapter notes and condensed draft',
    '排版': 'Typography',
    '字体、行距、段距与版心': 'Typeface, leading, spacing and measure',
    '文件、网页与划线记录': 'Files, web pages and highlights',
    '笔记库': 'Notes library',
    '审计、依据与章节覆盖': 'Audit, evidence and chapter coverage',
    '页边回声': 'Echoes',
    '跨书语义相近的笔记': 'Semantically related notes across books',
    '费曼自测': 'Feynman self-test',
    '用自己的话讲清一章': 'Explain a chapter in your own words',
    '全局搜索': 'Global search',
    '书、章节、笔记与生成内容': 'Books, chapters, notes and generated content',
    '知识地图': 'Knowledge map',
    '书、标签与跨书概念': 'Books, tags and cross-book concepts',
    '人物关系图': 'Relationship graph',
    '身份、阵营与事件关系': 'Identity, factions and events',
    '19 个研究、深读与整理工具': '19 research, deep-reading and organizing tools',
    '整本成书': 'Compose book',
    '合并章节、补过渡、导出': 'Merge chapters, add transitions, export',
    '听读': 'Listening',
    '逐句朗读、双人播客与定时': 'Sentence reading, A/B podcast and timer',
    '分享卡': 'Share card',
    '6 种版式、3 套主题': '6 layouts, 3 themes',
    '小红书': 'Xiaohongshu',
    '按章生成 3:4 多页图文': 'Generate 3:4 multi-page posts by chapter',
    '统计': 'Stats',
    '连续阅读、目标与 AI 用量': 'Streaks, goals and AI usage',
    '设置': 'Settings',
    '五套主题、模型服务与数据': 'Five themes, model providers and data',
    '夜间阅读': 'Night reading',
    '暖色夜间主题': 'Warm dark theme',
    '和常见工具的区别': 'What makes it different',
    'Readwise 帮你收集，Obsidian 帮你连接，NotebookLM 帮你理解资料集。页边只关心一件事：读完这一章之后，能留下什么可复用的东西。': 'Readwise helps you collect, Obsidian helps you connect, NotebookLM helps you understand a set. ThinRead cares about one thing: what reusable artifact is left after you finish a chapter.',
    '页边 ThinRead': 'ThinRead',
    '常见工具': 'Common tools',
    '一本书的产出': 'Output of one book',
    '读薄稿、卡片、成书、分享图': 'Condensed draft, cards, book, share image',
    '高亮、摘要或零散笔记': 'Highlights, summaries or scattered notes',
    '跨书能力': 'Cross-book ability',
    '语义回声 + 知识地图 + 人物关系图': 'Echoes + knowledge map + relationship graph',
    '标签、双链或当前资料集': 'Tags, backlinks or the current set',
    '导入与 OCR': 'Import and OCR',
    '8 种文件格式 + 网页 / Readwise / 微信读书 + macOS OCR': '8 file formats + web / Readwise / WeChat Reading + macOS OCR',
    '通常只支持 EPUB / PDF': 'Usually EPUB / PDF only',
    '笔记可信度': 'Trust in notes',
    '引用核对 + 审计 + 版本 diff': 'Quote verification + audit + version diff',
    '很少核对引用和覆盖度': 'Quotes and coverage rarely verified',
    '数据位置': 'Where data lives',
    '本机 SQLite + 文件': 'Local SQLite + files',
    '多数是云端服务': 'Mostly cloud services',
    '适合的读法': 'Best for',
    '深读非虚构，并继续写作': 'Deep reading of nonfiction, then writing',
    '收集、回顾或通用知识库': 'Collecting, review or a general knowledge base',
    '“不替你读书，只把读完之后的痕迹整理好。”': '“It does not read for you. It organizes what reading leaves behind.”',
    '页边 · 产品原则': 'ThinRead · product principle',
    '接下来做什么': 'What is next',
    '已采纳、修复中、接入中、已拒绝，都可以在这里看到。拒绝也会写原因。': 'Accepted, fixing, integrating or rejected — all visible here. Rejections include a reason.',
    '写下建议': 'Write a suggestion',
    '已采纳': 'Accepted',
    '修复中': 'Fixing',
    '接入中': 'Integrating',
    '已上线': 'Shipped',
    '已拒绝': 'Rejected',
    '路线图根据开发记录和已知限制整理；已完成项写落地时间，未完成项只标当前阶段，不写虚构排期，也不代表承诺交付。': 'The roadmap is based on development notes and known limits. Shipped items carry a date; unfinished items only show a stage. No invented schedules or delivery promises.',
    '版本记录': 'Release history',
    '每一次版本都围绕同一个方向：让读完之后的产出更可信、更可复用。': 'Every release points the same way: make what comes after reading more trustworthy and reusable.',
    '第一个 macOS 版本': 'First macOS build',
    '阅读器、章节回收站、笔记依据核查、搜索索引、BibTeX / RIS / APA 引用和未签名发布流程。': 'Reader, chapter trash, note evidence audit, search index, BibTeX / RIS / APA citations and the unsigned release flow.',
    '第一次引导与成本确认': 'First-run onboarding and cost confirmation',
    '首次引导、圆角图标、内嵌手册，以及模型调用前的费用与请求数确认。': 'Onboarding, rounded icon, embedded manual, and cost/request confirmation before model calls.',
    '文章复制全文': 'Copy full article',
    '章节、读薄稿、成书、报告和周复盘都可以一键复制全文。': 'Copy a chapter, condensed draft, composition, report or weekly review in one click.',
    '可信度与听读 2.0': 'Trust and listening 2.0',
    '统计持久化、笔记审计、版本 diff、Markdown 导出、阅读小结、千问 TTS、音色库、MP3 导出和段落间隔。': 'Persistent stats, note audit, version diff, Markdown export, reading summary, Qwen TTS, voice library, MP3 export and paragraph gaps.',
    '阅读计划与分享重构': 'Reading plans and sharing rebuild',
    '阅读计划、应用锁、内容回收站、分享卡 / 小红书重构、重点句高亮，以及知识地图里的「未归类」。': 'Reading plans, app lock, content trash, share card / Xiaohongshu rebuild, key-line highlights and the “Unlabeled” node in the knowledge map.',
    '官网上线': 'Website launch',
    '项目介绍、下载、公开路线图、迭代时间线、点赞和本机留言。': 'Project introduction, downloads, public roadmap, timeline, likes and local feedback.',
    '版本刷新': 'Version refresh',
    '重新打包 macOS DMG；应用功能与 v0.1.4 一致，官网同步浅色 / 深色模式和留言服务。': 'Repackaged the macOS DMG; app features match v0.1.4, with light/dark mode and feedback on the site.',
    'PDF 深度解析与正文编辑': 'Deep PDF parsing and body editing',
    '接入 Docling 深度解析，恢复代码换行与缩进；支持手动编辑正文、图片理解、代码检查 / 修复 / 理解，并自动选择可用的视觉模型。': 'Docling deep parsing with code line breaks and indentation restored; manual body editing, image understanding, code review/fix/explain and automatic vision model selection.',
    '同步、批注与英文 Beta': 'Sync, annotations and English beta',
    '加入加密同步快照、PDF 原页批注、书架状态、AI 预算守卫、系统 TTS 和英文 Beta，接入 OpenDesign Cloud，并重做分享卡；仓库以 MIT 协议公开，官网与手册同步翻新。': 'Encrypted sync snapshots, PDF page annotations, shelf status, AI budget guard, system TTS and English beta; OpenDesign Cloud; rebuilt share cards; MIT source release with a refreshed site and manual.',
    '可靠性与速度': 'Reliability and speed',
    '设置文件原子写入与损坏备份、WebDAV 配置持久化修复；视觉 PDF 超过 120 页自动分批；启动维护移出首屏、读薄并发提升、阅读进度不再触发整章重渲染；数据库拆分为领域模块。': 'Atomic settings writes and corrupt-file backups; WebDAV config persistence fix; vision PDF batches beyond 120 pages; startup maintenance off the first paint; higher condense concurrency; reader progress no longer rerenders the chapter; database split into domain modules.',
    '同步、Windows 与更完整的英文': 'Sync, Windows and fuller English',
    '加密同步、数据库加密、跨平台 OCR、少量主进程错误与导出模板的英文覆盖，以及任务级取消；这些是方向，不是承诺日期。': 'Encrypted sync, database encryption, cross-platform OCR, English for remaining main-process errors and export templates, and per-task cancellation. Directions, not promised dates.',
    '喜欢或不喜欢，都可以说': 'Tell us what works — or what does not',
    '点赞是轻量的鼓励；建议和问题会送到留言台，采纳后进入公开路线图。勾选「允许公开展示」后，你的留言也会出现在这里。': 'A like is light encouragement; suggestions and issues go to the feedback desk and accepted ones enter the public roadmap. If you allow public display, your message appears here too.',
    '点赞': 'Like',
    '一个浏览器只记一次；计数由 Abacus 提供，不收集个人信息。': 'One like per browser; counting by Abacus, no personal data collected.',
    '当前版本': 'Current version',
    '最新发布': 'Latest release',
    '开源协议': 'License',
    '未签名构建；书、笔记和设置都保存在本机。': 'Unsigned build; books, notes and settings stay on-device.',
    '留言': 'Feedback',
    '类型': 'Type',
    '建议': 'Suggestion',
    '问题': 'Issue',
    '其他': 'Other',
    '一句话标题': 'One-line title',
    '具体场景 / 问题': 'Context / problem',
    '联系方式（可选）': 'Contact (optional)',
    '截图（可选，最大 2MB）': 'Screenshot (optional, max 2MB)',
    '选择图片': 'Choose image',
    '未选择文件': 'No file selected',
    '允许公开展示（不显示联系方式）': 'Allow public display (contact hidden)',
    '发送留言': 'Send feedback',
    '正在连接留言台…': 'Connecting to the feedback desk…',
    '最近公开': 'Recently public',
    '我的留言': 'My feedback',
    '刷新': 'Refresh',
    '复制全部': 'Copy all',
    '把下一本书': 'Read your next book',
    '读成自己的。': 'into something of your own.',
    'macOS arm64 · MIT 开源 · 未签名构建。书和笔记保存在本机；Windows 在评估中。': 'macOS arm64 · MIT · unsigned build. Books and notes stay on-device; Windows is under evaluation.',
    '首次打开若提示「无法验证开发者」，在 Finder 里右键应用 → 打开，或到「系统设置 → 隐私与安全性」允许本次打开。': 'If macOS says the developer cannot be verified on first launch, right-click the app in Finder → Open, or allow it in System Settings → Privacy & Security.',
    '先读用户手册': 'Read the manual',
    '查看源码': 'View source',
    '把一本书读成自己的。': 'Read a book into something of your own.',
    '本地优先的 AI 阅读工作台 · MIT': 'Local-first AI reading workbench · MIT',
    '产品': 'Product',
    '资源': 'Resources',
    '用户手册': 'Manual',
    '路线图': 'Roadmap',
    '参与': 'Participate',
    '留言 / 点赞': 'Feedback / like',
    '报告问题': 'Report an issue',
    '参与贡献': 'Contribute',
    '© 2026 页边 ThinRead': '© 2026 ThinRead',
    '书和笔记留在本机 · 引用回到原文': 'Books and notes stay local · quotes return to the source',
    '界面截图': 'Screenshot',
    '关闭': 'Close',
    '阅读计划': 'Reading plans',
    '按每天阅读分钟数把章节排到各天，勾选已读；书架顶部显示今日计划，可直接继续。': 'Place chapters on a daily minute budget and tick them off; today’s plan appears at the top of the library.',
    '应用锁': 'App lock',
    '可选的本地密码锁，启动先锁定，验证通过才加载书、笔记和设置。它是界面隐私层，不是数据库加密。': 'Optional local passcode lock. The app locks on launch and loads books, notes and settings only after verification. It is a UI privacy layer, not database encryption.',
    '知识地图「未归类」': 'Knowledge map — “Unlabeled”',
    '没有标签的笔记会汇总到「未归类」节点，按书连边，点击后还能看到具体笔记。': 'Notes without tags collect under the “Unlabeled” node, linked by book, and the notes remain visible on click.',
    '笔记审计与 Markdown 导出': 'Note audit and Markdown export',
    '引用核对、无引用、人工修改和章节覆盖度；可按当前筛选导出带 YAML frontmatter 的 Markdown 文件夹。': 'Quote verification, missing quotes, manual edits and chapter coverage; export the current filter as a Markdown folder with YAML frontmatter.',
    '版本 diff 与按段重写': 'Version diff and section rewrite',
    '读薄稿、成稿和报告的历史版本可做行级 diff；选中一段只重写这一段，应用前先看差异。': 'Line-level diffs across draft, composition and report versions; rewrite only the selected section after reviewing the diff.',
    '千问 TTS 2.0 与 MP3 导出': 'Qwen TTS 2.0 and MP3 export',
    'A/B 音色、英文音色、睡眠定时、断点续听、迷你播放器、整章 MP3 和段落间隔。': 'A/B voices, English voices, sleep timer, resume listening, mini player, full-chapter MP3 and paragraph gaps.',
    '分享卡 / 小红书重构': 'Share cards / Xiaohongshu rebuild',
    '深色编辑排版、纸/墨/苔绿三套主题、重点句高亮、可选署名，以及按章/按书切换。': 'Dark editorial layout, paper/ink/moss themes, key-line highlights, optional signature and chapter/book switching.',
    '多模型对比': 'Model comparison',
    '同一章用另一个模型重跑，保存为内容库快照并直接打开 diff，不覆盖当前笔记或成稿。': 'Rerun a chapter with another model, save it as a content-library snapshot and open a diff without overwriting current notes or composition.',
    '完整英文界面': 'Full English UI',
    '主要界面、工作台、概念合并和出题文案已接入英文；少量主进程错误与导出模板仍在补齐。': 'Main UI, workbench, concept merge and quiz copy are in English; a small set of main-process errors and export templates remain.',
    '任务级取消': 'Per-task cancellation',
    '关系图和长报告目前只能全局取消；计划改成按任务取消，并支持排队。': 'Relationship graphs and long reports can only be cancelled globally for now; per-task cancellation and queueing are planned.',
    'PDF 内搜索': 'Search inside PDFs',
    'PDF 阅读器目前按页渲染，需要补文本层和命中定位；当前替代是章节搜索和全局搜索。': 'The PDF viewer renders pages; text-layer search and hit positioning are still needed. Chapter and global search are the current workaround.',
    '保存筛选': 'Save filters',
    '笔记库和内容库的筛选条件还不能保存为预设；命令面板已经支持快速操作。': 'Notes and content filters cannot be saved as presets yet; the command palette already covers quick actions.',
    '加密同步 / 跨设备': 'Encrypted sync / cross-device',
    '需要同步协议、冲突合并和端到端密钥，不能只加一个上传按钮；当前替代是整库导出/导入和手动备份。': 'Requires a sync protocol, conflict merging and end-to-end keys; an upload button is not enough. Whole-library export/import and manual backups are the current alternative.',
    '数据库加密': 'Database encryption',
    '应用锁只是界面隐私层，SQLite 仍是明文；需要数据库迁移和系统钥匙串绑定方案。': 'App lock is a UI privacy layer; SQLite is still plaintext. Database migration and keychain binding are required.',
    'Windows / Linux': 'Windows / Linux',
    'Electron 构建已有，但扫描版 OCR 依赖 macOS Vision；跨平台需要新引擎和实机验证。': 'Electron builds exist, but scanned OCR relies on macOS Vision; cross-platform support needs a new engine and device testing.',
    '播客片头与章节标记': 'Podcast intro and chapter markers',
    '双人播客已有 A/B 脚本和 MP3 段落间隔；片头和章节标记还没进入音频管线。': 'A/B scripts and MP3 gaps are ready; intro and chapter markers are not in the audio pipeline yet.',
    '间隔重复 / 记忆卡复习': 'Spaced repetition / flashcards',
    '与产品定位不符。': 'Does not fit the product.',
    '页边是读书笔记和写作工具，不做复习系统、记忆卡或考试队列。后续优先围绕“笔记是否可信、是否覆盖全书、是否可复用”。': 'ThinRead is a reading-notes and writing tool, not a review system, flashcard deck or exam queue. Priorities stay on trustworthy notes, whole-book coverage and reuse.',
    '云端账号 / 多人协作': 'Cloud accounts / collaboration',
    '本地优先，不引入账号和云端正文。': 'Local-first; no accounts or cloud bodies.',
    '当前架构是单机本地数据库；引入云端账号会改变隐私边界和迁移成本，暂不投入。': 'The current architecture is a single-device local database; cloud accounts would change the privacy boundary and migration cost, so they are not being pursued now.',
    '内置书源 / 盗版下载': 'Built-in book sources / piracy',
    '版权与合规风险。': 'Copyright and compliance risk.',
    '项目只处理用户自己导入的文件和合法笔记来源，不提供书籍下载或破解。': 'The project only handles files users import themselves and lawful note sources; it does not provide book downloads or cracking.',
    '全自动替用户读书': 'Fully automatic reading',
    '保留原文引用和人工判断。': 'Keeps source quotes and human judgment.',
    '页边不提供“跳过阅读”的自动摘要；AI 只做读薄草稿，引用仍要回到原文核对。': 'ThinRead does not offer a skip-reading summary; AI only drafts the condensed version, and quotes still return to the source for verification.',
    '笔记': 'Notes',
    'GitHub 仓库': 'GitHub repository',
    '上一张': 'Previous screenshot',
    '下一张': 'Next screenshot',
    '主导航': 'Main navigation',
    '产品事实': 'Product facts',
    '切换深色模式': 'Switch to dark mode',
    '切换深色模式': 'Switch to dark mode',
    '切换到深色模式': 'Switch to dark mode',
    '切换浅色模式': 'Switch to light mode',
    '切换到浅色模式': 'Switch to light mode',
    '和同类工具的区别': 'Comparison with common tools',
    '展开导航': 'Open navigation',
    '收起导航': 'Close navigation',
    '按场景筛选截图': 'Filter screenshots by scenario',
    '界面大图': 'Screenshot preview',
    '留言类型': 'Feedback type',
    '留言视图': 'Feedback view',
    '路线图筛选': 'Roadmap filter',
    '页边 ThinRead 首页': 'ThinRead home',
    '你现在怎么做？希望改成什么样？': 'How do you work now? What should change?',
    '例如：希望支持按章节导出笔记': 'e.g. export notes by chapter',
    '邮箱 / 微信，仅后台可见': 'Email / WeChat, visible only to the team',
    '已点赞': 'Liked',
    '点赞中…': 'Liking…',
    '稍后再试': 'Try again later',
    '刷新中…': 'Refreshing…',
    '暂无留言': 'No feedback yet',
    '已复制': 'Copied',
    '复制失败': 'Copy failed',
    '发送中…': 'Sending…',
    '连接中…': 'Connecting…',
    '重试连接': 'Retry connection',
    '正在读取': 'Loading',
    '留言台未连接': 'Feedback desk offline',
    '还没有公开留言': 'No public feedback yet',
    '同感': 'Agree',
    '已同感': 'Agreed',
    '官方回复': 'Official reply',
    '还没有官方回复。': 'No official reply yet.',
    '路线图：': 'Roadmap:',
    '拒绝原因：': 'Rejected because:',
    '来自用户建议': 'From user feedback',
    '待处理': 'Pending',
    '正在向留言台查询你提交过的留言。': 'Looking up the feedback you have submitted.',
    '还没有提交过留言': 'No feedback submitted yet',
    '提交留言后，查询码会保存在这个浏览器里；之后可以在这里看处理进度和官方回复。': 'After you submit, the lookup code stays in this browser so you can check progress and official replies here.',
    '去写一条 →': 'Write one →',
    '留言台未连接，暂时读不到这条留言的状态。服务恢复后点「刷新」再试。': 'The feedback desk is offline, so this status cannot be read yet. Try Refresh once the service is back.',
    '这条留言可能已经被删除，或者查询码不完整。': 'This feedback may have been deleted, or the lookup code is incomplete.',
    '暂时读不到状态': 'Status unavailable',
    '查询码失效': 'Lookup code expired',
    '写下建议时勾选「允许公开展示」，它会出现在这里。': 'Tick “allow public display” when writing a suggestion and it will appear here.',
    '留言会先保存在这台设备上；服务恢复后可以再发送。': 'Feedback is saved on this device first; you can send it once the service is back.',
    '已提交到在线留言板': 'Submitted to the online board',
    '留言截图': 'Feedback screenshot',
    '截图读取失败': 'Could not read the screenshot',
    '路线图由留言台同步；用户建议被处理后会自动出现在这里。': 'The roadmap syncs with the feedback desk; user suggestions appear here once they are processed.',
    '进行中': 'In progress',
    '未排期': 'Unscheduled',
    '方案评估': 'Evaluating options',
    '评估中': 'Evaluating',
    '长期不考虑': 'Not planned',
    '切换到中文': 'Switch to Chinese',
    '留言会送到留言台；勾选「允许公开展示」后会出现在右侧。': 'Feedback goes to the desk; tick “allow public display” and it appears on the right.',
    '留言会先进入审核；审核通过后才会出现在右侧。': 'Feedback is reviewed first and appears on the right once approved.',
    '留言台暂时未连接；留言会先保存在本机浏览器。': 'The feedback desk is offline; feedback is saved in this browser first.',
  }

  const originals = new Map()
  const attrOriginals = new Map()
  let lang = 'zh'
  try { lang = localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh' } catch { /* ignore */ }

  const skip = (node) => {
    const parent = node.parentElement
    if (!parent) return true
    return Boolean(parent.closest('script, style, #feedbackList, .note-list, .note-card'))
  }

  function collect(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const value = node.nodeValue || ''
      if (!skip(node) && /[\u4e00-\u9fff]/.test(value) && originals.get(node) !== value) {
        originals.set(node, value)
      }
      node = walker.nextNode()
    }
    for (const el of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
      if (el.id === 'langToggle' || el.closest('#feedbackList, .note-card')) continue
      let values = attrOriginals.get(el)
      for (const name of ['placeholder', 'aria-label', 'title']) {
        const value = el.getAttribute(name)
        if (!value || !/[\u4e00-\u9fff]/.test(value)) continue
        if (!values) {
          values = {}
          attrOriginals.set(el, values)
        }
        values[name] = value
      }
    }
  }

  function translateText(node) {
    const text = node.nodeValue || ''
    const leading = text.match(/^\s*/)?.[0] ?? ''
    const trailing = text.match(/\s*$/)?.[0] ?? ''
    const key = text.trim()
    if (!key) return
    let next = text
    if (lang === 'en') {
      if (EN[key]) next = leading + EN[key] + trailing
    } else {
      const original = originals.get(node)
      if (original != null) next = original
    }
    if (next !== text) node.nodeValue = next
  }

  function apply(root = document.body, notify = false) {
    collect(root)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      if (!skip(node)) translateText(node)
      node = walker.nextNode()
    }
    for (const [el, values] of attrOriginals) {
      if (!el.isConnected || el.id === 'langToggle' || el.closest('#feedbackList, .note-card')) continue
      for (const [name, original] of Object.entries(values)) {
        const next = lang === 'en' ? (EN[original] || original) : original
        if (el.getAttribute(name) !== next) el.setAttribute(name, next)
      }
    }
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
    document.title = lang === 'en'
      ? 'ThinRead · read a book down to a publishable draft'
      : '页边 ThinRead · 把一本书读成能发出去的稿子'
    const meta = document.querySelector('meta[name="description"]')
    if (meta) {
      meta.setAttribute('content', lang === 'en'
        ? 'ThinRead is an MIT-licensed macOS AI reading tool: condense chapters, distill cards with traceable quotes, connect notes across books, then compose articles, share cards or podcasts. Books and notes stay on-device.'
        : '页边 ThinRead 是 macOS 上的开源 AI 阅读工具：读薄章节、提炼带原文依据的卡片、连接跨书笔记，再写成稿、做成分享图或播客。书和笔记留在本机。')
    }
    const toggle = document.querySelector('#langToggle')
    if (toggle) {
      const label = lang === 'en' ? '中文' : 'EN'
      const aria = lang === 'en' ? '切换到中文' : 'Switch to English'
      const pressed = String(lang === 'en')
      // 同值写入同样会触发 MutationObserver，必须逐项比较，避免自激循环。
      if (toggle.textContent !== label) toggle.textContent = label
      if (toggle.getAttribute('aria-label') !== aria) toggle.setAttribute('aria-label', aria)
      if (toggle.getAttribute('aria-pressed') !== pressed) toggle.setAttribute('aria-pressed', pressed)
    }
    if (notify) {
      window.dispatchEvent(new CustomEvent('thinread:langchange', { detail: { lang } }))
    }
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'zh'
    try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
    apply(document.body, true)
  }

  window.THINREAD_I18N = {
    get lang() { return lang },
    get en() { return EN },
    t(value) { return lang === 'en' ? (EN[value] || value) : value },
    apply,
    setLang,
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('#langToggle')) setLang(lang === 'en' ? 'zh' : 'en')
  })

  // Keep dynamically rendered UI (roadmap cards, feedback states, form buttons)
  // in the selected language without making every render path call the dictionary.
  let scheduled = false
  let applying = false
  function scheduleApply() {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (applying || !document.body) return
      applying = true
      try {
        apply()
      } finally {
        applying = false
      }
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      apply()
      if (document.body) {
        new MutationObserver(scheduleApply).observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['placeholder', 'aria-label', 'title'],
        })
      }
    }, { once: true })
  } else {
    apply()
    if (document.body) {
      new MutationObserver(scheduleApply).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'aria-label', 'title'],
      })
    }
  }
})()
