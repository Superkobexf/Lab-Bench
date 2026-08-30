"""端到端业务流程。

覆盖三条链路：
  * 旧备份导入 → 数据可读
  * 合同上传 → 抽取 → 确认 → 生成带倒数日的待办
  * 删除 → 回收站 → 恢复（含学生档案的连带恢复）

以及口令与会话的关键行为。
"""

import datetime
import json

import pytest


def d(offset):
    return (datetime.date.today() + datetime.timedelta(days=offset)).isoformat()


# ── 备份导入 ────────────────────────────────────────────────


def test_legacy_backup_import(login):
    """缺少后加字段的老备份要能直接导入，非法条目跳过而不是整份失败。"""
    pi = login("pi")
    backup = {
        "students": [{"id": "s9", "name": "王五"}],
        "topics": [{"id": "t9", "studentId": "s9", "title": "新课题"}],
        "weeklyLogs": [],
        "settings": {"weeklyReviewDay": 3},
        "unknownCollection": [{"id": "x"}],       # 不在白名单，忽略
        "achievements": ["不是对象", {"没有id": 1}],  # 非法条目，跳过
    }
    response = pi.post("/api/import", content=json.dumps(backup))
    assert response.status_code == 200
    imported = response.json()["imported"]
    assert imported["students"] == 1
    assert imported.get("achievements", 0) == 0

    state = pi.get("/api/state").json()["state"]
    assert any(s["id"] == "s9" for s in state["students"])
    assert state["settings"]["weeklyReviewDay"] == 3


def test_import_rejects_non_object(login):
    pi = login("pi")
    assert pi.post("/api/import", content="[1,2,3]").status_code == 400
    assert pi.post("/api/import", content="not json").status_code == 400


# ── 合同链路 ────────────────────────────────────────────────


CONTRACT_TEXT = (
    "技术开发合同\n"
    "本项目自 {a} 起启动，乙方应于 {b} 前提交中期研究报告\n"
    "项目最终交付日期为 {c}，甲方应在交付后组织验收\n"
    "本合同一式两份，签署日期 {d}\n"
)


def make_contract(pi, project_id="p1"):
    contract = pi.post("/api/contracts",
                       json={"project_id": project_id, "title": "技术开发合同"}
                       ).json()["contract"]
    body = CONTRACT_TEXT.format(a=d(-30), b=d(5), c=d(60), d=d(-35)).encode()
    version = pi.post(f"/api/contracts/{contract['id']}/versions",
                      files={"file": ("原合同.txt", body, "text/plain")},
                      data={"version_note": "原合同"}).json()
    return contract, version


def test_contract_upload_and_extract(login):
    pi = login("pi")
    _contract, version = make_contract(pi)
    assert version["parse"]["status"] == "done"
    assert version["parse"]["item_count"] > 0


def test_contract_rejects_unknown_project(login):
    pi = login("pi")
    assert pi.post("/api/contracts",
                   json={"project_id": "nope", "title": "x"}).status_code == 404


def test_duplicate_upload_rejected(login):
    pi = login("pi")
    contract, _version = make_contract(pi)
    body = CONTRACT_TEXT.format(a=d(-30), b=d(5), c=d(60), d=d(-35)).encode()
    again = pi.post(f"/api/contracts/{contract['id']}/versions",
                    files={"file": ("副本.txt", body, "text/plain")})
    assert again.status_code == 409


def test_versions_are_numbered(login):
    pi = login("pi")
    contract, _v = make_contract(pi)
    second = pi.post(f"/api/contracts/{contract['id']}/versions",
                     files={"file": ("补充协议.txt",
                                     ("补充：验收顺延至 %s" % d(120)).encode("utf-8"),
                                     "text/plain")},
                     data={"version_note": "顺延"}).json()
    assert second["version"]["version_no"] == 2


def test_confirm_item_creates_todo_with_countdown(login):
    """抽取结果必须先确认才变成待办——OCR 和正则都会误读。"""
    pi = login("pi")
    _contract, version = make_contract(pi)
    version_id = version["version"]["id"]

    assert pi.get("/api/todos").json()["todos"] == []

    items = pi.get(f"/api/contracts/versions/{version_id}/items").json()["items"]
    future = sorted(
        [i for i in items if i["kind"] == "date" and i["parsed_date"] > d(0)],
        key=lambda i: i["parsed_date"],
    )
    assert future, "应当抽到未来的日期节点"

    result = pi.patch(f"/api/contracts/items/{future[0]['id']}",
                      json={"confirmed": True, "remind_days_before": 14})
    assert result.json()["todo_id"]

    todos = pi.get("/api/todos").json()["todos"]
    assert len(todos) == 1
    assert todos[0]["days_until"] is not None
    assert todos[0]["source"] == "contract"


def test_unconfirm_removes_todo(login):
    pi = login("pi")
    _contract, version = make_contract(pi)
    items = pi.get(f"/api/contracts/versions/{version['version']['id']}/items").json()["items"]
    target = [i for i in items if i["kind"] == "date" and i["parsed_date"] > d(0)][0]

    pi.patch(f"/api/contracts/items/{target['id']}", json={"confirmed": True})
    assert len(pi.get("/api/todos").json()["todos"]) == 1
    pi.patch(f"/api/contracts/items/{target['id']}", json={"confirmed": False})
    assert pi.get("/api/todos").json()["todos"] == []


def test_students_never_see_contract_todos(login):
    pi = login("pi")
    _contract, version = make_contract(pi)
    items = pi.get(f"/api/contracts/versions/{version['version']['id']}/items").json()["items"]
    target = [i for i in items if i["kind"] == "date" and i["parsed_date"] > d(0)][0]
    pi.patch(f"/api/contracts/items/{target['id']}", json={"confirmed": True})
    pi.logout()

    student = login("zhangsan")
    assert all(t["source"] != "contract" for t in student.get("/api/todos").json()["todos"])


@pytest.mark.parametrize("offset,level", [(-3, "overdue"), (0, "today"), (30, "low")])
def test_todo_countdown_levels(login, offset, level):
    pi = login("pi")
    todo = pi.post("/api/todos",
                   json={"title": "节点", "due_date": d(offset), "remind_days_before": 7}
                   ).json()["todo"]
    assert todo["level"] == level


def test_todo_rejects_bad_date(login):
    pi = login("pi")
    assert pi.post("/api/todos",
                   json={"title": "x", "due_date": "2026-13-45"}).status_code == 400


# ── 回收站 ──────────────────────────────────────────────────


def test_restoring_student_brings_back_dependents(login):
    """删学生会连带删掉他的课题和周进展，恢复时必须一并捞回来，
    否则只剩一个空壳档案。"""
    pi = login("pi")
    for collection, rid in (("students", "s1"), ("topics", "t1"),
                            ("weeklyLogs", "w1"), ("automationPipelines", "ap1")):
        pi.delete(f"/api/records/{collection}/{rid}")

    trash = pi.get("/api/trash").json()
    assert trash["total"] >= 4

    result = pi.post("/api/trash/restore",
                     json={"kind": "record", "collection": "students", "id": "s1"})
    assert result.status_code == 200
    assert result.json()["restored_related"] >= 2

    state = pi.get("/api/state").json()["state"]
    assert any(s["id"] == "s1" for s in state["students"])
    assert any(t["id"] == "t1" for t in state["topics"])
    assert any(w["id"] == "w1" for w in state["weeklyLogs"])


def test_restore_twice_is_404(login):
    pi = login("pi")
    pi.delete("/api/records/topics/t1")
    assert pi.post("/api/trash/restore",
                   json={"kind": "record", "collection": "topics", "id": "t1"}
                   ).status_code == 200
    assert pi.post("/api/trash/restore",
                   json={"kind": "record", "collection": "topics", "id": "t1"}
                   ).status_code == 404


def test_student_trash_is_scoped(login):
    pi = login("pi")
    pi.delete("/api/records/topics/t1")
    pi.logout()

    student = login("zhangsan")
    items = student.get("/api/trash").json()["items"]
    # 学生看不到导师删的记录类条目，只能看到自己的目标和计划
    assert all(i["kind"] in ("goal", "plan") for i in items)
    assert student.post("/api/trash/purge",
                        json={"kind": "record", "collection": "topics", "id": "t1"}
                        ).status_code == 403


# ── 账号与口令 ──────────────────────────────────────────────


def test_reset_password_invalidates_old_sessions(login, client):
    pi = login("pi")
    users = pi.get("/api/users").json()["users"]
    student_user = [u for u in users if u["username"] == "zhangsan"][0]

    assert pi.patch(f"/api/users/{student_user['id']}",
                    json={"new_password": "Reset-Pass-2026!"}).status_code == 200
    pi.logout()

    old = client.post("/api/auth/login",
                      json={"username": "zhangsan", "password": "Student-2026"})
    assert old.status_code == 401

    new = client.post("/api/auth/login",
                      json={"username": "zhangsan", "password": "Reset-Pass-2026!"})
    assert new.status_code == 200
    assert new.json()["must_change_password"] is True


def test_weak_password_rejected(login):
    pi = login("pi")
    assert pi.post("/api/users",
                   json={"username": "newbie", "role": "student",
                         "student_id": "s2", "password": "short"}
                   ).status_code == 400


def test_cannot_disable_last_pi(login):
    pi = login("pi")
    me = pi.get("/api/auth/me").json()["user"]
    assert pi.patch(f"/api/users/{me['id']}", json={"active": False}).status_code == 400


def test_disabled_account_cannot_login(login, client):
    pi = login("pi")
    users = pi.get("/api/users").json()["users"]
    target = [u for u in users if u["username"] == "lisi"][0]
    pi.patch(f"/api/users/{target['id']}", json={"active": False})
    pi.logout()

    assert client.post("/api/auth/login",
                       json={"username": "lisi", "password": "Student-2026"}
                       ).status_code == 401


def test_student_account_requires_existing_record(login):
    pi = login("pi")
    assert pi.post("/api/users",
                   json={"username": "ghost", "role": "student",
                         "student_id": "nope", "password": "Good-Pass-2026!"}
                   ).status_code == 400


def test_login_lockout_after_repeated_failures(login, client):
    login("pi").logout()
    for _ in range(8):
        client.post("/api/auth/login", json={"username": "lisi", "password": "wrong"})
    blocked = client.post("/api/auth/login",
                          json={"username": "lisi", "password": "Student-2026"})
    assert blocked.status_code == 401
    assert "尝试次数过多" in blocked.json()["error"]
