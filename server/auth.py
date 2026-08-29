"""口令哈希、会话与 CSRF。

口令算法优先 argon2id，装不上时降级到 pbkdf2-sha256（600k 轮）。
哈希串里带算法前缀，users.hash_algo 也存一份，所以两种可以共存：
以后服务器装上 argon2-cffi，用户下次登录成功时会自动重算成 argon2id，
不需要让所有人改密码。

会话 token 在库里只存 sha256，不存原文——数据库万一泄露，
拿到的哈希没法直接拿来冒充会话。
"""

import base64
import datetime
import hashlib
import hmac
import os
import secrets

from db import get_conn, tx

# argon2 的内存开销是「每次哈希」的，不是全局的。
# 10 个人同时登录 = 10 × ARGON2_MEMORY_MB 的瞬时占用，
# 所以这个值必须按机器内存来定，不能照抄库的默认值（64MB → 10 人就是 640MB）。
#   2C2G：19（OWASP 认可的档位之一，10 人同时登录约 190MB）
#   4G 以上：可以调到 46 或 64
ARGON2_MEMORY_MB = int(os.environ.get("LAB_BENCH_ARGON2_MEMORY_MB", "19"))
ARGON2_TIME_COST = int(os.environ.get("LAB_BENCH_ARGON2_TIME_COST", "3"))

try:  # 生产环境走这条
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHash

    _ph = PasswordHasher(
        time_cost=ARGON2_TIME_COST,
        memory_cost=ARGON2_MEMORY_MB * 1024,  # 单位是 KiB
        parallelism=1,  # 2 核机器上并行度留给并发登录本身，不给单次哈希
    )
    ARGON2_AVAILABLE = True
except ImportError:  # 本地开发没装 argon2-cffi 时
    _ph = None
    ARGON2_AVAILABLE = False

PBKDF2_ROUNDS = 600_000
SESSION_TTL = datetime.timedelta(days=14)
SESSION_IDLE_TTL = datetime.timedelta(days=3)
MAX_FAILED = 8
LOCKOUT = datetime.timedelta(minutes=15)
MIN_PASSWORD_LEN = 10

PREFERRED_ALGO = "argon2id" if ARGON2_AVAILABLE else "pbkdf2-sha256"


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _parse_iso(value):
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed


# ── 口令 ────────────────────────────────────────────────────


def hash_password(password):
    """返回 (hash, algo)。"""
    if ARGON2_AVAILABLE:
        return _ph.hash(password), "argon2id"
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    blob = "$pbkdf2-sha256$%d$%s$%s" % (
        PBKDF2_ROUNDS,
        base64.b64encode(salt).decode(),
        base64.b64encode(dk).decode(),
    )
    return blob, "pbkdf2-sha256"


def verify_password(password, stored, algo):
    if not stored:
        return False
    if algo == "argon2id":
        if not ARGON2_AVAILABLE:
            # 库被卸了却还有 argon2 哈希：不能静默放行
            return False
        try:
            return _ph.verify(stored, password)
        except (VerifyMismatchError, VerificationError, InvalidHash):
            return False
    if algo == "pbkdf2-sha256":
        try:
            _, name, rounds, salt_b64, dk_b64 = stored.split("$")
            if name != "pbkdf2-sha256":
                return False
            dk = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                base64.b64decode(salt_b64),
                int(rounds),
            )
            return hmac.compare_digest(dk, base64.b64decode(dk_b64))
        except (ValueError, TypeError):
            return False
    return False


def needs_rehash(algo, stored=""):
    """存的是弱算法、或参数已经变了，就在下次登录成功时顺带重算。"""
    if algo != PREFERRED_ALGO:
        return PREFERRED_ALGO == "argon2id"
    if algo == "argon2id" and ARGON2_AVAILABLE and stored:
        try:
            return _ph.check_needs_rehash(stored)
        except Exception:
            return False
    return False


def password_problem(password):
    """返回不合格原因，合格返回 None。"""
    if len(password) < MIN_PASSWORD_LEN:
        return "口令至少 %d 位。" % MIN_PASSWORD_LEN
    if password.lower() in {"password", "12345678910", "labbench123"}:
        return "口令过于常见，请换一个。"
    kinds = sum(
        [
            any(c.islower() for c in password),
            any(c.isupper() for c in password),
            any(c.isdigit() for c in password),
            any(not c.isalnum() for c in password),
        ]
    )
    if kinds < 2:
        return "口令需要至少包含大小写字母、数字、符号中的两类。"
    return None


# ── 会话 ────────────────────────────────────────────────────


def _token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(user_id, ip="", user_agent=""):
    """返回 (session_token, csrf_token)。session_token 只在这里出现一次明文。"""
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    now = datetime.datetime.now(datetime.timezone.utc)
    with tx() as conn:
        conn.execute(
            "INSERT INTO sessions(token, user_id, csrf_token, created_at, expires_at,"
            " last_seen_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)",
            (
                _token_hash(token),
                user_id,
                csrf,
                now.isoformat(),
                (now + SESSION_TTL).isoformat(),
                now.isoformat(),
                ip,
                (user_agent or "")[:300],
            ),
        )
    return token, csrf


def load_session(token):
    """校验会话并顺带续期。无效返回 None。"""
    if not token:
        return None
    conn = get_conn()
    row = conn.execute(
        "SELECT s.*, u.role, u.username, u.display_name, u.student_id, u.active,"
        "       u.must_change"
        " FROM sessions s JOIN users u ON u.id = s.user_id"
        " WHERE s.token = ?",
        (_token_hash(token),),
    ).fetchone()
    if row is None:
        return None
    now = datetime.datetime.now(datetime.timezone.utc)
    expires = _parse_iso(row["expires_at"])
    last_seen = _parse_iso(row["last_seen_at"])
    if not row["active"] or expires is None or expires <= now:
        destroy_session(token)
        return None
    # 闲置过久也失效，防止公用电脑上会话长期有效
    if last_seen is not None and now - last_seen > SESSION_IDLE_TTL:
        destroy_session(token)
        return None
    with tx() as conn2:
        conn2.execute(
            "UPDATE sessions SET last_seen_at = ? WHERE token = ?",
            (now.isoformat(), _token_hash(token)),
        )
    return dict(row)


def destroy_session(token):
    if not token:
        return
    with tx() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (_token_hash(token),))


def destroy_user_sessions(user_id):
    """改密码、停用账号时把该用户所有会话踢掉。"""
    with tx() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def purge_expired_sessions():
    with tx() as conn:
        conn.execute(
            "DELETE FROM sessions WHERE expires_at <= ?",
            (now_iso(),),
        )


def check_csrf(session, header_value):
    return bool(
        session
        and header_value
        and hmac.compare_digest(session["csrf_token"], header_value)
    )


# ── 登录 ────────────────────────────────────────────────────


def authenticate(username, password, ip=""):
    """返回 (user_row_dict, error_message)。错误信息对外统一，不泄露账号是否存在。"""
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()
    generic = "用户名或口令不正确。"

    if row is None:
        # 没这个人也做一次哈希，抹平时间差，避免用响应快慢枚举用户名
        hash_password(password)
        return None, generic

    locked_until = _parse_iso(row["locked_until"])
    now = datetime.datetime.now(datetime.timezone.utc)
    if locked_until and locked_until > now:
        remain = int((locked_until - now).total_seconds() // 60) + 1
        return None, "尝试次数过多，请 %d 分钟后再试。" % remain

    if not row["active"]:
        return None, "账号已停用，请联系导师。"

    if not verify_password(password, row["password_hash"], row["hash_algo"]):
        failed = row["failed_count"] + 1
        lock = (now + LOCKOUT).isoformat() if failed >= MAX_FAILED else None
        with tx() as conn2:
            conn2.execute(
                "UPDATE users SET failed_count = ?, locked_until = ?, updated_at = ?"
                " WHERE id = ?",
                (failed, lock, now.isoformat(), row["id"]),
            )
        return None, generic

    # 登录成功：清计数，必要时把口令哈希升级到更强的算法
    updates = {"failed_count": 0, "locked_until": None, "last_login_at": now.isoformat()}
    if needs_rehash(row["hash_algo"], row["password_hash"]):
        new_hash, new_algo = hash_password(password)
        updates["password_hash"] = new_hash
        updates["hash_algo"] = new_algo
    with tx() as conn2:
        conn2.execute(
            "UPDATE users SET %s, updated_at = ? WHERE id = ?"
            % ", ".join("%s = ?" % k for k in updates),
            tuple(updates.values()) + (now.isoformat(), row["id"]),
        )
    result = dict(row)
    result.update({k: v for k, v in updates.items()})
    return result, None


def audit(user_id, action, target="", detail="", ip=""):
    with tx() as conn:
        conn.execute(
            "INSERT INTO audit_log(user_id, action, target, detail, ip, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (user_id, action, target, detail[:2000], ip, now_iso()),
        )
