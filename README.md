# Lab Bench 课题组管理台

面向高校课题组 PI（课题负责人）的本地管理工具。管理研究生、硕士课题、横向课题、组内事务、每周进展、成果和经费投入。

A local-first management tool for university research group leaders. Keeps track of graduate students, their projects, industry contracts, group duties, weekly progress, outputs and spending.

**零安装、零依赖、零服务器。** 几个静态文件，双击就能用。数据只存在你自己电脑的浏览器里，不上传任何服务器。

**No install, no dependencies, no server.** A handful of static files — double-click and it runs. Your data stays in your own browser and is never uploaded anywhere.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> 本文档中英对照，所有截图均使用虚构的演示数据，不涉及任何真实人员、单位或成果。
>
> This document is bilingual. Every screenshot uses fictional demo data — no real people, organisations or publications are involved.

## 界面语言 · Interface language

界面支持中文和英文，侧边栏左下角随时切换，选择会记住。首次打开时按浏览器语言自动判断：中文环境用中文，其余用英文。

The interface is available in Chinese and English. Switch any time from the bottom of the sidebar; your choice is remembered. On first run it follows your browser language — Chinese locales get Chinese, everyone else gets English.

![总览（中文界面）](docs/screenshots/dashboard.png)

![Overview (English interface)](docs/screenshots/en/dashboard.png)

## 为什么做这个 · Why this exists

带研究生的老师大多在用微信群 + 文件夹 + 脑子记事。学生的实验进度、卡在哪里、论文写到第几稿、这学期花了多少耗材费——这些信息散在各处，学期末想复盘就得从头翻聊天记录。

Most academics supervising graduate students run on group chats, folders, and memory. How far along an experiment is, where a student is stuck, which draft the paper is on, how much was spent on consumables this term — it all lives in different places, and reconstructing it at the end of term means scrolling back through months of messages.

商业的科研管理系统要么太重（面向整个学院），要么要把数据传到别人的服务器上。这个工具的定位很简单：**一个人就能用起来的课题组台账**，数据在自己手里。

Commercial research management systems are either too heavy (built for a whole department) or want your data on someone else's server. This tool aims at something simpler: **a ledger for one research group that one person can actually keep up with**, with the data staying in your hands.

## 快速开始 · Getting started

下载或克隆本仓库，然后二选一：

Download or clone this repository, then either:

- **方式一（推荐）**：双击 `start-lab.command`，浏览器打开 `http://localhost:5299`。
  **Option 1 (recommended)**: double-click `start-lab.command` and open `http://localhost:5299`.
- **方式二**：直接双击 `index.html`。
  **Option 2**: open `index.html` directly.

手动启动命令 · Or start it manually:

```bash
python3 -m http.server 5299 --bind 127.0.0.1
```

系统自带一套示例数据（一个示例学生、课题、周进展、成果和费用记录），方便你先摸清每个模块怎么用，之后可以在"数据"页一键恢复或直接删掉示例内容。

It ships with a small set of sample data (one student, one project, a weekly log, an output and an expense) so you can see how each module is meant to be used. Delete it, or reset it any time from the Data page.

> **浏览器建议用 Chrome 或 Edge。** "档案扫描"和"关联文件"依赖 File System Access API，Safari 和 Firefox 目前不支持，其余功能不受影响。
>
> **Chrome or Edge recommended.** File Scan and file linking rely on the File System Access API, which Safari and Firefox don't support yet. Everything else works everywhere.

## 功能模块 · Modules

| 模块 Module | 用途 | What it's for |
| --- | --- | --- |
| **总览** Overview | 学生进展、过期周报、风险提示、事务积分和导师今日待办 | Student progress, overdue logs, risk alerts, duty points and your queue for today |
| **在读学生** Students | 年级、预计毕业、状态、联系方式和导师关注点 | Year, expected graduation, status, contact details and what you're watching |
| **毕业学生** Alumni | 毕业去向、现任职位、联系方式——课题组自己的校友网络 | Where graduates went, current roles, contacts — your group's own alumni network |
| **硕士课题** Projects | 整体规划、实验进展、文献库、数据分析、进度和风险 | Plan, experiments, literature, data analysis, progress and risk |
| **研讨看板** Discussion | 按课题关键词生成知识图谱，机制图讨论区 | Keyword graph generated from each project, plus a space for mechanism diagrams |
| **档案扫描** File Scan | 授权选择学生档案文件夹，自动识别新增文件并解析内容 | Point it at a student's folder; it finds new files and reads their contents |
| **横向课题** Industry | 合作单位、合作老师、学生分工和交付物 | Partner organisations, contacts, student assignments and deliverables |
| **合作线索** Leads | 企业、科研院所、大学等外部合作与学生发展机会跟踪 | Long-term tracking of external contacts and career openings for students |
| **AI 爬虫** Paper Radar | 按课题检索词从 OpenAlex、Crossref、Europe PMC 抓近 30 天新论文 | Pulls papers from the last 30 days out of OpenAlex, Crossref and Europe PMC |
| **课题组事务** Group Duties | 事务量、小时数、积分和状态，可作为劳务费依据 | Who did what, hours, points and status — a basis for allocating stipends |
| **周进展** Weekly Logs | 每周记录实验、数据、文献、卡点、下周计划和导师反馈 | Experiments, data, literature, blockers, next-week plan and your feedback |
| **成果展板** Output Board | SCI、投稿、论文草稿的公开统计，形成正向压力 | Papers, submissions and drafts per student, shown openly |
| **经费投入** Spending | 耗材、检测、版面费、补助，以及每 IF 投入的产出比 | Reagents, instrument time, publication fees, stipends and cost per unit of output |
| **数据** Data | 导入导出 JSON 备份、规则设置、浏览器内历史备份 | JSON export/import, settings and in-browser backup history |

## 界面预览 · A look at it

**成果展板**——每位学生的 SCI、投稿和草稿状态摆在同一个页面上。公开可见能形成正向压力，比私下催进度有效。

**Output Board** — every student's papers, submissions and drafts on one page. Making it visible to the whole group works better than chasing people privately.

![成果展板 Output Board](docs/screenshots/achievements.png)

**经费投入**——耗材、检测、版面费和补助都是真实培养成本。补齐影响因子后可以粗略看到每 IF 的投入。

**Spending** — consumables, instrument time, publication fees and stipends are all real costs of training someone. Fill in impact factors and you get a rough cost-per-IF.

![经费投入 Spending](docs/screenshots/en/funding.png)

**硕士课题**——规划、实验、数据分析和文献库集中在一张卡片上，风险等级和复盘日期一眼可见。

**Projects** — plan, experiments, analysis and literature on a single card, with risk level and review date visible at a glance.

![硕士课题 Projects](docs/screenshots/topics.png)

## 几个值得说明的设计 · Design decisions worth explaining

**档案扫描能读文件内容，不只是文件名。** 授权一个文件夹后，系统会递归扫描，解析 `.txt` `.md` `.csv` `.json` `.docx` `.xlsx` `.pdf` 的正文，据此更新档案快照并生成周进展候选稿——候选稿需要导师审核通过才进入正式记录。

**File Scan reads file contents, not just filenames.** Grant access to a folder and it walks the tree, extracting text from `.txt` `.md` `.csv` `.json` `.docx` `.xlsx` and `.pdf`, then updates the archive snapshot and drafts a weekly log — which you have to approve before it becomes a real record.

PDF 解析是零依赖手写的（解 FlateDecode 流取文本操作符）。**能覆盖大部分由 Word、LaTeX 和期刊排版系统生成的 PDF，但扫描件和使用 CID 字体的 PDF 取不到文本**，这种情况会退回只记文件名，不会往档案里写乱码。

PDF extraction is written from scratch with no dependencies (inflating FlateDecode streams and reading the text operators). **It handles most PDFs produced by Word, LaTeX and journal typesetters, but scanned documents and PDFs using CID fonts yield no text.** In that case it falls back to recording the filename only, rather than writing garbage into your archive.

**文件夹名和学生姓名对不上时不会静默失败。** 没匹配上的文件夹会列在"档案扫描"页面，点一下就能指派给对应学生，指派后作为别名保存，以后自动识别。

**A folder name that doesn't match a student isn't a silent failure.** Unmatched folders are listed on the File Scan page; assign one to a student and the name is saved as an alias, recognised automatically from then on.

**关联文件只存文件名和文本摘要，不存文件本身。** 浏览器存储容量有限，存二进制会很快撑爆，也会让导出的备份 JSON 无法使用。所以原文件请不要随意删除或移动。

**Linked files store the filename and a text excerpt, not the file itself.** Browser storage is small; keeping binaries would fill it fast and make the exported backup unusable. So don't delete or move the originals.

**备份提醒是刻意做得显眼的。** 数据存在 localStorage 里，清一次浏览器缓存就全没了。系统里的"每日自动备份"同样存在浏览器里，救不了这种情况——**只有导出成 JSON 文件才是真备份**。超过 14 天没导出，首页会出现提醒。

**The backup warning is deliberately loud.** Data lives in localStorage, and clearing your browser wipes it. The daily automatic backup lives in the same place, so it won't save you — **only exporting a JSON file is a real backup**. If you haven't exported in 14 days, the front page says so.

## 数据与隐私 · Data and privacy

所有数据保存在当前浏览器的 localStorage 中，不经过任何服务器。唯一的联网行为是"AI 爬虫"模块调用公开论文索引 API（OpenAlex、Crossref、Europe PMC），不需要注册账号，也不会上传你的任何数据。

Everything is stored in your browser's localStorage and never touches a server. The only network activity is the Paper Radar module calling public paper indexes (OpenAlex, Crossref, Europe PMC). No account is needed and none of your data is sent anywhere.

**换浏览器或换电脑前，务必在"数据"页导出 JSON 备份。**

**Before switching browsers or machines, export a JSON backup from the Data page.**

## 常见问题 · FAQ

**端口被占用？** 修改 `start-lab.command` 里的端口号。
**Port already in use?** Change the port in `start-lab.command`.

**多人怎么用？** 各自在自己电脑上用，各自维护自己课题组的数据。需要迁移时用"数据"页的导出/导入。
**How do several people use it?** Each on their own machine with their own data. Move data around with export/import on the Data page.

**能放到服务器上多人共享吗？** 当前版本是纯前端单机应用，没有账号体系和并发控制，不适合直接放公网。有这个需求建议 fork 后自行接后端。
**Can I host it for a shared team?** Not as it stands — it's a purely client-side single-user app with no accounts or concurrency control, so it isn't suitable for the open internet. Fork it and add a backend if you need that.

**爬虫要什么条件？** 需要联网，调用的是公开 API，不用注册。
**What does Paper Radar require?** An internet connection. It calls public APIs and needs no account.

## 参与贡献 · Contributing

欢迎 Issue 和 PR。这个项目是我在带自己课题组的过程中一点点长出来的，功能取舍带有明显的个人偏好，如果你的使用场景不一样，非常欢迎提出来。

Issues and pull requests are welcome. This grew out of running my own research group, so the feature choices reflect a particular way of working — if yours differs, please say so.

代码主体是单文件 `app.js`，没有构建步骤，改完刷新浏览器就能看到效果。

The bulk of the code is a single `app.js` with no build step; edit it and refresh the browser.

**想加一门语言？** 只改 `i18n.js` 一个文件：复制里面的 `EN` 对象，把值翻译成目标语言，注册到 `DICTIONARIES`，再在侧边栏的切换器里加一个按钮。`app.js` 一行都不用动 —— 词典直接用中文原文当 key，所以源码读起来仍然是自然语句。

**Want to add a language?** You only touch `i18n.js`: copy the `EN` object, translate the values, register it in `DICTIONARIES`, and add a button to the switcher in the sidebar. Not a single line of `app.js` needs to change — the dictionary is keyed on the original Chinese strings, so the source still reads as natural sentences.

## 许可协议 · Licence

[MIT](LICENSE)。可自由使用、修改和分发，包括商业用途。

[MIT](LICENSE). Free to use, modify and distribute, including commercially.

做这个工具的初衷是给和我一样带研究生的高校老师免费用，如果它帮你省下了一些时间，我会很高兴。

This was built to be given away to other academics supervising graduate students. If it saves you some time, that's the point.
