#!/usr/bin/env python3
"""Convert a text-layer PDF into chapter HTML using Docling.

This is an optional high-quality PDF backend. It is intentionally a separate
process: Docling pulls in PyTorch and layout models, which should not be loaded
into Electron's main process.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys

import pypdfium2 as pdfium
from pathlib import Path

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import HeadingHierarchyOptions, PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption


def escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def picture_data_url(item, doc) -> str | None:
    try:
        image = item.get_image(doc)
        if image is None:
            return None
        if image.width < 100 or image.height < 70:
            return None
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        data = buffer.getvalue()
        if len(data) < 1500:
            return None
        return "data:image/png;base64," + base64.b64encode(data).decode("ascii")
    except Exception:
        return None


def table_html(item, doc) -> str:
    import re

    try:
        html = item.export_to_html(doc=doc)
    except Exception:
        try:
            html = "<pre>" + escape_html(item.export_to_markdown(doc=doc)) + "</pre>"
        except Exception:
            return ""
    return re.sub(r"[¡•■□◆◇●○▪▫][ \t]+", "", html)


def item_page(item) -> int | None:
    prov = getattr(item, "prov", None)
    if not prov:
        return None
    try:
        return int(prov[0].page_no)
    except Exception:
        return None


def ignored_title(value: str) -> bool:
    import re

    return bool(
        re.match(
            r"^(封面|书名|书名页|版权|扉页|目录|brief\s+contents|contents|table\s*of\s*contents|index|索引)$",
            value.strip(),
            re.IGNORECASE,
        )
    )


def normalized_title(value: str) -> str:
    import re

    return re.sub(r"^[0-9一二三四五六七八九十]+[.、\s]+", "", value.strip()).strip().lower()


def is_page_number(value: str) -> bool:
    import re

    return bool(re.fullmatch(r"[0-9ivxlcdm]{1,5}", value.strip(), re.IGNORECASE))


def clean_inline_symbols(value: str) -> str:
    import re

    return re.sub(r"(^|[\n\r\t ])[¡•■□◆◇●○▪▫][ \t]+", r"\1", value)


def is_noise_text(value: str) -> bool:
    import re

    text = value.strip()
    if not text or is_page_number(text):
        return True
    if len(text) <= 20 and not re.search(r"[A-Za-z0-9\u4e00-\u9fff]", text):
        return True
    return bool(re.fullmatch(r"[¡•■□◆◇●○▪▫·\-–—\s]+", text))


def clean_list_text(value: str) -> str:
    import re

    return re.sub(r"^[¡•■□◆◇●○▪▫·\-–—]+\s*", "", value.strip()).strip()


def normalize_code_text(value: str) -> str:
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


def expand_code_indent(value: str) -> str:
    lines = value.split("\n")
    indents = [len(line) - len(line.lstrip(" ")) for line in lines if line.strip()]
    positive = [indent for indent in indents if indent > 0]
    if not positive:
        return value
    smallest = min(positive)
    if smallest >= 4:
        return value
    python_like = bool(re.search(r"\b(def|class|import|from|print|async\s+def)\b", value))
    unit = 4 if python_like else 2
    if smallest >= 2:
        unit = 2
    return "\n".join(
        (" " * ((len(line) - len(line.lstrip(" "))) * unit)) + line.lstrip(" ")
        if line.strip()
        else line
        for line in lines
    )


def looks_like_code(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if stripped.startswith(("#", "//", "/*", "*", "@", '"""', "'''", "</", "<?")):
        return True
    if re.match(
        r"^(def|class|import|async|await|return|if|elif|else|for|while|with|try|except|finally|"
        r"const|let|var|function|export|module|package|npm|npx|pip|uv|curl|brew|cd|node|git|docker|"
        r"python|mcp|use|fn|pub|impl|struct|enum|raise|yield|lambda)\b",
        stripped,
    ):
        return True
    if re.match(r"^from\s+\S+\s+import\b", stripped):
        return True
    if re.search(r"[(){}\[\]=;]", stripped):
        return True
    if stripped.endswith((":", "\\", "=>", "->")):
        return True
    return bool(re.match(r"^\s{2,}\S", line))


def trim_code_annotations(value: str) -> str:
    lines = value.split("\n")
    last_code = -1
    for index, line in enumerate(lines):
        if looks_like_code(line):
            last_code = index
    if last_code < 0 or last_code >= len(lines) - 1:
        return value
    trailing = lines[last_code + 1 :]
    # 只删除代码块末尾的说明文字；保留代码内部的空行和 docstring。
    if trailing and all(not looks_like_code(line) for line in trailing):
        return "\n".join(lines[: last_code + 1]).rstrip()
    return value


def bounded_code_text(item, pdf_doc) -> str | None:
    prov = getattr(item, "prov", None)
    if not prov:
        return None
    try:
        page_no = int(prov[0].page_no)
        bbox = prov[0].bbox
        page = pdf_doc[page_no - 1]
        textpage = page.get_textpage()
        try:
            text = textpage.get_text_bounded(bbox.l, bbox.b, bbox.r, bbox.t)
        finally:
            textpage.close()
        return text if text.strip() else None
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("output")
    parser.add_argument("--outline", help="JSON array of {page,title} chapter starts")
    parser.add_argument("--title", default="")
    parser.add_argument("--author", default="")
    parser.add_argument("--pages", help="Optional page range, e.g. 1-20")
    args = parser.parse_args()

    pdf = Path(args.pdf)
    if not pdf.exists():
        print(f"PDF not found: {pdf}", file=sys.stderr)
        return 2

    outline: list[dict] = []
    if args.outline:
        try:
            outline = json.loads(Path(args.outline).read_text("utf-8"))
        except Exception:
            outline = []

    pipeline = PdfPipelineOptions(
        do_ocr=False,
        generate_picture_images=True,
        images_scale=1.5,
    )
    pipeline.heading_hierarchy_options = HeadingHierarchyOptions(enabled=True)

    def on_progress(event) -> None:
        kind = getattr(getattr(event, "kind", None), "value", "")
        if kind == "phase_started":
            phase = getattr(getattr(event, "phase", None), "value", "")
            print(json.dumps({"type": "phase", "phase": phase}), flush=True)
        elif kind == "page_completed":
            print(
                json.dumps(
                    {
                        "type": "pages",
                        "done": int(getattr(event, "completed_pages", 0)),
                        "total": int(getattr(event, "total_pages", 0)),
                    }
                ),
                flush=True,
            )

    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline)},
        progress_callback=on_progress,
    )
    page_range = None
    if args.pages:
        try:
            start, end = args.pages.split('-', 1)
            page_range = (int(start), int(end))
        except Exception:
            page_range = None
    if page_range:
        result = converter.convert(str(pdf), page_range=page_range)
    else:
        result = converter.convert(str(pdf))
    doc = result.document
    pdf_doc = pdfium.PdfDocument(str(pdf))

    starts: list[dict] = []
    if outline:
        for entry in outline:
            if not isinstance(entry, dict):
                continue
            title = str(entry.get("title", "")).strip()
            page = entry.get("page")
            if not title or ignored_title(title) or not isinstance(page, int) or page < 1:
                continue
            starts.append({"page": page, "title": title})
        starts.sort(key=lambda item: item["page"])
        # Deduplicate page starts, keeping the first title.
        seen: set[int] = set()
        starts = [item for item in starts if not (item["page"] in seen or seen.add(item["page"]))]

    def chapter_index_for_page(page: int | None) -> int:
        if not starts:
            return 0
        if page is None:
            return current_chapter[0]
        index = 0
        for i, start in enumerate(starts):
            if start["page"] <= page:
                index = i
            else:
                break
        return index

    chapters: list[dict] = []
    if starts:
        chapters = [
            {"title": item["title"], "html": [], "pages": set()}
            for item in starts
        ]
        # Keep front matter if the first bookmark starts later.
        if starts[0]["page"] > 1:
            chapters.insert(0, {"title": "前言", "html": [], "pages": set()})
            starts.insert(0, {"page": 1, "title": "前言"})
    else:
        chapters = [{"title": args.title or pdf.stem, "html": [], "pages": set()}]
        starts = [{"page": 1, "title": chapters[0]["title"]}]

    current_chapter = [0]
    current_page: int | None = None
    list_open = False
    seen_first_heading = False

    def close_list() -> None:
        nonlocal list_open
        if list_open:
            chapters[current_chapter[0]]["html"].append("</ul>")
            list_open = False

    for item, _level in doc.iterate_items():
        label = str(getattr(item, "label", ""))
        page = item_page(item)
        if page is not None and page != current_page:
            close_list()
            current_page = page
            current_chapter[0] = chapter_index_for_page(page)
            seen_first_heading = False
            chapters[current_chapter[0]]["pages"].add(page)
            chapters[current_chapter[0]]["html"].append(
                f'<div class="page-marker">第 {page} 页</div>'
            )

        if label in {"page_header", "page_footer", "document_index"}:
            continue

        text = clean_inline_symbols(str(getattr(item, "text", "") or "")).strip()
        if text and is_noise_text(text):
            continue
        if label == "section_header":
            close_list()
            level = int(getattr(item, "level", 1) or 1)
            level = max(2, min(6, level + 1))
            chapter_title = chapters[current_chapter[0]]["title"]
            if text and not (
                not seen_first_heading
                and normalized_title(text) == normalized_title(chapter_title)
            ):
                chapters[current_chapter[0]]["html"].append(
                    f"<h{level}>{escape_html(text)}</h{level}>"
                )
            seen_first_heading = True
            continue

        if label == "list_item":
            cleaned = clean_list_text(text)
            if not cleaned:
                continue
            if not list_open:
                chapters[current_chapter[0]]["html"].append("<ul>")
                list_open = True
            chapters[current_chapter[0]]["html"].append(
                f"<li>{escape_html(cleaned)}</li>"
            )
            continue

        close_list()
        if label == "table":
            html = table_html(item, doc)
            if html:
                chapters[current_chapter[0]]["html"].append(
                    f'<div class="docling-table">{html}</div>'
                )
            continue
        if label == "picture":
            data_url = picture_data_url(item, doc)
            if data_url:
                chapters[current_chapter[0]]["html"].append(
                    f'<figure class="docling-figure"><img src="{data_url}" alt="第 {page or "?"} 页图表" loading="lazy"></figure>'
                )
            continue
        if label == "code":
            code_text = bounded_code_text(item, pdf_doc)
            code_text = normalize_code_text(expand_code_indent(trim_code_annotations(code_text or text)))
            if code_text:
                chapters[current_chapter[0]]["html"].append(
                    f"<pre><code>{escape_html(code_text)}</code></pre>"
                )
            continue
        if label == "formula":
            if text:
                chapters[current_chapter[0]]["html"].append(
                    f'<p class="formula">{escape_html(text)}</p>'
                )
            continue
        if text:
            chapters[current_chapter[0]]["html"].append(f"<p>{escape_html(text)}</p>")

    close_list()
    try:
        pdf_doc.close()
    except Exception:
        pass

    for chapter in chapters:
        chapter["html"] = [
            re.sub(r"<ul>\s*</ul>", "", part)
            for part in chapter["html"]
        ]
        chapter["html"] = [part for part in chapter["html"] if part.strip()]

    output = {
        "title": args.title or pdf.stem,
        "author": args.author,
        "pageCount": len(doc.pages),
        "chapters": [
            {
                "title": chapter["title"],
                "html": "\n".join(chapter["html"]).strip(),
            }
            for chapter in chapters
            if chapter["html"]
        ],
    }
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False), "utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
