"""FastAPI 依赖：会话、CSRF、角色与学生数据范围。

单独成一个模块，好让 routes/ 下的路由和 app.py 都能引用，
不用互相 import 造成环。
"""

import os

from fastapi import Depends, Header, HTTPException, Request

import auth
import db

COOKIE = "lb_session"
# 本地 http 调试时置 0；公网必须为 1，否则会话 Cookie 会明文过网络
SECURE_COOKIE = os.environ.get("LAB_BENCH_SECURE_COOKIE", "1") != "0"


def has_admin():
    row = db.get_conn().execute(
        "SELECT 1 FROM users WHERE role = 'pi' AND active = 1 LIMIT 1"
    ).fetchone()
    return row is not None


def client_ip(request: Request):
    # nginx 反代后真实 IP 在 X-Forwarded-For 里，取最左一跳
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else ""


def current_session(request: Request):
    if not has_admin():
        raise HTTPException(503, "系统尚未初始化，请先创建管理员账号。")
    session = auth.load_session(request.cookies.get(COOKIE))
    if session is None:
        raise HTTPException(401, "未登录或会话已过期。")
    return session


def require_csrf(
    request: Request,
    session=Depends(current_session),
    x_csrf_token: str = Header(default=""),
):
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return session
    if not auth.check_csrf(session, x_csrf_token):
        raise HTTPException(403, "CSRF 校验失败，请刷新页面后重试。")
    return session


def require_pi(session=Depends(require_csrf)):
    if session["role"] != "pi":
        raise HTTPException(403, "只有导师账号可以执行这个操作。")
    return session


def student_scope(session):
    """学生返回自己绑定的 student_id；导师返回 None，表示不设限。"""
    if session["role"] == "pi":
        return None
    if not session["student_id"]:
        raise HTTPException(403, "该学生账号还没有绑定学生档案，请联系导师。")
    return session["student_id"]


def resolve_target_student(session, requested):
    """决定这次操作作用在哪个学生身上。

    学生：只能是自己，请求里写别人直接拒绝。
    导师：必须显式指定，且该学生档案要存在。
    """
    scope = student_scope(session)
    if scope is not None:
        if requested and requested != scope:
            raise HTTPException(403, "只能操作自己的内容。")
        return scope
    if not requested:
        raise HTTPException(400, "需要指定 student_id。")
    exists = db.get_conn().execute(
        "SELECT 1 FROM records WHERE collection='students' AND id=? AND deleted=0",
        (requested,),
    ).fetchone()
    if not exists:
        raise HTTPException(404, "学生档案不存在。")
    return requested


def assert_can_read_student(session, student_id):
    scope = student_scope(session)
    if scope is not None and scope != student_id:
        raise HTTPException(403, "没有权限查看该学生的内容。")
