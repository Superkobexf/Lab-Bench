"""合同抽取规则。

抽取只认「日期 + 交付/验收/付款/截止」这类组合。签署日期和证件
有效期不能进候选——它们混进日程会让整个倒数日功能失去信任。

标题按分句取，不是按整句：合同里一句话常带好几个节点
（"自 X 起启动，乙方应于 Y 前提交"），按整句取会让两个日期得到
一模一样的标题，用户分不清哪条是哪条。
"""

import datetime

import extract


def d(offset):
    return (datetime.date.today() + datetime.timedelta(days=offset)).isoformat()


CONTRACT = """技术开发合同
本项目自 {start} 起启动，乙方应于 {mid} 前提交中期研究报告
项目最终交付日期为 {final}，甲方应在交付后三十日内组织验收
中期检查安排在二〇二六年九月十日进行
本合同总额为人民币 48.5 万元，签订后甲方支付首款 200,000 元
本合同一式两份，签署日期 {signed}
乙方法人身份证有效期至 2031-05-08
条款编号 100 不应被当作金额
""".format(start=d(-30), mid=d(5), final=d(60), signed=d(-35))


def test_finds_all_date_formats():
    found = {iso for iso, _s, _e, _raw in extract.find_dates(CONTRACT)}
    assert d(-30) in found
    assert d(5) in found
    assert d(60) in found
    assert "2026-09-10" in found, "中文数字日期（二〇二六年九月十日）应能识别"
    assert "2031-05-08" in found


def test_signature_and_id_dates_are_excluded():
    """签署日期和证件有效期没有节点词，不能进候选。"""
    dates = {i["parsed_date"] for i in extract.find_items(CONTRACT) if i["kind"] == "date"}
    assert d(-35) not in dates, "签署日期不该进日程"
    assert "2031-05-08" not in dates, "身份证有效期不该进日程"


def test_milestone_dates_are_picked_up():
    dates = {i["parsed_date"] for i in extract.find_items(CONTRACT) if i["kind"] == "date"}
    assert d(60) in dates   # 交付
    assert d(5) in dates    # 提交
    assert "2026-09-10" in dates  # 中期检查


def test_titles_are_distinct_per_date():
    """同一句里的多个日期必须拿到各自的分句，否则用户分不清。"""
    items = [i for i in extract.find_items(CONTRACT) if i["kind"] == "date"]
    titles = [i["title"] for i in items]
    assert len(titles) == len(set(titles)), titles


def test_confidence_reflects_milestone_weight():
    """交付/验收应当比"起启动"更可信。"""
    items = {i["parsed_date"]: i["confidence"]
             for i in extract.find_items(CONTRACT) if i["kind"] == "date"}
    assert items[d(60)] > items[d(-30)]


def test_amounts_parsed_with_unit_conversion():
    amounts = {int(i["parsed_amount"])
               for i in extract.find_items(CONTRACT) if i["kind"] == "amount"}
    assert 485000 in amounts, "48.5 万元应换算成 485000"
    assert 200000 in amounts


def test_small_numbers_are_not_amounts():
    """条款编号、页码这类小数字不能当金额。"""
    amounts = {int(i["parsed_amount"])
               for i in extract.find_items(CONTRACT) if i["kind"] == "amount"}
    assert 100 not in amounts


def test_pdf_text_layer_preserves_line_structure():
    """PDF 的换行必须还原。

    所有文字连成一行的话，后面按分句取标题会全部失效——
    这正是早期版本踩过的坑。
    """
    import io
    import zlib

    lines = ["第一行 交付日期为 2026-12-15", "第二行 提交日期为 2026-06-30"]
    content = b"BT /F1 12 Tf 72 720 Td\n"
    for line in lines:
        content += b"(" + line.encode("utf-8") + b") Tj 0 -16 Td\n"
    content += b"ET"
    stream = zlib.compress(content)
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" /Filter /FlateDecode >>\nstream\n"
        + stream + b"\nendstream",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    for index, obj in enumerate(objs, 1):
        out.write(b"%d 0 obj\n" % index + obj + b"\nendobj\n")
    out.write(b"trailer\n<< /Root 1 0 R >>\n%%EOF")

    text = extract.pdf_text(out.getvalue())
    assert "\n" in text, "PDF 文本必须保留换行，否则分句抽取会失效"
    assert len(text.strip().split("\n")) >= 2


def test_no_text_layer_returns_empty():
    """扫描件取不到文本，要返回空让调用方去走 OCR，而不是抛错。"""
    assert extract.pdf_text(b"%PDF-1.4\n% no text\n%%EOF") == ""
