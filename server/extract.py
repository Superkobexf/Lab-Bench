"""合同文本提取与关键字段抽取。

分两层：
  1. 取文本。数字版 PDF / docx / txt 直接读文本层，零依赖；
     取不到文本的（扫描件、拍照件）交给 ocr.py。
  2. 从文本里抽日期、任务和金额。这一层不关心文本从哪来，
     所以 OCR 接上之后规则完全复用。

抽出来的东西一律是"候选"，要导师确认后才会变成待办。
OCR 和正则都会误读，这个环节不能省。
"""

import datetime
import re
import zipfile
import zlib

# ── 取文本 ──────────────────────────────────────────────────


def _inflate(data):
    """PDF 的 FlateDecode 是带 zlib 包头的；个别文件是裸 deflate。"""
    for wbits in (15, -15):
        try:
            return zlib.decompress(data, wbits)
        except zlib.error:
            continue
    # 截断的流尽量取出已解出的部分
    try:
        d = zlib.decompressobj()
        return d.decompress(data)
    except zlib.error:
        return b""


_PDF_STREAM = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.S)


def pdf_text(data):
    """解 FlateDecode 流，取 Tj / TJ 文本操作符里的字符串。

    和前端 app.js 里那份手写实现是同一个思路，覆盖 Word、LaTeX
    和期刊排版系统生成的 PDF；扫描件和 CID 字体取不到，返回空串。
    """
    chunks = []
    for match in _PDF_STREAM.finditer(data):
        raw = match.group(1)
        head_start = data.rfind(b"<<", 0, match.start())
        head = data[head_start:match.start()] if head_start >= 0 else b""
        if b"/FlateDecode" not in head:
            continue
        inflated = _inflate(raw)
        if not inflated:
            continue
        chunks.append(_pdf_operator_text(inflated))
    return _tidy("\n".join(c for c in chunks if c))


_ESCAPES = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f"}

# 按出现顺序同时匹配「字符串」和「换行定位操作符」。
# 不还原换行的话，整页文字会连成一行，后面按句取标题就全废了。
_PDF_TOKEN = re.compile(
    rb"(\((?:\\.|[^\\()])*\))"      # 1: (文本)
    rb"|(\bT[dD]\b|\bT\*|'|\")",    # 2: Td / TD / T* / ' / " 都会另起一行
    re.S,
)


def _pdf_operator_text(content):
    lines, current = [], []

    def flush():
        if current:
            joined = "".join(current).strip()
            if joined:
                lines.append(joined)
            current.clear()

    # 只看 BT...ET 文本块，避免把图形操作符当文字
    blocks = re.findall(rb"BT(.*?)ET", content, re.S) or [content]
    for block in blocks:
        for token in _PDF_TOKEN.finditer(block):
            if token.group(1) is not None:
                # 同一行里的多个字符串（TJ 数组）直接拼接，不加空格
                current.append(_decode_pdf_string(token.group(1)[1:-1]))
            else:
                flush()
        flush()
    return "\n".join(lines)


def _decode_pdf_string(raw):
    result = bytearray()
    i = 0
    while i < len(raw):
        ch = raw[i:i + 1]
        if ch == b"\\" and i + 1 < len(raw):
            nxt = raw[i + 1:i + 2]
            if nxt in _ESCAPES:
                result += _ESCAPES[nxt]; i += 2; continue
            if nxt.isdigit():  # 八进制
                oct_digits = raw[i + 1:i + 4]
                m = re.match(rb"[0-7]{1,3}", oct_digits)
                if m:
                    result.append(int(m.group(0), 8) & 0xFF)
                    i += 1 + len(m.group(0)); continue
            result += nxt; i += 2; continue
        result += ch; i += 1
    blob = bytes(result)
    # PDF 里中文常见 UTF-16BE（带 BOM）
    if blob[:2] == b"\xfe\xff":
        try:
            return blob[2:].decode("utf-16-be", "ignore")
        except Exception:
            return ""
    for enc in ("utf-8", "gbk", "latin-1"):
        try:
            return blob.decode(enc)
        except UnicodeDecodeError:
            continue
    return ""


_XML_TAG = re.compile(r"<[^>]+>")


def docx_text(path):
    try:
        with zipfile.ZipFile(path) as zf:
            xml = zf.read("word/document.xml").decode("utf-8", "ignore")
    except (KeyError, zipfile.BadZipFile, OSError):
        return ""
    # 段落和换行还原成真正的换行，否则整篇挤成一行，日期上下文会串
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
    return _tidy(_XML_TAG.sub("", xml))


def _tidy(text):
    text = text.replace("　", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def text_from_file(path, filename):
    """返回 (text, parser)。取不到文本时 text 为空，由调用方决定要不要走 OCR。"""
    lower = filename.lower()
    try:
        if lower.endswith(".pdf"):
            with open(path, "rb") as fh:
                return pdf_text(fh.read()), "PDF文本层"
        if lower.endswith(".docx"):
            return docx_text(path), "Word正文"
        if lower.endswith((".txt", ".md")):
            with open(path, "rb") as fh:
                raw = fh.read()
            for enc in ("utf-8", "gbk"):
                try:
                    return _tidy(raw.decode(enc)), "纯文本"
                except UnicodeDecodeError:
                    continue
    except OSError:
        return "", ""
    return "", ""


# ── 抽日期 ──────────────────────────────────────────────────

_CN_DIGIT = {
    "〇": "0", "零": "0", "一": "1", "二": "2", "两": "2", "三": "3", "四": "4",
    "五": "5", "六": "6", "七": "7", "八": "8", "九": "9", "十": "10",
}

DATE_PATTERNS = [
    # 2025年3月1日 / 2025 年 3 月 1 日
    re.compile(r"(?P<y>\d{4})\s*年\s*(?P<m>\d{1,2})\s*月\s*(?P<d>\d{1,2})\s*日"),
    # 2025-03-01 / 2025/3/1 / 2025.3.1
    re.compile(r"(?P<y>\d{4})\s*[-/.]\s*(?P<m>\d{1,2})\s*[-/.]\s*(?P<d>\d{1,2})"),
]
# 二〇二五年三月一日
CN_DATE = re.compile(
    r"(?P<y>[〇零一二三四五六七八九]{4})\s*年\s*"
    r"(?P<m>[一二三四五六七八九十]{1,3})\s*月\s*"
    r"(?P<d>[一二三四五六七八九十]{1,3})\s*日"
)


def _cn_number(text):
    """把'十''二十''三十一'这类中文数字转成整数。只处理 1-31 的量级。"""
    if not text:
        return None
    if all(c in "〇零一二三四五六七八九" for c in text):  # 逐位，如年份
        return int("".join(_CN_DIGIT[c] for c in text))
    if text == "十":
        return 10
    if text.startswith("十"):
        return 10 + int(_CN_DIGIT.get(text[1], "0"))
    if "十" in text:
        head, _, tail = text.partition("十")
        return int(_CN_DIGIT.get(head, "0")) * 10 + (
            int(_CN_DIGIT.get(tail, "0")) if tail else 0
        )
    return int(_CN_DIGIT.get(text, "0")) or None


def _make_date(year, month, day):
    try:
        return datetime.date(int(year), int(month), int(day)).isoformat()
    except (ValueError, TypeError):
        return None


def find_dates(text):
    """返回 [(iso_date, start, end, raw)]，按出现位置排序。"""
    found = []
    for pattern in DATE_PATTERNS:
        for m in pattern.finditer(text):
            iso = _make_date(m.group("y"), m.group("m"), m.group("d"))
            if iso:
                found.append((iso, m.start(), m.end(), m.group(0)))
    for m in CN_DATE.finditer(text):
        iso = _make_date(
            _cn_number(m.group("y")), _cn_number(m.group("m")), _cn_number(m.group("d"))
        )
        if iso:
            found.append((iso, m.start(), m.end(), m.group(0)))
    # 同一位置可能被多个规则命中，按起点去重
    seen, out = set(), []
    for item in sorted(found, key=lambda x: x[1]):
        if item[1] in seen:
            continue
        seen.add(item[1])
        out.append(item)
    return out


# ── 抽任务与节点 ────────────────────────────────────────────

# 权重越高越可能是真正要盯的节点
MILESTONE_WORDS = [
    ("验收", 1.0), ("交付", 1.0), ("结题", 1.0), ("中期检查", 0.95),
    ("提交", 0.85), ("完成", 0.8), ("汇报", 0.8), ("答辩", 0.9),
    ("付款", 0.95), ("支付", 0.9), ("拨付", 0.9), ("开票", 0.85),
    ("截止", 1.0), ("到期", 0.95), ("期限", 0.9), ("之前", 0.7),
    ("启动", 0.7), ("开工", 0.7), ("试运行", 0.8), ("上线", 0.8),
]

AMOUNT = re.compile(
    r"(?:人民币|金额|合计|总额|价款)?\s*"
    r"(?:¥|￥|RMB)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d{1,2})?)\s*"
    r"(万元|万|元|圆整|元整)"
)

SENT_SPLIT = re.compile(r"[。；;\n]")


def _context(text, start, end, width=60):
    left = max(0, start - width)
    right = min(len(text), end + width)
    return _tidy(text[left:right])


_SENT_BOUNDARY = "。；;\n"
# 分句边界：合同里一句话常带好几个节点，
# "自 X 起启动，乙方应于 Y 前提交" 必须拆开，否则两个日期会得到同一个标题
_CLAUSE_BOUNDARY = _SENT_BOUNDARY + "，,"


def _span_around(text, start, end, boundary):
    left = start
    while left > 0 and text[left - 1] not in boundary:
        left -= 1
    right = end
    while right < len(text) and text[right] not in boundary:
        right += 1
    return _tidy(text[left:right]).strip("，,、 ")


def _sentence_around(text, start, end):
    return _span_around(text, start, end, _SENT_BOUNDARY)


def _clause_around(text, start, end):
    return _span_around(text, start, end, _CLAUSE_BOUNDARY)


def find_items(text, limit=40):
    """从合同正文里抽出候选条目。

    只抽"日期 + 附近有节点关键词"的组合——纯日期（比如签署日期、
    身份证有效期）噪声太大，全塞进待办反而没人看。
    """
    items = []
    for iso, start, end, raw in find_dates(text):
        clause = _clause_around(text, start, end)
        sentence = _sentence_around(text, start, end)
        # 先在日期所在的分句里找节点词，找不到再放宽到整句
        hits = [(w, s) for w, s in MILESTONE_WORDS if w in clause]
        scope = clause
        if not hits:
            hits = [(w, s) for w, s in MILESTONE_WORDS if w in sentence]
            scope = sentence
            # 打个折：关键词不在同一分句里，关联没那么确定
            hits = [(w, s * 0.8) for w, s in hits]
        if not hits:
            # 签署日期、身份证有效期这类不带节点词的，不进候选
            continue
        word, score = max(hits, key=lambda x: x[1])
        items.append({
            "kind": "date",
            "title": scope[:80],
            "raw_text": sentence,
            "parsed_date": iso,
            "parsed_amount": None,
            "confidence": round(min(0.99, score), 2),
        })

    for m in AMOUNT.finditer(text):
        value = m.group(1).replace(",", "")
        try:
            amount = float(value)
        except ValueError:
            continue
        if m.group(2) in ("万元", "万"):
            amount *= 10000
        if amount < 1000:  # 过小的数字多半是条款编号、页码
            continue
        ctx = _context(text, m.start(), m.end())
        items.append({
            "kind": "amount",
            "title": _tidy(m.group(0)),
            "raw_text": ctx,
            "parsed_date": "",
            "parsed_amount": amount,
            "confidence": 0.8 if any(w in ctx for w in ("付款", "支付", "拨付", "金额", "价款")) else 0.5,
        })

    # 按可信度排序，同分保持出现顺序
    items.sort(key=lambda x: -x["confidence"])
    return _dedupe(items)[:limit]


def _dedupe(items):
    seen, out = set(), []
    for item in items:
        key = (item["kind"], item["parsed_date"], item["title"][:40],
               item["parsed_amount"])
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out
