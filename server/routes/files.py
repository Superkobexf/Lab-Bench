"""文件存储：机制图、周报附件、成果证明的真身。

以前只存文件名和文本摘要，是 localStorage 容量逼出来的妥协；
有了自己的服务器就没必要继续。

两条安全线，都不能省：

1. **内联只给图片。** 任何能被浏览器当 HTML 解析的东西，一旦从本域
   内联返回，就等于在应用的 origin 里执行脚本——会话 Cookie 直接被拿走。
   所以 image 之外的一律 Content-Disposition: attachment 强制下载。
   SVG 也不算图片：它能带 <script>，内联等于自杀。

2. **响应的 Content-Type 由服务端按后缀决定，不信客户端报的 mime。**
   浏览器嗅探已经被 nosniff 关掉，但类型本身也不能让上传方说了算。
"""

import hashlib
import os
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

import auth
import db
from deps import client_ip, current_session, require_csrf, student_scope

router = APIRouter(prefix="/api/files", tags=["files"])

UPLOAD_DIR = os.environ.get(
    "LAB_BENCH_UPLOADS",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads"),
)

MAX_IMAGE = 8 * 1024 * 1024
MAX_DOC = 30 * 1024 * 1024

# 只有这几种才内联显示。注意没有 svg——它能带脚本。
IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

DOC_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".zip": "application/zip",
    ".svg": "image/svg+xml",  # 收得下，但只当附件下载，绝不内联
}


def new_id():
    return "f_%s" % secrets.token_hex(10)


def _ext(filename):
    return os.path.splitext(filename or "")[1].lower()


def file_out(row):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "filename": row["filename"],
        "mime": row["mime"],
        "size": row["size"],
        "student_id": row["student_id"],
        "created_at": row["created_at"],
        "url": "/api/files/%s" % row["id"],
    }


@router.post("")
async def upload(
    request: Request,
    file: UploadFile = File(...),
    student_id: str = Form(default=""),
    session=Depends(require_csrf),
):
    ext = _ext(file.filename)
    if ext in IMAGE_TYPES:
        kind, mime, limit = "image", IMAGE_TYPES[ext], MAX_IMAGE
    elif ext in DOC_TYPES:
        kind, mime, limit = "doc", DOC_TYPES[ext], MAX_DOC
    else:
        raise HTTPException(400, "不支持这种文件类型：%s" % (ext or "未知"))

    data = await file.read()
    if not data:
        raise HTTPException(400, "文件是空的。")
    if len(data) > limit:
        raise HTTPException(413, "文件超过 %d MB。" % (limit // 1024 // 1024))

    # 学生只能把文件挂在自己名下；导师可以指定归属，也可以不指定
    scope = student_scope(session)
    if scope is not None:
        owner = scope
    else:
        owner = student_id or None
        if owner:
            exists = db.get_conn().execute(
                "SELECT 1 FROM records WHERE collection='students' AND id=? AND deleted=0",
                (owner,),
            ).fetchone()
            if not exists:
                raise HTTPException(404, "学生档案不存在。")

    digest = hashlib.sha256(data).hexdigest()
    file_id = new_id()
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    # 存盘名用自己生成的 id：原始文件名可能带路径分隔符或奇怪字符
    stored = os.path.join(UPLOAD_DIR, "%s%s" % (file_id, ext))
    with open(stored, "wb") as fh:
        fh.write(data)
    os.chmod(stored, 0o600)

    now = auth.now_iso()
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO files(id, kind, filename, stored_path, mime, size, sha256,"
            " student_id, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (file_id, kind, (file.filename or "")[:300], stored, mime, len(data),
             digest, owner, session["user_id"], now),
        )
    auth.audit(session["user_id"], "file.upload", target=file_id,
               detail=(file.filename or "")[:200], ip=client_ip(request))
    row = db.get_conn().execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone()
    return {"file": file_out(row)}


def _load(file_id, session):
    row = db.get_conn().execute(
        "SELECT * FROM files WHERE id=? AND deleted=0", (file_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "文件不存在。")
    scope = student_scope(session)
    # 学生只能取自己名下的；没有归属的文件（导师上传的通用素材）也允许读，
    # 否则学生看不到导师放的机制图。
    if scope is not None and row["student_id"] not in (None, "", scope):
        raise HTTPException(403, "没有权限访问这个文件。")
    return row


@router.get("/{file_id}")
def download(file_id: str, session=Depends(current_session)):
    row = _load(file_id, session)
    if not os.path.isfile(row["stored_path"]):
        raise HTTPException(410, "文件已经不在服务器上了。")

    # 只有真正的图片才内联；其余一律强制下载。
    # 这一行是安全边界，不要为了"预览 PDF 方便"改成 inline。
    if row["kind"] == "image":
        disposition = "inline"
    else:
        disposition = "attachment"

    return FileResponse(
        row["stored_path"],
        media_type=row["mime"],
        headers={
            "Content-Disposition": '%s; filename*=UTF-8\'\'%s' % (
                disposition,
                _percent_encode(row["filename"]),
            ),
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _percent_encode(name):
    from urllib.parse import quote

    return quote(name or "file", safe="")


@router.delete("/{file_id}")
def remove(file_id: str, request: Request, session=Depends(require_csrf)):
    row = _load(file_id, session)
    scope = student_scope(session)
    if scope is not None and row["uploaded_by"] != session["user_id"]:
        raise HTTPException(403, "只能删除自己上传的文件。")
    with db.tx() as conn:
        conn.execute(
            "UPDATE files SET deleted=1 WHERE id=?", (file_id,)
        )
    auth.audit(session["user_id"], "file.delete", target=file_id, ip=client_ip(request))
    return {"ok": True}


@router.get("")
def list_files(session=Depends(current_session)):
    scope = student_scope(session)
    conn = db.get_conn()
    if scope is None:
        rows = conn.execute(
            "SELECT * FROM files WHERE deleted=0 ORDER BY created_at DESC LIMIT 500"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM files WHERE deleted=0 AND (student_id=? OR student_id IS NULL)"
            " ORDER BY created_at DESC LIMIT 500",
            (scope,),
        ).fetchall()
    return {"files": [file_out(r) for r in rows]}
