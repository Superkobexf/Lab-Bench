#!/usr/bin/env python3
"""命令行运维工具。

    python manage.py createadmin [用户名]     建第一个导师账号
    python manage.py passwd <用户名>          改口令
    python manage.py listusers               看账号列表
    python manage.py importjson <文件>        灌入旧的备份 JSON
    python manage.py purge                   清理过期会话
    python manage.py checkenv                检查算法/OCR/内存参数

口令一律走交互式输入，不从命令行参数读——命令行参数会留在
shell history 和 ps 的输出里。
"""

import getpass
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import auth  # noqa: E402
import db  # noqa: E402
from models import RecordIn  # noqa: E402


def _read_password(prompt="设置口令: "):
    while True:
        pw = getpass.getpass(prompt)
        problem = auth.password_problem(pw)
        if problem:
            print("  " + problem)
            continue
        if pw != getpass.getpass("再输一次确认: "):
            print("  两次输入不一致。")
            continue
        return pw


def createadmin(argv):
    db.init_db()
    username = argv[0] if argv else input("导师账号用户名: ").strip()
    if not username:
        print("用户名不能为空。")
        return 1
    exists = db.get_conn().execute(
        "SELECT 1 FROM users WHERE username=?", (username,)
    ).fetchone()
    if exists:
        print("用户名已存在。要改口令请用： manage.py passwd %s" % username)
        return 1
    display = input("显示名（回车用用户名）: ").strip() or username
    pw = _read_password()
    pw_hash, algo = auth.hash_password(pw)
    now = auth.now_iso()
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO users(username, display_name, role, password_hash, hash_algo,"
            " must_change, created_at, updated_at) VALUES (?,?,'pi',?,?,0,?,?)",
            (username, display, pw_hash, algo, now, now),
        )
    print("已创建导师账号 %s（口令算法 %s）。" % (username, algo))
    if algo != "argon2id":
        print("提示：当前环境没装 argon2-cffi，用的是 pbkdf2-sha256。")
        print("      服务器上装了 argon2-cffi 之后，你下次登录会自动升级。")
    return 0


def passwd(argv):
    db.init_db()
    if not argv:
        print("用法: manage.py passwd <用户名>")
        return 1
    row = db.get_conn().execute(
        "SELECT * FROM users WHERE username=?", (argv[0],)
    ).fetchone()
    if row is None:
        print("没有这个账号。")
        return 1
    pw = _read_password("给 %s 设置新口令: " % argv[0])
    pw_hash, algo = auth.hash_password(pw)
    with db.tx() as conn:
        conn.execute(
            "UPDATE users SET password_hash=?, hash_algo=?, failed_count=0,"
            " locked_until=NULL, updated_at=? WHERE id=?",
            (pw_hash, algo, auth.now_iso(), row["id"]),
        )
    auth.destroy_user_sessions(row["id"])
    print("已更新，该账号所有登录会话已失效。")
    return 0


def listusers(argv):
    db.init_db()
    rows = db.get_conn().execute(
        "SELECT * FROM users ORDER BY role DESC, username"
    ).fetchall()
    if not rows:
        print("还没有任何账号。")
        return 0
    print("%-18s %-8s %-14s %-6s %s" % ("用户名", "角色", "绑定学生", "启用", "上次登录"))
    for r in rows:
        print("%-18s %-8s %-14s %-6s %s" % (
            r["username"], r["role"], r["student_id"] or "-",
            "是" if r["active"] else "否", r["last_login_at"] or "-",
        ))
    return 0


def importjson(argv):
    db.init_db()
    if not argv:
        print("用法: manage.py importjson <备份文件.json>")
        return 1
    with open(argv[0], encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        print("备份内容必须是一个 JSON 对象。")
        return 1
    now = auth.now_iso()
    total, skipped = 0, 0
    with db.tx() as conn:
        for collection in db.COLLECTIONS:
            items = data.get(collection)
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    skipped += 1
                    continue
                rid = item.get("id")
                if not isinstance(rid, str) or not rid or len(rid) > 64:
                    skipped += 1
                    continue
                payload = {k: v for k, v in item.items() if k != "id"}
                try:
                    RecordIn(id=rid, payload=payload)
                except Exception:
                    skipped += 1
                    continue
                owner = rid if collection == "students" else payload.get("studentId")
                conn.execute(
                    "INSERT INTO records(collection, id, student_id, payload, deleted,"
                    " updated_at) VALUES (?,?,?,?,0,?)"
                    " ON CONFLICT(collection, id) DO UPDATE SET"
                    " student_id=excluded.student_id, payload=excluded.payload,"
                    " deleted=0, updated_at=excluded.updated_at",
                    (collection, rid, owner if isinstance(owner, str) else None,
                     json.dumps(payload, ensure_ascii=False), now),
                )
                total += 1
        settings = data.get("settings")
        if isinstance(settings, dict):
            for key, value in settings.items():
                if isinstance(key, str) and len(key) <= 64:
                    conn.execute(
                        "INSERT INTO settings(key, value, updated_at) VALUES (?,?,?)"
                        " ON CONFLICT(key) DO UPDATE SET value=excluded.value,"
                        " updated_at=excluded.updated_at",
                        (key, json.dumps(value, ensure_ascii=False), now),
                    )
    print("导入完成：%d 条记录，跳过 %d 条不合法的。" % (total, skipped))
    return 0


def purge(argv):
    db.init_db()
    auth.purge_expired_sessions()
    print("已清理过期会话。")
    return 0


def checkenv(argv):
    """看一眼当前环境：口令算法、OCR 引擎、内存相关参数都对不对。"""
    import ocr

    print("口令算法   : %s" % auth.PREFERRED_ALGO)
    if auth.PREFERRED_ALGO == "argon2id":
        print("  argon2 内存: %d MB/次（%d 人同时登录约 %d MB）"
              % (auth.ARGON2_MEMORY_MB, 10, auth.ARGON2_MEMORY_MB * 10))
    else:
        print("  警告：没装 argon2-cffi，正在用 pbkdf2-sha256。公网部署请装上。")

    ocr.reset_probe()
    info = ocr.status()
    print("OCR 引擎   : %s" % (info["engine"] or "无"))
    if not info["available"]:
        print("  %s" % info["reason"])
        print("  数字版合同不受影响，仍能自动抽取。")
    print("PDF 渲染   : %s" % ("可用" if info["can_render_pdf"] else "缺 PyMuPDF，扫描版 PDF 无法识别"))
    print("OCR 子进程 : 内存上限 %s MB，超时 %d 秒" % (ocr.MEM_MB, ocr.TIMEOUT))
    if info["available"]:
        deep = ocr.selfcheck()
        if deep.get("error"):
            print("  自检失败：%s" % deep["error"])
        else:
            print("  引擎能否加载 : %s" % ("能" if deep.get("engine_loads") else "不能"))
            print("  内存上限生效 : %s" % (
                "是" if deep.get("memory_cap_enforced")
                else "否（本平台不强制 RLIMIT_AS，建议配 swap 兜底）"))
    print("数据库     : %s" % db.DB_PATH)
    return 0


COMMANDS = {
    "createadmin": createadmin,
    "passwd": passwd,
    "listusers": listusers,
    "importjson": importjson,
    "purge": purge,
    "checkenv": checkenv,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        return 1
    return COMMANDS[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    sys.exit(main())
