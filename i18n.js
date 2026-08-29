/* ── 多语言 / Internationalization ──────────────────────────────────
   设计说明（给想加语言的贡献者）：

   界面文案直接以中文原文作为词典的 key，而不是 "dashboard.title" 这类
   抽象 key。这样做的取舍是：源码读起来仍然是自然语句，新增语言只需要在
   下面照着 EN 再写一份，不必回头改动 app.js 的任何一行。

   翻译发生在渲染之后：render 出来的 HTML 字符串整体过一遍 translate()。
   为此有三条必须遵守的规则，破坏任何一条都会出真实的 bug：

   1. 只翻译标签之间的文本，以及 placeholder / title / aria-label / alt
      这几个属性。其余属性一律原样保留 —— 因为 <option value="已发表">
      的 value 是会被存进数据里、并参与逻辑判断的，翻译了就会导致
      筛选和统计失效。

   2. 用户自己输入的内容不翻译。app.js 里的 escapeHTML() 会把用户数据
      包在一对私有区字符里，translate() 遇到这段就跳过。否则一个叫
      "数据分析" 的课题名会被当成界面文案翻掉。

   3. 词典按 key 长度从长到短匹配。因为模板里有 `匹配到 ${n} 位学生`
      这类插值，运行时会变成 "匹配到 3 位学生"，必须能分段命中。

   How to add a language: copy the EN object, translate the values,
   register it in DICTIONARIES below, and add an option to the switcher
   in renderLanguageSwitch(). No changes to app.js are required.
   ------------------------------------------------------------------ */

const LANG_KEY = "lab-group-lang-v1";

/* 用户数据的保护标记：私有使用区字符，不会出现在正常文本里 */
const GUARD_OPEN = "\uE000";
const GUARD_CLOSE = "\uE001";

const EN = {
  /* ── 导航与视图标题 ── */
  "课题组管理台": "Lab Bench",
  "本地管理工具": "Local-first tool",
  "总览": "Overview",
  "在读学生": "Students",
  "毕业学生": "Alumni",
  "硕士课题": "Projects",
  "研讨看板": "Discussion",
  "档案扫描": "File Scan",
  "横向课题": "Industry",
  "合作线索": "Leads",
  "AI 爬虫": "Paper Radar",
  "课题组事务": "Group Duties",
  "周进展": "Weekly Logs",
  "成果展板": "Output Board",
  "经费投入": "Spending",
  "数据": "Data",
  "主导航": "Main navigation",

  /* ── 登录与账号 ── */
  "登录": "Sign in",
  "退出": "Sign out",
  "用户名": "Username",
  "口令": "Password",
  "当前口令": "Current password",
  "新口令": "New password",
  "再输一次": "Repeat new password",
  "请先设置新口令": "Set a new password first",
  "保存并继续": "Save and continue",
  "账号由导师创建。忘记口令请联系导师重置。": "Accounts are created by your supervisor. Ask them to reset a forgotten password.",
  "这是导师给你的初始口令，第一次登录需要改掉。": "This is the temporary password your supervisor gave you; change it before continuing.",
  "导师": "Supervisor",
  "学生": "Student",
  "用户名或口令不正确。": "Incorrect username or password.",
  "登录已过期，请重新登录。": "Your session has expired. Please sign in again.",
  "口令已更新，请用新口令登录。": "Password updated. Please sign in with the new one.",
  "两次输入的新口令不一致。": "The two new passwords do not match.",
  "连不上服务器，请检查网络或稍后重试。": "Cannot reach the server. Check your connection and try again.",
  "请求失败": "Request failed",
  "提交的内容不合法。": "The submitted data is not valid.",
  "数据保存在课题组服务器上。": "Data is stored on the group server.",
  "保存中…": "Saving…",
  "已保存": "Saved",
  "保存失败": "Save failed",
  "请重试": "please try again",
  "正在载入…": "Loading…",

  /* ── 目标与计划 ── */
  "目标与计划": "Goals & Plans",
  "长期与短期目标、每周工作计划，以及导师批注。": "Long- and short-term goals, weekly work plans and supervisor notes.",
  "长期目标": "Long-term goals",
  "短期目标": "Short-term goals",
  "近期工作计划": "Recent work plans",
  "新增目标": "Add goal",
  "编辑目标": "Edit goal",
  "填写本周计划": "Fill in this week's plan",
  "本周工作计划": "This week's work plan",
  "周起始日": "Week starting",
  "计划条目（每行一条）": "Plan items (one per line)",
  "目标日期": "Target date",
  "完成度 %": "Progress %",
  "具体说明": "Details",
  "还没有长期目标": "No long-term goals yet",
  "还没有短期目标": "No short-term goals yet",
  "还没有填写工作计划": "No work plan filled in yet",
  "点上面的按钮添加一条。": "Use the button above to add one.",
  "当周": "week",
  "完成": "done",
  "这一周还没有具体条目。": "No items for this week yet.",
  "批注": "Notes",
  "写批注": "Write a note",
  "回复批注": "Reply to note",
  "回复": "Reply",
  "标记已处理": "Mark handled",
  "重新打开": "Reopen",
  "已处理": "Handled",
  "条待处理批注": "notes to handle",
  "（已注销）": "(deleted account)",
  "进行中": "In progress",
  "有风险": "At risk",
  "已完成": "Done",
  "已搁置": "On hold",
  "草稿": "Draft",
  "已提交": "Submitted",

  /* ── 合同与倒数日 ── */
  "合同管理": "Contracts",
  "横向合同多版本存档、关键日期抽取和倒数日提醒。": "Versioned industry contracts, extracted key dates and countdown reminders.",
  "新建合同": "New contract",
  "合同名称": "Contract name",
  "所属横向课题": "Industry project",
  "对方单位": "Counterparty",
  "上传新版本": "Upload new version",
  "查看条目": "View items",
  "重新解析": "Re-parse",
  "版本": "Version",
  "文件": "File",
  "版本说明": "Version note",
  "解析": "Parsing",
  "候选": "Candidates",
  "个版本": "versions",
  "条待确认": "to confirm",
  "抽取结果": "extracted items",
  "还没有上传合同": "No contracts uploaded yet",
  "扫描件识别可用": "Scanned-document OCR available",
  "扫描件识别不可用": "Scanned-document OCR unavailable",
  "扫描件无法自动识别": "Scanned documents cannot be read automatically",
  "取不到文字": "No text found",
  "待解析": "Not parsed",
  "解析中": "Parsing",
  "可信度": "Confidence",
  "确认并建待办": "Confirm and create task",
  "撤销确认": "Undo confirm",
  "修改": "Edit",
  "忽略": "Dismiss",
  "已确认": "Confirmed",
  "已忽略": "Dismissed",
  "修改抽取条目": "Edit extracted item",
  "标题": "Title",
  "提前几天提醒": "Remind days ahead",
  "没有抽到候选条目": "No candidate items found",
  "倒数日与待办": "Countdown & tasks",
  "新增待办": "Add task",
  "事项": "Task",
  "到期日": "Due date",
  "指派给": "Assign to",
  "不指派": "Unassigned",
  "没有待办": "No tasks",
  "确认合同里的关键日期，或手动添加一条。": "Confirm key dates from a contract, or add one manually.",
  "没有到期日": "No due date",
  "今天到期": "Due today",
  "没有逾期": "Nothing overdue",
  "条逾期": "overdue",
  "条今天到期": "due today",
  "来自合同": "From contract",
  "合同资料只对导师账号开放。": "Contract records are visible to supervisor accounts only.",
  "请先在「横向课题」页面添加合作单位，再上传合同。": "Add an industry partner on the Industry page before uploading a contract.",

  "学生进展、风险和事务负担的今日快照。": "Today's snapshot of student progress, risks and duty load.",
  "培养阶段、联系方式、毕业节点和个人目标。": "Stage, contact details, graduation date and personal goals.",
  "毕业去向、现任职位、联系方式和可交流资源。": "Destination, current role, contact details and what they can advise on.",
  "规划、实验进展、文献库、数据分析和阶段风险。": "Plan, experiments, literature, data analysis and stage risk.",
  "机制图、文献知识图谱和待入学课题建议。": "Mechanism diagrams, literature graph and topic suggestions for incoming students.",
  "按学生汇总材料版本、关键文件和待导师检查点。": "Material versions, key files and advisor checkpoints, grouped by student.",
  "合作单位、合作老师、学生分工和后续具体项目。": "Partner organisations, contacts, student assignments and follow-up projects.",
  "企业、科研院所、大学等外部合作与学生发展机会的长期跟踪。": "Long-term tracking of external contacts and career opportunities for students.",
  "按学生课题配置检索词，抓取近 30 天新论文并沉淀重要发现。": "Configure search terms per project, pull papers from the last 30 days and keep what matters.",
  "事务量、完成情况和劳务费分配依据。": "Duty load, completion status and the basis for stipend allocation.",
  "每周记录实验、数据、问题、下周计划和导师反馈。": "Weekly record of experiments, data, blockers, next-week plans and advisor feedback.",
  "SCI、投稿、论文草稿和阶段成果的公开统计。": "Public tally of papers, submissions, drafts and staged outputs.",
  "试剂耗材、仪器检测、论文版面、补助和投入产出比。": "Reagents, instrument time, publication fees, stipends and cost-per-output.",
  "本地导入导出、重置示例数据和提醒说明。": "Local import/export, sample data reset and reminder settings.",

  /* ── 通用动作与状态 ── */
  "编辑": "Edit",
  "删除": "Delete",
  "查看": "View",
  "保存": "Save",
  "取消": "Cancel",
  "导入": "Import",
  "关闭": "Close",
  "跟进": "Follow up",
  "去处理": "Handle",
  "通过": "Approve",
  "丢弃": "Discard",
  "扫描": "Scan",
  "筛选": "Filter",
  "记录": "Record",
  "进度": "Progress",
  "状态": "Status",
  "日期": "Date",
  "类别": "Category",
  "备注": "Notes",
  "姓名": "Name",
  "年级": "Year",
  "阶段": "Stage",
  "计划": "Plan",
  "结果": "Result",
  "分析": "Analysis",
  "讨论": "Discussion",
  "问题": "Blockers",
  "进展": "Progress",
  "成果": "Output",
  "课题": "Project",
  "学生": "Students",
  "事务": "duties",
  "论文": "paper",
  "文献": "literature",
  "实验": "experiment",
  "风险": "risk",
  "积分": "points",
  "金额": "Amount",
  "占比": "Share",
  "小时": "hours",
  "元": " CNY",
  "条": "",
  "篇": "",
  "个": "",
  "件": "",
  "位学生": " students",
  "条记录": " records",
  "个文件": " files",
  "个单位": " organisations",
  "篇 SCI": " papers",
  "个近期复盘": " reviews due",
  "条候选稿": " drafts",
  "条近期跟进": " due soon",
  "个近两周更新文件：": " files updated in the last two weeks: ",

  "高": "High",
  "中": "Medium",
  "低": "Low",
  "高风险": "High risk",
  "中风险": "Medium risk",
  "低风险": "Low risk",
  "全部风险": "All risk levels",
  "全部状态": "All statuses",
  "全部类别": "All categories",
  "全部去向": "All destinations",
  "全部学生": "All students",
  "其他": "Other",
  "未知": "Unknown",
  "暂无": "None",
  "待补": "TBD",
  "待定": "TBD",
  "未分配": "Unassigned",
  "完成": "Done",
  "进行中": "In progress",
  "计划中": "Planned",
  "待审核": "Pending review",
  "已更新": "Updated",
  "该看进展": "Needs review",

  /* ── 总览 ── */
  "记录周进展": "Log weekly progress",
  "新增学生": "Add student",
  "当前培养对象": "Currently supervised",
  "待看周报": "Weekly logs due",
  "超过7天未更新": "Not updated in 7+ days",
  "横向合作": "Industry projects",
  "合作单位条目": "Partner organisations",
  "事务积分": "Duty points",
  "劳务核算依据": "Basis for stipends",
  "劳务依据": "Stipend basis",
  "导师今日待办": "Your queue today",
  "今天没有紧急事项": "Nothing urgent today",
  "可以集中看论文、写反馈或整理横向线索。": "A good day for reading papers, writing feedback or tidying up industry leads.",
  "学生进展": "Student progress",
  "需要你看的问题": "Issues needing you",
  "目前没有明显风险": "No visible risks",
  "继续保持每周记录即可。": "Just keep the weekly records going.",
  "补一条周报": "Add a weekly log",
  "调整规则": "Adjust rules",
  "还没有可展示的学生": "No students to show yet",
  "添加学生和课题后可用。": "Available once you add students and projects.",
  "最近周报": "Latest log",
  "复盘": "Review",
  "暂无周报": "No log yet",
  "还没有绑定硕士课题": "No project linked yet",
  "需要补周进展": " needs a weekly log",
  "上次更新是": "Last updated ",
  "还没有正式周进展。": "No weekly log recorded yet.",
  "课题需要复盘": " is due for review",
  "复盘日期": "review due ",
  "接近交付节点": " has a milestone approaching",
  "交付节点已过期": " milestone is overdue",
  "合作线索需要跟进": " lead needs following up",
  "有周进展候选稿待审核": " has a draft weekly log awaiting review",
  "有新的论文雷达结果": " has new paper radar results",
  "提醒": "Reminder",
  "优先": "Priority",
  "的候选周进展？": "'s draft weekly log?",
  "的周进展": "'s weekly log",
  "的记录？": "'s record?",
  "的课题复盘已到期": "'s project review is overdue",
  "的硕士课题处于": "'s project is at ",
  "的课题机制图": "'s mechanism diagram",
  "已": " has gone ",
  "天未": " days without ",
  "原定复盘日期为": "Originally due ",
  "需要拆出最近一周可验证的小目标。": "break this into a verifiable one-week goal.",
  "当前进度": "current progress",
  "建议先看实验记录和下周计划，避免短期问题拖成长期停滞。": "Check the lab notes and next-week plan first, before a short delay becomes a long stall.",
  "建议检查实验、文献库和数据分析是否同步推进。": "Check whether experiments, literature and analysis are advancing together.",

  /* ── 学生与毕业生 ── */
  "搜索姓名、年级或状态": "Search by name, year or status",
  "当前角色": "Current role",
  "联系方式": "Contact",
  "预计毕业": "Expected graduation",
  "导师关注点": "What you're watching",
  "档案文件夹别名": "Archive folder alias",
  "文件夹名和姓名不一致时填，多个用顿号隔开": "Fill in when the folder name differs from the student name; separate multiple with commas",
  "编辑学生": "Edit student",
  "待入学": "Incoming",
  "研一": "Year 1",
  "研二": "Year 2",
  "研三": "Year 3",
  "硕士": "Master's",
  "博士": "PhD",
  "本科": "Bachelor's",
  "联合培养": "Joint programme",
  "入门阶段": "Getting started",

  "搜索姓名、单位、职位、方向或联系方式": "Search by name, organisation, role, field or contact",
  "新增毕业生": "Add alumnus",
  "新增毕业学生": "Add alumnus",
  "编辑毕业学生": "Edit alumnus",
  "删除毕业生": "Delete alumnus",
  "已记录校友": "Alumni on record",
  "学术/读博": "Academia / PhD",
  "企业研发": "Industry R&D",
  "可交流深造": "Can advise on further study",
  "可交流就业": "Can advise on jobs",
  "可联系": "Reachable",
  "有联系方式": "Contact on file",
  "待补联系方式": "No contact yet",
  "毕业生去向": "Where alumni went",
  "毕业去向": "Destination",
  "毕业年份": "Graduation year",
  "毕业年份待补": "Year TBD",
  "毕业学位/层次": "Degree",
  "学位待补": "Degree TBD",
  "去向待补": "Destination TBD",
  "地区待补": "Location TBD",
  "现单位": "Current organisation",
  "现单位/学校": "Current organisation",
  "现任职位": "Current role",
  "所在城市": "City",
  "主要联系方式": "Primary contact",
  "电话": "Phone",
  "微信": "WeChat",
  "邮箱": "Email",
  "研究/能力方向": "Field / skills",
  "可交流内容": "Can advise on",
  "读博深造": "PhD study",
  "高校/科研院所": "University / institute",
  "公务/事业单位": "Government / public sector",
  "创业/自由职业": "Founder / freelance",
  "研发工程师": "R&D engineer",
  "电话、微信、邮箱或备注": "Phone, WeChat, email or a note",
  "例如 博士生、研发工程师、高校教师": "e.g. PhD student, R&D engineer, lecturer",
  "读博、就业、论文、实验、企业研发、城市生活等": "PhD applications, job hunting, papers, experiments, industry work, city life",
  "待补读博、就业、论文、实验或行业经验": "Add what they can advise on: PhD, jobs, papers, experiments or industry",
  "例如 2026": "e.g. 2026",
  "这个板块可以变成课题组自己的校友网络。": "This can become your group's own alumni network.",
  "在读学生需要了解读博、就业、企业研发、论文投稿或毕业选择时，可以先从这里找到合适的师兄师姐联系。": "When current students need advice on PhD applications, jobs, industry work or submissions, this is where they find the right senior to ask.",

  /* ── 课题 ── */
  "新增课题": "Add project",
  "新增硕士课题": "Add project",
  "编辑硕士课题": "Edit project",
  "删除课题": "Delete project",
  "课题名称": "Project title",
  "整体规划": "Overall plan",
  "实验进展": "Experiments",
  "文献库": "Literature",
  "数据分析": "Data analysis",
  "进度百分比": "Progress (%)",
  "下次复盘": "Next review",
  "文献库：": "Literature: ",
  "档案路径：": "Archive path: ",
  "暂无课题": "No projects yet",
  "文献调研与实验方案设计": "Literature review and experiment design",
  "课题入门与文献积累": "Onboarding and literature building",
  "暂无数据，待实验启动后记录。": "No data yet; will record once experiments begin.",

  /* ── 研讨看板 ── */
  "机制图讨论": "Mechanism discussion",
  "文献知识图谱": "Literature graph",
  "待入学课题池": "Incoming-student topic pool",
  "课题建议": "Topic suggestion",
  "添加待入学课题建议": "Add a topic suggestion",
  "选择待入学学生。": "Select an incoming student.",
  "请先添加学生。": "Add a student first.",
  "请先添加课题信息。": "Add project details first.",
  "暂无机制图": "No mechanism diagram",
  "可将图片放入学生档案目录": "Put images in the student's archive folder",
  "自动提取关键词": "Keywords extracted automatically",
  "关键词": "Keyword",
  "建议本周讨论的问题": "Questions worth discussing this week",
  "导师追问": "Advisor follow-up",
  "帮助学生入学前就有明确的文献阅读方向。": "Gives incoming students a clear reading direction before they arrive.",

  /* ── 档案扫描 ── */
  "搜索学生、文件或检查点": "Search students, files or checkpoints",
  "扫描学生档案文件夹": "Scan student archive folder",
  "未扫描": "Not scanned",
  "材料快照": "Material snapshot",
  "导师优先检查": "Check these first",
  "还没有扫描记录": "No scans yet",
  "要看": "Look at",
  "导师检查": "Advisor review",
  "没对上学生的文件夹": "Folders with no matching student",
  "指派给学生": "Assign to student",
  "文件夹名和学生姓名不一致时会出现在这里。指派一次之后，以后扫描就能自动认出来。": "Folders whose name doesn't match a student appear here. Assign once and future scans will recognise them.",
  "指派后，这个文件夹名会作为该学生的档案别名保存，以后扫描会自动认它。": "Once assigned, this folder name is saved as an alias for that student and recognised automatically from now on.",
  "请先添加学生，再指派文件夹。": "Add a student before assigning folders.",
  "扫描完成：匹配到": "Scan complete: matched ",
  "位学生的档案，已更新档案扫描并生成周进展候选稿。": " students; archives updated and draft weekly logs generated.",
  "还有": "Another ",
  "个文件夹没对上学生，可以在页面上手动指派。": " folders had no matching student; you can assign them manually on the page.",
  "扫描完成，但没有一个文件夹能对上学生姓名。": "Scan complete, but no folder matched a student name.",
  "扫到这些文件夹：": "Folders found:",
  "页面可以把它们手动指派给对应学生。": " page you can assign them to students manually.",
  "扫描完成：所选文件夹里没有找到任何文件。": "Scan complete: no files found in the selected folder.",
  "扫描失败：": "Scan failed: ",
  "请重新选择文件夹。": "Please pick the folder again.",
  "当前浏览器不支持直接选择文件夹。可以继续手动维护档案扫描，或换用支持 File System Access API 的浏览器（如 Chrome）。": "This browser can't open a folder directly. You can keep the archive up to date manually, or use a browser that supports the File System Access API (such as Chrome).",
  "本次扫描未明显识别到数据结果文件。": "This scan found no obvious data or result files.",
  "本次扫描未明显识别到文献更新。": "This scan found no obvious literature updates.",
  "新增文件是否形成明确本周产出。": "Check whether the new files add up to a clear output for the week.",
  "看新增文献是否进入课题问题链和论文讨论。": "Check whether new literature feeds into the project's questions and the paper's discussion.",
  "请确认学生分工和后续具体项目。": "Confirm student assignments and the follow-up project.",
  "扫描到": "Scanned ",
  "个，已解析正文/表格": " files, text/tables parsed",
  "重点文件": "key files",
  "个文件，重点文件": " files, key files",
  "扫描后生成的候选周报需要确认。": "Draft weekly logs from scans need your confirmation.",
  "档案扫描到": "Archive scan found ",
  "档案自动扫描": "Automatic archive scan",
  "自动扫描生成，需人工确认。": "Generated by scan; needs manual confirmation.",
  "无扩展名": "no extension",
  "文件名": "filename",
  "正文": "text",
  "表格文本": "table text",
  "根目录": "root",
  "学生档案": "Student archive",
  "个；类型包括": " files; types include ",

  /* ── 横向课题与线索 ── */
  "搜索合作单位、合作老师或后续项目": "Search partners, contacts or follow-up projects",
  "新增合作单位": "Add partner",
  "编辑合作单位": "Edit partner",
  "删除合作单位": "Delete partner",
  "合作单位": "Partner organisation",
  "合作老师": "Contact person",
  "合作老师：": "Contact: ",
  "后续具体项目": "Follow-up project",
  "学生分工": "Student assignments",
  "对接记录": "Meeting notes",
  "下次跟进": "Next follow-up",
  "合作中": "Active",
  "待推进": "To advance",
  "暂停": "On hold",
  "已结束": "Finished",
  "还没有横向合作": "No industry projects yet",
  "页面添加合作单位。": " page, add a partner organisation.",
  "承担学生": "Students involved",
  "横向对接": "Industry contact",

  "搜索单位、联系人、机会或学生": "Search organisations, contacts, opportunities or students",
  "新增线索": "Add lead",
  "新增合作线索": "Add lead",
  "编辑合作线索": "Edit lead",
  "删除合作线索": "Delete lead",
  "线索池": "Lead pool",
  "线索：": "Lead: ",
  "单位名称": "Organisation",
  "联系人": "Contact",
  "联系人待补": "Contact TBD",
  "对方身份": "Their role",
  "会面日期": "Meeting date",
  "会面": "Met",
  "来源/背景": "Source / background",
  "来源待补": "Source TBD",
  "优先级": "Priority",
  "保持联系": "Keep in touch",
  "待跟进": "To follow up",
  "可转横向": "Could become a project",
  "学生发展机会": "Career opportunity",
  "暂缓": "Paused",
  "合作可能": "Cooperation potential",
  "跟进记录": "Follow-up notes",
  "可推荐/对接的学生": "Students who could be introduced",
  "可推荐/对接学生": "Students to introduce",
  "学生发展推荐": "Career recommendations",
  "下一次跟进": "Next follow-up",
  "先记录关系，不急着立项": "Record the relationship first; no need to formalise it yet",

  /* ── AI 爬虫 ── */
  "搜索学生、课题范围或关键词": "Search students, scope or keywords",
  "抓取本月论文": "Fetch this month's papers",
  "本月论文雷达": "This month's paper radar",
  "还没有本月论文": "No papers this month",
  "还没有配置论文爬虫": "No paper radar configured",
  "还没有配置论文爬虫。请先添加学生。": "No paper radar configured. Add a student first.",
  "编辑论文爬虫关键词": "Edit search keywords",
  "论文爬虫": "Paper radar",
  "爬虫": "Radar",
  "课题范围（中文描述）": "Scope (plain description)",
  "英文检索词（空格分隔）": "English search terms (space separated)",
  "检索式": "Query",
  "关键词为空": "No keywords set",
  "关键词：": "Keywords: ",
  "请先配置该学生的英文检索关键词。": "Configure English search keywords for this student first.",
  "上次抓取": "Last fetched",
  "未运行": "Never run",
  "正在抓取": "Fetching",
  "正在检索近": "Searching the last ",
  "天论文，请稍等。": " days of papers, please wait.",
  "默认检索近": "Searches the last ",
  "天结果。": " days by default.",
  "抓取失败": "Fetch failed",
  "公开论文索引暂时不可用。": "The public paper index is temporarily unavailable.",
  "暂时不可用。": " is temporarily unavailable.",
  "请检查网络后重试。": "Check your connection and try again.",
  "摘要": "Abstract",
  "原文": "Source",
  "未命名论文": "Untitled paper",
  "未知期刊": "Unknown journal",
  "强相关": "Highly relevant",
  "弱相关": "Loosely relevant",
  "待判断": "Unclear",
  "可忽略": "Can skip",
  "与检索式重合较少": "Little overlap with the query",
  "命中课题邻近主题": "Matches an adjacent topic",
  "命中": "Matches ",
  "筛选理由：": "Why: ",
  "重要发现线索：": "Worth noting: ",
  "适合借鉴方法": "Useful method to borrow",
  "适合感官评价设计": "Useful for sensory design",
  "适合机制讨论": "Useful for mechanism discussion",
  "适合结果对照": "Useful as a result comparison",
  "适合补文献综述": "Useful for the literature review",
  "先看摘要判断": "Read the abstract to judge",
  "公开索引": "Public index",

  /* ── 事务 ── */
  "新增事务": "Add duty",
  "编辑事务": "Edit duty",
  "删除事务": "Delete duty",
  "事务名称": "Duty",
  "暂无事务记录": "No duties recorded",
  "日常事务": "Routine",
  "实验室卫生值日": "Lab cleaning rota",
  "每积分劳务费": "Stipend per point",
  "元/积分": " CNY/point",
  "建议金额": "Suggested amount",

  /* ── 周进展 ── */
  "更新周进展": "Update weekly log",
  "编辑周进展": "Edit weekly log",
  "编辑候选周进展": "Edit draft log",
  "周日期": "Week of",
  "本周产出评分 1-5": "Output score for the week (1-5)",
  "下周计划": "Next week's plan",
  "下周": "Next week",
  "文献进展": "Literature",
  "问题和卡点": "Blockers",
  "导师反馈": "Advisor feedback",
  "导师反馈：": "Advisor feedback: ",
  "候选稿": "Draft",
  "待导师审核": "Awaiting your review",
  "周进展审核流": "Draft review",
  "编辑后通过": "Edit and approve",
  "下周开始按方案进行预实验。": "Start pilot experiments next week as planned.",
  "需要导师确认课题方向和实验优先级。": "Needs the advisor to confirm direction and experiment priority.",

  /* ── 成果展板 ── */
  "搜索学生、题名、期刊或状态": "Search students, titles, journals or status",
  "新增成果": "Add output",
  "新增成果记录": "Add output",
  "编辑成果记录": "Edit output",
  "删除成果": "Delete output",
  "成果明细": "All outputs",
  "成果类型": "Type",
  "成果题名": "Title",
  "公开展板": "Public board",
  "榜单": "Ranking",
  "已发表": "Published",
  "已接收": "Accepted",
  "在投": "Under review",
  "投稿准备": "Preparing submission",
  "撰写中": "Writing",
  "数据整理": "Organising data",
  "起步": "Starting out",
  "已发表 SCI": "Published papers",
  "已发表/接收 SCI": "published / accepted",
  "在投/投稿准备": "Under review / preparing",
  "撰写中/数据整理": "Writing / organising data",
  "暂无 SCI": "No papers yet",
  "可公示成果": "Ready to show",
  "下一批目标": "Next wave",
  "需要推进": "Needs a push",
  "继续加油": "Keep going",
  "还没有 SCI 记录": "No papers on record",
  "下一篇：": "Next: ",
  "领先": "Ahead",
  "追赶中": "Catching up",
  "待启动": "Not started",
  "待突破": "Yet to land",
  "推进中": "In motion",
  "暂未记录成果，先从周进展和课题数据中拆出第一条可投稿成果。": "No outputs yet. Pull the first submittable result out of the weekly logs and project data.",
  "期刊/平台/目标": "Journal / venue / target",
  "期刊待定": "Journal TBD",
  "目标期刊待定": "Target journal TBD",
  "级别": "Tier",
  "级别/分区": "Tier / quartile",
  "影响因子": "Impact factor",
  "影响因子合计": "Total impact factor",
  "作者角色": "Authorship",
  "第一作者": "First author",
  "发表/接收/投稿日期": "Published / accepted / submitted",
  "日期待定": "Date TBD",
  "日期待补": "Date TBD",
  "证明材料": "Evidence",
  "待补 DOI、截图或文件路径": "Add a DOI, screenshot or file path",
  "DOI、截图、文件路径或投稿系统记录": "DOI, screenshot, file path or submission-system record",
  "例如 中科院一区、JCR Q1": "e.g. JCR Q1",
  "例如 第一作者、通讯作者": "e.g. first author, corresponding author",
  "例如 8.5": "e.g. 8.5",
  "例如 2026-06-12 或 待补": "e.g. 2026-06-12, or TBD",
  "中文期刊": "Domestic journal",
  "综述": "Review",
  "会议论文": "Conference paper",
  "专利": "Patent",
  "软著": "Software copyright",
  "竞赛/奖项": "Award",
  "小论文": "Journal paper",

  /* ── 经费投入 ── */
  "搜索学生、用途、凭证或备注": "Search students, items, receipts or notes",
  "新增费用": "Add expense",
  "新增费用记录": "Add expense",
  "编辑费用记录": "Edit expense",
  "删除费用记录": "Delete expense",
  "费用明细": "All expenses",
  "费用结构": "Cost breakdown",
  "费用事项": "Item",
  "费用类别": "Category",
  "费用记录": "expense",
  "未命名费用": "Untitled expense",
  "试剂耗材": "Reagents",
  "仪器检测": "Instrument time",
  "论文版面": "Publication fees",
  "论文版面费": "Publication fees",
  "补助费用": "Stipends",
  "补助": "Stipend",
  "差旅会议": "Travel & conferences",
  "总投入": "Total spend",
  "已登记费用": "Recorded expenses",
  "试剂耗材+仪器": "Reagents + instruments",
  "实验直接成本": "Direct experiment cost",
  "导师实际承担": "Paid by the advisor",
  "每 IF 投入": "Cost per IF",
  "每 IF": "per IF ",
  "每": "per ",
  "总投入/IF合计": "Total spend / total IF",
  "待补 IF": "IF pending",
  "学生投入产出概览": "Spend and output by student",
  "实验/版面直接成本": "Direct experiment/publication cost",
  "支付/来源": "Paid by",
  "导师/课题经费": "Advisor / grant",
  "供应商/平台/期刊": "Supplier / platform / journal",
  "关联实验/成果": "Related experiment or output",
  "关联成果/实验": "Related output / experiment",
  "凭证": "Receipt",
  "待补发票、共享平台记录或截图": "Add an invoice, platform record or screenshot",
  "发票号、共享平台记录、支付截图或文件路径": "Invoice number, platform record, payment screenshot or file path",
  "金额（元）": "Amount (CNY)",
  "例如 GC-MS 检测、论文版面费、月补助": "e.g. GC-MS analysis, publication fee, monthly stipend",
  "这不是为了给学生贴标签，而是让课题资源投入透明化。": "This isn't about labelling students — it's about making resource use visible.",
  "补助、耗材、仪器检测和版面费都是真实培养成本。后续补齐影响因子后，可以用总投入除以已发表 SCI 的影响因子合计，粗略观察科研投入产出比。": "Stipends, reagents, instrument time and publication fees are all real costs of training a student. Once impact factors are filled in, total spend divided by total impact factor gives a rough sense of return.",

  /* ── 数据与备份 ── */
  "本地数据": "Local data",
  "数据备份": "Backup",
  "导出数据": "Export data",
  "生成备份": "Create backup",
  "下载最新备份": "Download latest backup",
  "从文件导入": "Import from file",
  "导入粘贴内容": "Import pasted text",
  "恢复示例": "Reset to sample data",
  "导出备份文件": "Export a backup file",
  "备份版本": "Backup history",
  "手动备份": "Manual backup",
  "每日自动备份": "Daily automatic backup",
  "导入前自动备份": "Automatic backup before import",
  "下载前备份": "Backup before download",
  "规则设置": "Settings",
  "保存规则": "Save settings",
  "每周查看日": "Weekly review day",
  "提醒时间": "Reminder hour",
  "周一": "Monday",
  "周二": "Tuesday",
  "周三": "Wednesday",
  "周四": "Thursday",
  "周五": "Friday",
  "周六": "Saturday",
  "周日": "Sunday",
  "导出 JSON 后可以备份到自己的网盘或硬盘；导入会覆盖当前浏览器里的数据。": "Export the JSON to your own cloud drive or disk. Importing overwrites whatever is in this browser.",
  "导出的数据会显示在这里；也可以把备份 JSON 粘贴到这里后点“导入粘贴内容”。": "Exported data appears here. You can also paste a backup JSON here and click \"Import pasted text\".",
  "还没有备份。保存数据时会每天自动留一份，也可以手动生成。": "No backups yet. One is kept automatically each day you save, or you can create one manually.",
  "你还没有把数据导出成文件。清理浏览器数据会让所有记录消失。": "You haven't exported your data to a file yet. Clearing browser data would erase everything.",
  "距离上次导出备份已经": "It's been ",
  "天，建议立刻导出一份。": " days since your last export — do one now.",
  "天，建议导出一份存到网盘或硬盘。": " days since your last export — save one to a drive.",
  "今天已导出备份。": "Exported today.",
  "上次导出备份是": "Last export was ",
  "天前，状态良好。": " days ago — all good.",
  "天前": " days ago",
  "请先把备份 JSON 粘贴到下面的文本框，或改用“从文件导入”。": "Paste the backup JSON into the box below, or use \"Import from file\" instead.",
  "导入失败：数据格式不正确。": "Import failed: unexpected data format.",
  "导入失败：文件不是有效的 JSON 备份。": "Import failed: not a valid JSON backup.",
  "会覆盖当前浏览器里的全部数据，确定继续？": " will overwrite everything in this browser. Continue?",
  "当前数据会先自动存一份备份。）": "Your current data is backed up first.)",
  "导入完成。": "Import complete.",
  "读取文件失败：": "Could not read the file: ",
  "请重试。": "Please try again.",
  "恢复示例数据会覆盖当前浏览器里的记录。": "Resetting to sample data will overwrite the records in this browser.",
  "学生数据缺少必要的 id 或 name（": "Student records are missing a required id or name (",
  "课题组管理台备份-": "lab-bench-backup-",
  "数据只保存在本机浏览器。": "Data stays in this browser only.",

  /* ── 关联文件 ── */
  "关联文件": "Link files",
  "已关联": "Linked ",
  "取消关联": "Unlink ",
  "移除关联": "Remove link",
  "原文件不会被删除。": "The original file is not deleted.",
  "个文件，其中": " files, of which ",
  "个成功读取到文本内容。": " had readable text.",
  "注意：系统只记录文件名和文本摘要，不保存文件本身，原文件请勿删除或移动。": "Note: only the filename and a text excerpt are stored, not the file itself — don't delete or move the original.",
  "选择文件失败：": "Could not open the file picker: ",

  /* ── 提醒与通知 ── */
  "开启提醒": "Enable reminders",
  "提醒已开启": "Reminders on",
  "提醒规则": "Reminder rules",
  "当前浏览器不支持系统通知。": "This browser doesn't support system notifications.",
  "课题组管理台：有进展需要查看": "Lab Bench: progress needs your attention",

  /* ── 空状态与模态 ── */
  "还没有记录": "Nothing here yet",
  "先添加一条，系统就能开始做提醒和统计。": "Add one and the reminders and stats start working.",
  "新增或更新": "Add or update",
  "把": "Assign \"",
  "开始。": " to begin.",
  "点击": "Click ",

  /* ── 开屏动画 ── */
  "课题组管理台开屏动画": "Lab Bench intro animation",
  "跳过": "Skip",
  "把课题组装进一个清晰的工作台": "Put your whole group on one clear bench",
  "学生、课题、进展、事务和数据备份，在同一个本地系统里持续沉淀。": "Students, projects, progress, duties and backups — all accumulating in one local system.",
  "从周进展到档案扫描": "From weekly logs to archive scans",
  "新增材料被汇入档案，导师检查点直接对准论文故事和实验证据。": "New material flows into the archive, and your checkpoints point straight at the paper's story and evidence.",
  "原始文件": "Raw files",
  "扫描对比": "Scan & compare",
  "论文推进": "Paper progress",
  "让课题、事务和产出一起被看见": "Make projects, duties and output all visible",
  "周报、复盘、横向节点和事务积分，形成可追踪、可交接的培养记录。": "Weekly logs, reviews, industry milestones and duty points build a training record you can track and hand over.",
  "进入课题组管理台": "Enter Lab Bench",
  "今天先看风险、进展和需要你拍板的节点。": "Start with the risks, the progress, and what needs your call.",

  /* ── 补充：扫描发现的遗漏文案 ── */
  "你还没有把数据导出成文件。清理浏览器数据会让所有记录消失。": "You haven't exported your data to a file yet. Clearing browser data would erase everything.",
  "数据备份": "Backup",
  "毕业": "Graduates ",
  "待补充": "To be filled in",
  "产出": "Output ",
  "未扫描": "Not scanned",
  "下一轮": "Next round",
  "扫描": "scan",
  "仪器": "instruments",
  "实验直接成本": "Direct experiment cost",
  "撰写中": "Writing",
  "日常事务": "Routine",
  "在": "On the ",
  "本地": "Local",
  "使用方式": "How to use it",
  "合作": "Cooperation",
  "发展": "Careers",
  "说明": "How it works",
  "价值": "Why it helps",
  "点击": "Click ",
  "分钟": " minutes",
  "研一": "Year 1",
  "默认每": "Reminder set for ",
  "检查学生周进展。浏览器通知开启后，页面打开时会提示到期事项。": "\u2014 review student weekly logs. With browser notifications on, due items are flagged when you open the page.",
  "请在课题的规划和实验描述中填写具体内容，系统会自动提取关键词。": "Fill in the plan and experiment description of the project, and keywords will be extracted automatically.",
  "文献路径：待配置": "Literature path: not set",
  "建议追问：": "Worth asking: ",
  "中，哪些实验指标最能支撑核心结论，文献是否已经闭环。": " — which measurements best support the core conclusion, and is the literature argument closed?",
  "页面为待入学学生创建课题条目，填写初步方向和文献需求。": " page, create a project entry for the incoming student with a rough direction and reading list.",
  "企业、科研院所、大学等外部交流都可以先放在线索里，等出现明确需求后再转到横向课题、联合项目或人才推荐。": "Companies, institutes and universities can all sit here as leads first, and move on to an industry project, a joint programme or a student referral once a concrete need appears.",
  "每条线索可标记适合推荐的学生，后续按单位需求对接读博、工作、联合培养或项目交流。": "Each lead can be tagged with students worth recommending, so you can match them to PhD places, jobs, joint programmes or project exchanges as needs come up.",
  "默认检索近 30 天新发表论文。页面打开时不会自动联网，点击抓取后会从 OpenAlex、Crossref、Europe PMC 等公开论文索引获取题名、期刊、日期和摘要片段，并生成本地重要发现摘要。": "Searches papers published in the last 30 days. Nothing goes online when the page opens; only when you click fetch does it pull titles, journals, dates and abstract snippets from public indexes (OpenAlex, Crossref, Europe PMC) and summarise the notable ones locally.",
  "导师查看建议": "How to use this",
  "每周五先看每位同学 3-5 篇最新论文，判断是否影响实验设计、数据解释或论文讨论": "Each Friday, skim 3-5 recent papers per student and judge whether they affect experiment design, data interpretation or the discussion section",
  "重要条目可复制到周进展的": "Copy anything important into the ",
  "添加学生后，系统会自动为每位学生创建一个爬虫条目。你也可以在": "A radar entry is created automatically for each student you add. You can also go to ",
  "页面新增学生，然后回到这里配置检索关键词。": " to add a student, then come back here to set the search keywords.",

  "在「硕士课题」页面为待入学学生创建课题条目，填写初步方向和文献需求。": "On the Projects page, create an entry for the incoming student with a rough direction and reading needs.",
  "点击「硕士课题」→「新增课题」，选择待入学学生。": "Go to Projects \u2192 Add project and pick the incoming student.",
  "文献路径：": "Literature path: ",
  "待配置": "not set",
  "暂无课题": "No project yet",
  "起步": "How to start",

  "在\u201c硕士课题\u201d页面为待入学学生创建课题条目，填写初步方向和文献需求。": "On the Projects page, create an entry for the incoming student with a rough direction and reading needs.",
  "点击\u201c硕士课题\u201d\u2192\u201c新增课题\u201d，选择待入学学生。": "Go to Projects \u2192 Add project and pick the incoming student.",

  /* ── 总览里自动生成的句子 ── */
  "天未更新周进展": " days without a weekly log",
  "还没有更新过周进展": " has never posted a weekly log",
  "风险": " risk",
  "当前进度": " — currently at ",
  "，需要拆出最近一周可验证的小目标。": "; break this into a verifiable one-week goal.",
  "原定复盘日期为": "Originally due ",
  "，建议检查实验、文献库和数据分析是否同步推进。": "; check whether experiments, literature and analysis are advancing together.",
  "合作老师：": "Contact: ",
  "。下一次跟进": ". Next follow-up ",
  "，请确认学生分工和后续具体项目。": ". Confirm student assignments and the follow-up project.",
  "上次更新是": "Last updated ",
  "，复盘日期": ", review due ",
  "，下次跟进": ", next follow-up ",
  "篇候选论文，建议筛出能影响实验或讨论的条目。": " candidate papers — pick out the ones that affect your experiments or discussion.",
  "实验推进中": "Experiments under way",
  "横向课题为主": "Mostly contract work",
  "投稿阶段": "Submission stage",
  "组内协调": "Coordination",
  "仪器管理": "Instruments",
  "横向支持": "Contract support",

  "距离上次导出备份已经": "It's been ",
  "天，建议立刻导出一份。": " days since your last export — do one now.",
  "天，建议导出一份存到网盘或硬盘。": " days since your last export — save one to a drive.",
  "上次导出备份是": "Last export was ",
  "天前，状态良好。": " days ago — all good.",
  "抓取": "Fetch",
  "后会显示近": " and results from the last ",
  "天结果。": " days appear here.",

  /* ── 示例数据 ── */
  "示例同学": "Sample Student",
  "示例课题名称（请替换为真实课题）": "Sample project title (replace with your own)",
  "示例论文题名（请替换为真实成果）": "Sample paper title (replace with your own)",
  "示例师兄/师姐": "Sample alumnus",
  "示例单位（请替换）": "Sample organisation (replace)",
  "示例研究方向": "Sample research field",
  "示例试剂采购": "Sample reagent purchase",
  "示例预实验": "Sample pilot experiment",
  "示例供应商": "Sample supplier",
  "示例事务记录，可删除后添加真实事务。": "Sample duty record — delete it and add your own.",
  "示例校友记录，可删除后添加真实毕业生。": "Sample alumni record — delete it and add your own.",
  "投稿阶段": "Submission stage",
  "尽快熟悉实验方法，建立文献阅读习惯，明确课题方向": "Get comfortable with the methods, build a reading habit, settle on a direction",
  "短期：完成文献综述和实验方案；长期：按课题计划推进实验、数据分析和论文撰写。": "Short term: finish the review and experiment plan. Long term: run the experiments, analyse, and write.",
  "暂无正式实验，正在学习基本方法和仪器操作。": "No formal experiments yet; learning basic methods and instruments.",
  "建议按课题关键词建立分类文献库，每周新增 2-3 篇核心文献。": "Build a keyword-organised literature library, adding 2-3 core papers a week.",
  "本周学习了基本实验方法，熟悉了实验室安全规范。": "Learned the basic methods this week and went through lab safety.",
  "暂无实验数据。": "No experimental data yet.",
  "阅读了 3 篇入门文献，初步了解课题背景。": "Read 3 introductory papers and got a first sense of the background.",
  "建议先从最简单的指标测定开始，逐步建立方法库。": "Start with the simplest measurements and build up a methods library from there.",
  "成果展板会按学生汇总，公开展示能形成正向压力。": "Outputs are grouped by student; showing them publicly creates healthy pressure.",
  "费用记录用于让课题资源投入透明化，可删除后添加真实记录。": "Expense records make resource use visible — delete this and add your own.",
  "示例记录。正式使用时填写 DOI、投稿系统截图或稿件文件路径。": "Sample record. In real use, fill in a DOI, submission screenshot or manuscript path.",
  "示例凭证。正式使用时填写发票号或采购平台记录。": "Sample receipt. In real use, fill in the invoice number or platform record.",
  "可交流就业面试、企业研发日常和行业选择。": "Can advise on job interviews, day-to-day industry R&D and career choices.",
};

const DICTIONARIES = { en: EN };

let currentLang = readStoredLang();
let translationPattern = null;

function readStoredLang() {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored && (stored === "zh" || DICTIONARIES[stored])) return stored;
  /* 首次打开时跟随浏览器语言，中文环境用中文，其余一律英文 */
  return String(navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

function getLang() {
  return currentLang;
}

function localeTag() {
  return currentLang === "zh" ? "zh-CN" : "en-US";
}

function setLang(lang) {
  if (lang !== "zh" && !DICTIONARIES[lang]) return;
  currentLang = lang;
  translationPattern = null;
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* 长 key 优先，保证 "已发表 SCI" 不会被 "已发表" 抢先命中 */
function buildPattern(dict) {
  const keys = Object.keys(dict).filter(Boolean).sort((a, b) => b.length - a.length);
  return new RegExp(keys.map(escapeRegExp).join("|"), "g");
}

/* 一段连续中文要么整段翻译，要么原样保留 —— 绝不半中半英。

   曾经踩过的坑：词典里有 "学生"→"students"，于是一句没收录的
   "检查学生周进展。" 被翻成 "检查studentsWeekly Logs。"，比不翻还糟。
   现在的规则是：先整段查词典；查不到就尝试切分，且只有切分后
   一个中文字都不剩（全部命中）才采用；否则整段留中文。
   留下来的中文会在界面上一眼可见，正好提示这条该补进词典。 */
const CHINESE_RUN = /[一-龥][一-龥A-Za-z0-9 ／/、，。：；！？（）“”「」→%\-—.·]*/g;

function translateRun(run, dict) {
  const trimmed = run.trim();
  if (!trimmed) return run;
  if (dict[trimmed] !== undefined) return run.replace(trimmed, dict[trimmed]);

  if (!translationPattern) translationPattern = buildPattern(dict);
  translationPattern.lastIndex = 0;
  /* 词典译文里不含中文，所以替换之后还剩中文，就说明没覆盖全，整段放弃 */
  const replaced = trimmed.replace(translationPattern, (match) => dict[match]);
  if (/[\u4e00-\u9fa5]/.test(replaced)) return run;
  return run.replace(trimmed, replaced);
}

/* 中文标点在英文句子里很扎眼（"weekly log。"）。
   插值把句子切开时，句尾的 。，等会落在任何词条之外，只能统一收尾处理。
   只有整段都译干净了才替换，否则会出现半中半英的标点。 */
const CJK_PUNCTUATION = {
  "\u3002": ". ", "\uff0c": ", ", "\u3001": ", ", "\uff1a": ":", "\uff1b": ";",
  "\uff01": "!", "\uff1f": "?", "\uff08": " (", "\uff09": ")",
  "\u201c": '"', "\u201d": '"', "\u300c": '"', "\u300d": '"',
};
const CJK_PUNCTUATION_RE = new RegExp(`[${Object.keys(CJK_PUNCTUATION).join("")}]`, "g");

function normalisePunctuation(text) {
  if (/[\u4e00-\u9fa5]/.test(text)) return text;
  return text.replace(CJK_PUNCTUATION_RE, (mark) => CJK_PUNCTUATION[mark]).replace(/ +([.,;:!?])/g, "$1").replace(/ {2,}/g, " ");
}

function translateText(text) {
  const dict = DICTIONARIES[currentLang];
  if (!dict) return text;
  return normalisePunctuation(text.replace(CHINESE_RUN, (run) => translateRun(run, dict)));
}

/* 用户输入不参与翻译：escapeHTML() 已用私有区字符把它包起来 */
function translateOutsideGuards(text) {
  if (!text.includes(GUARD_OPEN)) return translateText(text);
  return text
    .split(new RegExp(`${GUARD_OPEN}([\\s\\S]*?)${GUARD_CLOSE}`))
    .map((segment, index) => (index % 2 ? segment : translateText(segment)))
    .join("");
}

function stripGuards(text) {
  return text.split(GUARD_OPEN).join("").split(GUARD_CLOSE).join("");
}

/* 只有这几个属性的值是给人看的，其余属性（尤其是 value 和 data-*）
   会被存进数据或参与筛选比较，翻译了就会把逻辑改坏 */
const TRANSLATABLE_ATTRS = new Set(["placeholder", "title", "aria-label", "alt"]);

function translateTag(tag) {
  return tag.replace(/([a-zA-Z-]+)="([^"]*)"/g, (whole, attr, value) => {
    if (!TRANSLATABLE_ATTRS.has(attr.toLowerCase())) return `${attr}="${stripGuards(value)}"`;
    return `${attr}="${translateOutsideGuards(value)}"`;
  });
}

/* 翻译一段 HTML：标签内只动白名单属性，标签之间的文本正常翻译 */
function tr(html) {
  const source = String(html);
  if (currentLang === "zh") return stripGuards(source);
  return source
    .split(/(<[^>]*>)/)
    .map((part) => (part.startsWith("<") && part.endsWith(">") ? translateTag(part) : translateOutsideGuards(part)))
    .join("");
}

/* 纯文本用（alert / confirm / textContent），不含标签 */
function t(text) {
  const source = String(text);
  return currentLang === "zh" ? stripGuards(source) : translateOutsideGuards(source);
}
