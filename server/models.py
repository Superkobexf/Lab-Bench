"""请求体的 Pydantic 模型。

这一层是原来 validateImportData() 那套"只验形状不验内容"的替代品：
类型、长度、取值范围在进业务逻辑之前就被强制住，而且是在服务端，
前端绕不过去。
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 单条自由文本的上限。合同正文另算，见 contracts 路由。
TEXT = 4000
LINE = 300


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ── 登录与账号 ──────────────────────────────────────────────


class LoginIn(Strict):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class PasswordChangeIn(Strict):
    old_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class UserCreateIn(Strict):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    display_name: str = Field(default="", max_length=LINE)
    role: str = Field(pattern=r"^(pi|student)$")
    student_id: Optional[str] = Field(default=None, max_length=64)
    password: str = Field(min_length=1, max_length=256)

    @field_validator("student_id")
    @classmethod
    def blank_to_none(cls, v):
        return v or None


class UserUpdateIn(Strict):
    display_name: Optional[str] = Field(default=None, max_length=LINE)
    student_id: Optional[str] = Field(default=None, max_length=64)
    active: Optional[bool] = None
    new_password: Optional[str] = Field(default=None, max_length=256)


# ── 既有业务记录 ────────────────────────────────────────────


class RecordIn(Strict):
    """payload 保持前端原有对象形状，但强制它是个平坦的 JSON 对象。"""

    id: Optional[str] = Field(default=None, max_length=64)
    payload: Dict[str, Any]

    @field_validator("payload")
    @classmethod
    def check_payload(cls, v):
        if len(v) > 80:
            raise ValueError("字段过多")
        for key, value in v.items():
            if not isinstance(key, str) or len(key) > 64:
                raise ValueError("字段名不合法")
            _check_json_value(value, depth=0)
        return v


def _check_json_value(value, depth):
    """只允许 JSON 基本类型，限制深度和长度，挡住畸形备份。"""
    if depth > 4:
        raise ValueError("嵌套过深")
    if value is None or isinstance(value, (bool, int, float)):
        return
    if isinstance(value, str):
        if len(value) > 20000:
            raise ValueError("文本过长")
        return
    if isinstance(value, list):
        if len(value) > 500:
            raise ValueError("数组过长")
        for item in value:
            _check_json_value(item, depth + 1)
        return
    if isinstance(value, dict):
        if len(value) > 80:
            raise ValueError("字段过多")
        for k, item in value.items():
            if not isinstance(k, str) or len(k) > 64:
                raise ValueError("字段名不合法")
            _check_json_value(item, depth + 1)
        return
    raise ValueError("不支持的数据类型")


class SettingsIn(Strict):
    weeklyReviewDay: Optional[int] = Field(default=None, ge=0, le=6)
    notifyHour: Optional[int] = Field(default=None, ge=0, le=23)
    stipendRate: Optional[float] = Field(default=None, ge=0, le=100000)
    lastExportAt: Optional[str] = Field(default=None, max_length=32)
    lastArchiveScanAt: Optional[str] = Field(default=None, max_length=64)


# ── 功能一：目标 / 计划 / 批注 ──────────────────────────────


class GoalIn(Strict):
    student_id: Optional[str] = Field(default=None, max_length=64)
    horizon: str = Field(pattern=r"^(long|short)$")
    title: str = Field(min_length=1, max_length=LINE)
    detail: str = Field(default="", max_length=TEXT)
    target_date: str = Field(default="", max_length=32)
    status: str = Field(default="进行中", max_length=32)
    progress: int = Field(default=0, ge=0, le=100)
    sort_order: int = Field(default=0, ge=0, le=9999)


class GoalPatch(Strict):
    horizon: Optional[str] = Field(default=None, pattern=r"^(long|short)$")
    title: Optional[str] = Field(default=None, min_length=1, max_length=LINE)
    detail: Optional[str] = Field(default=None, max_length=TEXT)
    target_date: Optional[str] = Field(default=None, max_length=32)
    status: Optional[str] = Field(default=None, max_length=32)
    progress: Optional[int] = Field(default=None, ge=0, le=100)
    sort_order: Optional[int] = Field(default=None, ge=0, le=9999)


class PlanItem(Strict):
    id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=LINE)
    done: bool = False
    goal_id: Optional[str] = Field(default=None, max_length=64)


class PlanIn(Strict):
    student_id: Optional[str] = Field(default=None, max_length=64)
    week_of: str = Field(min_length=1, max_length=32)
    items: List[PlanItem] = Field(default_factory=list, max_length=60)
    status: str = Field(default="草稿", max_length=32)


class AnnotationIn(Strict):
    target_type: str = Field(pattern=r"^(goal|plan|weekly_log)$")
    target_id: str = Field(min_length=1, max_length=64)
    parent_id: Optional[str] = Field(default=None, max_length=64)
    body: str = Field(min_length=1, max_length=TEXT)


class AnnotationPatch(Strict):
    body: Optional[str] = Field(default=None, min_length=1, max_length=TEXT)
    resolved: Optional[bool] = None


# ── 功能二：合同 / 抽取条目 / 待办 ──────────────────────────


class ContractIn(Strict):
    project_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=LINE)
    counterparty: str = Field(default="", max_length=LINE)


class ContractItemPatch(Strict):
    title: Optional[str] = Field(default=None, max_length=LINE)
    parsed_date: Optional[str] = Field(default=None, max_length=32)
    confirmed: Optional[bool] = None
    dismissed: Optional[bool] = None
    remind_days_before: Optional[int] = Field(default=None, ge=0, le=365)


class TodoIn(Strict):
    title: str = Field(min_length=1, max_length=LINE)
    detail: str = Field(default="", max_length=TEXT)
    student_id: Optional[str] = Field(default=None, max_length=64)
    project_id: Optional[str] = Field(default=None, max_length=64)
    due_date: str = Field(default="", max_length=32)
    remind_days_before: int = Field(default=7, ge=0, le=365)


class TodoPatch(Strict):
    title: Optional[str] = Field(default=None, min_length=1, max_length=LINE)
    detail: Optional[str] = Field(default=None, max_length=TEXT)
    due_date: Optional[str] = Field(default=None, max_length=32)
    remind_days_before: Optional[int] = Field(default=None, ge=0, le=365)
    done: Optional[bool] = None
