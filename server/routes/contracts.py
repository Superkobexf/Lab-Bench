"""功能二：横向合同上传、多版本、文本抽取与候选条目确认。

一份合同一条 contracts，每次上传是一个新 version——
原合同、补充协议、变更单都是同一份合同的不同版本，
抽取结果挂在版本上，所以能看出补充协议改了哪些日期。

合同只有导师能上传和查看：里面通常有保密条款和金额，
学生端一律不可见。
"""

import hashlib
import os
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

import auth
import db
import extract
import ocr
from deps import client_ip, require_pi
from models import ContractIn, ContractItemPatch

router = APIRouter(prefix="/api/contracts", tags=["contracts"])

UPLOAD_DIR = os.environ.get(
    "LAB_BENCH_UPLOADS",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "server", "uploads"),
)
MAX_UPLOAD = 30 * 1024 * 1024
ALLOWED_EXT = {
    ".pdf", ".docx", ".txt", ".md",
    ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff",
}


def new_id(prefix):
    return "%s_%s" % (prefix, secrets.token_hex(8))


def _ext(filename):
    return os.path.splitext(filename or "")[1].lower()


def contract_out(row, versions=None):
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "title": row["title"],
        "counterparty": row["counterparty"],
        "current_version_id": row["current_version_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "versions": versions or [],
    }


def version_out(row, item_counts=None):
    counts = (item_counts or {}).get(row["id"], {"total": 0, "pending": 0, "confirmed": 0})
    return {
        "id": row["id"],
        "contract_id": row["contract_id"],
        "version_no": row["version_no"],
        "version_note": row["version_note"],
        "filename": row["filename"],
        "size": row["size"],
        "sha256": row["sha256"][:16],
        "ocr_status": row["ocr_status"],
        "ocr_engine": row["ocr_engine"],
        "ocr_error": row["ocr_error"],
        "text_length": len(row["ocr_text"] or ""),
        "uploaded_at": row["uploaded_at"],
        "item_total": counts["total"],
        "item_pending": counts["pending"],
        "item_confirmed": counts["confirmed"],
    }


def item_out(row):
    return {
        "id": row["id"],
        "version_id": row["version_id"],
        "kind": row["kind"],
        "title": row["title"],
        "raw_text": row["raw_text"],
        "parsed_date": row["parsed_date"],
        "parsed_amount": row["parsed_amount"],
        "confidence": row["confidence"],
        "confirmed": bool(row["confirmed"]),
        "dismissed": bool(row["dismissed"]),
        "created_at": row["created_at"],
    }


def _item_counts(version_ids):
    if not version_ids:
        return {}
    marks = ",".join("?" * len(version_ids))
    rows = db.get_conn().execute(
        "SELECT version_id, COUNT(*) AS total,"
        " SUM(CASE WHEN confirmed=0 AND dismissed=0 THEN 1 ELSE 0 END) AS pending,"
        " SUM(CASE WHEN confirmed=1 THEN 1 ELSE 0 END) AS confirmed"
        " FROM contract_items WHERE version_id IN (%s) GROUP BY version_id" % marks,
        list(version_ids),
    ).fetchall()
    return {
        r["version_id"]: {
            "total": r["total"], "pending": r["pending"] or 0,
            "confirmed": r["confirmed"] or 0,
        }
        for r in rows
    }


# ── 合同 ────────────────────────────────────────────────────


@router.get("")
def list_contracts(session=Depends(require_pi)):
    conn = db.get_conn()
    contracts = conn.execute(
        "SELECT * FROM contracts WHERE deleted=0 ORDER BY updated_at DESC"
    ).fetchall()
    versions = conn.execute(
        "SELECT v.* FROM contract_versions v"
        " JOIN contracts c ON c.id = v.contract_id AND c.deleted = 0"
        " ORDER BY v.contract_id, v.version_no DESC"
    ).fetchall()
    counts = _item_counts([v["id"] for v in versions])
    grouped = {}
    for v in versions:
        grouped.setdefault(v["contract_id"], []).append(version_out(v, counts))
    return {
        "contracts": [contract_out(c, grouped.get(c["id"], [])) for c in contracts],
        "ocr": ocr.status(),
    }


@router.post("")
def create_contract(body: ContractIn, request: Request, session=Depends(require_pi)):
    exists = db.get_conn().execute(
        "SELECT 1 FROM records WHERE collection='industryProjects' AND id=? AND deleted=0",
        (body.project_id,),
    ).fetchone()
    if not exists:
        raise HTTPException(404, "横向课题不存在。")
    cid = new_id("ct")
    now = auth.now_iso()
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO contracts(id, project_id, title, counterparty, created_by,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (cid, body.project_id, body.title, body.counterparty,
             session["user_id"], now, now),
        )
    auth.audit(session["user_id"], "contract.create", target=cid, ip=client_ip(request))
    row = db.get_conn().execute("SELECT * FROM contracts WHERE id=?", (cid,)).fetchone()
    return {"contract": contract_out(row)}


@router.delete("/{contract_id}")
def delete_contract(contract_id: str, request: Request, session=Depends(require_pi)):
    with db.tx() as conn:
        conn.execute(
            "UPDATE contracts SET deleted=1, updated_at=? WHERE id=?",
            (auth.now_iso(), contract_id),
        )
    auth.audit(session["user_id"], "contract.delete", target=contract_id,
               ip=client_ip(request))
    return {"ok": True}


# ── 版本上传与解析 ──────────────────────────────────────────


@router.post("/{contract_id}/versions")
async def upload_version(
    contract_id: str,
    request: Request,
    file: UploadFile = File(...),
    version_note: str = Form(default=""),
    session=Depends(require_pi),
):
    contract = db.get_conn().execute(
        "SELECT * FROM contracts WHERE id=? AND deleted=0", (contract_id,)
    ).fetchone()
    if contract is None:
        raise HTTPException(404, "合同不存在。")

    ext = _ext(file.filename)
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "不支持这种文件类型：%s" % (ext or "未知"))

    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "文件超过 30MB。")
    if not data:
        raise HTTPException(400, "文件是空的。")

    digest = hashlib.sha256(data).hexdigest()
    same = db.get_conn().execute(
        "SELECT version_no FROM contract_versions WHERE contract_id=? AND sha256=?",
        (contract_id, digest),
    ).fetchone()
    if same:
        raise HTTPException(
            409, "这个文件和第 %d 版内容完全一致，没有重复上传的必要。" % same["version_no"]
        )

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    version_id = new_id("cv")
    # 存盘名不用原始文件名——原名可能含路径分隔符或奇怪字符
    stored = os.path.join(UPLOAD_DIR, "%s%s" % (version_id, ext))
    with open(stored, "wb") as fh:
        fh.write(data)
    os.chmod(stored, 0o600)

    next_no = (db.get_conn().execute(
        "SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM contract_versions"
        " WHERE contract_id=?", (contract_id,)
    ).fetchone()["n"])

    now = auth.now_iso()
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO contract_versions(id, contract_id, version_no, version_note,"
            " filename, stored_path, sha256, size, mime, ocr_status, uploaded_by,"
            " uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)",
            (version_id, contract_id, next_no, version_note[:300],
             (file.filename or "")[:300], stored, digest, len(data),
             file.content_type or "", session["user_id"], now),
        )
        conn.execute(
            "UPDATE contracts SET current_version_id=?, updated_at=? WHERE id=?",
            (version_id, now, contract_id),
        )
    auth.audit(session["user_id"], "contract.upload",
               target="%s/v%d" % (contract_id, next_no), ip=client_ip(request))

    result = parse_version(version_id)
    row = db.get_conn().execute(
        "SELECT * FROM contract_versions WHERE id=?", (version_id,)
    ).fetchone()
    return {
        "version": version_out(row, _item_counts([version_id])),
        "parse": result,
    }


def parse_version(version_id):
    """先试文本层，取不到再试 OCR，最后抽候选条目。

    返回结果里明确区分三种情况：抽到了、是扫描件但 OCR 不可用、
    识别失败。前端要据此给出不同提示，不能一律显示"没有找到日期"。
    """
    row = db.get_conn().execute(
        "SELECT * FROM contract_versions WHERE id=?", (version_id,)
    ).fetchone()
    if row is None:
        return {"status": "failed", "error": "版本不存在。"}

    with db.tx() as conn:
        conn.execute(
            "UPDATE contract_versions SET ocr_status='running' WHERE id=?",
            (version_id,),
        )

    text, parser = extract.text_from_file(row["stored_path"], row["filename"])
    engine, error, status = parser, "", "done"

    if not text.strip():
        # 没有文本层 —— 扫描件或拍照件，交给 OCR
        text, engine, error = ocr.ocr_file(row["stored_path"], row["filename"])
        if error:
            status = "no_text"
        elif text.strip():
            status = "done"
        else:
            status = "no_text"
            error = "没有从文件里读到任何文字。"

    items = extract.find_items(text) if text.strip() else []
    now = auth.now_iso()
    with db.tx() as conn:
        conn.execute(
            "UPDATE contract_versions SET ocr_status=?, ocr_engine=?, ocr_error=?,"
            " ocr_text=? WHERE id=?",
            (status, engine, error[:500], text[:400000], version_id),
        )
        # 重新解析时清掉上一轮还没处理的候选，已确认/已忽略的保留
        conn.execute(
            "DELETE FROM contract_items WHERE version_id=? AND confirmed=0"
            " AND dismissed=0",
            (version_id,),
        )
        for item in items:
            conn.execute(
                "INSERT INTO contract_items(id, version_id, kind, title, raw_text,"
                " parsed_date, parsed_amount, confidence, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (new_id("ci"), version_id, item["kind"], item["title"],
                 item["raw_text"], item["parsed_date"], item["parsed_amount"],
                 item["confidence"], now),
            )
    return {
        "status": status,
        "engine": engine,
        "error": error,
        "text_length": len(text),
        "item_count": len(items),
    }


@router.post("/versions/{version_id}/reparse")
def reparse(version_id: str, session=Depends(require_pi)):
    return {"parse": parse_version(version_id)}


@router.get("/versions/{version_id}/items")
def list_items(version_id: str, session=Depends(require_pi)):
    row = db.get_conn().execute(
        "SELECT * FROM contract_versions WHERE id=?", (version_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "版本不存在。")
    items = db.get_conn().execute(
        "SELECT * FROM contract_items WHERE version_id=?"
        " ORDER BY dismissed, confirmed DESC, confidence DESC",
        (version_id,),
    ).fetchall()
    return {
        "version": version_out(row, _item_counts([version_id])),
        "items": [item_out(i) for i in items],
        "ocr_error": row["ocr_error"],
        "ocr_status": row["ocr_status"],
    }


@router.get("/versions/{version_id}/text")
def version_text(version_id: str, session=Depends(require_pi)):
    """给导师核对用的原文。合同正文不下发给任何学生账号。"""
    row = db.get_conn().execute(
        "SELECT ocr_text, filename FROM contract_versions WHERE id=?", (version_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "版本不存在。")
    return {"filename": row["filename"], "text": row["ocr_text"]}


@router.patch("/items/{item_id}")
def patch_item(
    item_id: str, body: ContractItemPatch, request: Request, session=Depends(require_pi)
):
    """确认一个候选条目。确认为日期类时，顺带生成一条带倒数日的待办。"""
    row = db.get_conn().execute(
        "SELECT ci.*, cv.contract_id FROM contract_items ci"
        " JOIN contract_versions cv ON cv.id = ci.version_id WHERE ci.id=?",
        (item_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "条目不存在。")

    changes = {}
    if body.title is not None:
        changes["title"] = body.title
    if body.parsed_date is not None:
        changes["parsed_date"] = body.parsed_date
    if body.dismissed is not None:
        changes["dismissed"] = 1 if body.dismissed else 0
        if body.dismissed:
            changes["confirmed"] = 0
    if body.confirmed is not None:
        changes["confirmed"] = 1 if body.confirmed else 0
        if body.confirmed:
            changes["dismissed"] = 0
            changes["confirmed_by"] = session["user_id"]
            changes["confirmed_at"] = auth.now_iso()

    if changes:
        sets = ", ".join("%s=?" % k for k in changes)
        with db.tx() as conn:
            conn.execute(
                "UPDATE contract_items SET %s WHERE id=?" % sets,
                list(changes.values()) + [item_id],
            )

    updated = db.get_conn().execute(
        "SELECT * FROM contract_items WHERE id=?", (item_id,)
    ).fetchone()

    todo_id = None
    if updated["confirmed"] and updated["kind"] == "date" and updated["parsed_date"]:
        todo_id = _sync_todo(updated, row["contract_id"], session["user_id"],
                             body.remind_days_before)
    elif not updated["confirmed"]:
        # 取消确认就把自动生成的待办一并撤掉，避免留下孤儿提醒
        with db.tx() as conn:
            conn.execute(
                "UPDATE todos SET deleted=1, updated_at=? WHERE source='contract'"
                " AND source_id=?", (auth.now_iso(), item_id),
            )

    return {"item": item_out(updated), "todo_id": todo_id}


def _sync_todo(item, contract_id, user_id, remind_days):
    """确认过的日期条目 -> 待办。同一条目重复确认是更新而不是新建。"""
    contract = db.get_conn().execute(
        "SELECT project_id, title FROM contracts WHERE id=?", (contract_id,)
    ).fetchone()
    now = auth.now_iso()
    existing = db.get_conn().execute(
        "SELECT id FROM todos WHERE source='contract' AND source_id=?", (item["id"],)
    ).fetchone()
    todo_id = existing["id"] if existing else new_id("td")
    title = item["title"][:300] or "合同节点"
    with db.tx() as conn:
        if existing:
            conn.execute(
                "UPDATE todos SET title=?, due_date=?, remind_days_before=COALESCE(?,"
                " remind_days_before), deleted=0, updated_at=? WHERE id=?",
                (title, item["parsed_date"], remind_days, now, todo_id),
            )
        else:
            conn.execute(
                "INSERT INTO todos(id, source, source_id, title, detail, project_id,"
                " due_date, remind_days_before, created_by, created_at, updated_at)"
                " VALUES (?, 'contract', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (todo_id, item["id"], title, item["raw_text"][:2000],
                 contract["project_id"] if contract else None,
                 item["parsed_date"], remind_days if remind_days is not None else 7,
                 user_id, now, now),
            )
    return todo_id
