#!/usr/bin/env python3
"""OCR 工作进程。由 ocr.py 以子进程方式拉起，跑完就退出。

单独成一个进程是为了内存：识别引擎加载后会常驻几百 MB 到 GB，
如果放在 web 进程里，跑过一次 OCR 之后那块内存就再也回不来了，
2C2G 的机器上迟早被 OOM Killer 干掉。子进程退出时内核会把整块
内存收回去，web 进程始终维持在 ~90MB。

用法（不面向人类，由 ocr.py 调用）：
    python ocr_worker.py <文件路径> <原始文件名>
结果以单行 JSON 打到 stdout：
    {"text": "...", "engine": "RapidOCR", "error": ""}

引擎优先级：RapidOCR（onnxruntime，跑的是和 PaddleOCR 相同的
PP-OCR 模型，但运行时轻得多）> PaddleOCR（大机器上可选）。
"""

import io
import json
import os
import sys

MAX_PAGES = int(os.environ.get("LAB_BENCH_OCR_MAX_PAGES", "12"))
RENDER_DPI = int(os.environ.get("LAB_BENCH_OCR_DPI", "200"))
MIN_SCORE = 0.5
# 行分桶的高度容差（像素）。同一行的文字块纵坐标会有几个像素抖动。
ROW_TOLERANCE = 12


def emit(text="", engine="", error=""):
    sys.stdout.write(json.dumps(
        {"text": text, "engine": engine, "error": error}, ensure_ascii=False
    ))
    sys.stdout.flush()
    sys.exit(0)


def apply_memory_cap():
    """给自己设一个地址空间上限，返回是否真的设上了。

    宁可这个子进程自己抛 MemoryError 退出、让用户看到一句清楚的
    提示，也不要把内存吃光、让内核的 OOM Killer 随机挑一个进程杀
    ——那很可能杀掉的是 web 进程或 nginx。

    注意 macOS 不强制 RLIMIT_AS：setrlimit 会成功返回，但读回来
    还是无限。所以这里读回校验一次，让 checkenv 能如实告诉用户
    这台机器上这道保险到底有没有用。
    """
    cap_mb = int(os.environ.get("LAB_BENCH_OCR_MEM_MB", "0"))
    if cap_mb <= 0:
        return False
    try:
        import resource

        limit = cap_mb * 1024 * 1024
        soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        if hard != resource.RLIM_INFINITY:
            limit = min(limit, hard)
        resource.setrlimit(resource.RLIMIT_AS, (limit, hard))
        applied, _ = resource.getrlimit(resource.RLIMIT_AS)
        return applied != resource.RLIM_INFINITY and applied <= limit
    except (ImportError, ValueError, OSError):
        return False


# ── 引擎 ────────────────────────────────────────────────────


def load_engine():
    """返回 (识别函数, 引擎名)。识别函数吃 PNG 字节，吐文本。"""
    prefer = os.environ.get("LAB_BENCH_OCR_ENGINE", "").strip().lower()

    if prefer in ("", "rapidocr"):
        run = _try_rapidocr()
        if run:
            return run, "RapidOCR"
        if prefer == "rapidocr":
            return None, ""

    if prefer in ("", "paddleocr"):
        run = _try_paddleocr()
        if run:
            return run, "PaddleOCR"

    return None, ""


def _try_rapidocr():
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        return None
    try:
        engine = RapidOCR()
    except Exception:
        return None

    def run(image_bytes):
        from PIL import Image
        import numpy as np

        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        result, _ = engine(np.array(image))
        if not result:
            return ""
        # result 每项是 [四点坐标, 文本, 置信度]
        boxes = []
        for entry in result:
            try:
                box, text, score = entry[0], entry[1], float(entry[2])
            except (IndexError, ValueError, TypeError):
                continue
            if not text or score < MIN_SCORE:
                continue
            boxes.append((min(p[1] for p in box), min(p[0] for p in box), text))
        return _reading_order(boxes)

    return run


def _try_paddleocr():
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        return None
    try:
        engine = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    except Exception:
        return None

    def run(image_bytes):
        from PIL import Image
        import numpy as np

        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        result = engine.ocr(np.array(image), cls=True)
        if not result or not result[0]:
            return ""
        boxes = []
        for entry in result[0]:
            try:
                box, (text, score) = entry[0], entry[1]
            except (IndexError, ValueError, TypeError):
                continue
            if not text or float(score) < MIN_SCORE:
                continue
            boxes.append((min(p[1] for p in box), min(p[0] for p in box), text))
        return _reading_order(boxes)

    return run


def _reading_order(boxes):
    """把散落的文字块按阅读顺序拼回去：先按行分桶，行内按横坐标。

    合同的日期和它的说明常常不在同一个识别块里，顺序错了后面
    按分句抽取就全乱了。
    """
    if not boxes:
        return ""
    boxes.sort(key=lambda item: (round(item[0] / ROW_TOLERANCE), item[1]))
    lines, last_row = [], None
    for top, _left, text in boxes:
        row = round(top / ROW_TOLERANCE)
        if row == last_row and lines:
            lines[-1] = lines[-1] + " " + text
        else:
            lines.append(text)
        last_row = row
    return "\n".join(lines)


# ── 输入 ────────────────────────────────────────────────────


def iter_pdf_pages(path):
    """逐页渲染并 yield PNG 字节。

    一页一页地出，而不是先把所有页渲染进一个列表——十几页 200dpi
    的位图攒在内存里，在 2G 的机器上足够把自己撑死。
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise RuntimeError("服务器缺少 PyMuPDF，无法把扫描版 PDF 转成图片识别。")
    try:
        doc = fitz.open(path)
    except Exception as exc:
        raise RuntimeError("无法读取这个 PDF：%s" % str(exc)[:120])
    try:
        zoom = RENDER_DPI / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for index, page in enumerate(doc):
            if index >= MAX_PAGES:
                break
            pixmap = page.get_pixmap(matrix=matrix)
            data = pixmap.tobytes("png")
            del pixmap
            yield data
    finally:
        doc.close()


IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")


def selfcheck():
    """报告这台机器上的能力，供 manage.py checkenv 调用。
    在子进程里跑，所以探测引擎不会污染 web 进程的内存。"""
    import importlib.util

    capped = apply_memory_cap()
    run, name = load_engine()
    sys.stdout.write(json.dumps({
        "engine": name,
        "engine_loads": run is not None,
        "memory_cap_enforced": capped,
        "has_pymupdf": importlib.util.find_spec("fitz") is not None,
    }, ensure_ascii=False))
    sys.exit(0)


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--selfcheck":
        selfcheck()
    if len(sys.argv) < 3:
        emit(error="用法: ocr_worker.py <文件路径> <文件名>")
    path, filename = sys.argv[1], sys.argv[2]
    apply_memory_cap()

    if not os.path.isfile(path):
        emit(error="文件不存在。")

    run, engine_name = load_engine()
    if run is None:
        emit(error="服务器没有安装可用的 OCR 引擎（RapidOCR 或 PaddleOCR）。")

    lower = filename.lower()
    pages = []
    try:
        if lower.endswith(".pdf"):
            for image in iter_pdf_pages(path):
                pages.append(run(image))
        elif lower.endswith(IMAGE_EXT):
            with open(path, "rb") as fh:
                pages.append(run(fh.read()))
        else:
            emit(engine=engine_name, error="这种文件类型不支持 OCR。")
    except MemoryError:
        emit(engine=engine_name,
             error="识别时内存不足。可以降低 LAB_BENCH_OCR_DPI，或分批上传页数更少的文件。")
    except RuntimeError as exc:
        emit(engine=engine_name, error=str(exc))
    except Exception as exc:
        emit(engine=engine_name, error="识别过程出错：%s" % str(exc)[:200])

    text = "\n".join(p for p in pages if p).strip()
    if not text:
        emit(engine=engine_name, error="识别不到文字，可能是空白页或图像太模糊。")
    emit(text=text, engine=engine_name)


if __name__ == "__main__":
    main()
