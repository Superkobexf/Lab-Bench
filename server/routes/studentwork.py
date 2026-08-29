"""功能一：学生的长短期目标、近期工作计划，以及导师批注。

权限模型：
  * 学生只能读写自己的目标和计划；
  * 导师可以读写任何学生的；
  * 批注双向——导师给学生留言，学生可以在同一串下回复；
  * 谁写的批注谁能改，导师可以删任何一条、把任何一串标记为已处理。

所有归属判定都以库里已有的行为准，不信请求体里声称的 student_id。
"""

import json
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, Request

import auth
import db
from deps import (
    assert_can_read_student,
    client_ip,
    current_session,
    require_csrf,
    resolve_target_student,
    student_scope,
)
from models import (
    AnnotationIn,
    AnnotationPatch,
    GoalIn,
    GoalPatch,
    PlanIn,
)

router = APIRouter(prefix="/api", tags=["studentwork"])


def new_id(prefix):
    return "%s_%s" % (prefix, secrets.token_hex(8))


# ── 目标 ────────────────────────────────────────────────────


def goal_out(row, annotation_counts=None):
    counts = (annotation_counts or {}).get(row["id"], {"total": 0, "open": 0})
    return {
        "id": row["id"],
        "student_id": row["student_id"],
        "horizon": row["horizon"],
        "title": row["title"],
        "detail": row["detail"],
        "target_date": row["target_date"],
        "status": row["status"],
        "progress": row["progress"],
        "sort_order": row["sort_order"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "annotation_count": counts["total"],
        "open_annotation_count": counts["open"],
    }


def _annotation_counts(target_type, target_ids):
    if not target_ids:
        return {}
    marks = ",".join("?" * len(target_ids))
    rows = db.get_conn().execute(
        "SELECT target_id, COUNT(*) AS total,"
        " SUM(CASE WHEN resolved=0 THEN 1 ELSE 0 END) AS open_count"
        " FROM annotations WHERE deleted=0 AND target_type=? AND target_id IN (%s)"
        " GROUP BY target_id" % marks,
        [target_type] + list(target_ids),
    ).fetchall()
    return {
        r["target_id"]: {"total": r["total"], "open": r["open_count"] or 0}
        for r in rows
    }


@router.get("/goals")
def list_goals(
    student_id: str = Query(default=""), session=Depends(current_session)
):
    scope = student_scope(session)
    if scope is not None:
        student_id = scope
    conn = db.get_conn()
    if student_id:
        assert_can_read_student(session, student_id)
        rows = conn.execute(
            "SELECT * FROM goals WHERE deleted=0 AND student_id=?"
            " ORDER BY horizon DESC, sort_order, created_at",
            (student_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM goals WHERE deleted=0"
            " ORDER BY student_id, horizon DESC, sort_order, created_at"
        ).fetchall()
    counts = _annotation_counts("goal", [r["id"] for r in rows])
    return {"goals": [goal_out(r, counts) for r in rows]}


@router.post("/goals")
def create_goal(body: GoalIn, request: Request, session=Depends(require_csrf)):
    target = resolve_target_student(session, body.student_id)
    goal_id = new_id("goal")
    now = auth.now_iso()
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO goals(id, student_id, horizon, title, detail, target_date,"
            " status, progress, sort_order, created_by, updated_by, created_at,"
            " updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (goal_id, target, body.horizon, body.title, body.detail, body.target_date,
             body.status, body.progress, body.sort_order, session["user_id"],
             session["user_id"], now, now),
        )
    auth.audit(session["user_id"], "goal.create", target=goal_id, ip=client_ip(request))
    row = db.get_conn().execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
    return {"goal": goal_out(row)}


def _load_goal(goal_id, session):
    row = db.get_conn().execute(
        "SELECT * FROM goals WHERE id=? AND deleted=0", (goal_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "目标不存在。")
    assert_can_read_student(session, row["student_id"])
    return row


@router.patch("/goals/{goal_id}")
def update_goal(
    goal_id: str, body: GoalPatch, request: Request, session=Depends(require_csrf)
):
    _load_goal(goal_id, session)
    changes = body.model_dump(exclude_none=True)
    if not changes:
        return {"goal": goal_out(_load_goal(goal_id, session))}
    sets = ", ".join("%s=?" % k for k in changes)
    with db.tx() as conn:
        conn.execute(
            "UPDATE goals SET %s, updated_by=?, updated_at=? WHERE id=?" % sets,
            list(changes.values()) + [session["user_id"], auth.now_iso(), goal_id],
        )
    return {"goal": goal_out(_load_goal(goal_id, session))}


@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: str, request: Request, session=Depends(require_csrf)):
    _load_goal(goal_id, session)
    with db.tx() as conn:
        conn.execute(
            "UPDATE goals SET deleted=1, updated_by=?, updated_at=? WHERE id=?",
            (session["user_id"], auth.now_iso(), goal_id),
        )
    auth.audit(session["user_id"], "goal.delete", target=goal_id, ip=client_ip(request))
    return {"ok": True}


# ── 周计划 ──────────────────────────────────────────────────


def plan_out(row, counts=None):
    c = (counts or {}).get(row["id"], {"total": 0, "open": 0})
    return {
        "id": row["id"],
        "student_id": row["student_id"],
        "week_of": row["week_of"],
        "items": json.loads(row["items"]),
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "annotation_count": c["total"],
        "open_annotation_count": c["open"],
    }


@router.get("/plans")
def list_plans(
    student_id: str = Query(default=""),
    week_of: str = Query(default="", max_length=32),
    session=Depends(current_session),
):
    scope = student_scope(session)
    if scope is not None:
        student_id = scope
    sql = "SELECT * FROM plans WHERE deleted=0"
    args = []
    if student_id:
        assert_can_read_student(session, student_id)
        sql += " AND student_id=?"
        args.append(student_id)
    if week_of:
        sql += " AND week_of=?"
        args.append(week_of)
    sql += " ORDER BY week_of DESC, student_id"
    rows = db.get_conn().execute(sql, args).fetchall()
    counts = _annotation_counts("plan", [r["id"] for r in rows])
    return {"plans": [plan_out(r, counts) for r in rows]}


@router.put("/plans")
def upsert_plan(body: PlanIn, request: Request, session=Depends(require_csrf)):
    """按 (学生, 周) 覆盖写。同一周重复提交是更新而不是新建。"""
    target = resolve_target_student(session, body.student_id)
    items = json.dumps([i.model_dump() for i in body.items], ensure_ascii=False)
    now = auth.now_iso()
    existing = db.get_conn().execute(
        "SELECT id FROM plans WHERE student_id=? AND week_of=?", (target, body.week_of)
    ).fetchone()
    plan_id = existing["id"] if existing else new_id("plan")
    with db.tx() as conn:
        if existing:
            conn.execute(
                "UPDATE plans SET items=?, status=?, deleted=0, updated_by=?,"
                " updated_at=? WHERE id=?",
                (items, body.status, session["user_id"], now, plan_id),
            )
        else:
            conn.execute(
                "INSERT INTO plans(id, student_id, week_of, items, status, created_by,"
                " updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (plan_id, target, body.week_of, items, body.status,
                 session["user_id"], session["user_id"], now, now),
            )
    row = db.get_conn().execute("SELECT * FROM plans WHERE id=?", (plan_id,)).fetchone()
    return {"plan": plan_out(row)}


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: str, request: Request, session=Depends(require_csrf)):
    row = db.get_conn().execute(
        "SELECT * FROM plans WHERE id=? AND deleted=0", (plan_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "计划不存在。")
    assert_can_read_student(session, row["student_id"])
    with db.tx() as conn:
        conn.execute(
            "UPDATE plans SET deleted=1, updated_by=?, updated_at=? WHERE id=?",
            (session["user_id"], auth.now_iso(), plan_id),
        )
    return {"ok": True}


# ── 导师批注 ────────────────────────────────────────────────


def annotation_out(row):
    return {
        "id": row["id"],
        "target_type": row["target_type"],
        "target_id": row["target_id"],
        "student_id": row["student_id"],
        "parent_id": row["parent_id"],
        "author_id": row["author_id"],
        "author_name": row["author_name"] if "author_name" in row.keys() else "",
        "author_role": row["author_role"] if "author_role" in row.keys() else "",
        "body": row["body"],
        "resolved": bool(row["resolved"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _target_student(target_type, target_id):
    """批注挂在哪个学生名下，由被批注的对象决定，不由请求体决定。"""
    conn = db.get_conn()
    if target_type == "goal":
        row = conn.execute(
            "SELECT student_id FROM goals WHERE id=? AND deleted=0", (target_id,)
        ).fetchone()
    elif target_type == "plan":
        row = conn.execute(
            "SELECT student_id FROM plans WHERE id=? AND deleted=0", (target_id,)
        ).fetchone()
    else:  # weekly_log
        row = conn.execute(
            "SELECT student_id FROM records WHERE collection='weeklyLogs'"
            " AND id=? AND deleted=0",
            (target_id,),
        ).fetchone()
    if row is None or not row["student_id"]:
        raise HTTPException(404, "被批注的内容不存在。")
    return row["student_id"]


@router.get("/annotations")
def list_annotations(
    target_type: str = Query(default="", max_length=16),
    target_id: str = Query(default="", max_length=64),
    student_id: str = Query(default="", max_length=64),
    only_open: bool = Query(default=False),
    session=Depends(current_session),
):
    scope = student_scope(session)
    if scope is not None:
        student_id = scope
    sql = (
        "SELECT a.*, u.display_name AS author_name, u.role AS author_role"
        " FROM annotations a LEFT JOIN users u ON u.id = a.author_id"
        " WHERE a.deleted=0"
    )
    args = []
    if target_type:
        sql += " AND a.target_type=?"; args.append(target_type)
    if target_id:
        sql += " AND a.target_id=?"; args.append(target_id)
    if student_id:
        assert_can_read_student(session, student_id)
        sql += " AND a.student_id=?"; args.append(student_id)
    if only_open:
        sql += " AND a.resolved=0"
    sql += " ORDER BY a.created_at"
    rows = db.get_conn().execute(sql, args).fetchall()
    return {"annotations": [annotation_out(r) for r in rows]}


@router.post("/annotations")
def create_annotation(
    body: AnnotationIn, request: Request, session=Depends(require_csrf)
):
    owner = _target_student(body.target_type, body.target_id)
    # 学生只能在自己的内容下回复
    assert_can_read_student(session, owner)
    if body.parent_id:
        parent = db.get_conn().execute(
            "SELECT * FROM annotations WHERE id=? AND deleted=0", (body.parent_id,)
        ).fetchone()
        if parent is None:
            raise HTTPException(404, "要回复的批注不存在。")
        if parent["target_id"] != body.target_id:
            raise HTTPException(400, "回复和原批注不在同一条内容上。")
    ann_id = new_id("ann")
    now = auth.now_iso()
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO annotations(id, target_type, target_id, student_id, parent_id,"
            " author_id, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (ann_id, body.target_type, body.target_id, owner, body.parent_id,
             session["user_id"], body.body, now, now),
        )
    row = db.get_conn().execute(
        "SELECT a.*, u.display_name AS author_name, u.role AS author_role"
        " FROM annotations a LEFT JOIN users u ON u.id=a.author_id WHERE a.id=?",
        (ann_id,),
    ).fetchone()
    return {"annotation": annotation_out(row)}


@router.patch("/annotations/{ann_id}")
def update_annotation(
    ann_id: str, body: AnnotationPatch, request: Request, session=Depends(require_csrf)
):
    row = db.get_conn().execute(
        "SELECT * FROM annotations WHERE id=? AND deleted=0", (ann_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "批注不存在。")
    assert_can_read_student(session, row["student_id"])
    changes = {}
    if body.body is not None:
        # 正文只有作者本人能改，导师也不能替学生改口
        if row["author_id"] != session["user_id"]:
            raise HTTPException(403, "只能修改自己写的批注。")
        changes["body"] = body.body
    if body.resolved is not None:
        changes["resolved"] = 1 if body.resolved else 0
    if not changes:
        return {"ok": True}
    sets = ", ".join("%s=?" % k for k in changes)
    with db.tx() as conn:
        conn.execute(
            "UPDATE annotations SET %s, updated_at=? WHERE id=?" % sets,
            list(changes.values()) + [auth.now_iso(), ann_id],
        )
    return {"ok": True}


@router.delete("/annotations/{ann_id}")
def delete_annotation(ann_id: str, request: Request, session=Depends(require_csrf)):
    row = db.get_conn().execute(
        "SELECT * FROM annotations WHERE id=? AND deleted=0", (ann_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "批注不存在。")
    assert_can_read_student(session, row["student_id"])
    # 作者本人或导师可删
    if session["role"] != "pi" and row["author_id"] != session["user_id"]:
        raise HTTPException(403, "只能删除自己写的批注。")
    with db.tx() as conn:
        conn.execute(
            "UPDATE annotations SET deleted=1, updated_at=? WHERE id=?"
            " OR parent_id=?",
            (auth.now_iso(), ann_id, ann_id),
        )
    return {"ok": True}
