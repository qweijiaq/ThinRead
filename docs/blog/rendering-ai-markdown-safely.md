# 渲染模型生成的内容，先把它当成不可信输入

AI 返回的内容，本质上是一段不可信文本。

它可能来自模型，也可能来自用户粘贴的网页、EPUB 里的 HTML、浏览器扩展抓来的文章。只要内容不是你自己写的，就不应该直接塞进 `innerHTML`。

一个读书工具里通常有两条渲染路径：

- 书本章节：从 EPUB/DOCX/HTML 解析出来的 HTML（PDF 则走纯文本），用白名单清洗；
- AI 笔记和对话：Markdown，用 ReactMarkdown 渲染，不启用原始 HTML。

两条路径的目的不同，但原则一样：只允许你认识的标签和属性。

以下内容来自一个读书工具项目的实践。下面这些处理，一部分是主动设计的，一部分是被真实内容逼出来的。

## 一、白名单，而不是黑名单

EPUB 里的 HTML 很杂。有 `script`、`style`、`iframe`，有内联事件，有 `javascript:` 链接，还有各种出版社自定义的 class。

黑名单很难写全。今天禁了 `onerror`，明天可能漏了 `onload`。所以章节 HTML 用标签白名单：

```ts
const ALLOWED_TAGS = [
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'ul', 'ol', 'li', 'em', 'strong', 'i', 'b', 'u', 's',
  'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'figure', 'figcaption', 'img', 'sup', 'sub', 'code', 'pre', 'dl', 'dt', 'dd',
]
```

属性也只放行必要的：图片的 `src/alt/title`，表格的 `colspan/rowspan`，列表的 `start/type`。类名只允许 `center`、`right`、`caption` 和 `language-*` 这类排版类。

链接统一转成 `span`：

```ts
transformTags: {
  a: (_tagName, attribs) => ({
    tagName: 'span',
    attribs: { class: 'epub-inline-link', title: attribs.href ?? '' },
  }),
}
```

不是不让人点链接，而是书里的链接经常指向相对路径或外站，直接在应用里打开不可控。转成带标题的文本，既保留信息，也不引入跳转风险。

属性白名单也要写全。`img` 允许 `src`、`alt`、`title`，但 `src` 还要限制协议；`td` 允许 `colspan`、`rowspan`，但不能允许 `onclick`；class 只允许排版相关的名字，不要让第三方内容控制布局。

白名单不是一次写完就结束。每次新增一种内容类型，都要重新检查允许的标签和属性。比如支持脚注后，可能会引入 `sup`、`a`；支持视频后，可能会引入 `video`、`source`。每加一个，都是一次信任边界的扩大。

## 二、图片不能随便带外部地址

章节里的图片可能是内嵌的 `data:` URL，也可能是外部 URL。直接把外部 URL 渲染出来，等于让书里的一段内容去请求网络，可能泄露阅读行为，也可能加载失败。

一种做法是在解析时把内嵌图片抽出来，正文里只留一个占位 id。需要显示时再从本地映射还原。

```ts
$('img').each((_, element) => {
  const node = $(element)
  const id = node.attr('data-img-id')
  if (id === undefined) {
    node.remove()
    return
  }
  const src = images.get(id)
  if (src) node.attr('src', src)
  else node.remove()
})
```

模型新插入的 `<img>` 没有 id，直接删掉。它不是书里的图，没有理由加载。

即使允许 `data:`，也要限制类型和大小。`data:image/svg+xml` 里可能包含脚本，不能当成普通图片。只允许 `image/png`、`image/jpeg`、`image/webp` 这类位图，并限制 base64 长度，避免一个超大图片把页面卡死。

外部 URL 不是绝对不能加载，但要有明确的信任策略。可以只允许白名单域名，或者把远程图片下载到本地后再显示。不要在渲染时直接让第三方内容发起请求。

## 三、代码块重复，是另一个坑

有些 EPUB 会把代码的每个 token 包成一个独立的 `<code>`：

```html
<pre><code>const</code> <code>a</code> <code>=</code> <code>1</code></pre>
```

渲染层会再包一层代码块，如果只替换第一个 `<code>`，整段代码会被插进去一遍，出现重复。

所以清洗前先做一次归一化：如果 `<pre>` 里有多个 `<code>`，把文本合并成一个 `<code>`，保留 `language-*` 类。

```ts
const code = $('<code></code>').text(pre.text())
if (languageClasses.length > 0) code.attr('class', languageClasses.join(' '))
pre.empty().append(code)
```

这个 bug 很隐蔽，只有在特定出版社的 EPUB 上才出现。第一次看到代码重复两遍时，我以为是模型生成的，查了半天才发现是渲染层。

代码块的后续处理也要安全。语法高亮应该输出 HTML 字符串，而不是直接执行代码；复制按钮只复制文本；折叠、行号这些功能不能改变代码内容。导出 Markdown 或 HTML 时，代码里的 `<`、`>` 要转义，否则导出的文件会变成一段坏掉的标签。

## 四、Markdown 不启用原始 HTML

AI 笔记用 ReactMarkdown。默认情况下，Markdown 里的原始 HTML 不会被渲染成 DOM，而是当作文本处理。这已经挡掉了大部分 `<script>` 和事件属性。

不要轻易启用 `rehype-raw`。笔记内容通常不需要任意 HTML。标题、列表、引用、表格、代码块，Markdown 都能表达；需要 HTML 的地方，往往是模型想插样式或 iframe，这些都不应该出现。

`[[笔记标题]]` 这种双链，可以在渲染前转成内部链接，再在组件层替换成按钮。链接点击不跳转，只触发应用内的笔记跳转。

Markdown 里的图片和链接也要单独处理。默认渲染器可能允许 `javascript:` 或外部图片，最好在组件层覆盖 `a` 和 `img`，对协议做校验。外链可以加 `rel="noreferrer"`，图片可以走代理或本地缓存。

插件也要控制。每引入一个 remark/rehype 插件，就多一段处理逻辑。只用需要的插件，不要为了“支持更多语法”把所有插件都打开。

## 五、Mermaid 延迟加载，失败就回退

Mermaid 图表是一个例外。它需要把文本渲染成 SVG，`dangerouslySetInnerHTML` 不可避免。

处理方式是：

- 只在遇到 `language-mermaid` 代码块时动态加载 Mermaid，不塞进首屏包；
- 渲染失败时保留原始代码块，不打断整篇笔记；
- 渲染中的占位也是代码块，不会闪一块空白。

Mermaid 本身也可能有解析漏洞，所以它只处理用户主动写的图表代码，不处理任意 HTML。输入范围收窄，风险也就小一些。

Mermaid 通常有安全级别配置。能禁用 HTML 标签就禁用，能限制外部资源就限制。渲染出来的 SVG 也不要直接信任，最好在沙箱或隔离容器里生成。

## 六、流式内容也要按不可信处理

流式输出会让内容分块到达。有些实现会在流式过程中直接用 `innerHTML` 拼接，这是更危险的做法。

无论是否流式，最终都应该经过同一套渲染路径：

- 纯文本先转义；
- Markdown 走安全的渲染器；
- HTML 走白名单清洗；
- 代码块只作为文本，不执行；
- 链接和图片地址做协议校验。

流式只改变内容到达的时间，不改变内容本身不可信的事实。

## 七、CSP 和 Electron 边界

清洗是应用层的第一道门，不是唯一一道。

在 Electron 里，渲染进程应该开启 `contextIsolation`，不要直接暴露 Node API；页面可以设置内容安全策略（CSP），限制脚本、样式和图片的来源；外部链接用系统浏览器打开，不要在应用窗口里加载。

CSP 不能替代清洗，清洗也不能替代 CSP。一个漏掉的标签可能被 CSP 挡住，一个 CSP 配置错误也可能让清洗失效。两层都做，成本不高。

## 八、导出 HTML 的风险

很多产品支持把笔记导出成 HTML 或 PDF。导出时，内容会离开当前应用，进入浏览器、邮件或别的系统。

如果导出的是完整 HTML，之前被清洗掉的标签可能因为拼接模板又回来了。导出模板本身也要转义，不要把标题、正文直接插进字符串。

导出的文件最好自带一个最小的 CSP，或者只导出静态、无脚本的 HTML。用户打开导出文件时，不应该再执行任何模型生成的代码。

## 九、怎么测试 XSS 用例

安全测试不能只靠“看起来没问题”。可以准备一组固定输入：

- `<script>alert(1)</script>`
- `<img src=x onerror=alert(1)>`
- `[链接](javascript:alert(1))`
- `<svg onload=alert(1)>`
- `<iframe src="...">`
- 带 `data:text/html` 的链接
- 带外部图片地址的 Markdown

检查重点不是弹窗有没有出现，而是这些内容最终变成了什么：文本、被移除的节点，还是安全的属性。自动化测试可以直接检查生成的 DOM 里没有 `script`、没有 `on*` 属性、没有 `javascript:` 协议。

## 十、上线前可以逐条检查

- 是否使用白名单，而不是黑名单？
- 是否禁用了 `script`、`style`、`iframe` 和内联事件？
- 链接是否做了协议校验，或直接转成纯文本？
- 图片是否只允许本地或受信任的 data URL？
- Markdown 是否禁用了原始 HTML？
- 代码块是否只作为文本渲染？
- Mermaid 等需要 `dangerouslySetInnerHTML` 的地方，输入范围是否收窄？
- 流式内容是否和最终内容走同一套清洗逻辑？
- 第三方文件和模型输出是否被区别对待？

前端很容易把“渲染”当成展示问题：样式好不好看，排版对不对。

但只要内容来自模型、网页或第三方文件，渲染就是执行问题。一个 `<img onerror>`、一个 `javascript:` 链接、一个外部图片地址，都可能在用户打开笔记时发生。

处理这类内容的默认动作应该是：先问它从哪来，再决定用什么渲染。自己写的 JSX 可以信任，模型返回的字符串不行。

这些做法不能保证绝对安全，但比直接把字符串塞进 `innerHTML` 好。内容来源变复杂之后，渲染就不再是一个单纯的展示问题了。
