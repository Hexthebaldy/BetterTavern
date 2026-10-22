"""邮件的文字：templates/<lang>.json 里每种邮件一个标题、一段正文；正文里的 {code} 换成验证码。

HTML 版只是把正文分段，验证码放大加粗；不引用外部图片和样式（很多邮箱默认不加载）。
"""

from __future__ import annotations

import html
import json
from functools import cache
from pathlib import Path

from . import Mail

TEMPLATES = Path(__file__).parent / "templates"
LANGUAGES = ("zh", "en", "ja")
DEFAULT_LANGUAGE = "zh"


@cache
def _strings(language: str) -> dict[str, dict[str, str]]:
    return json.loads((TEMPLATES / f"{language}.json").read_text(encoding="utf-8"))


def _language(language: str | None) -> str:
    return language if language in LANGUAGES else DEFAULT_LANGUAGE


def code_mail(to: str, purpose: str, code: str, language: str | None, minutes: int) -> Mail:
    """验证邮箱（purpose=verify）或找回密码（reset）的验证码邮件。"""
    strings = _strings(_language(language))[purpose]
    subject = strings["subject"].format(code=code)
    text = strings["body"].format(code=code, minutes=minutes)
    paragraphs = []
    for part in text.split("\n\n"):
        escaped = html.escape(part).replace("\n", "<br>")
        escaped = escaped.replace(
            html.escape(code),
            f'<strong style="font-size:28px;letter-spacing:6px">{html.escape(code)}</strong>',
        )
        paragraphs.append(f'<p style="margin:0 0 16px;line-height:1.6">{escaped}</p>')
    body = "".join(paragraphs)
    page = (
        '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;'
        f'max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">{body}</div>'
    )
    return Mail(to=to, subject=subject, text=text, html=page, dev_code=code)
