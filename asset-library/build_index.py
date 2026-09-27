#!/usr/bin/env python3
"""扫描各类别下的 info.md，重新生成 INDEX.md 总目录。用法：python3 build_index.py"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read_meta(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---", text, re.S)
    meta = {}
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                meta[key.strip()] = value.split("#", 1)[0].strip()
    return meta


def main():
    lines = ["# 成果总目录", "", "> 由 `build_index.py` 自动生成，请勿手动编辑。", ""]
    total = 0
    for cat in sorted(p for p in ROOT.iterdir() if p.is_dir() and p.name[:2].isdigit()):
        items = []
        for info in sorted(cat.rglob("info.md")):
            meta = read_meta(info)
            rel = info.parent.relative_to(ROOT).as_posix()
            title = meta.get("title") or info.parent.name
            extra = " · ".join(v for v in (meta.get("date"), meta.get("status"), meta.get("id")) if v)
            items.append(f"- [{title}](<{rel}/>)" + (f" — {extra}" if extra else ""))
        lines.append(f"## {cat.name}（{len(items)}）")
        lines.append("")
        lines.extend(items or ["_暂无_"])
        lines.append("")
        total += len(items)
    lines.insert(4, f"共 {total} 项成果。\n")
    (ROOT / "INDEX.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"INDEX.md 已更新：{total} 项")


if __name__ == "__main__":
    main()
