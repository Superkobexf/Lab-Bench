"""测试夹具。

每个测试用一个全新的临时数据库和上传目录，互不影响，也绝不碰
真实数据。数据库路径必须在导入 db 之前设好——db.py 在模块层就读
了环境变量。
"""

import os
import sys
import tempfile

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.dirname(HERE)
sys.path.insert(0, SERVER)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """一套干净的运行环境。"""
    db_path = tmp_path / "test.db"
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setenv("LAB_BENCH_DB", str(db_path))
    monkeypatch.setenv("LAB_BENCH_UPLOADS", str(uploads))
    monkeypatch.setenv("LAB_BENCH_SECURE_COOKIE", "0")

    # 这些模块在导入时就固化了路径常量和 db 引用，必须整体重新导入。
    #
    # 必须连 routes 包本身一起清掉：只清 routes.contracts 这样的子模块，
    # 包对象上仍挂着上一次导入的子模块属性，`from routes import contracts`
    # 会直接拿到那个旧对象——它绑定的是上一个测试的数据库连接，
    # 表现为随机的 503，且只在多个用例连跑时才出现。
    for name in [n for n in list(sys.modules) if n == "routes" or n.startswith("routes.")]:
        sys.modules.pop(name, None)
    for name in ("db", "auth", "deps", "app", "models"):
        sys.modules.pop(name, None)

    import db as db_mod

    db_mod.DB_PATH = str(db_path)
    db_mod._local.__dict__.clear()
    db_mod.init_db()
    return {"db_path": str(db_path), "uploads": str(uploads), "db": db_mod}


@pytest.fixture()
def client(env):
    from fastapi.testclient import TestClient

    import app as app_mod
    import routes.files as files_mod

    files_mod.UPLOAD_DIR = env["uploads"]
    with TestClient(app_mod.app) as c:
        yield c


@pytest.fixture()
def seed(env):
    """一个导师、两个学生，以及各自的档案、课题、周进展和自动化流程。

    张三=s1，李四=s2。学生数据成对出现，是为了让越权测试有真实的
    "别人的数据"可以尝试访问。
    """
    import json

    import auth
    import db as db_mod

    now = auth.now_iso()

    def add_user(conn, username, display, role, student_id, password):
        pw_hash, algo = auth.hash_password(password)
        conn.execute(
            "INSERT INTO users(username, display_name, role, student_id,"
            " password_hash, hash_algo, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (username, display, role, student_id, pw_hash, algo, now, now),
        )

    def add_record(conn, collection, rid, student_id, payload):
        conn.execute(
            "INSERT INTO records(collection, id, student_id, payload, updated_at)"
            " VALUES (?,?,?,?,?)",
            (collection, rid, student_id, json.dumps(payload, ensure_ascii=False), now),
        )

    with db_mod.tx() as conn:
        add_user(conn, "pi", "王老师", "pi", None, "Lab-Bench-2026")
        for sid, name in (("s1", "张三"), ("s2", "李四")):
            add_record(conn, "students", sid, sid, {"name": name, "grade": "研二"})
        add_user(conn, "zhangsan", "张三", "student", "s1", "Student-2026")
        add_user(conn, "lisi", "李四", "student", "s2", "Student-2026")
        add_record(conn, "topics", "t1", "s1", {"studentId": "s1", "title": "张三的课题"})
        add_record(conn, "weeklyLogs", "w1", "s1", {"studentId": "s1", "experiment": "张三的"})
        add_record(conn, "weeklyLogs", "w2", "s2", {"studentId": "s2", "experiment": "李四的"})
        add_record(conn, "automationPipelines", "ap1", "s1",
                   {"studentId": "s1", "title": "张三的流程", "steps": []})
        add_record(conn, "automationPipelines", "ap2", "s2",
                   {"studentId": "s2", "title": "李四的流程", "steps": []})
        add_record(conn, "industryProjects", "p1", None, {"name": "某某科技"})
        for key, value in (("weeklyReviewDay", 5), ("notifyHour", 17), ("stipendRate", 80)):
            conn.execute(
                "INSERT INTO settings(key, value, updated_at) VALUES (?,?,?)",
                (key, json.dumps(value), now),
            )
    return {"pi": ("pi", "Lab-Bench-2026"),
            "zhangsan": ("zhangsan", "Student-2026"),
            "lisi": ("lisi", "Student-2026")}


class Session:
    """登录后的会话，自动带上 CSRF 头。"""

    def __init__(self, client, username, password):
        self.client = client
        response = client.post(
            "/api/auth/login", json={"username": username, "password": password}
        )
        assert response.status_code == 200, response.text
        self.csrf = response.json()["csrf_token"]
        self.user = response.json()["user"]

    @property
    def headers(self):
        return {"X-CSRF-Token": self.csrf}

    def get(self, path, **kw):
        return self.client.get(path, **kw)

    def post(self, path, **kw):
        kw.setdefault("headers", {}).update(self.headers)
        return self.client.post(path, **kw)

    def put(self, path, **kw):
        kw.setdefault("headers", {}).update(self.headers)
        return self.client.put(path, **kw)

    def patch(self, path, **kw):
        kw.setdefault("headers", {}).update(self.headers)
        return self.client.patch(path, **kw)

    def delete(self, path, **kw):
        kw.setdefault("headers", {}).update(self.headers)
        return self.client.delete(path, **kw)

    def logout(self):
        self.client.post("/api/auth/logout", headers=self.headers)


@pytest.fixture()
def login(client, seed):
    def _login(who):
        username, password = seed[who]
        return Session(client, username, password)

    return _login


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
