"""待办与倒数日。

倒数日不是一套独立机制：待办有 due_date，接口按到期远近算出天数
和紧急程度，前端把它喂给已有的 getIssues()，就自动出现在总览
和提醒里，不用另造一个提醒系统。

学生能看到派给自己的待办；合同类待办只有导师可见——
它们来自合同正文，可能带金额和保密条款。
"""

import datetime
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, Request

import auth
import db
from deps import client_ip, current_session, require_csrf, student_scope
from models import TodoIn, TodoPatch

router = APIRouter(prefix="/api/todos", tags=["todos"])


def new_id(prefix):
    return "%s_%s" % (prefix, secrets.token_hex(8))


def _today():
    return datetime.date.today()


def _days_until(due_date):
    """返回距离到期还有几天。已过期为负数；日期无效返回 None。"""
    if not due_date:
        return None
    try:
        return (datetime.date.fromisoformat(due_date) - _today()).days
    except ValueError:
        return None


def _level(days, remind_days):
    """紧急程度。和前端 getIssues() 的 high / medium / low 对齐。"""
    if days is None:
        return "none"
    if days < 0:
        return "overdue"
    if days == 0:
        return "today"
    if days <= max(1, remind_days // 3):
        return "high"
    if days <= remind_days:
        return "medium"
    return "low"


def todo_out(row):
    days = _days_until(row["due_date"])
    remind = row["remind_days_before"]
    return {
        "id": row["id"],
        "source": row["source"],
        "source_id": row["source_id"],
        "title": row["title"],
        "detail": row["detail"],
        "student_id": row["student_id"],
        "project_id": row["project_id"],
        "due_date": row["due_date"],
        "remind_days_before": remind,
        "done": bool(row["done"]),
        "done_at": row["done_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        # 倒数日
        "days_until": days,
        "level": _level(days, remind),
        "in_reminder_window": days is not None and not row["done"] and days <= remind,
    }


@router.get("")
def list_todos(
    include_done: bool = Query(default=False),
    project_id: str = Query(default="", max_length=64),
    session=Depends(current_session),
):
    scope = student_scope(session)
    sql = "SELECT * FROM todos WHERE deleted=0"
    args = []
    if scope is not None:
        # 学生只看得到派给自己的，且永远看不到合同类待办
        sql += " AND student_id=? AND source<>'contract'"
        args.append(scope)
    if project_id:
        sql += " AND project_id=?"
        args.append(project_id)
    if not include_done:
        sql += " AND done=0"
    # 有到期日的排前面，按到期日升序；没到期日的垫底
    sql += " ORDER BY done, CASE WHEN due_date='' THEN 1 ELSE 0 END, due_date, created_at"
    rows = db.get_conn().execute(sql, args).fetchall()
    todos = [todo_out(r) for r in rows]
    return {
        "todos": todos,
        "counts": {
            "overdue": sum(1 for t in todos if t["level"] == "overdue"),
            "today": sum(1 for t in todos if t["level"] == "today"),
            "upcoming": sum(1 for t in todos if t["level"] in ("high", "medium")),
        },
    }


@router.post("")
def create_todo(body: TodoIn, request: Request, session=Depends(require_csrf)):
    scope = student_scope(session)
    student_id = body.student_id
    if scope is not None:
        # 学生只能给自己建待办
        if student_id and student_id != scope:
            raise HTTPException(403, "只能给自己创建待办。")
        student_id = scope
    elif student_id:
        exists = db.get_conn().execute(
            "SELECT 1 FROM records WHERE collection='students' AND id=? AND deleted=0",
            (student_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(404, "学生档案不存在。")
    if body.due_date and _days_until(body.due_date) is None:
        raise HTTPException(400, "到期日格式不对，应为 YYYY-MM-DD。")

    todo_id = new_id("td")
    now = auth.now_iso()
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO todos(id, source, title, detail, student_id, project_id,"
            " due_date, remind_days_before, created_by, created_at, updated_at)"
            " VALUES (?, 'manual', ?,?,?,?,?,?,?,?,?)",
            (todo_id, body.title, body.detail, student_id, body.project_id,
             body.due_date, body.remind_days_before, session["user_id"], now, now),
        )
    row = db.get_conn().execute("SELECT * FROM todos WHERE id=?", (todo_id,)).fetchone()
    return {"todo": todo_out(row)}


def _load_todo(todo_id, session):
    row = db.get_conn().execute(
        "SELECT * FROM todos WHERE id=? AND deleted=0", (todo_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "待办不存在。")
    scope = student_scope(session)
    if scope is not None:
        if row["student_id"] != scope or row["source"] == "contract":
            raise HTTPException(403, "没有权限操作这条待办。")
    return row


@router.patch("/{todo_id}")
def update_todo(
    todo_id: str, body: TodoPatch, request: Request, session=Depends(require_csrf)
):
    row = _load_todo(todo_id, session)
    changes = {}
    if body.title is not None:
        changes["title"] = body.title
    if body.detail is not None:
        changes["detail"] = body.detail
    if body.due_date is not None:
        if body.due_date and _days_until(body.due_date) is None:
            raise HTTPException(400, "到期日格式不对，应为 YYYY-MM-DD。")
        changes["due_date"] = body.due_date
    if body.remind_days_before is not None:
        changes["remind_days_before"] = body.remind_days_before
    if body.done is not None:
        changes["done"] = 1 if body.done else 0
        changes["done_at"] = auth.now_iso() if body.done else None
    if not changes:
        return {"todo": todo_out(row)}
    sets = ", ".join("%s=?" % k for k in changes)
    with db.tx() as conn:
        conn.execute(
            "UPDATE todos SET %s, updated_at=? WHERE id=?" % sets,
            list(changes.values()) + [auth.now_iso(), todo_id],
        )
    updated = db.get_conn().execute(
        "SELECT * FROM todos WHERE id=?", (todo_id,)
    ).fetchone()
    return {"todo": todo_out(updated)}


@router.delete("/{todo_id}")
def delete_todo(todo_id: str, request: Request, session=Depends(require_csrf)):
    row = _load_todo(todo_id, session)
    if row["source"] == "contract" and session["role"] != "pi":
        raise HTTPException(403, "合同待办只有导师能删除。")
    with db.tx() as conn:
        conn.execute(
            "UPDATE todos SET deleted=1, updated_at=? WHERE id=?",
            (auth.now_iso(), todo_id),
        )
    auth.audit(session["user_id"], "todo.delete", target=todo_id, ip=client_ip(request))
    return {"ok": True}
