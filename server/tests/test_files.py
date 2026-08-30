"""文件存储的安全边界。

守的是一条线：**只有真图片能内联，其余一律强制下载。**

任何能被浏览器当 HTML 解析的东西，从本域内联返回就等于在应用的
origin 里执行脚本，会话 Cookie 直接失守。SVG 尤其危险——它能带
<script>，看起来却像图片。

改这些用例之前先想清楚：放宽内联范围换来的"预览方便"，
是否值得把 XSS 防线打开。
"""

import pytest

from conftest import PNG


def upload(session, filename, data=PNG, content_type="image/png", student_id=None):
    payload = {"file": (filename, data, content_type)}
    form = {"student_id": student_id} if student_id else None
    return session.post("/api/files", files=payload, data=form)


def test_image_is_served_inline(login):
    pi = login("pi")
    response = upload(pi, "机制图.png")
    assert response.status_code == 200
    info = response.json()["file"]
    assert info["kind"] == "image"

    served = pi.get(info["url"])
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/png"
    assert served.headers["content-disposition"].startswith("inline")
    assert served.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("filename,data,mime", [
    ("说明.pdf", b"%PDF-1.4 x", "application/pdf"),
    ("数据.csv", b"a,b\n1,2", "text/csv"),
    ("笔记.txt", b"hello", "text/plain"),
])
def test_documents_are_forced_to_download(login, filename, data, mime):
    pi = login("pi")
    info = upload(pi, filename, data, mime).json()["file"]
    assert info["kind"] == "doc"
    served = pi.get(info["url"])
    assert served.headers["content-disposition"].startswith("attachment")


def test_svg_is_never_inlined(login):
    """SVG 能带脚本。收得下，但只能当附件下载。"""
    pi = login("pi")
    evil = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    info = upload(pi, "攻击.svg", evil, "image/svg+xml").json()["file"]
    assert info["kind"] == "doc", "SVG 绝不能被归为 image"
    served = pi.get(info["url"])
    assert served.headers["content-disposition"].startswith("attachment")


@pytest.mark.parametrize("filename,mime", [
    ("页面.html", "text/html"),
    ("脚本.js", "application/javascript"),
    ("程序.exe", "application/octet-stream"),
    ("无后缀", "image/png"),
])
def test_dangerous_types_rejected(login, filename, mime):
    pi = login("pi")
    assert upload(pi, filename, b"x", mime).status_code == 400


def test_mime_is_decided_by_server_not_client(login):
    """客户端把 .exe 报成 image/png 也不能蒙混过关。"""
    pi = login("pi")
    assert upload(pi, "木马.exe", b"MZ", "image/png").status_code == 400


def test_empty_file_rejected(login):
    pi = login("pi")
    assert upload(pi, "空.png", b"").status_code == 400


def test_oversize_image_rejected(login):
    pi = login("pi")
    huge = b"\x89PNG\r\n\x1a\n" + b"\x00" * (9 * 1024 * 1024)
    assert upload(pi, "大图.png", huge).status_code == 413


def test_upload_requires_csrf(client, login):
    login("pi")
    response = client.post("/api/files", files={"file": ("a.png", PNG, "image/png")})
    assert response.status_code == 403


def test_download_requires_login(client, login):
    pi = login("pi")
    info = upload(pi, "图.png").json()["file"]
    pi.logout()
    assert client.get(info["url"]).status_code == 401


def test_student_cannot_read_other_students_file(login):
    pi = login("pi")
    info = upload(pi, "张三的图.png", student_id="s1").json()["file"]
    pi.logout()

    lisi = login("lisi")
    assert lisi.get(info["url"]).status_code == 403


def test_student_can_read_unowned_file(login):
    """导师上传的通用素材没有归属，学生要能读到，否则看不到机制图。"""
    pi = login("pi")
    info = upload(pi, "通用素材.png").json()["file"]
    pi.logout()

    lisi = login("lisi")
    assert lisi.get(info["url"]).status_code == 200


def test_student_upload_is_forced_to_own_scope(login):
    """学生指定别人的 student_id，必须被改回他自己。"""
    student = login("zhangsan")
    info = upload(student, "我的.png", student_id="s2").json()["file"]
    assert info["student_id"] == "s1"


def test_student_cannot_delete_others_file(login):
    pi = login("pi")
    info = upload(pi, "导师的.png", student_id="s1").json()["file"]
    pi.logout()

    student = login("zhangsan")
    assert student.delete(info["url"]).status_code == 403


def test_deleted_file_is_gone(login):
    pi = login("pi")
    info = upload(pi, "临时.png").json()["file"]
    assert pi.delete(info["url"]).status_code == 200
    assert pi.get(info["url"]).status_code == 404


def test_filename_with_path_separators_is_safe(login, env):
    """原始文件名带路径分隔符，不能影响落盘位置。"""
    import os

    pi = login("pi")
    info = upload(pi, "../../etc/passwd.png").json()["file"]
    stored = os.listdir(env["uploads"])
    assert all(name.startswith("f_") for name in stored), stored
    assert pi.get(info["url"]).status_code == 200
