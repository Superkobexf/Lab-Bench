"""权限与越权测试。

这个文件是整套测试里最重要的一份。它守的是同一条线：
**归属判定必须以数据库里已有的行为准，不能信请求体里声称的 studentId。**

这条线被破坏过一次——早期版本用请求体里的 studentId 判权限，学生
只要 PUT 到别人的记录 id、把 studentId 填成自己，就能覆盖同学的周进展。
那个洞是写测试时撞出来的，不是 review 看出来的。

现在有多个人和多个 AI 在改同一份代码，这些用例就是那次教训的护栏。
"""

import pytest


def test_no_admin_returns_503(client, env):
    """一个账号都没有时，接口必须拒绝服务，而不是裸奔。"""
    assert client.get("/api/state").status_code == 503


def test_login_and_session(client, seed):
    bad = client.post("/api/auth/login", json={"username": "pi", "password": "wrong"})
    assert bad.status_code == 401
    # 账号不存在和口令错误必须返回同一句话，否则可以枚举用户名
    ghost = client.post("/api/auth/login", json={"username": "ghost", "password": "x"})
    assert ghost.json()["error"] == bad.json()["error"]

    ok = client.post("/api/auth/login", json={"username": "pi", "password": "Lab-Bench-2026"})
    assert ok.status_code == 200
    cookie = ok.headers.get("set-cookie", "")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie.lower() or "samesite=lax" in cookie.lower()


def test_security_headers(client, seed):
    response = client.get("/")
    csp = response.headers.get("content-security-policy", "")
    assert "script-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"


def test_student_sees_only_own_data(login):
    student = login("zhangsan")
    state = student.get("/api/state").json()["state"]
    assert [s["id"] for s in state["students"]] == ["s1"]
    assert [t["id"] for t in state["topics"]] == ["t1"]
    assert [w["id"] for w in state["weeklyLogs"]] == ["w1"]
    assert [p["id"] for p in state["automationPipelines"]] == ["ap1"]
    assert state["industryProjects"] == []


@pytest.mark.parametrize("collection,record_id", [
    ("weeklyLogs", "w2"),
    ("automationPipelines", "ap2"),
])
def test_student_cannot_overwrite_other_student_record(login, collection, record_id):
    """直接改别人的记录。"""
    student = login("zhangsan")
    response = student.put(
        f"/api/records/{collection}/{record_id}",
        json={"payload": {"studentId": "s2", "title": "篡改", "experiment": "篡改"}},
    )
    assert response.status_code == 403


@pytest.mark.parametrize("collection,record_id", [
    ("weeklyLogs", "w2"),
    ("automationPipelines", "ap2"),
])
def test_student_cannot_hijack_by_claiming_ownership(login, collection, record_id):
    """把 studentId 写成自己，试图冒名覆盖别人的记录。

    这正是历史上出过的那个洞。判定必须看库里 record_id 实际归谁，
    而不是看请求体说它归谁。
    """
    student = login("zhangsan")
    response = student.put(
        f"/api/records/{collection}/{record_id}",
        json={"payload": {"studentId": "s1", "title": "冒名", "experiment": "冒名"}},
    )
    assert response.status_code == 403


def test_victim_record_is_untouched(login):
    student = login("zhangsan")
    student.put("/api/records/weeklyLogs/w2",
                json={"payload": {"studentId": "s1", "experiment": "冒名"}})
    student.logout()

    pi = login("pi")
    logs = pi.get("/api/state").json()["state"]["weeklyLogs"]
    victim = [w for w in logs if w["id"] == "w2"][0]
    assert victim["experiment"] == "李四的"


def test_student_cannot_create_record_owned_by_another(login):
    student = login("zhangsan")
    response = student.put("/api/records/weeklyLogs/w_new",
                           json={"payload": {"studentId": "s2"}})
    assert response.status_code == 403


def test_student_can_write_own_records(login):
    student = login("zhangsan")
    assert student.put("/api/records/weeklyLogs/w1",
                       json={"payload": {"studentId": "s1", "experiment": "我的更新"}}
                       ).status_code == 200
    assert student.put("/api/records/automationPipelines/ap1",
                       json={"payload": {"studentId": "s1", "title": "我的流程", "steps": []}}
                       ).status_code == 200
    # 新建自己的也允许
    assert student.put("/api/records/weeklyLogs/w_mine",
                       json={"payload": {"studentId": "s1", "experiment": "新的"}}
                       ).status_code == 200


@pytest.mark.parametrize("collection", ["students", "topics", "industryProjects", "duties"])
def test_student_cannot_write_readonly_collections(login, collection):
    student = login("zhangsan")
    response = student.put(f"/api/records/{collection}/s1",
                           json={"payload": {"studentId": "s1", "name": "改"}})
    assert response.status_code == 403


@pytest.mark.parametrize("method,path", [
    ("get", "/api/users"),
    ("get", "/api/export"),
    ("get", "/api/contracts"),
])
def test_pi_only_endpoints_reject_students(login, method, path):
    student = login("zhangsan")
    assert getattr(student, method)(path).status_code == 403


def test_student_cannot_delete_records(login):
    student = login("zhangsan")
    assert student.delete("/api/records/weeklyLogs/w1").status_code == 403


def test_student_scoped_query_params_are_ignored(login):
    """学生带上别人的 student_id 查询，服务端必须改写成他自己。

    返回 200 而不是 403 是有意的：参数被静默收敛到本人范围，
    所以关键断言是"返回的数据全归自己"，不是状态码。
    """
    student = login("zhangsan")
    goals = student.get("/api/goals?student_id=s2").json()["goals"]
    assert all(g["student_id"] == "s1" for g in goals)
    plans = student.get("/api/plans?student_id=s2").json()["plans"]
    assert all(p["student_id"] == "s1" for p in plans)


def test_csrf_required_for_writes(client, login):
    """带着有效会话但不带 CSRF 头，写请求必须被拒。"""
    student = login("zhangsan")
    response = client.put("/api/records/weeklyLogs/w1",
                          json={"payload": {"studentId": "s1"}})
    assert response.status_code == 403
    assert "CSRF" in response.json()["error"]


def test_wrong_csrf_token_rejected(client, login):
    login("zhangsan")
    response = client.put("/api/records/weeklyLogs/w1",
                          json={"payload": {"studentId": "s1"}},
                          headers={"X-CSRF-Token": "forged"})
    assert response.status_code == 403


def test_unknown_collection_rejected(login):
    pi = login("pi")
    assert pi.put("/api/records/evilCollection/x",
                  json={"payload": {}}).status_code == 404
