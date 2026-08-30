"""SQLite schema and connection handling.

设计取舍：现有前端的数据集合（students / topics / weeklyLogs ...）
不拆成关系表，而是统一存进 records 表的 payload JSON 列，只把鉴权和筛选
真正需要的字段（collection / id / student_id / updated_at）提成真实列。

这样做的理由：
  1. app.js 里 3500 行渲染代码依赖的对象形状完全不变，不用重写；
  2. 旧备份 JSON 可以原样灌进来，migrateState() 的兼容逻辑继续成立；
  3. 写操作能按记录粒度落库，解决原来 localStorage 整包覆盖、
     多人并发互相踩的问题。

新功能（goals / plans / annotations / contracts / todos）是全新数据，
没有历史包袱，直接用规范的关系表。
"""

import json
import os
import sqlite3
import threading
from contextlib import contextmanager

DB_PATH = os.environ.get(
    "LAB_BENCH_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "lab.db"),
)

# 前端 seedData() 里的集合，决定 records.collection 的合法取值
COLLECTIONS = (
    "students",
    "alumni",
    "topics",
    "industryProjects",
    "collaborationLeads",
    "paperCrawler",
    "duties",
    "weeklyLogs",
    "weeklyDrafts",
    "archiveScans",
    "achievements",
    "financeRecords",
    "automationPipelines",
)

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── 账号与会话 ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    display_name  TEXT    NOT NULL DEFAULT '',
    role          TEXT    NOT NULL CHECK (role IN ('pi', 'student')),
    -- 学生账号绑定到 records 里 students 集合的某条记录
    student_id    TEXT,
    password_hash TEXT    NOT NULL,
    -- 记录用的哪种算法，便于以后整体升级（argon2id / pbkdf2-sha256）
    hash_algo     TEXT    NOT NULL,
    must_change   INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    failed_count  INTEGER NOT NULL DEFAULT 0,
    locked_until  TEXT,
    last_login_at TEXT,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_student ON users(student_id);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    last_seen_at TEXT   NOT NULL,
    ip          TEXT    NOT NULL DEFAULT '',
    user_agent  TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ── 既有业务数据（保持前端对象形状）────────────────────────

CREATE TABLE IF NOT EXISTS records (
    collection  TEXT    NOT NULL,
    id          TEXT    NOT NULL,
    student_id  TEXT,
    payload     TEXT    NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT    NOT NULL,
    updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS idx_records_student ON records(collection, student_id);
CREATE INDEX IF NOT EXISTS idx_records_updated ON records(updated_at);

-- 全局设置（原 state.settings），单行
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ── 功能一：目标与工作计划 ──────────────────────────────────

CREATE TABLE IF NOT EXISTS goals (
    id          TEXT PRIMARY KEY,
    student_id  TEXT    NOT NULL,
    horizon     TEXT    NOT NULL CHECK (horizon IN ('long', 'short')),
    title       TEXT    NOT NULL,
    detail      TEXT    NOT NULL DEFAULT '',
    target_date TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT '进行中',
    progress    INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_goals_student ON goals(student_id, horizon);

CREATE TABLE IF NOT EXISTS plans (
    id          TEXT PRIMARY KEY,
    student_id  TEXT    NOT NULL,
    week_of     TEXT    NOT NULL,
    -- [{id, text, done, goal_id}]，条目级结构留在 JSON 里，避免为待办再开一张表
    items       TEXT    NOT NULL DEFAULT '[]',
    status      TEXT    NOT NULL DEFAULT '草稿',
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (student_id, week_of)
);
CREATE INDEX IF NOT EXISTS idx_plans_student ON plans(student_id, week_of);

-- 导师批注：对学生内容（目标 / 计划 / 周进展）的留言，支持串起对话
CREATE TABLE IF NOT EXISTS annotations (
    id          TEXT PRIMARY KEY,
    target_type TEXT    NOT NULL CHECK (target_type IN ('goal', 'plan', 'weekly_log')),
    target_id   TEXT    NOT NULL,
    -- 冗余一份，便于按学生批量取批注和做权限判定
    student_id  TEXT    NOT NULL,
    parent_id   TEXT    REFERENCES annotations(id) ON DELETE CASCADE,
    author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body        TEXT    NOT NULL,
    resolved    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_annot_target ON annotations(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_annot_student ON annotations(student_id, resolved);

-- ── 功能二：横向合同、OCR 与倒数日 ──────────────────────────

-- 一份合同 = 一条 contracts + 多条 contract_versions
-- （原合同 / 补充协议 / 变更单都是同一份合同的不同版本）
CREATE TABLE IF NOT EXISTS contracts (
    id                 TEXT PRIMARY KEY,
    project_id         TEXT NOT NULL,
    title              TEXT NOT NULL,
    counterparty       TEXT NOT NULL DEFAULT '',
    current_version_id TEXT,
    created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    deleted            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);

CREATE TABLE IF NOT EXISTS contract_versions (
    id           TEXT    PRIMARY KEY,
    contract_id  TEXT    NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    version_no   INTEGER NOT NULL,
    version_note TEXT    NOT NULL DEFAULT '',
    filename     TEXT    NOT NULL,
    stored_path  TEXT    NOT NULL,
    sha256       TEXT    NOT NULL,
    size         INTEGER NOT NULL,
    mime         TEXT    NOT NULL DEFAULT '',
    -- pending / running / done / failed / no_text
    ocr_status   TEXT    NOT NULL DEFAULT 'pending',
    ocr_engine   TEXT    NOT NULL DEFAULT '',
    ocr_error    TEXT    NOT NULL DEFAULT '',
    ocr_text     TEXT    NOT NULL DEFAULT '',
    uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at  TEXT    NOT NULL,
    UNIQUE (contract_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_versions_contract ON contract_versions(contract_id, version_no);

-- 抽取结果挂在版本上，这样能看出补充协议改了哪些日期
CREATE TABLE IF NOT EXISTS contract_items (
    id           TEXT    PRIMARY KEY,
    version_id   TEXT    NOT NULL REFERENCES contract_versions(id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL CHECK (kind IN ('date', 'task', 'amount')),
    title        TEXT    NOT NULL DEFAULT '',
    raw_text     TEXT    NOT NULL DEFAULT '',
    parsed_date  TEXT    NOT NULL DEFAULT '',
    parsed_amount REAL,
    confidence   REAL    NOT NULL DEFAULT 0,
    -- 抽取结果一律先进待确认区，导师点过才生成待办
    confirmed    INTEGER NOT NULL DEFAULT 0,
    dismissed    INTEGER NOT NULL DEFAULT 0,
    confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at TEXT,
    created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_version ON contract_items(version_id, confirmed, dismissed);

CREATE TABLE IF NOT EXISTS todos (
    id                 TEXT    PRIMARY KEY,
    source             TEXT    NOT NULL DEFAULT 'manual'
                               CHECK (source IN ('manual', 'contract')),
    source_id          TEXT,
    title              TEXT    NOT NULL,
    detail             TEXT    NOT NULL DEFAULT '',
    owner_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    student_id         TEXT,
    project_id         TEXT,
    due_date           TEXT    NOT NULL DEFAULT '',
    remind_days_before INTEGER NOT NULL DEFAULT 7,
    done               INTEGER NOT NULL DEFAULT 0,
    done_at            TEXT,
    created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at         TEXT    NOT NULL,
    updated_at         TEXT    NOT NULL,
    deleted            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(done, deleted, due_date);
CREATE INDEX IF NOT EXISTS idx_todos_source ON todos(source, source_id);

-- ── 审计 ────────────────────────────────────────────────────
-- 公网部署 + 多人写入，出问题时要能回答"谁在什么时候改了什么"
CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    target     TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

SCHEMA_VERSION = "1"

_local = threading.local()


def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=15.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


def get_conn():
    """每线程一个连接。uvicorn 的线程池会复用线程，sqlite 连接不跨线程共享。"""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _local.conn = _connect()
    return conn


@contextmanager
def tx():
    """一个写事务。异常时回滚，避免半截写入。"""
    conn = get_conn()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def init_db():
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT INTO schema_meta(key, value) VALUES('version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (SCHEMA_VERSION,),
    )
    return conn


def row_to_dict(row):
    return dict(row) if row is not None else None


def load_payload(row):
    """records 行 -> 前端认识的对象（payload 展开，id 以列为准）。"""
    data = json.loads(row["payload"])
    data["id"] = row["id"]
    return data
