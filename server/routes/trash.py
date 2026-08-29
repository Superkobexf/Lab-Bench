"""回收站。

库里所有"删除"都是软删除（deleted=1），数据一直都在，
但在这之前没有任何恢复入口——学生手滑删掉一学期的目标，
就只能上服务器写 SQL 捞。这个模块把已删除的东西列出来，
并提供恢复和彻底删除。

删学生档案是最危险的一个：前端的 deleteStudent 会连带过滤掉
该学生的课题、周进展和事务，所以恢复时要把这些一并捞回来。

批注不进回收站：删批注时会级联删掉整串回复，恢复语义不清晰，
留给需要时再单独设计。
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request

import auth
import db
from deps import client_ip, current_session, require_csrf, require_pi, student_scope

router = APIRouter(prefix="/api/trash", tags=["trash"])

# 每类记录用哪个字段当标题，找不到就退回 id
RECORD_LABEL = {
    "students": ("name",),
    "alumni": ("name",),
    "topics": ("title",),
    "industryProjects": ("name",),
    "collaborationLeads": ("company",),
    "paperCrawler": ("scope", "query"),
    "duties": ("title",),
    "weeklyLogs": ("weekOf",),
    "weeklyDrafts": ("weekOf",),
    "archiveScans": ("folder",),
    "achievements": ("title",),
    "financeRecords": ("item",),
}

COLLECTION_LABEL = {
    "students": "学生档案",
    "alumni": "毕业学生",
    "topics": "硕士课题",
    "industryProjects": "横向课题",
    "collaborationLeads": "合作线索",
    "paperCrawler": "论文爬虫",
    "duties": "组内事务",
    "weeklyLogs": "周进展",
    "weeklyDrafts": "周进展候选稿",
    "archiveScans": "档案扫描",
    "achievements": "成果",
    "financeRecords": "经费记录",
}


def _label(collection, payload):
    for key in RECORD_LABEL.get(collection, ()):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:120]
    return ""


def _student_name(student_id):
    if not student_id:
        return ""
    row = db.get_conn().execute(
        "SELECT payload FROM records WHERE collection='students' AND id=?",
        (student_id,),
    ).fetchone()
    if row is None:
        return ""
    try:
        return json.loads(row["payload"]).get("name", "")
    except ValueError:
        return ""


@router.get("")
def list_trash(
    limit: int = Query(default=200, ge=1, le=500),
    session=Depends(current_session),
):
    """列出已删除但还能恢复的条目。

    导师看到全部；学生只看到自己的目标和周计划——其余集合本来
    就只有导师能删。
    """
    scope = student_scope(session)
    conn = db.get_conn()
    items = []

    if scope is None:
        for row in conn.execute(
            "SELECT * FROM records WHERE deleted=1 ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall():
            try:
                payload = json.loads(row["payload"])
            except ValueError:
                payload = {}
            items.append({
                "kind": "record",
                "sub": row["collection"],
                "kind_label": COLLECTION_LABEL.get(row["collection"], row["collection"]),
                "id": row["id"],
                "label": _label(row["collection"], payload) or row["id"],
                "student_name": _student_name(row["student_id"]),
                "deleted_at": row["updated_at"],
            })

    goal_sql = "SELECT * FROM goals WHERE deleted=1"
    plan_sql = "SELECT * FROM plans WHERE deleted=1"
    args = []
    if scope is not None:
        goal_sql += " AND student_id=?"
        plan_sql += " AND student_id=?"
        args = [scope]
    for row in conn.execute(goal_sql + " ORDER BY updated_at DESC LIMIT ?",
                            args + [limit]).fetchall():
        items.append({
            "kind": "goal", "sub": row["horizon"],
            "kind_label": "长期目标" if row["horizon"] == "long" else "短期目标",
            "id": row["id"], "label": row["title"],
            "student_name": _student_name(row["student_id"]),
            "deleted_at": row["updated_at"],
        })
    for row in conn.execute(plan_sql + " ORDER BY updated_at DESC LIMIT ?",
                            args + [limit]).fetchall():
        items.append({
            "kind": "plan", "sub": "",
            "kind_label": "周计划", "id": row["id"],
            "label": "%s 当周" % row["week_of"],
            "student_name": _student_name(row["student_id"]),
            "deleted_at": row["updated_at"],
        })

    if scope is None:
        for row in conn.execute(
            "SELECT * FROM todos WHERE deleted=1 ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall():
            items.append({
                "kind": "todo", "sub": row["source"],
                "kind_label": "待办", "id": row["id"], "label": row["title"],
                "student_name": _student_name(row["student_id"]),
                "deleted_at": row["updated_at"],
            })
        for row in conn.execute(
            "SELECT * FROM contracts WHERE deleted=1 ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall():
            items.append({
                "kind": "contract", "sub": "",
                "kind_label": "合同", "id": row["id"], "label": row["title"],
                "student_name": "", "deleted_at": row["updated_at"],
            })

    items.sort(key=lambda x: x["deleted_at"] or "", reverse=True)
    return {"items": items[:limit], "total": len(items)}


TABLES = {"goal": "goals", "plan": "plans", "todo": "todos", "contract": "contracts"}


def _check_access(kind, item_id, session):
    """返回这条记录，顺带做权限判定。归属一律以库里的行为准。"""
    scope = student_scope(session)
    conn = db.get_conn()

    if kind == "record":
        if scope is not None:
            raise HTTPException(403, "只有导师能恢复这类记录。")
        return None

    table = TABLES.get(kind)
    if table is None:
        raise HTTPException(400, "未知的条目类型。")
    row = conn.execute("SELECT * FROM %s WHERE id=?" % table, (item_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "条目不存在。")
    if scope is not None:
        if kind not in ("goal", "plan"):
            raise HTTPException(403, "没有权限操作这条记录。")
        if row["student_id"] != scope:
            raise HTTPException(403, "没有权限操作这条记录。")
    return row


@router.post("/restore")
def restore(payload: dict, request: Request, session=Depends(require_csrf)):
    kind = payload.get("kind")
    item_id = payload.get("id")
    collection = payload.get("collection", "")
    if not isinstance(kind, str) or not isinstance(item_id, str) or not item_id:
        raise HTTPException(400, "参数不完整。")

    _check_access(kind, item_id, session)
    now = auth.now_iso()

    if kind == "record":
        if collection not in db.COLLECTIONS:
            raise HTTPException(400, "未知的数据集合。")
        with db.tx() as conn:
            cur = conn.execute(
                "UPDATE records SET deleted=0, updated_at=?, updated_by=?"
                " WHERE collection=? AND id=? AND deleted=1",
                (now, session["user_id"], collection, item_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(404, "条目不存在或未被删除。")
            restored_extra = 0
            # 恢复学生档案时，把跟着一起被删掉的从属记录也捞回来。
            # 前端删学生是连带过滤掉课题/周进展/事务的，只恢复档案本身
            # 会留下一个空壳。
            if collection == "students":
                for child in ("topics", "weeklyLogs", "duties", "weeklyDrafts",
                              "achievements", "financeRecords", "paperCrawler",
                              "archiveScans"):
                    cur2 = conn.execute(
                        "UPDATE records SET deleted=0, updated_at=?, updated_by=?"
                        " WHERE collection=? AND student_id=? AND deleted=1",
                        (now, session["user_id"], child, item_id),
                    )
                    restored_extra += cur2.rowcount
        auth.audit(session["user_id"], "trash.restore",
                   target="%s/%s" % (collection, item_id),
                   detail="连带恢复 %d 条" % restored_extra, ip=client_ip(request))
        return {"ok": True, "restored_related": restored_extra}

    table = TABLES[kind]
    with db.tx() as conn:
        cur = conn.execute(
            "UPDATE %s SET deleted=0, updated_at=? WHERE id=? AND deleted=1" % table,
            (now, item_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "条目不存在或未被删除。")
    auth.audit(session["user_id"], "trash.restore", target="%s/%s" % (kind, item_id),
               ip=client_ip(request))
    return {"ok": True, "restored_related": 0}


@router.post("/purge")
def purge(payload: dict, request: Request, session=Depends(require_pi)):
    """彻底删除，不可恢复。只有导师能做。"""
    kind = payload.get("kind")
    item_id = payload.get("id")
    collection = payload.get("collection", "")
    if not isinstance(kind, str) or not isinstance(item_id, str) or not item_id:
        raise HTTPException(400, "参数不完整。")

    if kind == "record":
        if collection not in db.COLLECTIONS:
            raise HTTPException(400, "未知的数据集合。")
        with db.tx() as conn:
            conn.execute(
                "DELETE FROM records WHERE collection=? AND id=? AND deleted=1",
                (collection, item_id),
            )
        target = "%s/%s" % (collection, item_id)
    else:
        table = TABLES.get(kind)
        if table is None:
            raise HTTPException(400, "未知的条目类型。")
        with db.tx() as conn:
            conn.execute("DELETE FROM %s WHERE id=? AND deleted=1" % table, (item_id,))
        target = "%s/%s" % (kind, item_id)

    auth.audit(session["user_id"], "trash.purge", target=target, ip=client_ip(request))
    return {"ok": True}
