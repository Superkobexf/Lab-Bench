"""FastAPI 主体：安全响应头、会话依赖、账号与既有业务数据的接口。

公网部署下的几个硬性选择：
  * 绝不内置默认账号。没有管理员时接口直接拒绝服务，
    必须先跑 `python manage.py createadmin` 建第一个账号。
  * 会话 Cookie 走 HttpOnly + SameSite=Lax，改数据的请求另外校验 CSRF 头。
  * CSP 由服务端下发，比 <meta> 版本多管住 frame-ancestors。
"""

import json
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse

import auth
import db
from deps import (
    COOKIE,
    SECURE_COOKIE,
    client_ip,
    current_session,
    has_admin,
    require_csrf,
    require_pi,
    student_scope,
)
from models import (
    LoginIn,
    PasswordChangeIn,
    RecordIn,
    SettingsIn,
    UserCreateIn,
    UserUpdateIn,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    # app.js 的模板里有 24 处内联 style=，这个让步暂时去不掉
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self'; "
    "connect-src 'self' https://api.openalex.org https://api.crossref.org "
    "https://www.ebi.ac.uk; "
    "object-src 'none'; base-uri 'none'; form-action 'self'; "
    "frame-ancestors 'none'"
)


@asynccontextmanager
async def lifespan(_app):
    db.init_db()
    auth.purge_expired_sessions()
    if not has_admin():
        print(
            "\n[!] 还没有任何管理员账号，接口会拒绝服务。\n"
            "    先运行： python server/manage.py createadmin\n"
        )
    yield


app = FastAPI(title="Lab Bench", lifespan=lifespan, docs_url=None, redoc_url=None)

from routes import contracts, files, studentwork, todos, trash  # noqa: E402  (放在 app 之后避免循环导入)

app.include_router(studentwork.router)
app.include_router(contracts.router)
app.include_router(todos.router)
app.include_router(trash.router)
app.include_router(files.router)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if SECURE_COOKIE:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response


# ── 登录 ────────────────────────────────────────────────────


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, response: Response):
    if not has_admin():
        raise HTTPException(503, "系统尚未初始化，请先创建管理员账号。")
    ip = client_ip(request)
    user, error = auth.authenticate(body.username, body.password, ip=ip)
    if user is None:
        auth.audit(None, "login.fail", target=body.username[:64], ip=ip)
        raise HTTPException(401, error)
    token, csrf = auth.create_session(
        user["id"], ip=ip, user_agent=request.headers.get("user-agent", "")
    )
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=SECURE_COOKIE,
        samesite="lax",
        max_age=int(auth.SESSION_TTL.total_seconds()),
        path="/",
    )
    auth.audit(user["id"], "login.ok", ip=ip)
    return {
        "user": public_user(user),
        "csrf_token": csrf,
        "must_change_password": bool(user["must_change"]),
    }


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    session = auth.load_session(token)
    if session:
        auth.audit(session["user_id"], "logout", ip=client_ip(request))
    auth.destroy_session(token)
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(session=Depends(current_session)):
    return {
        "user": {
            "id": session["user_id"],
            "username": session["username"],
            "display_name": session["display_name"],
            "role": session["role"],
            "student_id": session["student_id"],
        },
        "csrf_token": session["csrf_token"],
        "must_change_password": bool(session["must_change"]),
    }


@app.post("/api/auth/password")
def change_password(
    body: PasswordChangeIn, request: Request, session=Depends(require_csrf)
):
    row = db.get_conn().execute(
        "SELECT * FROM users WHERE id = ?", (session["user_id"],)
    ).fetchone()
    if not auth.verify_password(body.old_password, row["password_hash"], row["hash_algo"]):
        raise HTTPException(400, "原口令不正确。")
    problem = auth.password_problem(body.new_password)
    if problem:
        raise HTTPException(400, problem)
    new_hash, algo = auth.hash_password(body.new_password)
    with db.tx() as conn:
        conn.execute(
            "UPDATE users SET password_hash=?, hash_algo=?, must_change=0, updated_at=?"
            " WHERE id=?",
            (new_hash, algo, auth.now_iso(), session["user_id"]),
        )
    # 改完密码把其它会话全踢掉，只有当前这个继续有效
    auth.destroy_user_sessions(session["user_id"])
    auth.audit(session["user_id"], "password.change", ip=client_ip(request))
    return {"ok": True, "relogin_required": True}


def public_user(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "student_id": row["student_id"],
        "active": bool(row["active"]),
    }


# ── 账号管理（仅导师）──────────────────────────────────────


@app.get("/api/users")
def list_users(session=Depends(require_pi)):
    rows = db.get_conn().execute(
        "SELECT * FROM users ORDER BY role DESC, username"
    ).fetchall()
    return {"users": [public_user(r) for r in rows]}


@app.post("/api/users")
def create_user(body: UserCreateIn, request: Request, session=Depends(require_pi)):
    problem = auth.password_problem(body.password)
    if problem:
        raise HTTPException(400, problem)
    if body.role == "student" and not body.student_id:
        raise HTTPException(400, "学生账号必须绑定一条学生档案。")
    if body.student_id:
        exists = db.get_conn().execute(
            "SELECT 1 FROM records WHERE collection='students' AND id=? AND deleted=0",
            (body.student_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(400, "绑定的学生档案不存在。")
    pw_hash, algo = auth.hash_password(body.password)
    now = auth.now_iso()
    try:
        with db.tx() as conn:
            cur = conn.execute(
                "INSERT INTO users(username, display_name, role, student_id,"
                " password_hash, hash_algo, must_change, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,1,?,?)",
                (
                    body.username,
                    body.display_name or body.username,
                    body.role,
                    body.student_id,
                    pw_hash,
                    algo,
                    now,
                    now,
                ),
            )
            new_id = cur.lastrowid
    except Exception:
        raise HTTPException(400, "用户名已被占用。")
    auth.audit(session["user_id"], "user.create", target=body.username, ip=client_ip(request))
    row = db.get_conn().execute("SELECT * FROM users WHERE id=?", (new_id,)).fetchone()
    return {"user": public_user(row)}


@app.patch("/api/users/{user_id}")
def update_user(
    user_id: int, body: UserUpdateIn, request: Request, session=Depends(require_pi)
):
    row = db.get_conn().execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "账号不存在。")
    fields, values = [], []
    if body.display_name is not None:
        fields.append("display_name=?"); values.append(body.display_name)
    if body.student_id is not None:
        fields.append("student_id=?"); values.append(body.student_id or None)
    if body.active is not None:
        if row["role"] == "pi" and not body.active:
            others = db.get_conn().execute(
                "SELECT COUNT(*) FROM users WHERE role='pi' AND active=1 AND id<>?",
                (user_id,),
            ).fetchone()[0]
            if others == 0:
                raise HTTPException(400, "不能停用最后一个导师账号。")
        fields.append("active=?"); values.append(1 if body.active else 0)
    if body.new_password:
        problem = auth.password_problem(body.new_password)
        if problem:
            raise HTTPException(400, problem)
        pw_hash, algo = auth.hash_password(body.new_password)
        fields += ["password_hash=?", "hash_algo=?", "must_change=1"]
        values += [pw_hash, algo]
    if not fields:
        return {"user": public_user(row)}
    values.append(auth.now_iso()); values.append(user_id)
    with db.tx() as conn:
        conn.execute(
            "UPDATE users SET %s, updated_at=? WHERE id=?" % ", ".join(fields), values
        )
    if body.new_password or body.active is False:
        auth.destroy_user_sessions(user_id)
    auth.audit(session["user_id"], "user.update", target=row["username"], ip=client_ip(request))
    updated = db.get_conn().execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return {"user": public_user(updated)}


# ── 既有业务数据 ────────────────────────────────────────────


@app.get("/api/state")
def get_state(session=Depends(current_session)):
    """返回前端认识的那个 state 对象。学生只拿到自己的数据。"""
    scope = student_scope(session)
    conn = db.get_conn()
    state = {c: [] for c in db.COLLECTIONS}
    if scope is None:
        rows = conn.execute(
            "SELECT * FROM records WHERE deleted=0 ORDER BY collection, id"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM records WHERE deleted=0 AND"
            " (student_id = ? OR (collection='students' AND id = ?))"
            " ORDER BY collection, id",
            (scope, scope),
        ).fetchall()
    for row in rows:
        if row["collection"] in state:
            state[row["collection"]].append(db.load_payload(row))
    settings = {}
    for row in conn.execute("SELECT key, value FROM settings").fetchall():
        settings[row["key"]] = json.loads(row["value"])
    state["settings"] = settings
    return {"state": state, "role": session["role"], "student_id": session["student_id"]}


def _student_of(collection, payload, fallback=None):
    """决定一条记录归属哪个学生，用于学生端可见性和写权限判定。"""
    if collection == "students":
        return fallback
    value = payload.get("studentId")
    return value if isinstance(value, str) and value else None


@app.put("/api/records/{collection}/{record_id}")
def put_record(
    collection: str,
    record_id: str,
    body: RecordIn,
    request: Request,
    session=Depends(require_csrf),
):
    if collection not in db.COLLECTIONS:
        raise HTTPException(404, "未知的数据集合。")
    if len(record_id) > 64 or not record_id:
        raise HTTPException(400, "记录 id 不合法。")
    scope = student_scope(session)
    owner = _student_of(collection, body.payload, fallback=record_id)
    if scope is not None:
        # 学生可以维护自己的周进展和科研自动化流程；其余集合一律只读
        if collection not in {"weeklyLogs", "automationPipelines"}:
            raise HTTPException(403, "没有权限修改这条记录。")
        # 归属必须以库里已有的那条为准。只看请求体里声称的 studentId，
        # 学生就能 PUT 到别人的记录 id 上、把 studentId 填成自己，
        # 从而覆盖掉别人的周进展。
        existing = db.get_conn().execute(
            "SELECT student_id FROM records WHERE collection=? AND id=?",
            (collection, record_id),
        ).fetchone()
        if existing is not None and existing["student_id"] != scope:
            raise HTTPException(403, "没有权限修改这条记录。")
        # 也不能把新记录挂到别人名下
        if owner != scope:
            raise HTTPException(403, "只能提交自己的记录。")
    payload = dict(body.payload)
    payload.pop("id", None)
    now = auth.now_iso()
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO records(collection, id, student_id, payload, deleted,"
            " updated_at, updated_by) VALUES (?,?,?,?,0,?,?)"
            " ON CONFLICT(collection, id) DO UPDATE SET"
            " student_id=excluded.student_id, payload=excluded.payload,"
            " deleted=0, updated_at=excluded.updated_at,"
            " updated_by=excluded.updated_by",
            (collection, record_id, owner, json.dumps(payload, ensure_ascii=False),
             now, session["user_id"]),
        )
    return {"ok": True, "id": record_id, "updated_at": now}


@app.delete("/api/records/{collection}/{record_id}")
def delete_record(
    collection: str, record_id: str, request: Request, session=Depends(require_pi)
):
    if collection not in db.COLLECTIONS:
        raise HTTPException(404, "未知的数据集合。")
    with db.tx() as conn:
        conn.execute(
            "UPDATE records SET deleted=1, updated_at=?, updated_by=?"
            " WHERE collection=? AND id=?",
            (auth.now_iso(), session["user_id"], collection, record_id),
        )
    auth.audit(
        session["user_id"], "record.delete", target="%s/%s" % (collection, record_id),
        ip=client_ip(request),
    )
    return {"ok": True}


@app.put("/api/settings")
def put_settings(body: SettingsIn, session=Depends(require_pi)):
    now = auth.now_iso()
    with db.tx() as conn:
        for key, value in body.model_dump(exclude_none=True).items():
            conn.execute(
                "INSERT INTO settings(key, value, updated_at) VALUES (?,?,?)"
                " ON CONFLICT(key) DO UPDATE SET value=excluded.value,"
                " updated_at=excluded.updated_at",
                (key, json.dumps(value), now),
            )
    return {"ok": True}


@app.post("/api/import")
async def import_backup(request: Request, session=Depends(require_pi)):
    """灌入旧的备份 JSON。形状沿用前端导出格式，兼容缺字段的老备份。"""
    raw = await request.body()
    if len(raw) > 40 * 1024 * 1024:
        raise HTTPException(413, "备份文件过大。")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "不是有效的 JSON 备份。")
    if not isinstance(data, dict):
        raise HTTPException(400, "备份内容必须是一个 JSON 对象。")

    now = auth.now_iso()
    counts = {}
    with db.tx() as conn:
        for collection in db.COLLECTIONS:
            items = data.get(collection)
            if not isinstance(items, list):
                continue
            kept = 0
            for item in items:
                if not isinstance(item, dict):
                    continue
                record_id = item.get("id")
                if not isinstance(record_id, str) or not record_id or len(record_id) > 64:
                    continue
                try:
                    RecordIn(id=record_id, payload={k: v for k, v in item.items() if k != "id"})
                except Exception:
                    continue  # 单条不合法就跳过，不让整份备份失败
                payload = {k: v for k, v in item.items() if k != "id"}
                conn.execute(
                    "INSERT INTO records(collection, id, student_id, payload, deleted,"
                    " updated_at, updated_by) VALUES (?,?,?,?,0,?,?)"
                    " ON CONFLICT(collection, id) DO UPDATE SET"
                    " student_id=excluded.student_id, payload=excluded.payload,"
                    " deleted=0, updated_at=excluded.updated_at,"
                    " updated_by=excluded.updated_by",
                    (collection, record_id,
                     _student_of(collection, payload, fallback=record_id),
                     json.dumps(payload, ensure_ascii=False), now, session["user_id"]),
                )
                kept += 1
            counts[collection] = kept
        incoming = data.get("settings")
        if isinstance(incoming, dict):
            for key, value in incoming.items():
                if isinstance(key, str) and len(key) <= 64:
                    conn.execute(
                        "INSERT INTO settings(key, value, updated_at) VALUES (?,?,?)"
                        " ON CONFLICT(key) DO UPDATE SET value=excluded.value,"
                        " updated_at=excluded.updated_at",
                        (key, json.dumps(value, ensure_ascii=False), now),
                    )
    auth.audit(session["user_id"], "import", detail=json.dumps(counts), ip=client_ip(request))
    return {"ok": True, "imported": counts}


@app.get("/api/audit")
def audit_log(
    limit: int = 100,
    action: str = "",
    session=Depends(require_pi),
):
    """审计日志。多人写入之后，"谁在什么时候改了什么"是个真问题。

    只给导师看：里面有用户名、IP 和操作目标。
    """
    limit = max(1, min(int(limit or 100), 500))
    sql = (
        "SELECT a.*, u.username, u.display_name, u.role"
        " FROM audit_log a LEFT JOIN users u ON u.id = a.user_id"
    )
    args = []
    if action:
        sql += " WHERE a.action LIKE ?"
        args.append(action[:40] + "%")
    sql += " ORDER BY a.id DESC LIMIT ?"
    args.append(limit)
    rows = db.get_conn().execute(sql, args).fetchall()
    return {
        "entries": [
            {
                "id": r["id"],
                "action": r["action"],
                "target": r["target"],
                "detail": r["detail"],
                "ip": r["ip"],
                "created_at": r["created_at"],
                "username": r["username"] or "（已删除账号）",
                "display_name": r["display_name"] or "",
                "role": r["role"] or "",
            }
            for r in rows
        ]
    }


@app.get("/api/export")
def export_backup(session=Depends(require_pi)):
    conn = db.get_conn()
    out = {c: [] for c in db.COLLECTIONS}
    for row in conn.execute("SELECT * FROM records WHERE deleted=0").fetchall():
        if row["collection"] in out:
            out[row["collection"]].append(db.load_payload(row))
    out["settings"] = {
        r["key"]: json.loads(r["value"])
        for r in conn.execute("SELECT key, value FROM settings").fetchall()
    }
    return JSONResponse(out, headers={
        "Content-Disposition": 'attachment; filename="lab-bench-backup.json"'
    })


@app.exception_handler(HTTPException)
async def http_error(_request, exc):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


# ── 静态文件（生产环境交给 nginx，这里是开发用）────────────


@app.get("/")
def index():
    return FileResponse(os.path.join(ROOT, "index.html"))


@app.get("/{filename}")
def static_root(filename: str):
    """开发用：直接吐根目录下的前端文件。生产环境由 nginx 接管，
    不会走到这里。"""
    if filename not in ("app.js", "api.js", "i18n.js", "theme.js", "styles.css", "favicon.ico"):
        raise HTTPException(404, "Not found")
    path = os.path.join(ROOT, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Not found")
    return FileResponse(path)
