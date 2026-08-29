"""扫描件 OCR —— 子进程调度。

真正干活的是 ocr_worker.py，这里只负责把它拉起来、等结果、收尸。

为什么不在 web 进程里直接跑：识别引擎一旦加载就常驻几百 MB 到
GB，Python 也不会把它还给操作系统。跑过一次 OCR 之后 web 进程就
永久地胖了，2C2G 的机器撑不了几次。子进程退出时内核会把整块内存
收回，web 进程始终 ~90MB。

只在文本层取不到字的时候才会走到这里。引擎不可用时如实报告，
绝不静默返回空——那会让人以为合同里真的没有日期。
"""

import json
import os
import subprocess
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.join(HERE, "ocr_worker.py")

# 一份几十页的扫描件可能要跑一两分钟；超过就当它卡死了
TIMEOUT = int(os.environ.get("LAB_BENCH_OCR_TIMEOUT", "300"))
# 子进程地址空间上限（MB）。0 表示不限。
# 2C2G 建议 1200 左右：留出 web 进程和系统的余量，
# 撑爆时是子进程自己报错，而不是 OOM Killer 随机杀进程。
MEM_MB = os.environ.get("LAB_BENCH_OCR_MEM_MB", "1200")

# 2 核机器上同时跑两个 OCR 只会互相拖慢并把内存翻倍，串行反而更快
_slot = threading.Semaphore(1)

_probe_cache = None


def _probe():
    """探测有没有可用引擎。

    只用 find_spec 看模块在不在，不去实例化——实例化就会把模型
    读进当前进程，那正是这次重构要避免的事。
    """
    global _probe_cache
    if _probe_cache is not None:
        return _probe_cache

    import importlib.util

    def has(name):
        try:
            return importlib.util.find_spec(name) is not None
        except (ImportError, ValueError):
            return False

    preferred = os.environ.get("LAB_BENCH_OCR_ENGINE", "").strip().lower()
    engines = []
    if has("rapidocr_onnxruntime"):
        engines.append("RapidOCR")
    if has("paddleocr"):
        engines.append("PaddleOCR")
    if preferred == "paddleocr" and "PaddleOCR" in engines:
        engines = ["PaddleOCR"]
    elif preferred == "rapidocr":
        engines = ["RapidOCR"] if "RapidOCR" in engines else []

    if engines:
        reason = ""
    elif preferred:
        reason = "指定的 OCR 引擎 %s 没有安装，扫描件无法自动识别。" % preferred
    else:
        reason = (
            "服务器没有安装 OCR 引擎（推荐 rapidocr-onnxruntime），"
            "扫描件无法自动识别。"
        )

    _probe_cache = {
        "available": bool(engines),
        "engine": engines[0] if engines else "",
        "reason": reason,
        "can_render_pdf": has("fitz") or has("pymupdf"),
    }
    return _probe_cache


def status():
    """给前端看的引擎状态。"""
    return dict(_probe())


def selfcheck():
    """在子进程里做一次深度自检：真的把引擎加载起来试试，
    并确认内存上限在这台机器上是否强制生效。

    放在子进程里做，是为了探测本身也不污染 web 进程的内存。
    """
    env = dict(os.environ)
    env["LAB_BENCH_OCR_MEM_MB"] = str(MEM_MB)
    try:
        proc = subprocess.run(
            [sys.executable, WORKER, "--selfcheck"],
            capture_output=True, timeout=180, env=env, cwd=HERE,
        )
        return json.loads((proc.stdout or b"").decode("utf-8", "ignore"))
    except (subprocess.TimeoutExpired, OSError, ValueError) as exc:
        return {"error": str(exc)[:200]}


def reset_probe():
    """装完依赖后不用重启服务也能重新探测（manage.py 会用到）。"""
    global _probe_cache
    _probe_cache = None


def ocr_file(path, filename):
    """返回 (text, engine, error)。error 非空时 text 一定为空。"""
    info = _probe()
    if not info["available"]:
        return "", "", info["reason"]
    if filename.lower().endswith(".pdf") and not info["can_render_pdf"]:
        return "", info["engine"], (
            "服务器缺少 PyMuPDF，无法把扫描版 PDF 转成图片识别。"
        )

    env = dict(os.environ)
    env["LAB_BENCH_OCR_MEM_MB"] = str(MEM_MB)
    # 识别引擎自己会开多线程，2 核机器上限制住，免得抢光 CPU
    env.setdefault("OMP_NUM_THREADS", "2")
    env.setdefault("OPENBLAS_NUM_THREADS", "2")

    with _slot:
        try:
            proc = subprocess.run(
                [sys.executable, WORKER, path, filename],
                capture_output=True,
                timeout=TIMEOUT,
                env=env,
                cwd=HERE,
            )
        except subprocess.TimeoutExpired:
            return "", info["engine"], (
                "识别超时（超过 %d 秒）。文件可能页数太多或图像太大，"
                "可以拆开分批上传。" % TIMEOUT
            )
        except OSError as exc:
            return "", info["engine"], "无法启动识别进程：%s" % str(exc)[:150]

    if proc.returncode != 0:
        detail = (proc.stderr or b"").decode("utf-8", "ignore").strip()
        # 被内核 OOM Killer 干掉时 returncode 是 -9，没有 stderr
        if proc.returncode == -9:
            return "", info["engine"], (
                "识别进程被系统终止，通常是内存不足。"
                "可以降低 LAB_BENCH_OCR_DPI，或给服务器加 swap。"
            )
        return "", info["engine"], "识别进程异常退出：%s" % (detail[-200:] or proc.returncode)

    try:
        result = json.loads((proc.stdout or b"").decode("utf-8", "ignore"))
    except ValueError:
        return "", info["engine"], "识别进程返回了无法解析的结果。"

    return result.get("text", ""), result.get("engine", info["engine"]), result.get("error", "")
