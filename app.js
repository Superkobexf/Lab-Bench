const APP_VERSION = "generic-v1";
const PAPER_CRAWL_WINDOW_DAYS = 30;
const ONE_DAY = 24 * 60 * 60 * 1000;
const INTRO_SESSION_KEY = "lab-group-intro-seen-v1";
const INTRO_DURATION_MS = 8600;
const INTRO_REDUCED_MOTION_MS = 650;

/* 服务端 db.py 里 COLLECTIONS 的镜像。两边必须一致，
   否则新集合会在同步时被静默丢掉。 */
const COLLECTIONS = [
  "students", "alumni", "topics", "industryProjects", "collaborationLeads",
  "paperCrawler", "duties", "weeklyLogs", "weeklyDrafts", "archiveScans",
  "achievements", "financeRecords",
];

const DEFAULT_SETTINGS = {
  weeklyReviewDay: 5,
  notifyHour: 17,
  stipendRate: 80,
  lastArchiveScanAt: "",
  unmatchedFolders: [],
  appVersion: APP_VERSION,
};

/* 数据在服务器上。这里先建一个空壳，登录后由 loadStateFromServer() 填。
   serverSnapshot 保存"服务端已知的样子"，saveState() 靠和它做 diff
   算出该推哪几条——这样 23 处 saveState() 调用点和各处删除代码都不用改，
   而且写请求是按记录粒度发的，多人同时用不会整包互相覆盖。 */
const state = emptyState();
let serverSnapshot = {};
let currentView = "dashboard";
let selectedGraphStudent = "example";

const viewMeta = {
  dashboard: ["总览", "学生进展、风险和事务负担的今日快照。"],
  students: ["在读学生", "培养阶段、联系方式、毕业节点和个人目标。"],
  goals: ["目标与计划", "长期与短期目标、每周工作计划，以及导师批注。"],
  contracts: ["合同管理", "横向合同多版本存档、关键日期抽取和倒数日提醒。"],
  alumni: ["毕业学生", "毕业去向、现任职位、联系方式和可交流资源。"],
  topics: ["硕士课题", "规划、实验进展、文献库、数据分析和阶段风险。"],
  discussion: ["研讨看板", "机制图、文献知识图谱和待入学课题建议。"],
  archive: ["档案扫描", "按学生汇总材料版本、关键文件和待导师检查点。"],
  industry: ["横向课题", "合作单位、合作老师、学生分工和后续具体项目。"],
  leads: ["合作线索", "企业、科研院所、大学等外部合作与学生发展机会的长期跟踪。"],
  crawler: ["AI 爬虫", "按学生课题配置检索词，抓取近 30 天新论文并沉淀重要发现。"],
  duties: ["课题组事务", "事务量、完成情况和劳务费分配依据。"],
  weekly: ["周进展", "每周记录实验、数据、问题、下周计划和导师反馈。"],
  achievements: ["成果展板", "SCI、投稿、论文草稿和阶段成果的公开统计。"],
  funding: ["经费投入", "试剂耗材、仪器检测、论文版面、补助和投入产出比。"],
  settings: ["数据", "本地导入导出、重置示例数据和提醒说明。"],
};

const $ = (selector) => document.querySelector(selector);

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(date) {
  if (!date) return 999;
  const start = new Date(`${date}T00:00:00`);
  const now = new Date(`${todayISO()}T00:00:00`);
  return Math.floor((now - start) / ONE_DAY);
}

function dateOffset(days) {
  const d = new Date(Date.now() + days * ONE_DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── 示例数据（仅此一份，用户可自行删除或修改） ── */

function exampleStudents() {
  return [
    {
      id: "example",
      name: t("示例同学"),
      grade: "研一",
      role: t("课题入门与文献积累"),
      advisorFocus: t("尽快熟悉实验方法，建立文献阅读习惯，明确课题方向"),
      contact: t("待补充"),
      graduation: "2028-06-20",
      status: t("入门阶段"),
    },
  ];
}

function exampleTopics() {
  return [
    {
      id: "example",
      studentId: "example",
      title: t("示例课题名称（请替换为真实课题）"),
      phase: t("文献调研与实验方案设计"),
      plan: t("短期：完成文献综述和实验方案；长期：按课题计划推进实验、数据分析和论文撰写。"),
      experiments: t("暂无正式实验，正在学习基本方法和仪器操作。"),
      literature: t("建议按课题关键词建立分类文献库，每周新增 2-3 篇核心文献。"),
      analysis: t("暂无数据，待实验启动后记录。"),
      progress: 10,
      nextReview: dateOffset(14),
      risk: "低",
      sourcePath: "",
    },
  ];
}

function exampleWeeklyLogs() {
  return [
    {
      id: "example",
      studentId: "example",
      weekOf: todayISO(),
      experiment: t("本周学习了基本实验方法，熟悉了实验室安全规范。"),
      data: t("暂无实验数据。"),
      literature: t("阅读了 3 篇入门文献，初步了解课题背景。"),
      blockers: t("需要导师确认课题方向和实验优先级。"),
      nextPlan: t("下周开始按方案进行预实验。"),
      mentorNote: t("建议先从最简单的指标测定开始，逐步建立方法库。"),
      outputScore: 3,
    },
  ];
}

function exampleDuties() {
  return [
    {
      id: "example",
      studentId: "example",
      title: t("实验室卫生值日"),
      category: t("日常事务"),
      date: todayISO(),
      hours: 1,
      points: 2,
      status: "完成",
      note: t("示例事务记录，可删除后添加真实事务。"),
    },
  ];
}

function exampleAchievements() {
  return [
    {
      id: "example",
      studentId: "example",
      type: "SCI",
      status: "撰写中",
      title: t("示例论文题名（请替换为真实成果）"),
      journal: t("目标期刊待定"),
      level: t("待定"),
      impactFactor: 0,
      role: t("第一作者"),
      publicationDate: t("待补"),
      proof: t("示例记录。正式使用时填写 DOI、投稿系统截图或稿件文件路径。"),
      note: t("成果展板会按学生汇总，公开展示能形成正向压力。"),
      attachments: [],
    },
  ];
}

function exampleAlumni() {
  return [
    {
      id: "example",
      name: t("示例师兄/师姐"),
      graduationYear: "2025",
      degree: "硕士",
      destinationType: "企业研发",
      organization: t("示例单位（请替换）"),
      position: t("研发工程师"),
      location: t("待补"),
      contact: t("待补"),
      phone: "",
      wechat: "",
      email: "",
      researchDirection: t("示例研究方向"),
      canHelp: t("可交流就业面试、企业研发日常和行业选择。"),
      note: t("示例校友记录，可删除后添加真实毕业生。"),
    },
  ];
}

function exampleFinanceRecords() {
  return [
    {
      id: "example",
      studentId: "example",
      category: "reagent",
      item: t("示例试剂采购"),
      amount: 1200,
      date: todayISO(),
      payer: t("导师/课题经费"),
      vendor: t("示例供应商"),
      relatedOutput: t("示例预实验"),
      proof: t("示例凭证。正式使用时填写发票号或采购平台记录。"),
      note: t("费用记录用于让课题资源投入透明化，可删除后添加真实记录。"),
      attachments: [],
    },
  ];
}

/* ── 状态管理 ── */

let syncTimer = 0;

/* 保存结果要看得见。数据在服务器上，静默失败会让人以为已经存好了。 */
function setSyncStatus(kind, detail = "") {
  const node = $("#syncStatus");
  if (!node) return;
  window.clearTimeout(syncTimer);
  node.classList.remove("hidden", "ok", "error", "pending");
  if (kind === "saving") {
    node.classList.add("pending");
    node.textContent = t("保存中…");
    return;
  }
  if (kind === "error") {
    node.classList.add("error");
    node.textContent = `${t("保存失败")}：${detail || t("请重试")}`;
    return;
  }
  node.classList.add("ok");
  node.textContent = t("已保存");
  syncTimer = window.setTimeout(() => node.classList.add("hidden"), 2200);
}

function emptyState() {
  const base = {};
  COLLECTIONS.forEach((key) => { base[key] = []; });
  base.settings = { ...DEFAULT_SETTINGS };
  return base;
}

/* 老版本数据里没有后加的模块字段，补齐后再交给渲染层，避免升级后白屏。 */
function migrateState(data) {
  COLLECTIONS.forEach((key) => {
    if (!Array.isArray(data[key])) data[key] = [];
  });
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  data.settings.appVersion = APP_VERSION;
  return data;
}

async function loadStateFromServer() {
  const data = await API.fetchState();
  const next = migrateState(data.state || {});
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, next);
  serverSnapshot = snapshotOf(state);
  return data;
}

function snapshotOf(source) {
  const snap = {};
  COLLECTIONS.forEach((key) => {
    snap[key] = new Map(
      (source[key] || []).map((item) => [item.id, JSON.stringify(item)]),
    );
  });
  snap.settings = JSON.stringify(source.settings || {});
  return snap;
}

/* 和快照比对，把真正变了的记录推给服务端。
   出错时把提示留在界面上——静默失败会让人以为存上了。 */
async function saveState() {
  const jobs = [];
  COLLECTIONS.forEach((collection) => {
    const previous = serverSnapshot[collection] || new Map();
    const seen = new Set();
    (state[collection] || []).forEach((item) => {
      if (!item || !item.id) return;
      seen.add(item.id);
      const serialised = JSON.stringify(item);
      if (previous.get(item.id) !== serialised) {
        const { id, ...payload } = item;
        jobs.push(API.putRecord(collection, id, payload));
      }
    });
    previous.forEach((_value, id) => {
      if (!seen.has(id)) jobs.push(API.deleteRecord(collection, id));
    });
  });
  const settingsNow = JSON.stringify(state.settings || {});
  if (settingsNow !== serverSnapshot.settings) {
    const { weeklyReviewDay, notifyHour, stipendRate, lastExportAt,
            lastArchiveScanAt } = state.settings || {};
    jobs.push(API.putSettings({
      weeklyReviewDay, notifyHour, stipendRate, lastExportAt, lastArchiveScanAt,
    }));
  }
  if (!jobs.length) return true;
  try {
    await Promise.all(jobs);
    serverSnapshot = snapshotOf(state);
    setSyncStatus("saved");
    return true;
  } catch (error) {
    setSyncStatus("error", error.message);
    return false;
  }
}

function seedData() {
  return {
    students: exampleStudents(),
    alumni: exampleAlumni(),
    topics: exampleTopics(),
    industryProjects: [],
    collaborationLeads: [],
    paperCrawler: [],
    duties: exampleDuties(),
    weeklyLogs: exampleWeeklyLogs(),
    weeklyDrafts: [],
    archiveScans: [],
    achievements: exampleAchievements(),
    financeRecords: exampleFinanceRecords(),
    settings: {
      weeklyReviewDay: 5,
      notifyHour: 17,
      stipendRate: 80,
      lastArchiveScanAt: "",
      lastBackupAt: "",
      lastExportAt: "",
      unmatchedFolders: [],
      appVersion: APP_VERSION,
    },
  };
}

function studentName(id) {
  return state.students.find((student) => student.id === id)?.name || "未分配";
}

/* studentName() 必须继续返回未转义原文：deleteWeekly / deleteWeeklyDraft 的
   confirm() 文案和 filterDuty() 的 textContent 比较都依赖它。
   凡是要拼进 HTML 的场合，一律走下面这个包装。 */
function studentNameHTML(id) {
  return escapeHTML(studentName(id));
}

/* 只放行 http/https。备份 JSON 里的 URL 是外部可控数据，
   escapeHTML 能挡住属性闭合，挡不住 javascript: 这类伪协议。 */
function safeURL(value = "") {
  try {
    const url = new URL(String(value), location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function latestLog(studentId) {
  return state.weeklyLogs
    .filter((log) => log.studentId === studentId)
    .sort((a, b) => b.weekOf.localeCompare(a.weekOf))[0];
}

/* 列表分隔符跟随语言：中文用顿号，英文用逗号。
   名字本身是用户数据、不参与翻译，所以分隔符只能在拼接时就定好。 */
function listJoin(items) {
  return items.join(getLang() === "zh" ? "、" : ", ");
}

/* 枚举值（年级、风险、状态这类）在数据里始终存中文，
   保证筛选和统计的比较逻辑跨语言都成立；只有显示时才翻译。
   所以它走 tv() 而不是 escapeHTML() —— 后者会把内容标记成
   用户数据，翻译时直接跳过。 */
function tv(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* 输出用一对私有区字符包起来，标记“这是用户数据”。
   i18n 的 tr() 看到这段就跳过翻译，最后再把标记去掉。
   否则一个叫“数据分析”的课题名会被当成界面文案翻成英文。 */
function escapeHTML(value = "") {
  const escaped = String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  return `${GUARD_OPEN}${escaped}${GUARD_CLOSE}`;
}

function hashText(value = "") {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function optionStudents(selected = "", multiple = false) {
  return state.students
    .map((student) => {
      const isSelected = Array.isArray(selected) ? selected.includes(student.id) : selected === student.id;
      return `<option value="${escapeHTML(student.id)}" ${isSelected ? "selected" : ""}>${escapeHTML(student.name)} · ${tv(student.grade)}</option>`;
    })
    .join("");
}

/* ── 渲染入口 ── */

function render() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });
  $("#viewTitle").textContent = t(viewMeta[currentView][0]);
  $("#viewSubtitle").textContent = t(viewMeta[currentView][1]);
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  $(`#${currentView}View`).classList.add("active-view");

  renderDashboard();
  renderGoals();
  renderContracts();
  renderStudents();
  renderAlumni();
  renderTopics();
  renderDiscussion();
  renderArchive();
  renderIndustry();
  renderLeads();
  renderCrawler();
  renderDuties();
  renderWeekly();
  renderAchievements();
  renderFunding();
  renderSettings();
}

/* ── 风险与提醒 ── */

function getIssues() {
  const issues = [];
  /* 合同倒数日直接并进既有的风险流，不另造提醒系统。 */
  for (const todo of todosCache) {
    if (!todo.in_reminder_window || todo.done) continue;
    issues.push({
      level: todo.level === "overdue" || todo.level === "today" ? "high" : "medium",
      title: `${escapeHTML(todo.title)}`,
      body: todo.level === "overdue"
        ? `已逾期<span>${Math.abs(todo.days_until)}</span>天。`
        : `还有<span>${todo.days_until}</span>天到期（${escapeHTML(todo.due_date)}）。`,
      view: todo.source === "contract" ? "contracts" : "dashboard",
    });
  }
  for (const student of state.students) {
    const log = latestLog(student.id);
    const days = log ? daysBetween(log.weekOf) : 999;
    if (days > 7) {
      issues.push({
        level: days > 14 ? "high" : "medium",
        title: log
          ? `${escapeHTML(student.name)} 已<span>${days}</span>天未更新周进展`
          : `${escapeHTML(student.name)} 还没有更新过周进展`,
        body: "建议先看实验记录和下周计划，避免短期问题拖成长期停滞。",
      });
    }
    const topic = (state.topics || []).find((item) => item.studentId === student.id);
    if (topic && topic.progress < 55 && ["中", "高"].includes(topic.risk)) {
      issues.push({
        level: topic.risk === "高" ? "high" : "medium",
        title: `${escapeHTML(student.name)}的硕士课题处于${tv(topic.risk)}风险`,
        body: `${escapeHTML(topic.title)} 当前进度<span>${topic.progress}%</span>，需要拆出最近一周可验证的小目标。`,
      });
    }
  }
  for (const topic of state.topics) {
    if (daysBetween(topic.nextReview) > 0) {
      issues.push({
        level: topic.risk === "高" ? "high" : "medium",
        title: `${escapeHTML(studentName(topic.studentId))}的课题复盘已到期`,
        body: `原定复盘日期为<span>${escapeHTML(topic.nextReview)}</span>，建议检查实验、文献库和数据分析是否同步推进。`,
      });
    }
  }
  for (const project of state.industryProjects) {
    const days = daysBetween(project.nextMilestone);
    if (days >= -7) {
      issues.push({
        level: "medium",
        title: `${escapeHTML(project.name)} ${days > 0 ? "交付节点已过期" : "接近交付节点"}`,
        body: `合作老师：${escapeHTML(project.expert)}。下一次跟进<span>${escapeHTML(project.nextMilestone)}</span>，请确认学生分工和后续具体项目。`,
      });
    }
  }
  return issues;
}

/* ── 总览 ── */

function getTodayTasks() {
  const tasks = [];
  (state.weeklyDrafts || []).forEach((draft) => {
    tasks.push({
      level: "high",
      title: `${escapeHTML(studentName(draft.studentId))} 有周进展候选稿待审核`,
      body: draft.summary || draft.experiment || "扫描后生成的候选周报需要确认。",
      view: "weekly",
    });
  });
  state.students.forEach((student) => {
    const log = latestLog(student.id);
    if (!log || daysBetween(log.weekOf) > 7) {
      tasks.push({
        level: "medium",
        title: `${escapeHTML(student.name)} 需要补周进展`,
        body: log ? `上次更新是<span>${escapeHTML(log.weekOf)}</span>。` : "还没有正式周进展。",
        view: "weekly",
      });
    }
  });
  state.topics.filter((topic) => daysBetween(topic.nextReview) >= -1).forEach((topic) => {
    tasks.push({
      level: topic.risk === "高" ? "high" : "medium",
      title: `${escapeHTML(studentName(topic.studentId))} 课题需要复盘`,
      body: `${escapeHTML(topic.title)}，复盘日期<span>${escapeHTML(topic.nextReview)}</span>。`,
      view: "topics",
    });
  });
  (state.collaborationLeads || []).filter((lead) => daysBetween(lead.nextFollowUp) >= -3).forEach((lead) => {
    tasks.push({
      level: "medium",
      title: `${escapeHTML(lead.company)} 合作线索需要跟进`,
      body: `${escapeHTML(lead.contact) || "联系人待补"}，下次跟进<span>${escapeHTML(lead.nextFollowUp)}</span>。`,
      view: "leads",
    });
  });
  (state.paperCrawler || []).filter((task) => task.findings?.length && daysBetween(task.lastRun) <= 3).forEach((task) => {
    tasks.push({
      level: "low",
      title: `${escapeHTML(studentName(task.studentId))} 有新的论文雷达结果`,
      body: `<span>${task.findings.length}</span> 篇候选论文，建议筛出能影响实验或讨论的条目。`,
      view: "crawler",
    });
  });
  return tasks.slice(0, 10);
}

function renderDashboard() {
  const issues = getIssues();
  const todayTasks = getTodayTasks();
  const activeIndustry = (state.industryProjects || []).filter((project) => project.status !== "已结束").length;
  const overdueLogs = state.students.filter((student) => !latestLog(student.id) || daysBetween(latestLog(student.id).weekOf) > 7).length;
  const dutyPoints = (state.duties || []).reduce((sum, duty) => sum + Number(duty.points || 0), 0);
  const upcoming = state.topics.filter((topic) => daysBetween(topic.nextReview) >= -3).length;

  const backup = backupStatus();

  $("#dashboardView").innerHTML = tr(`
    ${backup.level === "ok" ? "" : renderBackupAlert()}
    <div class="grid kpi-grid">
      ${kpi("学生", state.students.length, "当前培养对象")}
      ${kpi("待看周报", overdueLogs, "超过7天未更新")}
      ${kpi("横向合作", activeIndustry, "合作单位条目")}
      ${kpi("事务积分", dutyPoints, "劳务核算依据")}
    </div>
    <div class="panel today-panel" style="margin-top: 14px;">
      <div class="panel-head">
        <h2>导师今日待办</h2>
        <span class="tag ${todayTasks.length ? "warn" : "ok"}">${todayTasks.length || 0} 件</span>
      </div>
      <div class="today-list">
        ${todayTasks.length ? todayTasks.map(renderTodayTask).join("") : '<div class="empty-state"><strong>今天没有紧急事项</strong><p>可以集中看论文、写反馈或整理横向线索。</p></div>'}
      </div>
    </div>
    <div style="margin-top: 14px;">${renderTodoPanel()}</div>
    <div class="grid two-col" style="margin-top: 14px;">
      <div class="panel">
        <div class="panel-head">
          <h2>学生进展</h2>
          <span class="tag ${upcoming ? "warn" : "ok"}">${upcoming} 个近期复盘</span>
        </div>
        <div class="list">
          ${state.students.map(renderStudentProgressRow).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>需要你看的问题</h2>
          <button class="small-button" type="button" data-action="add-weekly">补一条周报</button>
        </div>
        <div class="issue-list">
          ${issues.length ? issues.slice(0, 8).map(renderIssue).join("") : '<div class="empty-state"><strong>目前没有明显风险</strong><p>继续保持每周记录即可。</p></div>'}
        </div>
      </div>
    </div>
    <div class="grid three-col" style="margin-top: 14px;">
      ${renderDutyBalance()}
      ${renderIndustrySummary()}
      ${renderReminderCard()}
    </div>
  `);
}

function renderTodayTask(task) {
  const tagClass = task.level === "high" ? "danger" : task.level === "medium" ? "warn" : "blue";
  return `
    <article class="today-item">
      <div>
        <strong>${tr(task.title)}</strong>
        <p>${tr(task.body)}</p>
      </div>
      <button class="small-button" type="button" data-action="set-view" data-id="${escapeHTML(task.view)}">去处理</button>
      <span class="tag ${tagClass}">${task.level === "high" ? "优先" : task.level === "medium" ? "提醒" : "信息"}</span>
    </article>
  `;
}

function kpi(label, value, caption) {
  return `<div class="card kpi"><strong>${value}</strong><span>${label} · ${caption}</span></div>`;
}

function renderStudentProgressRow(student) {
  const topic = state.topics.find((item) => item.studentId === student.id);
  const log = latestLog(student.id);
  const stale = !log || daysBetween(log.weekOf) > 7;
  return `
    <article class="list-row">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(student.name)} <span class="tag blue">${tv(student.grade)}</span></h3>
          <div class="meta">
            <span>${escapeHTML(student.status)}</span>
            <span>${log ? `最近周报 ${escapeHTML(log.weekOf)}` : "暂无周报"}</span>
            <span>${topic ? `复盘 ${escapeHTML(topic.nextReview)}` : "暂无课题"}</span>
          </div>
        </div>
        <span class="tag ${stale ? "danger" : "ok"}">${stale ? "该看进展" : "已更新"}</span>
      </div>
      ${topic ? `<div class="progress-track"><div class="progress-bar" style="width:${Number(topic.progress || 0)}%"></div></div>` : ""}
      <p class="meta">${topic ? escapeHTML(topic.title) : "还没有绑定硕士课题"}</p>
    </article>
  `;
}

function renderIssue(issue) {
  return `<div class="issue ${issue.level === "high" ? "high" : ""}"><strong>${tr(issue.title)}</strong><p>${tr(issue.body)}</p></div>`;
}

function renderDutyBalance() {
  const rows = state.students.map((student) => {
    const points = state.duties.filter((duty) => duty.studentId === student.id).reduce((sum, duty) => sum + Number(duty.points || 0), 0);
    return `<tr><td>${escapeHTML(student.name)}</td><td>${points}</td><td>${points * Number(state.settings.stipendRate || 0)} 元</td></tr>`;
  });
  return `
    <div class="panel">
      <div class="panel-head"><h2>劳务依据</h2><span class="tag violet">${Number(state.settings.stipendRate) || 0} 元/积分</span></div>
      <table class="table"><thead><tr><th>学生</th><th>积分</th><th>建议金额</th></tr></thead><tbody>${rows.length ? rows.join("") : '<tr><td colspan="3" class="meta">暂无事务记录</td></tr>'}</tbody></table>
    </div>
  `;
}

function renderIndustrySummary() {
  return `
    <div class="panel">
      <div class="panel-head"><h2>横向对接</h2><span class="tag blue">${state.industryProjects.length} 个单位</span></div>
      <div class="list">
        ${state.industryProjects.length ? state.industryProjects.map((project) => `
          <div class="list-row">
            <strong>${escapeHTML(project.name)}</strong>
            <div class="meta"><span>${escapeHTML(project.expert)}</span><span>${escapeHTML(project.nextMilestone)}</span><span>${listJoin((project.students || []).map(studentNameHTML))}</span></div>
          </div>
        `).join("") : '<div class="empty-state"><strong>还没有横向合作</strong><p>在"横向课题"页面添加合作单位。</p></div>'}
      </div>
    </div>
  `;
}

function renderReminderCard() {
  const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `
    <div class="panel">
      <div class="panel-head"><h2>提醒规则</h2><span class="tag ok">本地</span></div>
      <p class="meta">默认每<span>${dayNames[state.settings.weeklyReviewDay]}</span> <span>${Number(state.settings.notifyHour) || 0}:00</span> 检查学生周进展。浏览器通知开启后，页面打开时会提示到期事项。</p>
      <div style="height: 12px;"></div>
      <button class="primary-button" type="button" data-action="settings">调整规则</button>
    </div>
  `;
}

/* ── 学生 ── */

function renderStudents() {
  $("#studentsView").innerHTML = tr(`
    <div class="toolbar">
      <input id="studentSearch" type="search" placeholder="搜索姓名、年级或状态" />
      <button class="primary-button" type="button" data-action="add-student">新增学生</button>
    </div>
    <div class="list" id="studentList">
      ${state.students.map(renderStudentRow).join("") || emptyHTML()}
    </div>
  `);
}

function renderStudentRow(student) {
  return `
    <article class="list-row searchable" data-text="${escapeHTML(`${student.name} ${student.grade} ${student.status}`)}">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(student.name)} <span class="tag blue">${tv(student.grade)}</span></h3>
          <div class="meta"><span>${escapeHTML(student.role)}</span><span>${escapeHTML(student.status)}</span><span>毕业 ${escapeHTML(student.graduation)}</span></div>
        </div>
        <div class="row-actions">
          <button class="small-button" type="button" data-action="edit-student" data-id="${escapeHTML(student.id)}">编辑</button>
          <button class="small-button danger-button" type="button" data-action="delete-student" data-id="${escapeHTML(student.id)}">删除</button>
        </div>
      </div>
      <p>${escapeHTML(student.advisorFocus)}</p>
      <p class="meta">${escapeHTML(student.contact)}</p>
    </article>
  `;
}

/* ── 目标与计划（功能一）── */

/* 这三份数据不走 state/localStorage 那套，是登录后按需向服务端要的。
   学生只会拿到自己的，导师能切换看每个学生的。 */
let goalsCache = [];
let plansCache = [];
let annotationsCache = [];
let goalsStudentId = "";
let goalsLoaded = false;

function currentGoalsStudent() {
  if (!API.isPI) return API.studentId;
  if (goalsStudentId) return goalsStudentId;
  return state.students[0]?.id || "";
}

async function loadGoalsData(force = false) {
  const target = currentGoalsStudent();
  if (!target) {
    goalsCache = []; plansCache = []; annotationsCache = [];
    goalsLoaded = true;
    renderGoals();
    return;
  }
  if (goalsLoaded && !force) return;
  try {
    const [g, p, a] = await Promise.all([
      API.listGoals(API.isPI ? target : ""),
      API.listPlans(API.isPI ? target : ""),
      API.listAnnotations(API.isPI ? { student_id: target } : {}),
    ]);
    goalsCache = g.goals || [];
    plansCache = p.plans || [];
    annotationsCache = a.annotations || [];
    goalsLoaded = true;
  } catch (error) {
    setSyncStatus("error", error.message);
  }
  renderGoals();
}

function annotationsFor(type, id) {
  return annotationsCache.filter(
    (item) => item.target_type === type && item.target_id === id,
  );
}

function renderGoals() {
  const view = $("#goalsView");
  if (!view) return;
  if (!goalsLoaded) {
    view.innerHTML = tr('<div class="panel"><p class="meta">正在载入…</p></div>');
    return;
  }
  const target = currentGoalsStudent();
  const longGoals = goalsCache.filter((g) => g.horizon === "long");
  const shortGoals = goalsCache.filter((g) => g.horizon === "short");
  const openCount = annotationsCache.filter((a) => !a.resolved).length;

  view.innerHTML = tr(`
    <div class="toolbar">
      ${API.isPI ? `
        <select id="goalsStudentPicker">
          ${state.students.map((student) => `
            <option value="${escapeHTML(student.id)}" ${student.id === target ? "selected" : ""}>${escapeHTML(student.name)} · ${tv(student.grade)}</option>
          `).join("")}
        </select>` : `<strong>${escapeHTML(studentName(target))}</strong>`}
      <button class="primary-button" type="button" data-action="add-goal">新增目标</button>
      <button class="small-button" type="button" data-action="edit-plan">填写本周计划</button>
      ${openCount ? `<span class="tag warn">${openCount} 条待处理批注</span>` : ""}
    </div>

    <div class="grid two-col">
      <div class="panel">
        <div class="panel-head"><h2>长期目标</h2><span class="tag blue">${longGoals.length} 条</span></div>
        <div class="list">${longGoals.map(renderGoalRow).join("") || emptyGoalHTML("还没有长期目标")}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>短期目标</h2><span class="tag ok">${shortGoals.length} 条</span></div>
        <div class="list">${shortGoals.map(renderGoalRow).join("") || emptyGoalHTML("还没有短期目标")}</div>
      </div>
    </div>

    <div class="panel" style="margin-top: 14px;">
      <div class="panel-head"><h2>近期工作计划</h2><span class="tag violet">${plansCache.length} 周</span></div>
      <div class="list">${plansCache.map(renderPlanRow).join("") || emptyGoalHTML("还没有填写工作计划")}</div>
    </div>
  `);
}

function emptyGoalHTML(message) {
  return `<div class="empty-state"><strong>${message}</strong><p>点上面的按钮添加一条。</p></div>`;
}

function goalStatusClass(goal) {
  if (goal.status === "已完成") return "ok";
  if (goal.progress >= 60) return "ok";
  if (goal.progress >= 30) return "warn";
  return "violet";
}

function renderGoalRow(goal) {
  const notes = annotationsFor("goal", goal.id);
  return `
    <article class="list-row">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(goal.title)}</h3>
          <div class="meta">
            <span class="tag ${goalStatusClass(goal)}">${tv(goal.status)}</span>
            ${goal.target_date ? `<span>目标日期 ${escapeHTML(goal.target_date)}</span>` : ""}
            <span>${Number(goal.progress) || 0}%</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="small-button" type="button" data-action="annotate-goal" data-id="${escapeHTML(goal.id)}">批注${notes.length ? `（${notes.length}）` : ""}</button>
          <button class="small-button" type="button" data-action="edit-goal" data-id="${escapeHTML(goal.id)}">编辑</button>
          <button class="small-button danger-button" type="button" data-action="delete-goal" data-id="${escapeHTML(goal.id)}">删除</button>
        </div>
      </div>
      <div class="progress-track"><div class="progress-bar" style="width:${Number(goal.progress) || 0}%"></div></div>
      ${goal.detail ? `<p>${escapeHTML(goal.detail)}</p>` : ""}
      ${renderAnnotationList(notes)}
    </article>
  `;
}

function renderPlanRow(plan) {
  const notes = annotationsFor("plan", plan.id);
  const items = plan.items || [];
  const done = items.filter((item) => item.done).length;
  return `
    <article class="list-row">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(plan.week_of)} 当周</h3>
          <div class="meta">
            <span class="tag ${done === items.length && items.length ? "ok" : "warn"}">${done}/${items.length} 完成</span>
            <span>${tv(plan.status)}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="small-button" type="button" data-action="annotate-plan" data-id="${escapeHTML(plan.id)}">批注${notes.length ? `（${notes.length}）` : ""}</button>
          <button class="small-button" type="button" data-action="edit-plan" data-id="${escapeHTML(plan.week_of)}">编辑</button>
        </div>
      </div>
      <ul class="plan-items">
        ${items.map((item) => `
          <li class="${item.done ? "done" : ""}">
            <label>
              <input type="checkbox" data-action="toggle-plan-item"
                     data-id="${escapeHTML(plan.id)}:${escapeHTML(item.id)}"
                     ${item.done ? "checked" : ""} />
              ${escapeHTML(item.text)}
            </label>
          </li>
        `).join("") || '<li class="meta">这一周还没有具体条目。</li>'}
      </ul>
      ${renderAnnotationList(notes)}
    </article>
  `;
}

function renderAnnotationList(notes) {
  if (!notes.length) return "";
  return `
    <div class="annotation-list">
      ${notes.map((note) => `
        <div class="annotation ${note.author_role === "pi" ? "from-pi" : "from-student"} ${note.resolved ? "resolved" : ""}">
          <div class="annotation-head">
            <strong>${escapeHTML(note.author_name || "（已注销）")}</strong>
            <span class="tag ${note.author_role === "pi" ? "blue" : "violet"}">${note.author_role === "pi" ? "导师" : "学生"}</span>
            ${note.resolved ? '<span class="tag ok">已处理</span>' : ""}
            <button class="small-button" type="button" data-action="reply-annotation" data-id="${escapeHTML(note.id)}">回复</button>
            <button class="small-button" type="button" data-action="resolve-annotation" data-id="${escapeHTML(note.id)}">${note.resolved ? "重新打开" : "标记已处理"}</button>
          </div>
          <p>${escapeHTML(note.body)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

/* ── 目标与计划的表单 ── */

function goalForm(goal = {}) {
  const isNew = !goal.id;
  openModal(
    isNew ? "新增目标" : "编辑目标",
    [
      field("title", "目标", "text", goal.title || ""),
      field("horizon", "类型", "select", goal.horizon || "short", "", [["short", "短期目标"], ["long", "长期目标"]]),
      field("target_date", "目标日期", "date", goal.target_date || ""),
      field("status", "状态", "select", goal.status || "进行中", "", [["进行中", "进行中"], ["有风险", "有风险"], ["已完成", "已完成"], ["已搁置", "已搁置"]]),
      field("progress", "完成度 %", "number", goal.progress ?? 0),
      field("detail", "具体说明", "textarea", goal.detail || ""),
    ].join(""),
    async (values) => {
      const body = {
        horizon: values.horizon,
        title: values.title,
        detail: values.detail || "",
        target_date: values.target_date || "",
        status: values.status,
        progress: Math.max(0, Math.min(100, Number(values.progress) || 0)),
      };
      try {
        if (isNew) {
          if (API.isPI) body.student_id = currentGoalsStudent();
          await API.createGoal(body);
        } else {
          await API.updateGoal(goal.id, body);
        }
        await loadGoalsData(true);
        setSyncStatus("saved");
      } catch (error) {
        setSyncStatus("error", error.message);
        alert(error.message);
      }
    },
    { skipStateSave: true },
  );
}

function planForm(weekOf = "") {
  const week = weekOf || mondayOf(todayISO());
  const existing = plansCache.find((plan) => plan.week_of === week);
  const lines = (existing?.items || []).map((item) => item.text).join("\n");
  openModal(
    "本周工作计划",
    [
      field("week_of", "周起始日", "date", week),
      field("items", "计划条目（每行一条）", "textarea", lines),
      field("status", "状态", "select", existing?.status || "草稿", "", [["草稿", "草稿"], ["已提交", "已提交"]]),
    ].join(""),
    async (values) => {
      const previous = new Map((existing?.items || []).map((item) => [item.text, item]));
      const items = String(values.items || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 60)
        .map((text, index) => {
          const before = previous.get(text);
          return {
            id: before?.id || `pi_${index}_${Math.random().toString(36).slice(2, 8)}`,
            text: text.slice(0, 300),
            done: before?.done || false,
            goal_id: before?.goal_id || null,
          };
        });
      const body = { week_of: values.week_of, items, status: values.status };
      if (API.isPI) body.student_id = currentGoalsStudent();
      try {
        await API.savePlan(body);
        await loadGoalsData(true);
        setSyncStatus("saved");
      } catch (error) {
        setSyncStatus("error", error.message);
        alert(error.message);
      }
    },
    { skipStateSave: true },
  );
}

/* 周计划按自然周归档，统一取周一，避免同一周被存成好几条。 */
function mondayOf(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const shift = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - shift);
  return date.toISOString().slice(0, 10);
}

function annotationForm(targetType, targetId, parentId = "") {
  openModal(
    parentId ? "回复批注" : "写批注",
    field("body", "内容", "textarea", ""),
    async (values) => {
      if (!String(values.body || "").trim()) return;
      try {
        await API.createAnnotation({
          target_type: targetType,
          target_id: targetId,
          parent_id: parentId || null,
          body: values.body.trim(),
        });
        await loadGoalsData(true);
      } catch (error) {
        alert(error.message);
      }
    },
    { skipStateSave: true },
  );
}

async function togglePlanItem(compound) {
  const [planId, itemId] = String(compound).split(":");
  const plan = plansCache.find((item) => item.id === planId);
  if (!plan) return;
  const items = (plan.items || []).map((item) =>
    item.id === itemId ? { ...item, done: !item.done } : item,
  );
  const body = { week_of: plan.week_of, items, status: plan.status };
  if (API.isPI) body.student_id = plan.student_id;
  try {
    await API.savePlan(body);
    await loadGoalsData(true);
  } catch (error) {
    setSyncStatus("error", error.message);
  }
}

/* ── 目标与计划的其余动作 ── */

async function removeGoal(id) {
  const goal = goalsCache.find((item) => item.id === id);
  if (!goal || !confirm(t(`删除目标「${goal.title}」？`))) return;
  try {
    await API.deleteGoal(id);
    await loadGoalsData(true);
  } catch (error) {
    alert(error.message);
  }
}

function replyToAnnotation(id) {
  const note = annotationsCache.find((item) => item.id === id);
  if (!note) return;
  annotationForm(note.target_type, note.target_id, note.id);
}

async function toggleAnnotationResolved(id) {
  const note = annotationsCache.find((item) => item.id === id);
  if (!note) return;
  try {
    await API.updateAnnotation(id, { resolved: !note.resolved });
    await loadGoalsData(true);
  } catch (error) {
    alert(error.message);
  }
}

/* ── 合同管理（功能二）── */

let contractsCache = [];
let ocrStatus = { available: false, reason: "" };
let contractsLoaded = false;
let openVersion = null;

async function loadContracts(force = false) {
  if (!API.isPI) return;
  if (contractsLoaded && !force) return;
  try {
    const data = await API.listContracts();
    contractsCache = data.contracts || [];
    ocrStatus = data.ocr || ocrStatus;
    contractsLoaded = true;
  } catch (error) {
    setSyncStatus("error", error.message);
  }
  renderContracts();
}

function renderContracts() {
  const view = $("#contractsView");
  if (!view) return;
  if (!API.isPI) {
    view.innerHTML = tr('<div class="panel"><p class="meta">合同资料只对导师账号开放。</p></div>');
    return;
  }
  if (!contractsLoaded) {
    view.innerHTML = tr('<div class="panel"><p class="meta">正在载入…</p></div>');
    return;
  }
  view.innerHTML = tr(`
    <div class="toolbar">
      <button class="primary-button" type="button" data-action="add-contract">新建合同</button>
      ${ocrStatus.available
        ? `<span class="tag ok">扫描件识别可用（${escapeHTML(ocrStatus.engine || "OCR")}）</span>`
        : `<span class="tag warn">扫描件识别不可用</span>`}
    </div>
    ${ocrStatus.available ? "" : `
      <div class="backup-alert warn">
        <span><strong>扫描件无法自动识别</strong>：${escapeHTML(ocrStatus.reason || "服务器未安装 OCR 引擎。")}数字版合同（Word 导出、电子签生成的 PDF）不受影响，仍能自动抽取。</span>
      </div>`}
    <div class="list">
      ${contractsCache.map(renderContractRow).join("") || emptyGoalHTML("还没有上传合同")}
    </div>
  `);
}

function renderContractRow(contract) {
  const project = state.industryProjects.find((item) => item.id === contract.project_id);
  const pending = contract.versions.reduce((sum, v) => sum + v.item_pending, 0);
  return `
    <article class="list-row">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(contract.title)}</h3>
          <div class="meta">
            <span>${escapeHTML(project?.name || "（横向课题已删除）")}</span>
            ${contract.counterparty ? `<span>${escapeHTML(contract.counterparty)}</span>` : ""}
            <span>${contract.versions.length} 个版本</span>
            ${pending ? `<span class="tag warn">${pending} 条待确认</span>` : ""}
          </div>
        </div>
        <div class="row-actions">
          <button class="small-button" type="button" data-action="upload-contract" data-id="${escapeHTML(contract.id)}">上传新版本</button>
          <button class="small-button danger-button" type="button" data-action="delete-contract" data-id="${escapeHTML(contract.id)}">删除</button>
        </div>
      </div>
      <table class="table">
        <thead><tr><th>版本</th><th>文件</th><th>版本说明</th><th>解析</th><th>候选</th><th></th></tr></thead>
        <tbody>
          ${contract.versions.map((version) => `
            <tr>
              <td>v${Number(version.version_no) || 0}</td>
              <td>${escapeHTML(version.filename)}</td>
              <td>${escapeHTML(version.version_note || "—")}</td>
              <td>${renderOcrBadge(version)}</td>
              <td>${Number(version.item_confirmed) || 0} / ${Number(version.item_total) || 0}</td>
              <td>
                <button class="small-button" type="button" data-action="view-contract-version" data-id="${escapeHTML(version.id)}">查看条目</button>
                <button class="small-button" type="button" data-action="reparse-version" data-id="${escapeHTML(version.id)}">重新解析</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${openVersion && openVersion.contract_id === contract.id ? renderVersionItems() : ""}
    </article>
  `;
}

function renderOcrBadge(version) {
  if (version.ocr_status === "done") {
    return `<span class="tag ok">${escapeHTML(version.ocr_engine || "已解析")}</span>`;
  }
  if (version.ocr_status === "no_text") {
    return `<span class="tag danger" title="${escapeHTML(version.ocr_error || "")}">取不到文字</span>`;
  }
  if (version.ocr_status === "running") return '<span class="tag warn">解析中</span>';
  return '<span class="tag">待解析</span>';
}

function renderVersionItems() {
  const { items, version, ocr_error: ocrError } = openVersion;
  if (!items.length) {
    return `
      <div class="panel" style="margin-top: 12px;">
        <div class="panel-head"><h2>v${Number(version.version_no) || 0} 抽取结果</h2></div>
        <div class="empty-state">
          <strong>没有抽到候选条目</strong>
          <p>${escapeHTML(ocrError || "这份文件里没有找到「日期 + 交付/验收/付款」这类组合。可以手动新建待办。")}</p>
        </div>
      </div>`;
  }
  const pending = items.filter((item) => !item.confirmed && !item.dismissed);
  const handled = items.filter((item) => item.confirmed || item.dismissed);
  return `
    <div class="panel" style="margin-top: 12px;">
      <div class="panel-head">
        <h2>v${Number(version.version_no) || 0} 抽取结果</h2>
        <span class="tag warn">${pending.length} 条待确认</span>
      </div>
      <p class="meta">抽取结果只是候选。确认之后才会变成待办并开始倒数日提醒——OCR 和规则都会误读，请核对原文。</p>
      <div class="issue-list">
        ${pending.map(renderContractItem).join("")}
        ${handled.map(renderContractItem).join("")}
      </div>
    </div>
  `;
}

function renderContractItem(item) {
  const value = item.kind === "amount"
    ? `${money(item.parsed_amount || 0)} 元`
    : escapeHTML(item.parsed_date || "—");
  const confidence = Math.round((Number(item.confidence) || 0) * 100);
  return `
    <div class="issue ${item.dismissed ? "dismissed" : ""}">
      <div class="row-head">
        <div>
          <strong>${escapeHTML(item.title || "（无标题）")}</strong>
          <div class="meta">
            <span class="tag ${item.kind === "date" ? "blue" : "violet"}">${item.kind === "date" ? "日期" : "金额"}</span>
            <span>${value}</span>
            <span class="tag ${confidence >= 90 ? "ok" : confidence >= 70 ? "warn" : "danger"}">可信度 ${confidence}%</span>
            ${item.confirmed ? '<span class="tag ok">已确认</span>' : ""}
            ${item.dismissed ? '<span class="tag">已忽略</span>' : ""}
          </div>
        </div>
        <div class="row-actions">
          ${item.kind === "date" && !item.confirmed
            ? `<button class="small-button" type="button" data-action="confirm-item" data-id="${escapeHTML(item.id)}">确认并建待办</button>` : ""}
          ${item.confirmed
            ? `<button class="small-button" type="button" data-action="unconfirm-item" data-id="${escapeHTML(item.id)}">撤销确认</button>` : ""}
          <button class="small-button" type="button" data-action="edit-item" data-id="${escapeHTML(item.id)}">修改</button>
          ${!item.dismissed
            ? `<button class="small-button" type="button" data-action="dismiss-item" data-id="${escapeHTML(item.id)}">忽略</button>` : ""}
        </div>
      </div>
      <p class="meta">${escapeHTML(item.raw_text || "")}</p>
    </div>
  `;
}

function contractForm() {
  if (!state.industryProjects.length) {
    alert(t("请先在「横向课题」页面添加合作单位，再上传合同。"));
    return;
  }
  openModal(
    "新建合同",
    [
      field("title", "合同名称", "text", ""),
      field("project_id", "所属横向课题", "select", "", "",
        state.industryProjects.map((project) => [project.id, project.name])),
      field("counterparty", "对方单位", "text", ""),
    ].join(""),
    async (values) => {
      try {
        await API.createContract({
          project_id: values.project_id,
          title: values.title,
          counterparty: values.counterparty || "",
        });
        await loadContracts(true);
      } catch (error) {
        alert(error.message);
      }
    },
    { skipStateSave: true },
  );
}

async function removeContract(id) {
  const contract = contractsCache.find((item) => item.id === id);
  if (!contract) return;
  if (!confirm(t(`删除合同「${contract.title}」及其全部版本？此操作不可恢复。`))) return;
  try {
    await API.deleteContract(id);
    if (openVersion && openVersion.contract_id === id) openVersion = null;
    await loadContracts(true);
  } catch (error) {
    alert(error.message);
  }
}

/* 文件不经过服务器以外的任何地方：直接 POST 到自己的服务器。 */
function promptContractUpload(contractId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const note = prompt(t("这个版本的说明（比如「原合同」「补充协议」）："), "") ?? "";
    setSyncStatus("saving");
    try {
      const result = await API.uploadContractVersion(contractId, file, note);
      await loadContracts(true);
      setSyncStatus("saved");
      describeParse(result.parse);
    } catch (error) {
      setSyncStatus("error", error.message);
      alert(error.message);
    }
  });
  input.click();
}

/* 三种结果要分开说清楚，不能一律显示"没找到日期"。 */
function describeParse(parse) {
  if (!parse) return;
  if (parse.status === "no_text") {
    alert(t(`没能从文件里读到文字。\n${parse.error || ""}\n\n如果这是扫描件或拍照件，请手动填写关键日期。`));
    return;
  }
  if (!parse.item_count) {
    alert(t("文件已解析，但没有找到「日期 + 交付/验收/付款」这类组合。可以手动新建待办。"));
    return;
  }
  alert(t(`解析完成，抽到 ${parse.item_count} 条候选，请逐条确认后再生成待办。`));
}

async function openContractVersion(versionId) {
  try {
    const data = await API.listContractItems(versionId);
    openVersion = {
      contract_id: data.version.contract_id,
      version: data.version,
      items: data.items,
      ocr_error: data.ocr_error,
    };
    renderContracts();
  } catch (error) {
    alert(error.message);
  }
}

async function reparseContractVersion(versionId) {
  setSyncStatus("saving");
  try {
    const result = await API.reparseVersion(versionId);
    await loadContracts(true);
    if (openVersion && openVersion.version.id === versionId) {
      await openContractVersion(versionId);
    }
    setSyncStatus("saved");
    describeParse(result.parse);
  } catch (error) {
    setSyncStatus("error", error.message);
    alert(error.message);
  }
}

async function setContractItem(itemId, patch) {
  try {
    await API.patchContractItem(itemId, patch);
    if (openVersion) await openContractVersion(openVersion.version.id);
    await loadContracts(true);
    await loadTodos(true);
    renderDashboard();
  } catch (error) {
    alert(error.message);
  }
}

function contractItemForm(itemId) {
  const item = openVersion?.items.find((entry) => entry.id === itemId);
  if (!item) return;
  openModal(
    "修改抽取条目",
    [
      field("title", "标题", "text", item.title || ""),
      field("parsed_date", "日期", "date", item.parsed_date || ""),
      field("remind_days_before", "提前几天提醒", "number", 7),
    ].join(""),
    async (values) => {
      await setContractItem(itemId, {
        title: values.title,
        parsed_date: values.parsed_date || "",
        remind_days_before: Number(values.remind_days_before) || 7,
      });
    },
    { skipStateSave: true },
  );
}

/* ── 待办与倒数日 ── */

let todosCache = [];
let todoCounts = { overdue: 0, today: 0, upcoming: 0 };
let todosLoaded = false;

async function loadTodos(force = false) {
  if (todosLoaded && !force) return;
  try {
    const data = await API.listTodos();
    todosCache = data.todos || [];
    todoCounts = data.counts || todoCounts;
    todosLoaded = true;
  } catch (error) {
    setSyncStatus("error", error.message);
  }
}

function todoForm() {
  openModal(
    "新增待办",
    [
      field("title", "事项", "text", ""),
      field("due_date", "到期日", "date", ""),
      field("remind_days_before", "提前几天提醒", "number", 7),
      ...(API.isPI ? [studentSelectFieldOptional("student_id", "指派给")] : []),
      field("detail", "备注", "textarea", ""),
    ].join(""),
    async (values) => {
      try {
        await API.createTodo({
          title: values.title,
          detail: values.detail || "",
          due_date: values.due_date || "",
          remind_days_before: Number(values.remind_days_before) || 7,
          student_id: values.student_id || null,
        });
        await loadTodos(true);
        renderDashboard();
      } catch (error) {
        alert(error.message);
      }
    },
    { skipStateSave: true },
  );
}

function studentSelectFieldOptional(name, label) {
  const options = [["", "不指派"]].concat(
    state.students.map((student) => [student.id, student.name]),
  );
  return field(name, label, "select", "", "", options);
}

async function toggleTodo(id) {
  const todo = todosCache.find((item) => item.id === id);
  if (!todo) return;
  try {
    await API.updateTodo(id, { done: !todo.done });
    await loadTodos(true);
    renderDashboard();
  } catch (error) {
    alert(error.message);
  }
}

async function removeTodo(id) {
  const todo = todosCache.find((item) => item.id === id);
  if (!todo || !confirm(t(`删除待办「${todo.title}」？`))) return;
  try {
    await API.deleteTodo(id);
    await loadTodos(true);
    renderDashboard();
  } catch (error) {
    alert(error.message);
  }
}

function todoLevelClass(level) {
  if (level === "overdue") return "danger";
  if (level === "today" || level === "high") return "warn";
  if (level === "medium") return "violet";
  return "ok";
}

function todoCountdownText(todo) {
  if (todo.days_until === null || todo.days_until === undefined) return "没有到期日";
  if (todo.days_until < 0) return `已逾期 ${Math.abs(todo.days_until)} 天`;
  if (todo.days_until === 0) return "今天到期";
  return `还有 ${todo.days_until} 天`;
}

function renderTodoPanel() {
  const visible = todosCache.slice(0, 8);
  return `
    <div class="panel">
      <div class="panel-head">
        <h2>倒数日与待办</h2>
        <span class="tag ${todoCounts.overdue ? "danger" : todoCounts.today ? "warn" : "ok"}">
          ${todoCounts.overdue ? `${todoCounts.overdue} 条逾期` : todoCounts.today ? `${todoCounts.today} 条今天到期` : "没有逾期"}
        </span>
      </div>
      <div class="issue-list">
        ${visible.map((todo) => `
          <div class="issue ${todo.level === "overdue" ? "high" : ""}">
            <div class="row-head">
              <div>
                <strong>${escapeHTML(todo.title)}</strong>
                <div class="meta">
                  <span class="tag ${todoLevelClass(todo.level)}">${todoCountdownText(todo)}</span>
                  ${todo.due_date ? `<span>${escapeHTML(todo.due_date)}</span>` : ""}
                  ${todo.source === "contract" ? '<span class="tag blue">来自合同</span>' : ""}
                  ${todo.student_id ? `<span>${studentNameHTML(todo.student_id)}</span>` : ""}
                </div>
              </div>
              <div class="row-actions">
                <button class="small-button" type="button" data-action="toggle-todo" data-id="${escapeHTML(todo.id)}">完成</button>
                <button class="small-button danger-button" type="button" data-action="delete-todo" data-id="${escapeHTML(todo.id)}">删除</button>
              </div>
            </div>
          </div>
        `).join("") || '<div class="empty-state"><strong>没有待办</strong><p>确认合同里的关键日期，或手动添加一条。</p></div>'}
      </div>
      <div style="height: 10px;"></div>
      <button class="small-button" type="button" data-action="add-todo">新增待办</button>
    </div>
  `;
}

/* ── 硕士课题 ── */

function renderTopics() {
  $("#topicsView").innerHTML = tr(`
    <div class="toolbar">
      <select id="topicFilter">
        <option value="">全部风险</option>
        <option value="高">高风险</option>
        <option value="中">中风险</option>
        <option value="低">低风险</option>
      </select>
      <button class="primary-button" type="button" data-action="add-topic">新增课题</button>
    </div>
    <div class="list">
      ${state.topics.map(renderTopicRow).join("") || emptyHTML()}
    </div>
  `);
}

function renderTopicRow(topic) {
  const riskClass = topic.risk === "高" ? "danger" : topic.risk === "中" ? "warn" : "ok";
  return `
    <article class="list-row searchable" data-risk="${tv(topic.risk)}">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(topic.title)}</h3>
          <div class="meta"><span>${studentNameHTML(topic.studentId)}</span><span>${escapeHTML(topic.phase)}</span><span>复盘 ${escapeHTML(topic.nextReview)}</span></div>
        </div>
        <div class="row-actions">
          <span class="tag ${riskClass}">${tv(topic.risk)}风险</span>
          <button class="small-button" type="button" data-action="attach-file" data-id="topics:${escapeHTML(topic.id)}">关联文件</button>
          <button class="small-button" type="button" data-action="edit-topic" data-id="${escapeHTML(topic.id)}">编辑</button>
          <button class="small-button danger-button" type="button" data-action="delete-topic" data-id="${escapeHTML(topic.id)}">删除</button>
        </div>
      </div>
      <div class="progress-track"><div class="progress-bar" style="width:${Number(topic.progress || 0)}%"></div></div>
      <div class="grid three-col">
        <p><strong>整体规划</strong><br>${escapeHTML(topic.plan)}</p>
        <p><strong>实验进展</strong><br>${escapeHTML(topic.experiments)}</p>
        <p><strong>数据分析</strong><br>${escapeHTML(topic.analysis)}</p>
      </div>
      <p class="meta">文献库：${escapeHTML(topic.literature)}</p>
      ${renderAttachments("topics", topic)}
      ${topic.sourcePath ? `<p class="meta">档案路径：${escapeHTML(topic.sourcePath)}</p>` : ""}
    </article>
  `;
}

/* ── 研讨看板 ── */

function discussionMaterials() {
  const studentsWithTopics = state.students.filter((student) =>
    state.topics.some((topic) => topic.studentId === student.id)
  );

  const mechanisms = studentsWithTopics.map((student) => {
    const topic = state.topics.find((t) => t.studentId === student.id);
    return {
      studentId: student.id,
      title: `${escapeHTML(student.name)}的课题机制图`,
      src: "",
      focus: topic ? `${escapeHTML(topic.title)} — ${escapeHTML(topic.phase)}` : "暂无课题",
    };
  });

  const graphs = studentsWithTopics.map((student) => {
    const topic = state.topics.find((t) => t.studentId === student.id);
    const keywords = topic ? extractKeywordsFromTopic(topic) : [];
    const edges = [];
    for (let i = 0; i < keywords.length - 1; i += 1) {
      edges.push([keywords[0], keywords[i + 1]]);
    }
    return {
      studentId: student.id,
      center: `${student.name}文献库`,
      folder: topic?.sourcePath ? escapeHTML(topic.sourcePath) : "待配置",
      nodes: keywords,
      edges,
      prompt: topic ? `建议追问：${escapeHTML(topic.title)}中，哪些实验指标最能支撑核心结论，文献是否已经闭环。` : "请先添加课题信息。",
    };
  });

  const suggestions = [
    {
      title: "添加待入学课题建议",
      gap: "在「硕士课题」页面为待入学学生创建课题条目，填写初步方向和文献需求。",
      value: "帮助学生入学前就有明确的文献阅读方向。",
      start: "点击「硕士课题」→「新增课题」，选择待入学学生。",
    },
  ];

  return { mechanisms, graphs, suggestions };
}

function extractKeywordsFromTopic(topic) {
  const text = `${topic.title} ${topic.plan} ${topic.experiments}`;
  const keywords = [];
  const patterns = [
    /[\u4e00-\u9fa5]{2,6}(?:蛋白|淀粉|面团|面条|肉制品|油脂|益生菌|风味|感官|减盐|发酵)/g,
    /[\u4e00-\u9fa5]{2,6}(?:机制|特性|评价|分析|筛选|优化|调控|影响)/g,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    keywords.push(...matches);
  }
  return [...new Set(keywords)].slice(0, 8);
}

function renderDiscussion() {
  const materials = discussionMaterials();
  const graphs = materials.graphs;
  const graph = graphs.find((item) => item.studentId === selectedGraphStudent) || graphs[0];

  $("#discussionView").innerHTML = tr(`
    <div class="panel discussion-band">
      <div class="panel-head">
        <h2>机制图讨论</h2>
        <span class="tag blue">研一 + 研二</span>
      </div>
      ${materials.mechanisms.length ? `
        <div class="mechanism-grid">
          ${materials.mechanisms.map(renderMechanismCard).join("")}
        </div>
      ` : '<div class="empty-state"><strong>还没有可展示的学生</strong><p>添加学生并绑定课题后，机制图会出现在这里。</p></div>'}
    </div>
    <div class="grid two-col" style="margin-top: 14px;">
      <div class="panel discussion-band">
        <div class="panel-head">
          <h2>文献知识图谱</h2>
          <span class="tag violet">自动提取关键词</span>
        </div>
        ${graphs.length ? `
          <div class="graph-tabs">
            ${graphs.map((item) => `
              <button class="small-button ${item.studentId === selectedGraphStudent ? "active-tab" : ""}" type="button" data-action="select-graph" data-id="${escapeHTML(item.studentId)}">
                ${escapeHTML(studentName(item.studentId))}
              </button>
            `).join("")}
          </div>
          ${graph ? renderKnowledgeGraph(graph) : ""}
        ` : '<div class="empty-state"><strong>还没有可展示的学生</strong><p>添加学生和课题后，系统会自动从课题标题和描述中提取关键词生成知识图谱。</p></div>'}
      </div>
      <div class="panel discussion-band">
        <div class="panel-head"><h2>导师追问</h2><span class="tag warn">${graph ? escapeHTML(studentName(graph.studentId)) : "—"}</span></div>
        ${graph ? `
          <p class="meta">文献路径：${tr(graph.folder)}</p>
          <div class="issue">
            <strong>建议本周讨论的问题</strong>
            <p>${tr(graph.prompt)}</p>
          </div>
          <div class="mini-list">
            ${graph.nodes.map((node) => `<span class="tag">${escapeHTML(node)}</span>`).join("")}
          </div>
        ` : '<p class="meta">添加学生和课题后可用。</p>'}
      </div>
    </div>
    <div class="panel discussion-band" style="margin-top: 14px;">
      <div class="panel-head">
        <h2>待入学课题池</h2>
        <span class="tag ok">课题建议</span>
      </div>
      <div class="suggestion-grid">
        ${materials.suggestions.map(renderSuggestionCard).join("")}
      </div>
    </div>
  `);
}

function renderMechanismCard(item) {
  return `
    <article class="mechanism-card">
      <div style="aspect-ratio: 4/3; display:grid; place-items:center; border:1px dashed var(--line); border-radius:6px; background:#f9faf9; color:var(--muted); font-size:13px;">
        暂无机制图<br>可将图片放入学生档案目录
      </div>
      <div>
        <div class="row-head">
          <h3>${escapeHTML(studentName(item.studentId))}</h3>
          <span class="tag blue">${tv(state.students.find((student) => student.id === item.studentId)?.grade || "")}</span>
        </div>
        <strong>${tr(item.title)}</strong>
        <p>${tr(item.focus)}</p>
      </div>
    </article>
  `;
}

function renderKnowledgeGraph(graph) {
  if (!graph.nodes.length) {
    return '<div class="empty-state"><strong>关键词为空</strong><p>请在课题的规划和实验描述中填写具体内容，系统会自动提取关键词。</p></div>';
  }
  const nodes = [graph.center, ...graph.nodes];
  const positions = nodes.map((node, index) => {
    if (index === 0) return { node, x: 50, y: 50, central: true };
    const angle = ((index - 1) / graph.nodes.length) * Math.PI * 2 - Math.PI / 2;
    return {
      node,
      x: 50 + Math.cos(angle) * 36,
      y: 50 + Math.sin(angle) * 36,
      central: false,
    };
  });
  const byName = Object.fromEntries(positions.map((item) => [item.node, item]));
  const lines = [
    ...graph.nodes.map((node) => [graph.center, node]),
    ...graph.edges,
  ];
  return `
    <div class="knowledge-graph" aria-label="${escapeHTML(studentName(graph.studentId))}文献知识图谱">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${lines.map(([from, to]) => {
          const start = byName[from];
          const end = byName[to];
          if (!start || !end) return "";
          return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />`;
        }).join("")}
      </svg>
      ${positions.map((item) => `
        <button class="graph-node ${item.central ? "central" : ""}" type="button" style="left:${item.x}%; top:${item.y}%;">
          ${escapeHTML(item.node)}
        </button>
      `).join("")}
    </div>
  `;
}

function renderSuggestionCard(item) {
  return `
    <article class="suggestion-card">
      <h3>${tv(item.title)}</h3>
      <p><strong>说明</strong><br>${tv(item.gap)}</p>
      <p><strong>价值</strong><br>${tv(item.value)}</p>
      <p><strong>起步</strong><br>${tv(item.start)}</p>
    </article>
  `;
}

/* ── 档案扫描 ── */

function renderArchive() {
  const scans = state.archiveScans || [];
  $("#archiveView").innerHTML = tr(`
    <div class="toolbar">
      <input id="archiveSearch" type="search" placeholder="搜索学生、文件或检查点" />
      <div class="toolbar-actions">
        <button class="primary-button" type="button" data-action="scan-archive">扫描学生档案文件夹</button>
        <span class="tag ok">${tv(state.settings?.lastArchiveScanAt || "未扫描")}</span>
      </div>
    </div>
    <div class="grid two-col">
      <div class="panel">
        <div class="panel-head">
          <h2>材料快照</h2>
          <span class="tag blue">${scans.length} 位学生</span>
        </div>
        <div class="list">
          ${scans.map(renderArchiveRow).join("") || emptyHTML()}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>导师优先检查</h2><span class="tag warn">下一轮</span></div>
        <div class="issue-list">
          ${scans.length ? scans.map((scan) => `
            <div class="issue">
              <strong>${studentNameHTML(scan.studentId)}</strong>
              <p>${escapeHTML(scan.check)}</p>
            </div>
          `).join("") : '<div class="empty-state"><strong>还没有扫描记录</strong><p>点击"扫描学生档案文件夹"开始。</p></div>'}
        </div>
      </div>
    </div>
    ${renderUnmatchedFolders()}
  `);
}

function renderUnmatchedFolders() {
  const unmatched = state.settings?.unmatchedFolders || [];
  if (!unmatched.length) return "";
  return `
    <div class="panel" style="margin-top: 14px;">
      <div class="panel-head">
        <h2>没对上学生的文件夹</h2>
        <span class="tag warn">${unmatched.length} 个</span>
      </div>
      <p class="meta">文件夹名和学生姓名不一致时会出现在这里。指派一次之后，以后扫描就能自动认出来。</p>
      <div class="list">
        ${unmatched
          .map(
            (item) => `
          <article class="list-row">
            <div class="row-head">
              <div>
                <h3>${escapeHTML(item.folder)}</h3>
                <div class="meta"><span>${Number(item.count) || 0} 个文件</span></div>
              </div>
              <div class="row-actions">
                <button class="small-button" type="button" data-action="assign-folder" data-id="${escapeHTML(item.folder)}">指派给学生</button>
              </div>
            </div>
          </article>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderArchiveRow(scan) {
  const text = `${studentName(scan.studentId)} ${scan.files.join(" ")} ${scan.summary} ${scan.check}`;
  return `
    <article class="list-row searchable" data-text="${escapeHTML(text)}">
      <div class="row-head">
        <div>
          <h3>${studentNameHTML(scan.studentId)} <span class="tag violet">${tv(scan.version)}</span></h3>
          <div class="meta"><span>${escapeHTML(scan.folder)}</span></div>
        </div>
      </div>
      <p>${escapeHTML(scan.summary)}</p>
      <div class="meta">
        ${scan.files.map((file) => `<span class="tag">${escapeHTML(file)}</span>`).join("")}
      </div>
      <p><strong>要看</strong>：${escapeHTML(scan.check)}</p>
    </article>
  `;
}

/* ── 横向课题 ── */

function renderIndustry() {
  $("#industryView").innerHTML = tr(`
    <div class="toolbar">
      <input id="industrySearch" type="search" placeholder="搜索合作单位、合作老师或后续项目" />
      <button class="primary-button" type="button" data-action="add-industry">新增合作单位</button>
    </div>
    <div class="list">
      ${state.industryProjects.map(renderIndustryRow).join("") || emptyHTML()}
    </div>
  `);
}

function renderIndustryRow(project) {
  return `
    <article class="list-row searchable" data-text="${escapeHTML(`${project.name} ${project.expert} ${project.deliverable}`)}">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(project.name)}</h3>
          <div class="meta"><span>合作老师：${escapeHTML(project.expert)}</span><span>${escapeHTML(project.expertContact)}</span><span>跟进 ${escapeHTML(project.nextMilestone)}</span></div>
        </div>
        <div class="row-actions">
          <span class="tag blue">${tv(project.status)}</span>
          <button class="small-button" type="button" data-action="attach-file" data-id="industryProjects:${escapeHTML(project.id)}">关联文件</button>
          <button class="small-button" type="button" data-action="edit-industry" data-id="${escapeHTML(project.id)}">编辑</button>
          <button class="small-button danger-button" type="button" data-action="delete-industry" data-id="${escapeHTML(project.id)}">删除</button>
        </div>
      </div>
      <p><strong>后续具体项目</strong>：${escapeHTML(project.deliverable)}</p>
      <p><strong>学生分工</strong>：${listJoin((project.students || []).map(studentNameHTML)) || "未分配"}</p>
      ${renderAttachments("industryProjects", project)}
      <p class="meta">${escapeHTML(project.notes)}</p>
    </article>
  `;
}

/* ── 合作线索 ── */

function renderLeads() {
  const leads = state.collaborationLeads || [];
  const dueCount = leads.filter((lead) => daysBetween(lead.nextFollowUp) >= -7).length;
  $("#leadsView").innerHTML = tr(`
    <div class="toolbar">
      <input id="leadSearch" type="search" placeholder="搜索单位、联系人、机会或学生" />
      <button class="primary-button" type="button" data-action="add-lead">新增线索</button>
    </div>
    <div class="grid two-col" style="margin-bottom: 14px;">
      <div class="panel">
        <div class="panel-head">
          <h2>线索池</h2>
          <span class="tag ${dueCount ? "warn" : "ok"}">${dueCount} 条近期跟进</span>
        </div>
        <div class="list">
          ${leads.map(renderLeadRow).join("") || emptyHTML()}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>使用方式</h2><span class="tag blue">合作 + 发展</span></div>
        <div class="issue-list">
          <div class="issue">
            <strong>先记录关系，不急着立项</strong>
            <p>企业、科研院所、大学等外部交流都可以先放在线索里，等出现明确需求后再转到横向课题、联合项目或人才推荐。</p>
          </div>
          <div class="issue">
            <strong>学生发展推荐</strong>
            <p>每条线索可标记适合推荐的学生，后续按单位需求对接读博、工作、联合培养或项目交流。</p>
          </div>
        </div>
      </div>
    </div>
  `);
}

function renderLeadRow(lead) {
  const due = daysBetween(lead.nextFollowUp) >= -7;
  const resumeNames = listJoin((lead.resumeStudents || []).map(studentName)) || "待筛选";
  const searchable = `${lead.company} ${lead.contact} ${lead.role} ${lead.status} ${lead.cooperationPotential} ${lead.careerPotential} ${resumeNames}`;
  return `
    <article class="list-row searchable" data-text="${escapeHTML(searchable)}">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(lead.company)}</h3>
          <div class="meta">
            <span>${escapeHTML(lead.contact)} · ${escapeHTML(lead.role)}</span>
            <span>会面 ${escapeHTML(lead.meetingDate)}</span>
            <span>跟进 ${escapeHTML(lead.nextFollowUp)}</span>
          </div>
        </div>
        <div class="row-actions">
          <span class="tag ${due ? "warn" : "ok"}">${tv(lead.status)}</span>
          <span class="tag blue">${tv(lead.priority)}优先级</span>
          <button class="small-button" type="button" data-action="edit-lead" data-id="${escapeHTML(lead.id)}">编辑</button>
          <button class="small-button danger-button" type="button" data-action="delete-lead" data-id="${escapeHTML(lead.id)}">删除</button>
        </div>
      </div>
      <div class="grid two-col">
        <p><strong>合作可能</strong><br>${escapeHTML(lead.cooperationPotential)}</p>
        <p><strong>学生发展机会</strong><br>${escapeHTML(lead.careerPotential)}</p>
      </div>
      <p><strong>可推荐/对接学生</strong>：${escapeHTML(resumeNames)}</p>
      <p class="meta">${escapeHTML(lead.source)} · ${escapeHTML(lead.notes)}</p>
    </article>
  `;
}

/* ── AI 爬虫 ── */

function renderCrawler() {
  const tasks = state.paperCrawler || [];
  const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const reviewDayName = dayNames[state.settings.weeklyReviewDay] || "周五";
  $("#crawlerView").innerHTML = tr(`
    <div class="toolbar">
      <input id="crawlerSearch" type="search" placeholder="搜索学生、课题范围或关键词" />
      <button class="primary-button" type="button" data-action="run-all-crawlers">抓取本月论文</button>
    </div>
    <div class="grid two-col" style="margin-bottom: 14px;">
      <div class="panel">
        <div class="panel-head"><h2>本月论文雷达</h2><span class="tag ok">每${reviewDayName}</span></div>
        <p class="meta">默认检索近 ${PAPER_CRAWL_WINDOW_DAYS} 天新发表论文。页面打开时不会自动联网，点击抓取后会从 OpenAlex、Crossref、Europe PMC 等公开论文索引获取题名、期刊、日期和摘要片段，并生成本地重要发现摘要。</p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>导师查看建议</h2><span class="tag blue">15 分钟</span></div>
        <p class="meta">每周五先看每位同学 3-5 篇最新论文，判断是否影响实验设计、数据解释或论文讨论；重要条目可复制到周进展的"文献进展"。</p>
      </div>
    </div>
    ${tasks.length ? `
      <div class="list">
        ${tasks.map(renderCrawlerTask).join("")}
      </div>
    ` : `
      <div class="panel">
        <div class="empty-state">
          <strong>还没有配置论文爬虫</strong>
          <p>添加学生后，系统会自动为每位学生创建一个爬虫条目。你也可以在"学生"页面新增学生，然后回到这里配置检索关键词。</p>
        </div>
      </div>
    `}
  `);
}

function renderCrawlerTask(task) {
  const student = state.students.find((item) => item.id === task.studentId);
  const findings = task.findings || [];
  const text = `${studentName(task.studentId)} ${task.scope} ${task.query} ${findings.map((item) => item.title).join(" ")}`;
  return `
    <article class="list-row searchable" data-text="${escapeHTML(text)}">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(studentName(task.studentId))} <span class="tag blue">${tv(student?.grade || "")}</span></h3>
          <div class="meta"><span>${escapeHTML(task.scope)}</span><span>上次抓取 ${escapeHTML(task.lastRun || "未运行")}</span></div>
        </div>
        <div class="row-actions">
          <button class="small-button" type="button" data-action="run-crawler" data-id="${escapeHTML(task.studentId)}">抓取</button>
          <button class="small-button" type="button" data-action="edit-crawler" data-id="${escapeHTML(task.studentId)}">关键词</button>
        </div>
      </div>
      <p><strong>检索式</strong>：${escapeHTML(task.query)}</p>
      <div class="issue-list" id="crawlerFindings-${escapeHTML(task.studentId)}">
        ${findings.length ? findings.map(renderPaperFinding).join("") : `<div class="empty-state"><strong>还没有本月论文</strong><p>点击"抓取"后会显示近<span>${PAPER_CRAWL_WINDOW_DAYS}</span>天结果。</p></div>`}
      </div>
    </article>
  `;
}

function renderPaperFinding(paper) {
  const summaryId = `paperSummary-${hashText(`${paper.title}-${paper.date}-${paper.source}`)}`;
  const abstractText = paper.abstract || paper.summary || "该公开索引没有提供摘要，建议打开原文查看。";
  const relevance = paper.relevance || "待判断";
  const usage = paper.usage || "用途待定";
  return `
    <div class="issue">
      <strong>${escapeHTML(paper.title)}</strong>
      <div class="meta">
        <span class="tag ${relevanceClass(relevance)}">${escapeHTML(relevance)}</span>
        <span class="tag blue">${escapeHTML(usage)}</span>
        <span>${escapeHTML(paper.source || "公开索引")}</span>
        <span>${escapeHTML(paper.venue || "未知期刊")}</span>
        <span>${escapeHTML(paper.date || "")}</span>
        <button class="small-button" type="button" data-action="toggle-summary" data-id="${summaryId}">摘要</button>
        ${safeURL(paper.url) ? `<a class="small-button paper-link" href="${escapeHTML(safeURL(paper.url))}" target="_blank" rel="noopener noreferrer">原文</a>` : ""}
      </div>
      ${paper.relevanceReason ? `<p class="paper-note">筛选理由：${escapeHTML(paper.relevanceReason)}</p>` : ""}
      <p id="${summaryId}" class="paper-summary" hidden>${escapeHTML(abstractText)}</p>
    </div>
  `;
}

function relevanceClass(relevance) {
  if (relevance === "强相关") return "ok";
  if (relevance === "弱相关") return "warn";
  if (relevance === "可忽略") return "danger";
  return "violet";
}

/* ── 课题组事务 ── */

function renderDuties() {
  const rows = state.duties.map((duty) => `
    <tr>
      <td>${escapeHTML(duty.date)}</td>
      <td>${studentNameHTML(duty.studentId)}</td>
      <td>${escapeHTML(duty.title)}<br><span class="meta">${escapeHTML(duty.note)}</span></td>
      <td>${escapeHTML(duty.category)}</td>
      <td>${Number(duty.hours) || 0}</td>
      <td>${Number(duty.points) || 0}</td>
      <td>${tv(duty.status)}</td>
      <td><button class="small-button" type="button" data-action="edit-duty" data-id="${escapeHTML(duty.id)}">编辑</button> <button class="small-button danger-button" type="button" data-action="delete-duty" data-id="${escapeHTML(duty.id)}">删除</button></td>
    </tr>
  `);
  $("#dutiesView").innerHTML = tr(`
    <div class="toolbar">
      <select id="dutyStudentFilter"><option value="">全部学生</option>${optionStudents()}</select>
      <button class="primary-button" type="button" data-action="add-duty">新增事务</button>
    </div>
    <table class="table">
      <thead><tr><th>日期</th><th>学生</th><th>事务</th><th>类别</th><th>小时</th><th>积分</th><th>状态</th><th></th></tr></thead>
      <tbody>${rows.join("") || '<tr><td colspan="8" class="meta" style="text-align:center">暂无事务记录</td></tr>'}</tbody>
    </table>
  `);
}

/* ── 周进展 ── */

function renderWeekly() {
  const drafts = state.weeklyDrafts || [];
  $("#weeklyView").innerHTML = tr(`
    <div class="toolbar">
      <select id="weeklyStudentFilter"><option value="">全部学生</option>${optionStudents()}</select>
      <button class="primary-button" type="button" data-action="add-weekly">记录周进展</button>
    </div>
    ${drafts.length ? `
      <div class="panel review-panel" style="margin-bottom: 14px;">
        <div class="panel-head"><h2>待导师审核</h2><span class="tag warn">${drafts.length} 条候选稿</span></div>
        <div class="list">${drafts.map(renderWeeklyDraftRow).join("")}</div>
      </div>
    ` : ""}
    <div class="list">
      ${state.weeklyLogs.sort((a, b) => b.weekOf.localeCompare(a.weekOf)).map(renderWeeklyRow).join("") || emptyHTML()}
    </div>
  `);
}

function renderWeeklyDraftRow(draft) {
  return `
    <article class="list-row searchable" data-student="${escapeHTML(draft.studentId)}">
      <div class="row-head">
        <div>
          <h3>${studentNameHTML(draft.studentId)} · ${escapeHTML(draft.weekOf)} <span class="tag warn">候选稿</span></h3>
          <div class="meta"><span>${escapeHTML(draft.source || "自动生成")}</span><span>${escapeHTML(draft.status || "待审核")}</span></div>
        </div>
        <div class="row-actions">
          <button class="small-button" type="button" data-action="approve-weekly-draft" data-id="${escapeHTML(draft.id)}">通过</button>
          <button class="small-button" type="button" data-action="edit-weekly-draft" data-id="${escapeHTML(draft.id)}">编辑后通过</button>
          <button class="small-button danger-button" type="button" data-action="delete-weekly-draft" data-id="${escapeHTML(draft.id)}">丢弃</button>
        </div>
      </div>
      <p>${escapeHTML(draft.summary || "")}</p>
      <div class="grid three-col">
        <p><strong>实验</strong><br>${escapeHTML(draft.experiment)}</p>
        <p><strong>数据</strong><br>${escapeHTML(draft.data)}</p>
        <p><strong>下周</strong><br>${escapeHTML(draft.nextPlan)}</p>
      </div>
      <p><strong>问题</strong>：${escapeHTML(draft.blockers)}</p>
    </article>
  `;
}

function renderWeeklyRow(log) {
  const scoreClass = Number(log.outputScore) >= 4 ? "ok" : Number(log.outputScore) <= 2 ? "danger" : "warn";
  return `
    <article class="list-row searchable" data-student="${escapeHTML(log.studentId)}">
      <div class="row-head">
        <div>
          <h3>${studentNameHTML(log.studentId)} · ${escapeHTML(log.weekOf)}</h3>
          <div class="meta"><span class="tag ${scoreClass}">产出 ${Number(log.outputScore) || 0}/5</span><span>${daysBetween(log.weekOf)} 天前</span></div>
        </div>
        <button class="small-button" type="button" data-action="edit-weekly" data-id="${escapeHTML(log.id)}">编辑</button>
        <button class="small-button danger-button" type="button" data-action="delete-weekly" data-id="${escapeHTML(log.id)}">删除</button>
      </div>
      <div class="grid three-col">
        <p><strong>实验</strong><br>${escapeHTML(log.experiment)}</p>
        <p><strong>数据</strong><br>${escapeHTML(log.data)}</p>
        <p><strong>下周</strong><br>${escapeHTML(log.nextPlan)}</p>
      </div>
      <p><strong>问题</strong>：${escapeHTML(log.blockers)}</p>
      <p class="meta">导师反馈：${escapeHTML(log.mentorNote)}</p>
    </article>
  `;
}

/* ── 毕业学生 ── */

function alumniRecords() {
  return state.alumni || [];
}

function alumniDestinationTypes() {
  return [
    ["高校/科研院所", "高校/科研院所"],
    ["企业研发", "企业研发"],
    ["读博深造", "读博深造"],
    ["公务/事业单位", "公务/事业单位"],
    ["创业/自由职业", "创业/自由职业"],
    ["其他", "其他"],
  ];
}

function alumniContactable(item) {
  return Boolean(item.contact || item.wechat || item.email || item.phone);
}

function alumniStats() {
  const records = alumniRecords();
  return {
    total: records.length,
    academic: records.filter((item) => ["高校/科研院所", "读博深造"].includes(item.destinationType)).length,
    industry: records.filter((item) => item.destinationType === "企业研发").length,
    contactable: records.filter(alumniContactable).length,
  };
}

function renderAlumni() {
  const stats = alumniStats();
  const records = alumniRecords()
    .slice()
    .sort((a, b) => String(b.graduationYear || "").localeCompare(String(a.graduationYear || "")) || String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
  $("#alumniView").innerHTML = tr(`
    <div class="toolbar">
      <input id="alumniSearch" type="search" placeholder="搜索姓名、单位、职位、方向或联系方式" />
      <div class="toolbar-actions">
        <select id="alumniDestinationFilter">
          <option value="">全部去向</option>
          ${alumniDestinationTypes().map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
        </select>
        <button class="primary-button" type="button" data-action="add-alumni">新增毕业生</button>
      </div>
    </div>
    <div class="grid kpi-grid">
      ${kpi("毕业学生", stats.total, "已记录校友")}
      ${kpi("学术/读博", stats.academic, "可交流深造")}
      ${kpi("企业研发", stats.industry, "可交流就业")}
      ${kpi("可联系", stats.contactable, "有联系方式")}
    </div>
    <div class="panel alumni-note" style="margin-top: 14px;">
      <strong>这个板块可以变成课题组自己的校友网络。</strong>
      <p>在读学生需要了解读博、就业、企业研发、论文投稿或毕业选择时，可以先从这里找到合适的师兄师姐联系。</p>
    </div>
    <div class="panel" style="margin-top: 14px;">
      <div class="panel-head">
        <h2>毕业生去向</h2>
        <span class="tag blue">${records.length} 条记录</span>
      </div>
      <div class="list">
        ${records.map(renderAlumniRow).join("") || emptyHTML()}
      </div>
    </div>
  `);
}

function renderAlumniRow(item) {
  const searchable = `${item.name} ${item.graduationYear} ${item.degree} ${item.destinationType} ${item.organization} ${item.position} ${item.location} ${item.contact} ${item.wechat} ${item.email} ${item.researchDirection} ${item.canHelp} ${item.note}`;
  const reachable = alumniContactable(item);
  return `
    <article class="list-row searchable" data-destination="${tv(item.destinationType || "")}" data-text="${escapeHTML(searchable)}">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(item.name)} <span class="tag blue">${escapeHTML(item.graduationYear || "毕业年份待补")}</span></h3>
          <div class="meta">
            <span>${tv(item.degree || "学位待补")}</span>
            <span>${tv(item.destinationType || "去向待补")}</span>
            <span>${escapeHTML(item.location || "地区待补")}</span>
          </div>
        </div>
        <div class="row-actions">
          <span class="tag ${reachable ? "ok" : "warn"}">${reachable ? "可联系" : "待补联系方式"}</span>
          <button class="small-button" type="button" data-action="edit-alumni" data-id="${escapeHTML(item.id)}">编辑</button>
          <button class="small-button danger-button" type="button" data-action="delete-alumni" data-id="${escapeHTML(item.id)}">删除</button>
        </div>
      </div>
      <div class="grid three-col">
        <p><strong>现单位</strong><br>${escapeHTML(item.organization || "待补")}</p>
        <p><strong>现任职位</strong><br>${escapeHTML(item.position || "待补")}</p>
        <p><strong>联系方式</strong><br>${escapeHTML(item.contact || item.wechat || item.email || item.phone || "待补")}</p>
      </div>
      <div class="grid two-col">
        <p><strong>研究/能力方向</strong><br>${escapeHTML(item.researchDirection || "待补")}</p>
        <p><strong>可交流内容</strong><br>${escapeHTML(item.canHelp || "待补读博、就业、论文、实验或行业经验")}</p>
      </div>
      <p class="meta">${escapeHTML(item.note || "")}</p>
    </article>
  `;
}

/* ── 成果展板 ── */

function achievementRecords() {
  return state.achievements || [];
}

function isPublishedSci(item) {
  return item.type === "SCI" && ["已发表", "已接收"].includes(item.status);
}

function statusClass(status) {
  if (["已发表", "已接收"].includes(status)) return "ok";
  if (["在投", "投稿准备"].includes(status)) return "blue";
  if (["撰写中", "数据整理"].includes(status)) return "warn";
  if (status === "起步") return "violet";
  return "";
}

function achievementsByStudent(studentId) {
  return achievementRecords().filter((item) => item.studentId === studentId);
}

function achievementStats() {
  const achievements = achievementRecords();
  return {
    publishedSci: achievements.filter(isPublishedSci).length,
    submitting: achievements.filter((item) => ["在投", "投稿准备", "已接收"].includes(item.status)).length,
    inProgress: achievements.filter((item) => ["撰写中", "数据整理", "起步"].includes(item.status)).length,
    noSciStudents: state.students.filter((student) => !achievements.some((item) => item.studentId === student.id && isPublishedSci(item))).length,
  };
}

function achievementRanking() {
  return state.students
    .map((student) => {
      const items = achievementsByStudent(student.id);
      return {
        student,
        items,
        publishedSci: items.filter(isPublishedSci).length,
        active: items.filter((item) => ["在投", "投稿准备", "撰写中", "数据整理", "起步", "已接收"].includes(item.status)).length,
      };
    })
    .sort((a, b) => (b.publishedSci - a.publishedSci) || (b.active - a.active) || a.student.name.localeCompare(b.student.name, "zh-CN"));
}

function renderAchievements() {
  const achievements = achievementRecords();
  const stats = achievementStats();
  $("#achievementsView").innerHTML = tr(`
    <div class="toolbar">
      <input id="achievementSearch" type="search" placeholder="搜索学生、题名、期刊或状态" />
      <div class="toolbar-actions">
        <select id="achievementStatusFilter">
          <option value="">全部状态</option>
          <option value="已发表">已发表</option>
          <option value="已接收">已接收</option>
          <option value="在投">在投</option>
          <option value="投稿准备">投稿准备</option>
          <option value="撰写中">撰写中</option>
          <option value="数据整理">数据整理</option>
          <option value="起步">起步</option>
        </select>
        <button class="primary-button" type="button" data-action="add-achievement">新增成果</button>
      </div>
    </div>
    <div class="grid kpi-grid">
      ${kpi("已发表 SCI", stats.publishedSci, "可公示成果")}
      ${kpi("在投/投稿准备", stats.submitting, "下一批目标")}
      ${kpi("撰写中/数据整理", stats.inProgress, "需要推进")}
      ${kpi("暂无 SCI", stats.noSciStudents, "继续加油")}
    </div>
    <div class="grid two-col" style="margin-top: 14px;">
      <div class="panel achievement-board">
        <div class="panel-head">
          <h2>公开展板</h2>
          <span class="tag blue">${state.students.length} 位学生</span>
        </div>
        <div class="achievement-grid">
          ${state.students.map(renderAchievementStudentCard).join("") || emptyHTML()}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>榜单</h2><span class="tag violet">SCI 优先</span></div>
        <div class="list">
          ${achievementRanking().map(renderAchievementRankRow).join("") || emptyHTML()}
        </div>
      </div>
    </div>
    <div class="panel" style="margin-top: 14px;">
      <div class="panel-head">
        <h2>成果明细</h2>
        <span class="tag ok">${achievements.length} 条记录</span>
      </div>
      <div class="list">
        ${achievements.map(renderAchievementRow).join("") || emptyHTML()}
      </div>
    </div>
  `);
}

function renderAchievementStudentCard(student) {
  const items = achievementsByStudent(student.id);
  const publishedSci = items.filter(isPublishedSci).length;
  const active = items.filter((item) => !["已发表", "已接收"].includes(item.status)).length;
  const latest = items[0];
  const cardClass = publishedSci ? "has-sci" : active ? "moving" : "empty";
  return `
    <article class="achievement-card searchable" data-status="${tv(publishedSci ? "已发表" : latest?.status || "暂无")}" data-text="${escapeHTML(`${student.name} ${student.grade} ${items.map((item) => `${item.title} ${item.journal} ${item.status}`).join(" ")}`)}">
      <div class="achievement-card-head">
        <div>
          <h3>${escapeHTML(student.name)}</h3>
          <p>${tv(student.grade)} · ${escapeHTML(student.status)}</p>
        </div>
        <span class="achievement-badge ${cardClass}">${publishedSci ? `${publishedSci} 篇 SCI` : active ? "推进中" : "待突破"}</span>
      </div>
      <div class="achievement-score">
        <strong>${publishedSci}</strong>
        <span>已发表/接收 SCI</span>
      </div>
      <p>${latest ? escapeHTML(latest.title) : "暂未记录成果，先从周进展和课题数据中拆出第一条可投稿成果。"}</p>
      <div class="meta">
        ${items.slice(0, 3).map((item) => `<span class="tag ${statusClass(item.status)}">${tv(item.status)}</span>`).join("") || '<span class="tag warn">暂无 SCI</span>'}
      </div>
    </article>
  `;
}

function renderAchievementRankRow(row, index) {
  const nextTarget = row.items.find((item) => ["在投", "投稿准备", "撰写中", "数据整理", "起步"].includes(item.status));
  return `
    <article class="rank-row">
      <span class="rank-number">${index + 1}</span>
      <div>
        <strong>${escapeHTML(row.student.name)}</strong>
        <p>${row.publishedSci ? `已发表/接收 SCI ${row.publishedSci} 篇` : "还没有 SCI 记录"}${nextTarget ? ` · 下一篇：${tv(nextTarget.status)}` : ""}</p>
      </div>
      <span class="tag ${row.publishedSci ? "ok" : row.active ? "warn" : "danger"}">${row.publishedSci ? "领先" : row.active ? "追赶中" : "待启动"}</span>
    </article>
  `;
}

function renderAchievementRow(item) {
  const searchable = `${studentName(item.studentId)} ${item.title} ${item.journal} ${item.level} ${item.status} ${item.note}`;
  const impactFactor = Number(item.impactFactor || 0);
  return `
    <article class="list-row searchable" data-status="${tv(item.status)}" data-text="${escapeHTML(searchable)}">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(item.title)}</h3>
          <div class="meta">
            <span>${escapeHTML(studentName(item.studentId))}</span>
            <span>${tv(item.type)}</span>
            <span>${escapeHTML(item.journal || "期刊待定")}</span>
            <span>${impactFactor ? `IF ${impactFactor.toFixed(1)}` : "IF 待补"}</span>
            <span>${escapeHTML(item.publicationDate || "日期待定")}</span>
          </div>
        </div>
        <div class="row-actions">
          <span class="tag ${statusClass(item.status)}">${tv(item.status)}</span>
          <button class="small-button" type="button" data-action="attach-file" data-id="achievements:${escapeHTML(item.id)}">关联文件</button>
          <button class="small-button" type="button" data-action="edit-achievement" data-id="${escapeHTML(item.id)}">编辑</button>
          <button class="small-button danger-button" type="button" data-action="delete-achievement" data-id="${escapeHTML(item.id)}">删除</button>
        </div>
      </div>
      <div class="grid three-col">
        <p><strong>级别</strong><br>${escapeHTML(item.level || "待补")}</p>
        <p><strong>作者角色</strong><br>${escapeHTML(item.role || "待补")}</p>
        <p><strong>证明材料</strong><br>${escapeHTML(item.proof || "待补 DOI、截图或文件路径")}</p>
      </div>
      ${renderAttachments("achievements", item)}
      <p class="meta">${escapeHTML(item.note || "")}</p>
    </article>
  `;
}

/* ── 经费投入 ── */

function fundingCategories() {
  return [
    ["reagent", "试剂耗材"],
    ["instrument", "仪器检测"],
    ["publication", "论文版面"],
    ["stipend", "补助费用"],
    ["travel", "差旅会议"],
    ["other", "其他"],
  ];
}

function fundingCategoryLabel(category) {
  return fundingCategories().find(([value]) => value === category)?.[1] || "其他";
}

function fundingCategoryClass(category) {
  if (category === "publication") return "violet";
  if (category === "stipend") return "ok";
  if (category === "instrument") return "blue";
  if (category === "reagent") return "warn";
  return "";
}

function money(value) {
  return Number(value || 0).toLocaleString(localeTag(), { maximumFractionDigits: 0 });
}

function financeRecords() {
  return state.financeRecords || [];
}

function studentImpactStats(studentId) {
  const items = achievementsByStudent(studentId).filter(isPublishedSci);
  return {
    papers: items.length,
    impactSum: items.reduce((sum, item) => sum + Number(item.impactFactor || 0), 0),
  };
}

function sumByCategory(records) {
  const byCategory = Object.fromEntries(fundingCategories().map(([key]) => [key, 0]));
  records.forEach((record) => {
    const key = byCategory[record.category] === undefined ? "other" : record.category;
    byCategory[key] += Number(record.amount || 0);
  });
  return byCategory;
}

function financeByStudent(studentId) {
  const records = financeRecords().filter((record) => record.studentId === studentId);
  const byCategory = sumByCategory(records);
  const total = Object.values(byCategory).reduce((sum, value) => sum + value, 0);
  const { papers, impactSum } = studentImpactStats(studentId);
  return { records, byCategory, total, papers, impactSum, costPerIF: impactSum ? total / impactSum : 0 };
}

function financeSummary() {
  const records = financeRecords();
  const byCategory = sumByCategory(records);
  const total = records.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const impactSum = state.students.reduce((sum, student) => sum + studentImpactStats(student.id).impactSum, 0);
  return { total, byCategory, impactSum, costPerIF: impactSum ? total / impactSum : 0 };
}

function renderFunding() {
  const summary = financeSummary();
  const rows = state.students
    .map((student) => ({ student, finance: financeByStudent(student.id) }))
    .sort((a, b) => b.finance.total - a.finance.total || a.student.name.localeCompare(b.student.name, "zh-CN"));
  $("#fundingView").innerHTML = tr(`
    <div class="toolbar">
      <input id="fundingSearch" type="search" placeholder="搜索学生、用途、凭证或备注" />
      <div class="toolbar-actions">
        <select id="fundingCategoryFilter">
          <option value="">全部类别</option>
          ${fundingCategories().map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
        </select>
        <button class="primary-button" type="button" data-action="add-finance">新增费用</button>
      </div>
    </div>
    <div class="panel finance-note">
      <strong>这不是为了给学生贴标签，而是让课题资源投入透明化。</strong>
      <p>补助、耗材、仪器检测和版面费都是真实培养成本。后续补齐影响因子后，可以用总投入除以已发表 SCI 的影响因子合计，粗略观察科研投入产出比。</p>
    </div>
    <div class="grid kpi-grid" style="margin-top: 14px;">
      ${kpi("总投入", `${money(summary.total)} 元`, "已登记费用")}
      ${kpi("试剂耗材+仪器", `${money(summary.byCategory.reagent + summary.byCategory.instrument)} 元`, "实验直接成本")}
      ${kpi("论文版面费", `${money(summary.byCategory.publication)} 元`, "导师实际承担")}
      ${kpi("每 IF 投入", summary.impactSum ? `${money(summary.costPerIF)} 元` : "待补 IF", "总投入/IF合计")}
    </div>
    <div class="grid two-col" style="margin-top: 14px;">
      <div class="panel">
        <div class="panel-head">
          <h2>学生投入产出概览</h2>
          <span class="tag blue">${state.students.length} 位学生</span>
        </div>
        <div class="list">
          ${rows.map(renderFinanceStudentCard).join("") || emptyHTML()}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>费用结构</h2><span class="tag violet">${financeRecords().length} 条记录</span></div>
        <table class="table">
          <thead><tr><th>类别</th><th>金额</th><th>占比</th></tr></thead>
          <tbody>${fundingCategories().map(([key, label]) => renderFinanceCategoryRow(key, label, summary)).join("")}</tbody>
        </table>
      </div>
    </div>
    <div class="panel" style="margin-top: 14px;">
      <div class="panel-head">
        <h2>费用明细</h2>
        <span class="tag ok">${financeRecords().length} 条</span>
      </div>
      <div class="list">
        ${financeRecords().slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).map(renderFinanceRecordRow).join("") || emptyHTML()}
      </div>
    </div>
  `);
}

function renderFinanceStudentCard(row) {
  const { student, finance } = row;
  const directCost = finance.byCategory.reagent + finance.byCategory.instrument + finance.byCategory.publication;
  const maxTotal = Math.max(...state.students.map((item) => financeByStudent(item.id).total), 1);
  const width = Math.min(100, Math.round((finance.total / maxTotal) * 100));
  return `
    <article class="list-row">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(student.name)} <span class="tag blue">${tv(student.grade)}</span></h3>
          <div class="meta">
            <span>总投入 ${money(finance.total)} 元</span>
            <span>实验/版面直接成本 ${money(directCost)} 元</span>
            <span>补助 ${money(finance.byCategory.stipend)} 元</span>
          </div>
        </div>
        <span class="tag ${finance.impactSum ? "ok" : "warn"}">${finance.impactSum ? `每 IF ${money(finance.costPerIF)} 元` : "IF 待补"}</span>
      </div>
      <div class="progress-track"><div class="progress-bar finance-bar" style="width:${width}%"></div></div>
      <div class="meta">
        <span>SCI ${finance.papers} 篇</span>
        <span>影响因子合计 ${finance.impactSum ? finance.impactSum.toFixed(1) : "待补"}</span>
        <span>记录 ${finance.records.length} 条</span>
      </div>
    </article>
  `;
}

function renderFinanceCategoryRow(key, label, summary) {
  const amount = summary.byCategory[key] || 0;
  const ratio = summary.total ? Math.round((amount / summary.total) * 100) : 0;
  return `<tr><td>${label}</td><td>${money(amount)} 元</td><td>${ratio}%</td></tr>`;
}

function renderFinanceRecordRow(record) {
  const text = `${studentName(record.studentId)} ${record.item} ${record.vendor} ${record.proof} ${record.note} ${fundingCategoryLabel(record.category)}`;
  return `
    <article class="list-row searchable" data-category="${escapeHTML(record.category)}" data-text="${escapeHTML(text)}">
      <div class="row-head">
        <div>
          <h3>${escapeHTML(record.item || "未命名费用")}</h3>
          <div class="meta">
            <span>${escapeHTML(record.date || "日期待补")}</span>
            <span>${escapeHTML(studentName(record.studentId))}</span>
            <span>${escapeHTML(record.vendor || "来源待补")}</span>
          </div>
        </div>
        <div class="row-actions">
          <span class="tag ${fundingCategoryClass(record.category)}">${fundingCategoryLabel(record.category)}</span>
          <span class="tag ok">${money(record.amount)} 元</span>
          <button class="small-button" type="button" data-action="attach-file" data-id="financeRecords:${escapeHTML(record.id)}">关联文件</button>
          <button class="small-button" type="button" data-action="edit-finance" data-id="${escapeHTML(record.id)}">编辑</button>
          <button class="small-button danger-button" type="button" data-action="delete-finance" data-id="${escapeHTML(record.id)}">删除</button>
        </div>
      </div>
      <div class="grid three-col">
        <p><strong>支付/来源</strong><br>${escapeHTML(record.payer || "导师/课题经费")}</p>
        <p><strong>凭证</strong><br>${escapeHTML(record.proof || "待补发票、共享平台记录或截图")}</p>
        <p><strong>关联成果/实验</strong><br>${escapeHTML(record.relatedOutput || "待补")}</p>
      </div>
      ${renderAttachments("financeRecords", record)}
      <p class="meta">${escapeHTML(record.note || "")}</p>
    </article>
  `;
}

/* ── 数据设置 ── */

const EXPORT_WARN_DAYS = 14;
const EXPORT_DANGER_DAYS = 30;

/* 浏览器内备份清一次缓存就没了，只有导出到文件才是真备份，所以单独提醒。 */
function backupStatus() {
  const lastExportAt = state.settings.lastExportAt || "";
  if (!lastExportAt) {
    return { level: "danger", text: "你还没有把数据导出成文件。清理浏览器数据会让所有记录消失。" };
  }
  const days = daysBetween(lastExportAt);
  if (days >= EXPORT_DANGER_DAYS) {
    return { level: "danger", text: `距离上次导出备份已经<span>${days}</span>天，建议立刻导出一份。` };
  }
  if (days >= EXPORT_WARN_DAYS) {
    return { level: "warn", text: `距离上次导出备份已经<span>${days}</span>天，建议导出一份存到网盘或硬盘。` };
  }
  return { level: "ok", text: days <= 0 ? "今天已导出备份。" : `上次导出备份是<span>${days}</span>天前，状态良好。` };
}

function renderBackupAlert() {
  const status = backupStatus();
  return `
    <div class="backup-alert ${status.level}">
      <span><strong>数据备份</strong>：${tr(status.text)}</span>
      <button class="small-button" type="button" data-action="download-backup">导出备份文件</button>
    </div>
  `;
}

function renderSettings() {
  $("#settingsView").innerHTML = tr(`
    <div class="grid two-col">
      <div class="panel">
        <div class="panel-head"><h2>数据</h2><span class="tag blue">服务器</span></div>
        <p class="meta">数据保存在课题组服务器上，多人共用同一份。导出 JSON 可以备份到自己的网盘或硬盘；导入会覆盖服务器上的同名记录。</p>
        ${renderBackupAlert()}
        <div class="settings-actions" style="margin-top: 14px;">
          <button class="primary-button" type="button" data-action="download-backup">下载备份文件</button>
          <button class="small-button" type="button" data-action="export-data">在下方显示</button>
          <button class="small-button" type="button" data-action="choose-import-file">从文件导入</button>
          <button class="small-button" type="button" data-action="import-data">导入粘贴内容</button>
          <button class="small-button danger-button" type="button" data-action="reset-data">恢复示例</button>
        </div>
        <input id="importFileInput" type="file" accept="application/json,.json" hidden />
        <textarea id="dataBox" class="textarea-export" placeholder="导出的数据会显示在这里；也可以把备份 JSON 粘贴到这里后点“导入粘贴内容”。"></textarea>
        <p class="meta">服务器上的自动备份由运维脚本负责（见 deploy/README）。这里的导出是给你自己留一份离线副本用的。</p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>规则设置</h2></div>
        <form id="settingsForm" class="form-grid">
          ${field("weeklyReviewDay", "每周查看日", "select", state.settings.weeklyReviewDay, "", [
            ["1", "周一"], ["2", "周二"], ["3", "周三"], ["4", "周四"], ["5", "周五"], ["6", "周六"], ["0", "周日"],
          ])}
          ${field("notifyHour", "提醒时间", "number", state.settings.notifyHour)}
          ${field("stipendRate", "每积分劳务费", "number", state.settings.stipendRate)}
          <div class="form-actions"><button class="primary-button" type="submit">保存规则</button></div>
        </form>
      </div>
    </div>
    <div style="margin-top: 14px;">${renderAccountsPanel()}</div>
    <div style="margin-top: 14px;">${renderTrashPanel()}</div>
  `);
}

/* ── 账号管理与回收站 ── */

let usersCache = [];
let trashCache = [];
let adminLoaded = false;

async function loadAdminData(force = false) {
  if (!API.isPI) return;
  if (adminLoaded && !force) return;
  try {
    const [u, t] = await Promise.all([API.listUsers(), API.listTrash()]);
    usersCache = u.users || [];
    trashCache = t.items || [];
    adminLoaded = true;
  } catch (error) {
    setSyncStatus("error", error.message);
  }
  renderSettings();
}

/* 学生档案里已经有账号的，不再出现在"新建账号"的下拉里 */
function unboundStudents() {
  const bound = new Set(usersCache.map((user) => user.student_id).filter(Boolean));
  return state.students.filter((student) => !bound.has(student.id));
}

function renderAccountsPanel() {
  if (!API.isPI) return "";
  return `
    <div class="panel">
      <div class="panel-head">
        <h2>账号管理</h2>
        <span class="tag blue">${usersCache.length} 个账号</span>
      </div>
      <p class="meta">学生账号由你创建并绑定到学生档案。新建和重置口令时设的都是一次性口令，学生首次登录会被强制改掉。</p>
      <div class="settings-actions" style="margin: 12px 0;">
        <button class="primary-button" type="button" data-action="add-user">新建账号</button>
      </div>
      <table class="table">
        <thead><tr><th>用户名</th><th>显示名</th><th>角色</th><th>绑定学生</th><th>状态</th><th></th></tr></thead>
        <tbody>
          ${usersCache.map(renderUserRow).join("") ||
            '<tr><td colspan="6" class="meta" style="text-align:center">还没有账号</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderUserRow(user) {
  const isSelf = API.user && user.id === API.user.id;
  return `
    <tr>
      <td>${escapeHTML(user.username)}${isSelf ? ' <span class="tag ok">你</span>' : ""}</td>
      <td>${escapeHTML(user.display_name)}</td>
      <td><span class="tag ${user.role === "pi" ? "blue" : "violet"}">${user.role === "pi" ? "导师" : "学生"}</span></td>
      <td>${user.student_id ? studentNameHTML(user.student_id) : "—"}</td>
      <td><span class="tag ${user.active ? "ok" : "danger"}">${user.active ? "启用" : "停用"}</span></td>
      <td>
        <button class="small-button" type="button" data-action="reset-user-password" data-id="${escapeHTML(String(user.id))}">重置口令</button>
        <button class="small-button" type="button" data-action="edit-user" data-id="${escapeHTML(String(user.id))}">编辑</button>
        ${isSelf ? "" : `<button class="small-button ${user.active ? "danger-button" : ""}" type="button" data-action="toggle-user" data-id="${escapeHTML(String(user.id))}">${user.active ? "停用" : "启用"}</button>`}
      </td>
    </tr>
  `;
}

function userForm() {
  const candidates = unboundStudents();
  if (!candidates.length) {
    alert(t("所有学生档案都已经绑定了账号。请先在「在读学生」页面添加学生。"));
    return;
  }
  openModal(
    "新建账号",
    [
      field("username", "用户名", "text", "", "只能用字母、数字和 . _ -"),
      field("display_name", "显示名", "text", ""),
      field("student_id", "绑定学生档案", "select", "", "",
        candidates.map((student) => [student.id, `${student.name} · ${student.grade}`])),
      field("password", "初始口令", "text", "", "至少 10 位，学生首次登录会被要求改掉"),
    ].join(""),
    async (values) => {
      try {
        const created = await API.createUser({
          username: values.username,
          display_name: values.display_name || values.username,
          role: "student",
          student_id: values.student_id,
          password: values.password,
        });
        await loadAdminData(true);
        alert(t(`账号已创建。请把用户名 ${created.user.username} 和初始口令告诉学生，他首次登录时必须改掉。`));
      } catch (error) {
        alert(error.message);
        throw error;
      }
    },
    { skipStateSave: true },
  );
}

function editUserForm(userId) {
  const user = usersCache.find((item) => String(item.id) === String(userId));
  if (!user) return;
  const options = [["", "不绑定"]].concat(
    state.students.map((student) => [student.id, `${student.name} · ${student.grade}`]),
  );
  openModal(
    "编辑账号",
    [
      field("display_name", "显示名", "text", user.display_name || ""),
      user.role === "student"
        ? field("student_id", "绑定学生档案", "select", user.student_id || "", "", options)
        : "",
    ].join(""),
    async (values) => {
      const body = { display_name: values.display_name };
      if (user.role === "student") body.student_id = values.student_id || null;
      try {
        await API.updateUser(user.id, body);
        await loadAdminData(true);
      } catch (error) {
        alert(error.message);
        throw error;
      }
    },
    { skipStateSave: true },
  );
}

function resetUserPasswordForm(userId) {
  const user = usersCache.find((item) => String(item.id) === String(userId));
  if (!user) return;
  openModal(
    `重置 ${user.username} 的口令`,
    [
      `<p class="meta full">设一个一次性口令交给对方，他下次登录会被要求改掉。该账号当前所有登录会话都会立即失效。</p>`,
      field("new_password", "新口令", "text", "", "至少 10 位，含大小写/数字/符号中的两类"),
    ].join(""),
    async (values) => {
      try {
        await API.updateUser(user.id, { new_password: values.new_password });
        await loadAdminData(true);
        alert(t(`已重置。请把新口令告诉 ${user.display_name || user.username}，他登录后需要立即修改。`));
      } catch (error) {
        alert(error.message);
        throw error;
      }
    },
    { skipStateSave: true },
  );
}

async function toggleUserActive(userId) {
  const user = usersCache.find((item) => String(item.id) === String(userId));
  if (!user) return;
  const next = !user.active;
  if (!confirm(t(`${next ? "启用" : "停用"}账号 ${user.username}？${next ? "" : "停用后该账号会立即被踢下线。"}`))) return;
  try {
    await API.updateUser(user.id, { active: next });
    await loadAdminData(true);
  } catch (error) {
    alert(error.message);
  }
}

/* ── 回收站 ── */

function renderTrashPanel() {
  if (!API.isPI) return "";
  return `
    <div class="panel">
      <div class="panel-head">
        <h2>回收站</h2>
        <span class="tag ${trashCache.length ? "warn" : "ok"}">${trashCache.length} 条</span>
      </div>
      <p class="meta">删掉的东西都留在这里，可以恢复。恢复学生档案时，会连带把跟着一起删掉的课题、周进展和事务一并捞回来。</p>
      ${trashCache.length ? `
        <table class="table">
          <thead><tr><th>类型</th><th>内容</th><th>所属学生</th><th>删除时间</th><th></th></tr></thead>
          <tbody>${trashCache.map(renderTrashRow).join("")}</tbody>
        </table>
      ` : '<div class="empty-state"><strong>回收站是空的</strong><p>删除过的记录会出现在这里。</p></div>'}
    </div>
  `;
}

function renderTrashRow(item) {
  const key = `${item.kind}:${item.sub}:${item.id}`;
  return `
    <tr>
      <td><span class="tag violet">${tv(item.kind_label)}</span></td>
      <td>${escapeHTML(item.label)}</td>
      <td>${item.student_name ? escapeHTML(item.student_name) : "—"}</td>
      <td class="meta">${escapeHTML(formatDeletedAt(item.deleted_at))}</td>
      <td>
        <button class="small-button" type="button" data-action="restore-trash" data-id="${escapeHTML(key)}">恢复</button>
        <button class="small-button danger-button" type="button" data-action="purge-trash" data-id="${escapeHTML(key)}">彻底删除</button>
      </td>
    </tr>
  `;
}

/* 服务端存的是 UTC ISO，显示成本地时间 */
function formatDeletedAt(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(localeTag());
}

function parseTrashKey(key) {
  const [kind, sub, ...rest] = String(key).split(":");
  return { kind, sub, id: rest.join(":") };
}

function trashBody({ kind, sub, id }) {
  return kind === "record" ? { kind, collection: sub, id } : { kind, id };
}

async function restoreTrashItem(key) {
  const parsed = parseTrashKey(key);
  try {
    const result = await API.restoreTrash(trashBody(parsed));
    await Promise.all([loadStateFromServer(), loadAdminData(true), loadTodos(true)]);
    goalsLoaded = false;
    contractsLoaded = false;
    render();
    if (result.restored_related) {
      alert(t(`已恢复，并连带找回 ${result.restored_related} 条相关记录。`));
    }
  } catch (error) {
    alert(error.message);
  }
}

async function purgeTrashItem(key) {
  const parsed = parseTrashKey(key);
  const item = trashCache.find(
    (entry) => entry.kind === parsed.kind && entry.id === parsed.id,
  );
  if (!confirm(t(`彻底删除「${item ? item.label : parsed.id}」？此操作不可恢复。`))) return;
  try {
    await API.purgeTrash(trashBody(parsed));
    await loadAdminData(true);
    render();
  } catch (error) {
    alert(error.message);
  }
}

/* ── 通用 UI 工具 ── */

function emptyHTML() {
  return $("#emptyTemplate").innerHTML;
}

function field(name, label, type, value = "", placeholder = "", options = []) {
  if (type === "textarea") {
    return `<div class="field full"><label for="${name}">${label}</label><textarea id="${name}" name="${name}" placeholder="${placeholder}">${escapeHTML(value)}</textarea></div>`;
  }
  if (type === "select") {
    return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map(([val, text]) => `<option value="${val}" ${String(value) === String(val) ? "selected" : ""}>${text}</option>`).join("")}</select></div>`;
  }
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHTML(value)}" placeholder="${placeholder}" /></div>`;
}

function studentSelectField(name, label, value = "") {
  return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${optionStudents(value)}</select></div>`;
}

function studentCheckboxes(selected = []) {
  return `
    <div class="field full">
      <label>承担学生</label>
      <div class="meta">
        ${state.students.map((student) => `
          <label class="tag">
            <input type="checkbox" name="studentIds" value="${escapeHTML(student.id)}" ${selected.includes(student.id) ? "checked" : ""} />
            ${escapeHTML(student.name)}
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function resumeCheckboxes(selected = []) {
  return `
    <div class="field full">
      <label>可推荐/对接的学生</label>
      <div class="meta">
        ${state.students.map((student) => `
          <label class="tag">
            <input type="checkbox" name="studentIds" value="${escapeHTML(student.id)}" ${selected.includes(student.id) ? "checked" : ""} />
            ${escapeHTML(student.name)}
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

/* ── 模态框与表单 ── */

function openModal(title, html, onSubmit, options = {}) {
  $("#modalTitle").textContent = t(title);
  $("#modalForm").innerHTML = tr(`${html}<div class="form-actions"><button class="small-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存</button></div>`);
  $("#modal").classList.remove("hidden");
  $("#modalForm").onsubmit = async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("button[type=submit]");
    if (submit) submit.disabled = true;
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    const studentIds = formData.getAll("studentIds");
    if (studentIds.length > 0) values.studentIds = studentIds;
    try {
      await onSubmit(values);
      /* 目标、计划、批注这些自己直接调接口，不能再走全局的 state 同步。 */
      if (!options.skipStateSave) {
        setSyncStatus("saving");
        if (!(await saveState())) return;
      }
      closeModal();
      render();
      maybeNotify();
    } finally {
      if (submit) submit.disabled = false;
    }
  };
}

function closeModal() {
  $("#modal").classList.add("hidden");
  $("#modalForm").innerHTML = "";
}

function upsert(collection, item) {
  const index = state[collection].findIndex((entry) => entry.id === item.id);
  if (index >= 0) state[collection][index] = item;
  else state[collection].push(item);
}

/* ── 各模块表单 ── */

function studentForm(student = {}) {
  openModal(
    student.id ? "编辑学生" : "新增学生",
    [
      field("name", "姓名", "text", student.name || ""),
      field("grade", "年级", "select", student.grade || "研一", "", [["待入学", "待入学"], ["研一", "研一"], ["研二", "研二"], ["研三", "研三"], ["博士", "博士"]]),
      field("role", "当前角色", "text", student.role || ""),
      field("status", "状态", "text", student.status || ""),
      field("contact", "联系方式", "text", student.contact || ""),
      field("graduation", "预计毕业", "date", student.graduation || ""),
      field("folderAliases", "档案文件夹别名", "text", student.folderAliases || "", "文件夹名和姓名不一致时填，多个用顿号隔开"),
      field("advisorFocus", "导师关注点", "textarea", student.advisorFocus || ""),
    ].join(""),
    (values) => {
      const isNew = !student.id;
      const id = student.id || uid("s");
      upsert("students", { ...student, ...values, id });
      // 新增学生时自动创建爬虫条目
      if (isNew) {
        const exists = (state.paperCrawler || []).some((c) => c.studentId === id);
        if (!exists) {
          upsert("paperCrawler", {
            id: `crawler_${id}`,
            studentId: id,
            query: "",
            scope: "待配置",
            sources: ["OpenAlex", "Crossref"],
            lastRun: "",
            findings: [],
          });
        }
      }
    }
  );
}

function topicForm(topic = {}) {
  openModal(
    topic.id ? "编辑硕士课题" : "新增硕士课题",
    [
      studentSelectField("studentId", "学生", topic.studentId || state.students[0]?.id),
      field("title", "课题名称", "text", topic.title || ""),
      field("phase", "阶段", "text", topic.phase || ""),
      field("progress", "进度百分比", "number", topic.progress || 0),
      field("risk", "风险", "select", topic.risk || "低", "", [["低", "低"], ["中", "中"], ["高", "高"]]),
      field("nextReview", "下次复盘", "date", topic.nextReview || todayISO()),
      field("plan", "整体规划", "textarea", topic.plan || ""),
      field("experiments", "实验进展", "textarea", topic.experiments || ""),
      field("literature", "文献库", "textarea", topic.literature || ""),
      field("analysis", "数据分析", "textarea", topic.analysis || ""),
    ].join(""),
    (values) => upsert("topics", { ...topic, ...values, progress: Number(values.progress), id: topic.id || uid("t") })
  );
}

function industryForm(project = {}) {
  openModal(
    project.id ? "编辑合作单位" : "新增合作单位",
    [
      field("name", "合作单位", "text", project.name || ""),
      field("expert", "合作老师", "text", project.expert || ""),
      field("expertContact", "联系方式", "text", project.expertContact || ""),
      field("nextMilestone", "下次跟进", "date", project.nextMilestone || todayISO()),
      field("status", "状态", "select", project.status || "合作中", "", [["合作中", "合作中"], ["待推进", "待推进"], ["暂停", "暂停"], ["已结束", "已结束"]]),
      studentCheckboxes(project.students || []),
      field("deliverable", "后续具体项目", "textarea", project.deliverable || ""),
      field("notes", "对接记录", "textarea", project.notes || ""),
    ].join(""),
    (values) => {
      const { studentIds = [], ...rest } = values;
      upsert("industryProjects", { ...project, ...rest, students: studentIds, id: project.id || uid("p") });
    }
  );
}

function leadForm(lead = {}) {
  openModal(
    lead.id ? "编辑合作线索" : "新增合作线索",
    [
      field("company", "单位名称", "text", lead.company || ""),
      field("contact", "联系人", "text", lead.contact || ""),
      field("role", "对方身份", "text", lead.role || ""),
      field("meetingDate", "会面日期", "date", lead.meetingDate || todayISO()),
      field("source", "来源/背景", "text", lead.source || ""),
      field("status", "状态", "select", lead.status || "保持联系", "", [["保持联系", "保持联系"], ["待跟进", "待跟进"], ["可转横向", "可转横向"], ["学生发展机会", "学生发展机会"], ["暂缓", "暂缓"]]),
      field("priority", "优先级", "select", lead.priority || "中", "", [["高", "高"], ["中", "中"], ["低", "低"]]),
      field("nextFollowUp", "下次跟进", "date", lead.nextFollowUp || todayISO()),
      resumeCheckboxes(lead.resumeStudents || []),
      field("cooperationPotential", "合作可能", "textarea", lead.cooperationPotential || ""),
      field("careerPotential", "学生发展机会", "textarea", lead.careerPotential || ""),
      field("notes", "跟进记录", "textarea", lead.notes || ""),
    ].join(""),
    (values) => {
      const { studentIds = [], ...rest } = values;
      upsert("collaborationLeads", { ...lead, ...rest, resumeStudents: studentIds, id: lead.id || uid("lead") });
    }
  );
}

function crawlerForm(task = {}) {
  openModal(
    "编辑论文爬虫关键词",
    [
      field("scope", "课题范围（中文描述）", "textarea", task.scope || ""),
      field("query", "英文检索词（空格分隔）", "textarea", task.query || ""),
    ].join(""),
    (values) => {
      upsert("paperCrawler", { ...task, ...values, studentId: task.studentId, findings: task.findings || [] });
    }
  );
}

function dutyForm(duty = {}) {
  openModal(
    duty.id ? "编辑事务" : "新增事务",
    [
      studentSelectField("studentId", "学生", duty.studentId || state.students[0]?.id),
      field("title", "事务名称", "text", duty.title || ""),
      field("category", "类别", "text", duty.category || ""),
      field("date", "日期", "date", duty.date || todayISO()),
      field("hours", "小时", "number", duty.hours || 1),
      field("points", "积分", "number", duty.points || 1),
      field("status", "状态", "select", duty.status || "完成", "", [["计划中", "计划中"], ["进行中", "进行中"], ["完成", "完成"]]),
      field("note", "备注", "textarea", duty.note || ""),
    ].join(""),
    (values) => upsert("duties", { ...duty, ...values, hours: Number(values.hours), points: Number(values.points), id: duty.id || uid("d") })
  );
}

function weeklyForm(log = {}) {
  openModal(
    log.id ? "编辑周进展" : "记录周进展",
    [
      studentSelectField("studentId", "学生", log.studentId || state.students[0]?.id),
      field("weekOf", "周日期", "date", log.weekOf || todayISO()),
      field("outputScore", "本周产出评分 1-5", "number", log.outputScore || 3),
      field("experiment", "实验进展", "textarea", log.experiment || ""),
      field("data", "数据分析", "textarea", log.data || ""),
      field("literature", "文献进展", "textarea", log.literature || ""),
      field("blockers", "问题和卡点", "textarea", log.blockers || ""),
      field("nextPlan", "下周计划", "textarea", log.nextPlan || ""),
      field("mentorNote", "导师反馈", "textarea", log.mentorNote || ""),
    ].join(""),
    (values) => upsert("weeklyLogs", { ...log, ...values, outputScore: Number(values.outputScore), id: log.id || uid("w") })
  );
}

function alumniForm(item = {}) {
  openModal(
    item.id ? "编辑毕业学生" : "新增毕业学生",
    [
      field("name", "姓名", "text", item.name || ""),
      field("graduationYear", "毕业年份", "text", item.graduationYear || "", "例如 2026"),
      field("degree", "毕业学位/层次", "select", item.degree || "硕士", "", [["硕士", "硕士"], ["博士", "博士"], ["本科", "本科"], ["联合培养", "联合培养"], ["其他", "其他"]]),
      field("destinationType", "毕业去向", "select", item.destinationType || "企业研发", "", alumniDestinationTypes()),
      field("organization", "现单位/学校", "text", item.organization || ""),
      field("position", "现任职位", "text", item.position || "", "例如 博士生、研发工程师、高校教师"),
      field("location", "所在城市", "text", item.location || ""),
      field("contact", "主要联系方式", "text", item.contact || "", "电话、微信、邮箱或备注"),
      field("phone", "电话", "text", item.phone || ""),
      field("wechat", "微信", "text", item.wechat || ""),
      field("email", "邮箱", "email", item.email || ""),
      field("researchDirection", "研究/能力方向", "textarea", item.researchDirection || ""),
      field("canHelp", "可交流内容", "textarea", item.canHelp || "", "读博、就业、论文、实验、企业研发、城市生活等"),
      field("note", "备注", "textarea", item.note || ""),
    ].join(""),
    (values) => upsert("alumni", { ...item, ...values, id: item.id || uid("alumni") })
  );
}

function achievementForm(item = {}) {
  openModal(
    item.id ? "编辑成果记录" : "新增成果记录",
    [
      studentSelectField("studentId", "学生", item.studentId || state.students[0]?.id),
      field("type", "成果类型", "select", item.type || "SCI", "", [["SCI", "SCI"], ["中文期刊", "中文期刊"], ["综述", "综述"], ["会议论文", "会议论文"], ["专利", "专利"], ["软著", "软著"], ["竞赛/奖项", "竞赛/奖项"], ["其他", "其他"]]),
      field("status", "状态", "select", item.status || "撰写中", "", [["已发表", "已发表"], ["已接收", "已接收"], ["在投", "在投"], ["投稿准备", "投稿准备"], ["撰写中", "撰写中"], ["数据整理", "数据整理"], ["起步", "起步"]]),
      field("title", "成果题名", "text", item.title || ""),
      field("journal", "期刊/平台/目标", "text", item.journal || ""),
      field("level", "级别/分区", "text", item.level || "", "例如 中科院一区、JCR Q1"),
      field("impactFactor", "影响因子", "number", item.impactFactor || "", "例如 8.5"),
      field("role", "作者角色", "text", item.role || "", "例如 第一作者、通讯作者"),
      field("publicationDate", "发表/接收/投稿日期", "text", item.publicationDate || "", "例如 2026-06-12 或 待补"),
      field("proof", "证明材料", "textarea", item.proof || "", "DOI、截图、文件路径或投稿系统记录"),
      field("note", "备注", "textarea", item.note || ""),
    ].join(""),
    (values) => upsert("achievements", { ...item, ...values, impactFactor: Number(values.impactFactor || 0), id: item.id || uid("ach") })
  );
}

function financeForm(record = {}) {
  openModal(
    record.id ? "编辑费用记录" : "新增费用记录",
    [
      studentSelectField("studentId", "学生", record.studentId || state.students[0]?.id),
      field("category", "费用类别", "select", record.category || "reagent", "", fundingCategories()),
      field("item", "费用事项", "text", record.item || "", "例如 GC-MS 检测、论文版面费、月补助"),
      field("amount", "金额（元）", "number", record.amount || ""),
      field("date", "日期", "date", record.date || todayISO()),
      field("payer", "支付/来源", "text", record.payer || "导师/课题经费"),
      field("vendor", "供应商/平台/期刊", "text", record.vendor || ""),
      field("relatedOutput", "关联实验/成果", "text", record.relatedOutput || ""),
      field("proof", "凭证", "textarea", record.proof || "", "发票号、共享平台记录、支付截图或文件路径"),
      field("note", "备注", "textarea", record.note || ""),
    ].join(""),
    (values) => upsert("financeRecords", { ...record, ...values, amount: Number(values.amount || 0), id: record.id || uid("fin") })
  );
}

/* ── 操作路由 ── */

function handleAction(action, id) {
  if (action === "add-student") studentForm();
  if (action === "edit-student") studentForm(state.students.find((item) => item.id === id));
  if (action === "delete-student") deleteStudent(id);
  if (action === "add-alumni") alumniForm();
  if (action === "edit-alumni") alumniForm(alumniRecords().find((item) => item.id === id));
  if (action === "delete-alumni") deleteAlumni(id);
  if (action === "add-achievement") achievementForm();
  if (action === "edit-achievement") achievementForm(achievementRecords().find((item) => item.id === id));
  if (action === "delete-achievement") deleteAchievement(id);
  if (action === "add-finance") financeForm();
  if (action === "edit-finance") financeForm(financeRecords().find((item) => item.id === id));
  if (action === "delete-finance") deleteFinanceRecord(id);
  if (action === "attach-file") attachFilesTo(id);
  if (action === "remove-attachment") removeAttachment(id);
  if (action === "add-topic") topicForm();
  if (action === "edit-topic") topicForm(state.topics.find((item) => item.id === id));
  if (action === "delete-topic") deleteTopic(id);
  if (action === "add-industry") industryForm();
  if (action === "edit-industry") industryForm(state.industryProjects.find((item) => item.id === id));
  if (action === "delete-industry") deleteIndustry(id);
  if (action === "add-lead") leadForm();
  if (action === "edit-lead") leadForm(state.collaborationLeads.find((item) => item.id === id));
  if (action === "delete-lead") deleteLead(id);
  if (action === "run-crawler") runCrawler(id);
  if (action === "run-all-crawlers") runAllCrawlers();
  if (action === "edit-crawler") crawlerForm(state.paperCrawler.find((item) => item.studentId === id));
  if (action === "toggle-summary") togglePaperSummary(id);
  if (action === "add-duty") dutyForm();
  if (action === "edit-duty") dutyForm(state.duties.find((item) => item.id === id));
  if (action === "delete-duty") deleteDuty(id);
  if (action === "add-weekly") weeklyForm();
  if (action === "edit-weekly") weeklyForm(state.weeklyLogs.find((item) => item.id === id));
  if (action === "delete-weekly") deleteWeeklyLog(id);
  if (action === "approve-weekly-draft") approveWeeklyDraft(id);
  if (action === "edit-weekly-draft") editWeeklyDraft(id);
  if (action === "delete-weekly-draft") deleteWeeklyDraft(id);
  if (action === "select-graph") {
    selectedGraphStudent = id;
    renderDiscussion();
  }
  if (action === "close-modal") closeModal();
  if (action === "add-goal") goalForm();
  if (action === "edit-goal") goalForm(goalsCache.find((item) => item.id === id));
  if (action === "delete-goal") removeGoal(id);
  if (action === "edit-plan") planForm(id);
  if (action === "toggle-plan-item") togglePlanItem(id);
  if (action === "annotate-goal") annotationForm("goal", id);
  if (action === "annotate-plan") annotationForm("plan", id);
  if (action === "reply-annotation") replyToAnnotation(id);
  if (action === "resolve-annotation") toggleAnnotationResolved(id);
  if (action === "add-contract") contractForm();
  if (action === "delete-contract") removeContract(id);
  if (action === "upload-contract") promptContractUpload(id);
  if (action === "view-contract-version") openContractVersion(id);
  if (action === "reparse-version") reparseContractVersion(id);
  if (action === "confirm-item") setContractItem(id, { confirmed: true });
  if (action === "unconfirm-item") setContractItem(id, { confirmed: false });
  if (action === "dismiss-item") setContractItem(id, { dismissed: true });
  if (action === "edit-item") contractItemForm(id);
  if (action === "add-todo") todoForm();
  if (action === "add-user") userForm();
  if (action === "edit-user") editUserForm(id);
  if (action === "reset-user-password") resetUserPasswordForm(id);
  if (action === "toggle-user") toggleUserActive(id);
  if (action === "restore-trash") restoreTrashItem(id);
  if (action === "purge-trash") purgeTrashItem(id);
  if (action === "toggle-todo") toggleTodo(id);
  if (action === "delete-todo") removeTodo(id);
  if (action === "settings") {
    currentView = "settings";
    render();
  }
  if (action === "export-data") exportToDataBox();
  if (action === "download-backup") downloadServerBackup();
  if (action === "import-data") importData();
  if (action === "choose-import-file") $("#importFileInput")?.click();
  if (action === "reset-data") resetData();
  if (action === "scan-archive") scanStudentArchive();
  if (action === "assign-folder") assignFolderToStudent(id);
  if (action === "set-view") {
    currentView = id;
    render();
  }
}

/* ── 删除操作 ── */

function deleteStudent(id) {
  const student = state.students.find((item) => item.id === id);
  if (!student) return;
  if (!confirm(t(`删除 ${student.name}？相关课题、周报、事务、成果、费用和爬虫记录将一并删除。`))) return;
  state.students = state.students.filter((item) => item.id !== id);
  state.topics = state.topics.filter((item) => item.studentId !== id);
  state.weeklyLogs = state.weeklyLogs.filter((item) => item.studentId !== id);
  state.duties = state.duties.filter((item) => item.studentId !== id);
  state.paperCrawler = (state.paperCrawler || []).filter((item) => item.studentId !== id);
  state.weeklyDrafts = (state.weeklyDrafts || []).filter((item) => item.studentId !== id);
  state.archiveScans = (state.archiveScans || []).filter((item) => item.studentId !== id);
  state.achievements = achievementRecords().filter((item) => item.studentId !== id);
  state.financeRecords = financeRecords().filter((item) => item.studentId !== id);
  saveState();
  render();
}

function deleteAlumni(id) {
  const item = alumniRecords().find((record) => record.id === id);
  if (!item) return;
  if (!confirm(t(`删除毕业生"${item.name}"的记录？`))) return;
  state.alumni = alumniRecords().filter((record) => record.id !== id);
  saveState();
  render();
}

function deleteAchievement(id) {
  const item = achievementRecords().find((record) => record.id === id);
  if (!item) return;
  if (!confirm(t(`删除成果"${item.title}"？`))) return;
  state.achievements = achievementRecords().filter((record) => record.id !== id);
  saveState();
  render();
}

function deleteFinanceRecord(id) {
  const item = financeRecords().find((record) => record.id === id);
  if (!item) return;
  if (!confirm(t(`删除费用记录"${item.item || "未命名费用"}"？`))) return;
  state.financeRecords = financeRecords().filter((record) => record.id !== id);
  saveState();
  render();
}

function deleteTopic(id) {
  const topic = state.topics.find((item) => item.id === id);
  if (!topic) return;
  if (!confirm(t(`删除课题"${topic.title}"？`))) return;
  state.topics = state.topics.filter((item) => item.id !== id);
  saveState();
  render();
}

function deleteIndustry(id) {
  const project = state.industryProjects.find((item) => item.id === id);
  if (!project) return;
  if (!confirm(t(`删除合作单位"${project.name}"？`))) return;
  state.industryProjects = state.industryProjects.filter((item) => item.id !== id);
  saveState();
  render();
}

function deleteLead(id) {
  const lead = state.collaborationLeads.find((item) => item.id === id);
  if (!lead) return;
  if (!confirm(t(`删除合作线索"${lead.company}"？`))) return;
  state.collaborationLeads = state.collaborationLeads.filter((item) => item.id !== id);
  saveState();
  render();
}

function deleteDuty(id) {
  const duty = state.duties.find((item) => item.id === id);
  if (!duty) return;
  if (!confirm(t(`删除事务"${duty.title}"？`))) return;
  state.duties = state.duties.filter((item) => item.id !== id);
  saveState();
  render();
}

function deleteWeeklyLog(id) {
  const log = state.weeklyLogs.find((item) => item.id === id);
  if (!log) return;
  if (!confirm(t(`删除 ${studentName(log.studentId)} 的周进展 (${log.weekOf})？`))) return;
  state.weeklyLogs = state.weeklyLogs.filter((item) => item.id !== id);
  saveState();
  render();
}

/* ── 周进展审核流 ── */

function approveWeeklyDraft(id) {
  const draft = state.weeklyDrafts.find((item) => item.id === id);
  if (!draft) return;
  upsert("weeklyLogs", {
    id: uid("w"),
    studentId: draft.studentId,
    weekOf: draft.weekOf,
    experiment: draft.experiment,
    data: draft.data,
    literature: draft.literature,
    blockers: draft.blockers,
    nextPlan: draft.nextPlan,
    mentorNote: draft.mentorNote,
    outputScore: Number(draft.outputScore || 3),
  });
  state.weeklyDrafts = state.weeklyDrafts.filter((item) => item.id !== id);
  saveState();
  render();
}

function editWeeklyDraft(id) {
  const draft = state.weeklyDrafts.find((item) => item.id === id);
  if (!draft) return;
  openModal(
    "编辑候选周进展",
    [
      studentSelectField("studentId", "学生", draft.studentId),
      field("weekOf", "周日期", "date", draft.weekOf || todayISO()),
      field("outputScore", "本周产出评分 1-5", "number", draft.outputScore || 3),
      field("experiment", "实验进展", "textarea", draft.experiment || ""),
      field("data", "数据分析", "textarea", draft.data || ""),
      field("literature", "文献进展", "textarea", draft.literature || ""),
      field("blockers", "问题和卡点", "textarea", draft.blockers || ""),
      field("nextPlan", "下周计划", "textarea", draft.nextPlan || ""),
      field("mentorNote", "导师反馈", "textarea", draft.mentorNote || ""),
    ].join(""),
    (values) => {
      upsert("weeklyLogs", { ...values, outputScore: Number(values.outputScore), id: uid("w") });
      state.weeklyDrafts = state.weeklyDrafts.filter((item) => item.id !== id);
    }
  );
}

function deleteWeeklyDraft(id) {
  const draft = state.weeklyDrafts.find((item) => item.id === id);
  if (!draft) return;
  if (!confirm(t(`丢弃 ${studentName(draft.studentId)} 的候选周进展？`))) return;
  state.weeklyDrafts = state.weeklyDrafts.filter((item) => item.id !== id);
  saveState();
  render();
}

/* ── 数据导入导出 ── */

function validateImportData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "导入数据必须是一个 JSON 对象，不能是数组和空值。";
  if (!Array.isArray(data.students)) return "导入数据缺少有效的 students 字段（应为数组）。";
  if (!Array.isArray(data.topics)) return "导入数据缺少有效的 topics 字段（应为数组）。";
  if (!Array.isArray(data.weeklyLogs)) return "导入数据缺少有效的 weeklyLogs 字段（应为数组）。";
  if (!data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) return "导入数据缺少有效的 settings 字段（应为对象）。";
  for (const s of data.students) {
    if (!s.id || !s.name) return `学生数据缺少必要的 id 或 name（"${s.name || s.id || "未知"}"）。`;
  }
  for (const t of data.topics) {
    if (!t.id || !t.studentId) return `课题数据缺少必要的 id 或 studentId（"${t.title || t.id || "未知"}"）。`;
  }
  for (const w of data.weeklyLogs) {
    if (!w.id || !w.studentId || !w.weekOf) return "周进展数据缺少必要的 id、studentId 或 weekOf。";
  }
  if (!("weeklyReviewDay" in data.settings)) return "settings 中缺少 weeklyReviewDay 配置。";
  return null;
}

function importData() {
  const value = $("#dataBox").value.trim();
  if (!value) {
    alert(t("请先把备份 JSON 粘贴到下面的文本框，或改用“从文件导入”。"));
    return;
  }
  applyImportedJSON(value);
}

/* 直接选备份文件导入。让用户粘贴 JSON 是最容易劝退人的一步。 */
async function importDataFromFile(file) {
  if (!file) return;
  const input = $("#importFileInput");
  try {
    applyImportedJSON(await file.text(), file.name);
  } catch (error) {
    alert(t(`读取文件失败：${error.message || "请重试。"}`));
  }
  if (input) input.value = "";
}

async function applyImportedJSON(text, sourceName = "") {
  let next;
  try {
    next = JSON.parse(text);
  } catch {
    alert(t("导入失败：文件不是有效的 JSON 备份。"));
    return;
  }
  const error = validateImportData(next);
  if (error) {
    alert(t(`导入失败：数据格式不正确。\n${error}`));
    return;
  }
  if (!confirm(t(`导入${sourceName ? `「${sourceName}」` : ""}会覆盖服务器上的同名记录，确定继续？\n（建议先导出一份当前数据。）`))) return;
  try {
    setSyncStatus("saving");
    const result = await API.importBackup(text);
    await loadStateFromServer();
    render();
    setSyncStatus("saved");
    const total = Object.values(result.imported || {}).reduce((sum, n) => sum + n, 0);
    alert(t(`导入完成，共 ${total} 条记录。`));
  } catch (err) {
    setSyncStatus("error", err.message);
    alert(`${t("导入失败")}：${err.message}`);
  }
}

/* ── 导出与导入 ── */

/* 数据在服务器上，浏览器里不再留备份副本——那种副本会随着服务端更新
   变成陈旧数据，比没有更危险。导出直接向服务端要一份完整快照。 */
async function downloadServerBackup() {
  try {
    const data = await API.get("/api/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `课题组管理台备份-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    /* 只有真正导出成文件才算数，这条记录驱动首页的备份提醒。 */
    state.settings.lastExportAt = todayISO();
    await saveState();
    render();
  } catch (error) {
    alert(`${t("导出失败")}：${error.message}`);
  }
}

async function exportToDataBox() {
  try {
    const data = await API.get("/api/export");
    $("#dataBox").value = JSON.stringify(data, null, 2);
  } catch (error) {
    alert(`${t("导出失败")}：${error.message}`);
  }
}

async function resetData() {
  if (!confirm(t("恢复示例数据会覆盖服务器上的全部记录，确定继续？"))) return;
  const seeded = migrateState(seedData());
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, seeded);
  if (await saveState()) {
    await loadStateFromServer();
    render();
  }
}

/* ── 关联文件 ──
   只保存文件名、大小和解析出的文本摘要，不保存文件本身。
   localStorage 容量有限，存二进制会很快撑爆，也会让导出的备份 JSON 无法使用。 */

const ATTACHABLE_COLLECTIONS = {
  topics: "课题",
  achievements: "成果",
  industryProjects: "横向课题",
  financeRecords: "费用记录",
};

const ATTACHMENT_EXCERPT_LIMIT = 1200;

function findAttachable(collection, recordId) {
  if (!ATTACHABLE_COLLECTIONS[collection]) return null;
  return (state[collection] || []).find((item) => item.id === recordId) || null;
}

function renderAttachments(collection, record) {
  const attachments = record.attachments || [];
  if (!attachments.length) return "";
  return `
    <div class="attachment-list">
      ${attachments
        .map(
          (file) => `
        <span class="attachment-chip" title="${escapeHTML(`${file.name} · ${formatFileSize(file.size)} · ${file.parser || "文件名"}`)}">
          <strong>${escapeHTML(file.name)}</strong>
          <span>${formatFileSize(file.size)}</span>
          <button type="button" data-action="remove-attachment" data-id="${collection}:${escapeHTML(record.id)}:${escapeHTML(file.id)}" aria-label="移除关联">×</button>
        </span>`
        )
        .join("")}
    </div>
  `;
}

function formatFileSize(size = 0) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

async function attachFilesTo(target = "") {
  const [collection, recordId] = target.split(":");
  const record = findAttachable(collection, recordId);
  if (!record) return;
  const files = await pickFiles();
  if (!files.length) return;

  record.attachments = record.attachments || [];
  for (const file of files) {
    const ext = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
    const insight = await extractFileInsight(file, ext);
    record.attachments.push({
      id: uid("file"),
      name: file.name,
      size: file.size,
      ext,
      addedAt: todayISO(),
      parser: insight.parser,
      excerpt: clipContent(insight.content || "", ATTACHMENT_EXCERPT_LIMIT),
    });
  }
  saveState();
  render();
  const parsed = record.attachments.slice(-files.length).filter((file) => file.excerpt).length;
  alert(t(`已关联 ${files.length} 个文件，其中 ${parsed} 个成功读取到文本内容。\n注意：系统只记录文件名和文本摘要，不保存文件本身，原文件请勿删除或移动。`));
}

/* showOpenFilePicker 只有 Chrome/Edge 支持，其他浏览器回退到隐藏的 file input。 */
function pickFiles() {
  if (window.showOpenFilePicker) {
    return window
      .showOpenFilePicker({ multiple: true })
      .then((handles) => Promise.all(handles.map((handle) => handle.getFile())))
      .catch((error) => {
        if (error?.name !== "AbortError") alert(t(`选择文件失败：${error.message || "请重试。"}`));
        return [];
      });
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("change", () => resolve([...(input.files || [])]), { once: true });
    input.click();
  });
}

function removeAttachment(target = "") {
  const [collection, recordId, fileId] = target.split(":");
  const record = findAttachable(collection, recordId);
  if (!record || !record.attachments) return;
  const file = record.attachments.find((item) => item.id === fileId);
  if (!file || !confirm(t(`取消关联"${file.name}"？原文件不会被删除。`))) return;
  record.attachments = record.attachments.filter((item) => item.id !== fileId);
  saveState();
  render();
}

/* ── 档案扫描 ── */

async function scanStudentArchive() {
  if (!window.showDirectoryPicker) {
    alert(t("当前浏览器不支持直接选择文件夹。可以继续手动维护档案扫描，或换用支持 File System Access API 的浏览器（如 Chrome）。"));
    return;
  }
  try {
    const root = await window.showDirectoryPicker();
    const files = [];
    await collectDirectoryFiles(root, "", files);
    lastScanFiles = files;
    applyScanResult(files, todayISO(), true);
  } catch (error) {
    if (error?.name !== "AbortError") alert(t(`扫描失败：${error.message || "请重新选择文件夹。"}`));
  }
}

/* 把上一次扫到的文件留在内存里，用户绑定文件夹别名后可以直接重算，不用再选一次文件夹。 */
let lastScanFiles = [];

function applyScanResult(files, scannedAt, announce = false) {
  const studentFiles = groupFilesByStudent(files);
  const unmatched = unmatchedTopFolders(files);
  state.settings.lastArchiveScanAt = `${scannedAt} 扫描`;
  state.settings.unmatchedFolders = unmatched;

  if (studentFiles.length) {
    updateArchiveFromScan(studentFiles, scannedAt);
    createWeeklyDraftsFromScan(studentFiles, scannedAt);
  }
  saveState();
  render();

  if (!announce) return;
  if (!studentFiles.length) {
    alert(t(
      unmatched.length
        ? `扫描完成，但没有一个文件夹能对上学生姓名。\n\n扫到这些文件夹：\n${unmatched.slice(0, 8).map((item) => `· ${item.folder}（${item.count} 个文件）`).join("\n")}\n\n在"档案扫描"页面可以把它们手动指派给对应学生。`
        : "扫描完成：所选文件夹里没有找到任何文件。"
    ));
    return;
  }
  alert(t(
    `扫描完成：匹配到 ${studentFiles.length} 位学生的档案，已更新档案扫描并生成周进展候选稿。` +
      (unmatched.length ? `\n\n还有 ${unmatched.length} 个文件夹没对上学生，可以在页面上手动指派。` : "")
  ));
}

function assignFolderToStudent(folder) {
  if (!state.students.length) {
    alert(t("请先添加学生，再指派文件夹。"));
    return;
  }
  openModal(
    `把"${folder}"指派给学生`,
    [
      `<p class="meta full">指派后，这个文件夹名会作为该学生的档案别名保存，以后扫描会自动认它。</p>`,
      studentSelectField("studentId", "学生", state.students[0]?.id),
    ].join(""),
    (values) => {
      const student = state.students.find((item) => item.id === values.studentId);
      if (!student) return;
      const aliases = String(student.folderAliases || "").split(/[,，、;；\s]+/).filter(Boolean);
      if (!aliases.includes(folder)) aliases.push(folder);
      student.folderAliases = aliases.join("、");
      saveState();
      if (lastScanFiles.length) {
        applyScanResult(lastScanFiles, todayISO());
      } else {
        state.settings.unmatchedFolders = (state.settings.unmatchedFolders || []).filter((item) => item.folder !== folder);
        saveState();
        render();
      }
    }
  );
}

async function collectDirectoryFiles(directoryHandle, path, files) {
  for await (const [name, handle] of directoryHandle.entries()) {
    const nextPath = path ? `${path}/${name}` : name;
    if (handle.kind === "directory") {
      await collectDirectoryFiles(handle, nextPath, files);
    } else {
      const file = await handle.getFile();
      const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
      const insight = await extractFileInsight(file, ext);
      files.push({
        name,
        path: nextPath,
        size: file.size,
        lastModified: file.lastModified,
        ext,
        ...insight,
      });
    }
  }
}

async function extractFileInsight(file, ext) {
  const readableTextTypes = new Set(["txt", "md", "csv", "tsv", "json", "seq", "fasta", "fa", "gb", "gbk"]);
  try {
    if (file.size > 12 * 1024 * 1024) return { parser: "文件名", content: "" };
    if (readableTextTypes.has(ext)) {
      return { parser: "正文", content: clipContent(await file.text()) };
    }
    if (ext === "docx") {
      const xml = await readZipEntry(file, "word/document.xml");
      return { parser: xml ? "Word正文" : "文件名", content: clipContent(xmlToText(xml)) };
    }
    if (ext === "xlsx") {
      const text = await readXlsxText(file);
      return { parser: text ? "表格文本" : "文件名", content: clipContent(text) };
    }
    if (ext === "pdf") {
      const text = await readPdfText(file);
      return { parser: text ? "PDF正文" : "文件名", content: text };
    }
  } catch (error) {
    return { parser: "文件名", content: "" };
  }
  return { parser: "文件名", content: "" };
}

async function readXlsxText(file) {
  const sharedXml = await readZipEntry(file, "xl/sharedStrings.xml");
  const sheetXml = await readZipEntry(file, /^xl\/worksheets\/sheet\d+\.xml$/);
  const sharedStrings = [...sharedXml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) => xmlToText(match[0]));
  const sheetStrings = [...sheetXml.matchAll(/<c[^>]*t="s"[^>]*>[\s\S]*?<v>(\d+)<\/v>[\s\S]*?<\/c>/g)]
    .map((match) => sharedStrings[Number(match[1])] || "")
    .filter(Boolean);
  const directValues = [...sheetXml.matchAll(/<v>([^<]+)<\/v>/g)].map((match) => match[1]).filter(Boolean);
  return [...new Set([...sharedStrings, ...sheetStrings, ...directValues])].slice(0, 260).join(" ");
}

async function readZipEntry(file, wantedName) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocdOffset = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 66000); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) return "";
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let pointer = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder("utf-8");

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) return "";
    const compression = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const fileNameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localHeaderOffset = view.getUint32(pointer + 42, true);
    const nameStart = pointer + 46;
    const entryName = decoder.decode(bytes.slice(nameStart, nameStart + fileNameLength));
    const matched = typeof wantedName === "string" ? entryName === wantedName : wantedName.test(entryName);
    if (matched) {
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      if (compression === 0) return decoder.decode(compressed);
      if (compression === 8) return decoder.decode(await inflateRaw(compressed));
      return "";
    }
    pointer += 46 + fileNameLength + extraLength + commentLength;
  }
  return "";
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) return new Uint8Array();
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* PDF 的 FlateDecode 是带 zlib 包头的，和 zip 里的裸 deflate 不一样。 */
async function inflateZlib(bytes) {
  if (!("DecompressionStream" in window)) return new Uint8Array();
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return new Uint8Array();
  }
}

/* ── PDF 文本抽取 ──
   不引第三方库，只解 FlateDecode 流再取 Tj/TJ 文本操作符。
   能覆盖大多数由 Word/LaTeX/期刊排版生成的 PDF；
   扫描件（图片型 PDF）和用 CID 字体的中文 PDF 取不到文本，会返回空字符串。 */

const PDF_PARSE_BUDGET_MS = 4000;
const PDF_MAX_STREAM_BYTES = 2 * 1024 * 1024;

async function readPdfText(file, limit = 9000) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const streams = findPdfStreams(bytes);
  const chunks = [];
  const deadline = Date.now() + PDF_PARSE_BUDGET_MS;
  let collected = 0;

  for (const stream of streams) {
    if (collected >= limit || Date.now() > deadline) break;
    /* 图片流可以有几十 MB，解出来也不是文本，直接跳过。 */
    if (stream.length > PDF_MAX_STREAM_BYTES) continue;
    const inflated = await inflateZlib(stream);
    if (!inflated.length) continue;
    const text = extractPdfOperatorText(latin1Decode(inflated));
    if (!text) continue;
    chunks.push(text);
    collected += text.length;
  }

  const joined = chunks.join(" ");
  return looksLikeText(joined) ? clipContent(joined, limit) : "";
}

/* 扫出所有 /FlateDecode 的 stream ... endstream 段。 */
function findPdfStreams(bytes) {
  const header = latin1Decode(bytes);
  const streams = [];
  /* 前面加个非字母的边界，否则 "endstream" 里的 stream 也会被匹配到。 */
  const pattern = /[^A-Za-z]stream\r\n|[^A-Za-z]stream\n|[^A-Za-z]stream\r/g;
  let match;

  while ((match = pattern.exec(header)) !== null) {
    const keywordStart = match.index + 1;
    const dictStart = Math.max(0, keywordStart - 500);
    const dict = header.slice(dictStart, keywordStart);
    if (!dict.includes("/FlateDecode")) continue;
    const start = match.index + match[0].length;
    let end = header.indexOf("endstream", start);
    if (end < 0) continue;
    /* endstream 前通常有一个换行，属于分隔符不属于数据。 */
    while (end > start && (header[end - 1] === "\n" || header[end - 1] === "\r")) end -= 1;
    streams.push(bytes.slice(start, end));
    if (streams.length >= 400) break;
  }
  return streams;
}

/* 内容流里的可见文本都写在 (字符串) 里，Tj / TJ / ' / " 只是把它画出来。
   这里用线性扫描而不是正则：PDF 内容流里带大量括号和反斜杠，
   正则回溯会在某些论文 PDF 上直接把页面卡死。 */
function extractPdfOperatorText(content) {
  const pieces = [];
  let depth = 0;
  let current = "";
  let lastEnd = 0;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (depth === 0) {
      if (char === "(") {
        depth = 1;
        /* 记下上一段字符串结束到这一段开始之间的内容，用来判断要不要补空格。 */
        pieces.push({ separator: content.slice(lastEnd, index) });
      }
      continue;
    }
    if (char === "\\") {
      current += char + (content[index + 1] || "");
      index += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        pieces[pieces.length - 1].text = decodePdfString(current);
        current = "";
        lastEnd = index + 1;
      } else {
        current += char;
      }
      continue;
    }
    current += char;
  }

  return pieces
    /* /Lang(en-US) 这类结构标记也是括号字符串，但不是正文，要挡掉。 */
    .filter((piece) => piece.text && !piece.separator.includes("/Lang"))
    .map((piece, order) => (order && needsSpace(piece.separator) ? ` ${piece.text}` : piece.text))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/* TJ 数组里的数字是字距微调。同一个词被拆成多段时调整量很小，
   直接拼起来；调整量大或跨了换行/定位操作符才是真正的空格。
   不做这个判断的话，"chronic" 会被拆成 "c hr onic"，关键词就搜不到了。 */
function needsSpace(separator = "") {
  if (/[\n\r]/.test(separator)) return true;
  if (/\b(Tj|TJ|Td|TD|T\*|Tm|BT|ET|'|")/.test(separator)) return true;
  const numbers = separator.match(/-?\d+(?:\.\d+)?/g) || [];
  return numbers.some((value) => Math.abs(Number(value)) >= 120);
}

function decodePdfString(value) {
  return value
    .replace(/\\([nrtbf])/g, (_, code) => ({ n: "\n", r: "\r", t: "\t", b: "", f: "" }[code] ?? " "))
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\(.)/g, "$1");
}

function latin1Decode(bytes) {
  let out = "";
  const step = 8192;
  for (let index = 0; index < bytes.length; index += step) {
    out += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return out;
}

/* CID 字体的中文 PDF 解出来是乱码，用可读字符比例挡掉，避免把垃圾写进档案。 */
function looksLikeText(value) {
  if (value.length < 40) return false;
  const readable = value.match(/[一-龥A-Za-z0-9,.;:'"()\-\s]/g) || [];
  return readable.length / value.length > 0.75;
}

function xmlToText(xml = "") {
  return decodeXml(
    String(xml)
      .replace(/<\/(w:p|p|row|si)>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  ).trim();
}

function decodeXml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function clipContent(value = "", limit = 9000) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

/* 除了姓名，也认用户手工绑定的文件夹别名。
   很多课题组的文件夹叫"张三-2024级"或拼音，只按姓名精确匹配会大面积扫不到。 */
function studentFolderKeys(student) {
  const aliases = String(student.folderAliases || "")
    .split(/[,，、;；\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [student.name, ...aliases].filter(Boolean);
}

function matchesStudent(path, student) {
  const lowered = path.toLowerCase();
  return studentFolderKeys(student).some((key) => lowered.includes(key.toLowerCase()));
}

function groupFilesByStudent(files) {
  return state.students
    .map((student) => ({ student, files: files.filter((file) => matchesStudent(file.path, student)) }))
    .filter((item) => item.files.length);
}

/* 没匹配上的顶层文件夹要让用户看见，否则扫描失败时只能干瞪眼。 */
function unmatchedTopFolders(files) {
  const folders = new Map();
  files.forEach((file) => {
    if (state.students.some((student) => matchesStudent(file.path, student))) return;
    const top = file.path.split("/")[0] || "(根目录)";
    folders.set(top, (folders.get(top) || 0) + 1);
  });
  return [...folders.entries()]
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

function updateArchiveFromScan(studentFiles, scannedAt) {
  studentFiles.forEach(({ student, files }) => {
    const sorted = [...files].sort((a, b) => b.lastModified - a.lastModified);
    const recent = sorted.slice(0, 8);
    const scan = {
      studentId: student.id,
      version: `${scannedAt} 扫描`,
      folder: inferTopFolder(files, student),
      files: recent.map((file) => file.path),
      summary: summarizeScannedFiles(student, files),
      check: buildScanCheck(student, files),
    };
    upsertByStudent("archiveScans", scan);
  });
}

function createWeeklyDraftsFromScan(studentFiles, scannedAt) {
  studentFiles.forEach(({ student, files }) => {
    state.weeklyDrafts = (state.weeklyDrafts || []).filter(
      (d) => d.studentId !== student.id
    );
    const recent = files.filter((file) => Date.now() - file.lastModified <= 14 * ONE_DAY);
    if (!recent.length) return;
    const draft = {
      id: `draft_${student.id}_${scannedAt.replaceAll("-", "")}`,
      studentId: student.id,
      weekOf: scannedAt,
      outputScore: 3,
      summary: summarizeScannedFiles(student, recent),
      experiment: buildExperimentDraft(recent),
      data: inferDataProgress(recent),
      literature: inferLiteratureProgress(recent),
      blockers: buildScanCheck(student, recent),
      nextPlan: "请导师审核后，把候选稿改成正式周进展；重点确认新增文件是否对应真实实验进展。",
      mentorNote: "自动扫描生成，需人工确认。",
      source: "档案自动扫描",
      status: "待审核",
    };
    upsert("weeklyDrafts", draft);
  });
}

function upsertByStudent(collection, item) {
  const index = state[collection].findIndex((entry) => entry.studentId === item.studentId);
  if (index >= 0) state[collection][index] = { ...state[collection][index], ...item };
  else state[collection].push(item);
}

function inferTopFolder(files, student) {
  const keys = typeof student === "string" ? [student] : studentFolderKeys(student);
  const contains = (value = "") => keys.some((key) => value.toLowerCase().includes(key.toLowerCase()));
  const hit = files.find((file) => contains(file.path));
  if (!hit) return files[0]?.path.split("/")[0] || "学生档案";
  const parts = hit.path.split("/");
  const index = parts.findIndex(contains);
  return parts.slice(0, Math.min(parts.length, index + 3)).join("/");
}

function summarizeScannedFiles(student, files) {
  const counts = countBy(files, "ext");
  const progressFiles = files.filter((file) => /进度|实验|结果|论文|框架|计划|blast|测序|数据|文献/i.test(file.path) || /进展|结果|结论|讨论|材料|方法|参考文献|abstract|introduction/i.test(file.content || ""));
  const parsedCount = files.filter((file) => file.content).length;
  const highlights = extractContentHighlights(files);
  return `${student.name} 档案扫描到 ${files.length} 个文件，重点文件 ${progressFiles.length} 个，已解析正文/表格 ${parsedCount} 个；类型包括 ${Object.entries(counts).slice(0, 6).map(([ext, count]) => `${ext || "无扩展名"} ${count}`).join("、")}。${highlights ? ` 内容线索：${highlights}` : ""}`;
}

function buildScanCheck(student, files) {
  const names = files.map((file) => `${file.path} ${file.content || ""}`).join(" ");
  const checks = [];
  if (/论文|小论文|manuscript/i.test(names)) checks.push("看论文稿是否已有图表、统计标记和机制讨论。");
  if (/实验|结果|数据|xlsx|csv|opju/i.test(names)) checks.push("看新增数据是否已转成结论，而不是停留在原始文件。");
  if (/文献|参考|pdf/i.test(names)) checks.push("看新增文献是否进入课题问题链和论文讨论。");
  if (/测序|blast|菌|镜检/i.test(names)) checks.push("看菌株身份、培养条件和功能验证路线是否一致。");
  return checks.join(" ") || `查看 ${student.name} 新增文件是否形成明确本周产出。`;
}

function buildExperimentDraft(files) {
  const highlights = extractContentHighlights(files);
  const fileList = files.slice(0, 5).map((file) => file.path).join("；");
  return `扫描到 ${files.length} 个近两周更新文件：${fileList}${highlights ? `。正文/表格线索：${highlights}` : ""}`;
}

function inferDataProgress(files) {
  const dataFiles = files.filter((file) => /数据|结果|xlsx|csv|opju|seq|blast|测序|图/i.test(`${file.path} ${file.content || ""}`));
  const highlights = extractContentHighlights(dataFiles);
  return dataFiles.length ? `新增或更新 ${dataFiles.length} 个数据/结果相关文件，需要确认是否已有统计、图表和结论。${highlights ? ` 线索：${highlights}` : ""}` : "本次扫描未明显识别到数据结果文件。";
}

function inferLiteratureProgress(files) {
  const literatureFiles = files.filter((file) => /文献|参考|pdf|review|综述|references|abstract|introduction/i.test(`${file.path} ${file.content || ""}`));
  const highlights = extractContentHighlights(literatureFiles);
  return literatureFiles.length ? `新增或更新 ${literatureFiles.length} 个文献/综述相关文件，需要确认是否服务于实验设计和论文讨论。${highlights ? ` 线索：${highlights}` : ""}` : "本次扫描未明显识别到文献更新。";
}

function extractContentHighlights(files) {
  const keywords = /进展|实验|结果|结论|讨论|数据|显著|机制|文献|参考|abstract|result|conclusion|mechanism|flavor|sensory|probiotic|blast|sequencing/i;
  const hits = files
    .filter((file) => file.content && keywords.test(file.content))
    .slice(0, 3)
    .map((file) => {
      const matchIndex = file.content.search(keywords);
      const start = Math.max(0, matchIndex - 28);
      const snippet = file.content.slice(start, start + 120);
      return `${file.name}：${snippet}`;
    });
  return hits.join("；");
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function togglePaperSummary(id) {
  const summary = document.getElementById(id);
  if (!summary) return;
  summary.hidden = !summary.hidden;
}

/* ── AI 论文爬虫 ── */

async function runAllCrawlers() {
  const tasks = state.paperCrawler || [];
  if (!tasks.length) {
    alert(t("还没有配置论文爬虫。请先添加学生。"));
    return;
  }
  for (const task of tasks) {
    if (task.query) await runCrawler(task.studentId, true);
  }
  saveState();
  render();
}

async function runCrawler(studentId, quiet = false) {
  const task = state.paperCrawler.find((item) => item.studentId === studentId);
  if (!task) return;
  if (!task.query) {
    if (!quiet) alert(t("请先配置该学生的英文检索关键词。"));
    return;
  }
  const target = document.querySelector(`#crawlerFindings-${studentId}`);
  if (target) {
    target.innerHTML = tr(`<div class="empty-state"><strong>正在抓取</strong><p>正在检索近 ${PAPER_CRAWL_WINDOW_DAYS} 天论文，请稍等。</p></div>`);
  }
  try {
    const findings = await fetchRecentPapers(task.query);
    task.findings = findings;
    task.lastRun = todayISO();
    saveState();
    if (!quiet) render();
  } catch (error) {
    if (target) {
      target.innerHTML = tr(`<div class="empty-state"><strong>抓取失败</strong><p>${escapeHTML(error.message || "请检查网络后重试。")}</p></div>`);
    }
  }
}

async function fetchRecentPapers(query) {
  const to = todayISO();
  const from = dateOffset(-PAPER_CRAWL_WINDOW_DAYS);
  const results = await Promise.allSettled([
    fetchOpenAlexPapers(query, from, to),
    fetchCrossrefPapers(query, from, to),
    fetchEuropePmcPapers(query, from, to),
  ]);
  const papers = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);
  if (!papers.length && results.every((result) => result.status === "rejected")) {
    throw new Error("公开论文索引暂时不可用。");
  }
  const analyzed = dedupePapers(papers).map((paper) => ({
    ...paper,
    ...analyzePaperRelevance(query, paper),
  }));
  const useful = analyzed.filter((paper) => paper.relevance !== "可忽略");
  return (useful.length ? useful : analyzed)
    .sort((a, b) => (b.relevanceScore - a.relevanceScore) || String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 8);
}

async function fetchOpenAlexPapers(query, from, to) {
  const params = new URLSearchParams({
    search: query,
    filter: `from_publication_date:${from},to_publication_date:${to},type:article`,
    sort: "publication_date:desc",
    "per-page": "8",
  });
  const response = await fetch(`https://api.openalex.org/works?${params.toString()}`);
  if (!response.ok) throw new Error("OpenAlex 暂时不可用。");
  const data = await response.json();
  return (data.results || []).map((paper) => {
    const abstract = abstractFromInvertedIndex(paper.abstract_inverted_index);
    const title = stripTags(paper.title || "未命名论文");
    return {
      title,
      date: paper.publication_date || "",
      venue: paper.primary_location?.source?.display_name || paper.host_venue?.display_name || "",
      url: paper.primary_location?.landing_page_url || paper.doi || paper.id || "",
      source: "OpenAlex",
      abstract: abstract || "",
      searchText: `${title} ${abstract}`,
      summary: summarizePaper(title, abstract),
    };
  });
}

async function fetchCrossrefPapers(query, from, to) {
  const params = new URLSearchParams({
    "query.bibliographic": query,
    filter: `from-pub-date:${from},until-pub-date:${to},type:journal-article`,
    sort: "published",
    order: "desc",
    rows: "8",
  });
  const response = await fetch(`https://api.crossref.org/works?${params.toString()}`);
  if (!response.ok) throw new Error("Crossref 暂时不可用。");
  const data = await response.json();
  return (data.message?.items || []).map((paper) => {
    const title = stripTags(paper.title?.[0] || "未命名论文");
    const date = dateFromCrossref(paper);
    const abstract = stripTags(paper.abstract || "");
    return {
      title,
      date,
      venue: paper["container-title"]?.[0] || "",
      url: paper.URL || (paper.DOI ? `https://doi.org/${paper.DOI}` : ""),
      source: "Crossref",
      abstract: abstract || "",
      searchText: `${title} ${abstract}`,
      summary: summarizePaper(title, abstract),
    };
  });
}

async function fetchEuropePmcPapers(query, from, to) {
  const params = new URLSearchParams({
    query: `${query} AND FIRST_PDATE:[${from} TO ${to}]`,
    format: "json",
    pageSize: "8",
  });
  const response = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params.toString()}`);
  if (!response.ok) throw new Error("Europe PMC 暂时不可用。");
  const data = await response.json();
  return (data.resultList?.result || []).map((paper) => {
    const title = stripTags(paper.title || "未命名论文");
    const abstract = stripTags(paper.abstractText || "");
    return {
      title,
      date: paper.firstPublicationDate || paper.firstIndexDate || paper.pubYear || "",
      venue: paper.journalTitle || "",
      url: paper.doi ? `https://doi.org/${paper.doi}` : paper.id ? `https://europepmc.org/article/${paper.source || "MED"}/${paper.id}` : "",
      source: "Europe PMC",
      abstract: abstract || "",
      searchText: `${title} ${abstract}`,
      summary: summarizePaper(title, abstract),
    };
  });
}

function analyzePaperRelevance(query, paper) {
  const text = `${paper.title || ""} ${paper.abstract || ""} ${paper.venue || ""}`.toLowerCase();
  const tokens = queryTokens(query);
  const matchedTerms = tokens.filter((token) => text.includes(token.toLowerCase()));
  const topicBoosts = [
    [/flavou?r|aroma|volatile|sensory|taste|odor|感官|风味|香气/i, 2],
    [/mechanism|pathway|metabol|enzyme|omics|机制|代谢|酶|组学/i, 2],
    [/probiotic|lactobacillus|fermentation|strain|菌|益生菌|发酵/i, 2],
    [/machine learning|artificial intelligence|deep learning|model|ai|机器学习|人工智能|模型/i, 2],
    [/food|dough|noodle|starch|protein|食品|面|淀粉|蛋白/i, 1],
  ].reduce((score, [pattern, weight]) => score + (pattern.test(text) ? weight : 0), 0);
  const titleMatches = matchedTerms.filter((term) => String(paper.title || "").toLowerCase().includes(term.toLowerCase())).length;
  const score = matchedTerms.length + titleMatches + topicBoosts;
  const relevance = score >= 6 ? "强相关" : score >= 3 ? "弱相关" : "可忽略";
  const usage = inferPaperUsage(text);
  const reasonTerms = matchedTerms.slice(0, 5).join("、");
  const reason = reasonTerms
    ? `命中 ${reasonTerms}，${usage}。`
    : `${topicBoosts ? "命中课题邻近主题" : "与检索式重合较少"}，${usage}。`;
  return {
    relevance,
    relevanceScore: score,
    relevanceReason: reason,
    usage,
    matchedTerms,
  };
}

function queryTokens(query) {
  const stopWords = new Set(["and", "with", "from", "into", "food", "foods", "study", "effect", "effects", "quality", "properties", "protein", "analysis", "based"]);
  return [...new Set(String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/)
    .filter((token) => token.length > 1 && !stopWords.has(token)))];
}

function inferPaperUsage(text) {
  if (/review|综述|perspective|bibliometric/i.test(text)) return "适合补文献综述";
  if (/method|model|machine learning|deep learning|algorithm|protocol|方法|模型|算法/i.test(text)) return "适合借鉴方法";
  if (/mechanism|pathway|metabol|enzyme|omics|机制|通路|代谢/i.test(text)) return "适合机制讨论";
  if (/sensory|consumer|preference|感官|偏好/i.test(text)) return "适合感官评价设计";
  if (/result|quality|characteri[sz]ation|property|数据|性质|品质/i.test(text)) return "适合结果对照";
  return "先看摘要判断";
}

function dedupePapers(papers) {
  const seen = new Set();
  return papers.filter((paper) => {
    const key = paper.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dateFromCrossref(paper) {
  const parts = paper.published?.["date-parts"]?.[0] || paper.publishedPrint?.["date-parts"]?.[0] || paper.publishedOnline?.["date-parts"]?.[0];
  if (!parts) return "";
  const [year, month = 1, day = 1] = parts;
  return [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
}

function stripTags(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function abstractFromInvertedIndex(index) {
  if (!index) return "";
  const words = [];
  Object.entries(index).forEach(([word, positions]) => {
    positions.forEach((position) => {
      words[position] = word;
    });
  });
  return words.filter(Boolean).join(" ");
}

function summarizePaper(title, abstract) {
  const source = `${title}. ${abstract}`.trim();
  if (!source) return "暂无摘要信息，建议打开原文判断是否与课题相关。";
  const lower = source.toLowerCase();
  const tags = [];
  [
    ["mechanism", "机制"],
    ["sensory", "感官"],
    ["flavor", "风味"],
    ["protein", "蛋白"],
    ["microstructure", "微观结构"],
    ["metabol", "代谢"],
    ["probiotic", "益生菌"],
    ["machine learning", "机器学习"],
    ["artificial intelligence", "AI"],
    ["salt", "减盐/盐"],
  ].forEach(([needle, label]) => {
    if (lower.includes(needle)) tags.push(label);
  });
  const firstSentence = source.split(/(?<=[.!?。！？])\s+/)[0] || source;
  const clipped = firstSentence.length > 220 ? `${firstSentence.slice(0, 220)}...` : firstSentence;
  return `${tags.length ? `关键词：${tags.slice(0, 4).join("、")}。` : ""}重要发现线索：${clipped}`;
}

/* ── 事件绑定 ── */

function attachEvents() {
  /* 侧边栏和顶部按钮在切换语言时会整块重绘，所以一律用事件委托，
     不能直接 addEventListener，否则重绘一次就失效了。 */
  document.body.addEventListener("click", (event) => {
    const langTarget = event.target.closest("[data-lang]");
    if (langTarget) {
      switchLanguage(langTarget.dataset.lang);
      return;
    }
    if (event.target.closest("#quickWeeklyBtn")) weeklyForm();
    if (event.target.closest("#quickStudentBtn")) studentForm();
    if (event.target.closest("#notifyBtn")) requestNotifications();
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) handleAction(actionTarget.dataset.action, actionTarget.dataset.id);
    const navTarget = event.target.closest("[data-view]");
    if (navTarget) {
      currentView = navTarget.dataset.view;
      render();
      /* 这几个视图的数据不在 state 里，进页面时按需拉一次。 */
      if (currentView === "goals") loadGoalsData();
      if (currentView === "contracts") loadContracts();
      if (currentView === "settings") loadAdminData();
    }
  });

  $("#modalClose").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (event) => {
    if (event.target.id === "modal") closeModal();
  });

  document.body.addEventListener("change", (event) => {
    if (event.target.id === "goalsStudentPicker") {
      goalsStudentId = event.target.value;
      goalsLoaded = false;
      loadGoalsData(true);
    }
  });

  document.body.addEventListener("input", (event) => {
    const searchInputs = ["studentSearch", "alumniSearch", "industrySearch", "archiveSearch", "leadSearch", "crawlerSearch", "achievementSearch", "fundingSearch"];
    if (searchInputs.includes(event.target.id)) {
      filterText(event.target.value, event.target.closest(".view"));
    }
  });

  document.body.addEventListener("change", (event) => {
    if (event.target.id === "topicFilter") filterRisk(event.target.value);
    if (event.target.id === "weeklyStudentFilter") filterByAttr("data-student", event.target.value);
    if (event.target.id === "dutyStudentFilter") filterDuty(event.target.value);
    if (event.target.id === "alumniDestinationFilter") filterScopedAttr("#alumniView", "data-destination", event.target.value);
    if (event.target.id === "achievementStatusFilter") filterScopedAttr("#achievementsView", "data-status", event.target.value);
    if (event.target.id === "fundingCategoryFilter") filterScopedAttr("#fundingView", "data-category", event.target.value);
    if (event.target.id === "importFileInput") importDataFromFile(event.target.files?.[0]);
  });

  document.body.addEventListener("submit", (event) => {
    if (event.target.id === "settingsForm") {
      event.preventDefault();
      const formData = new FormData(event.target);
      state.settings.weeklyReviewDay = Number(formData.get("weeklyReviewDay"));
      state.settings.notifyHour = Number(formData.get("notifyHour"));
      state.settings.stipendRate = Number(formData.get("stipendRate"));
      saveState();
      render();
    }
  });
}

/* ── 搜索过滤 ── */

function filterText(query, scope) {
  const normalized = query.trim().toLowerCase();
  scope.querySelectorAll(".searchable").forEach((row) => {
    row.style.display = (row.dataset.text || '').toLowerCase().includes(normalized) ? "" : "none";
  });
}

function filterRisk(risk) {
  document.querySelectorAll("#topicsView .searchable").forEach((row) => {
    row.style.display = !risk || row.dataset.risk === risk ? "" : "none";
  });
}

function filterByAttr(attr, value) {
  document.querySelectorAll("#weeklyView .searchable").forEach((row) => {
    row.style.display = !value || row.getAttribute(attr) === value ? "" : "none";
  });
}

function filterScopedAttr(scopeSelector, attr, value) {
  document.querySelectorAll(`${scopeSelector} .searchable`).forEach((row) => {
    row.style.display = !value || row.getAttribute(attr) === value ? "" : "none";
  });
}

function filterDuty(studentId) {
  document.querySelectorAll("#dutiesView tbody tr").forEach((row) => {
    row.style.display = !studentId || row.children[1].textContent === studentName(studentId) ? "" : "none";
  });
}

/* ── 浏览器通知 ── */

function requestNotifications() {
  if (!("Notification" in window)) {
    alert(t("当前浏览器不支持系统通知。"));
    return;
  }
  Notification.requestPermission().then((permission) => {
    $("#notifyBtn").textContent = permission === "granted" ? "提醒已开启" : "开启提醒";
    maybeNotify(true);
  });
}

function cleanOldNotificationKeys() {
  const cutoff = dateOffset(-7);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("lab-notify-")) {
      const dateStr = key.replace("lab-notify-", "");
      if (dateStr < cutoff) localStorage.removeItem(key);
    }
  }
}

function maybeNotify(force = false) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  const shouldCheck = force || (now.getDay() === Number(state.settings.weeklyReviewDay) && now.getHours() >= Number(state.settings.notifyHour));
  const todayKey = `lab-notify-${todayISO()}`;
  if (!shouldCheck || localStorage.getItem(todayKey)) return;
  const issues = getIssues();
  if (issues.length) {
    new Notification("课题组管理台：有进展需要查看", {
      body: `${issues.length} 个提醒。优先查看周进展、到期复盘和横向节点。`,
    });
    localStorage.setItem(todayKey, "1");
    cleanOldNotificationKeys();
  }
}

/* ── 开屏动画 ── */

function getIntroParam() {
  return new URLSearchParams(window.location.search).get("intro");
}

function isIntroPreview() {
  const path = window.location.pathname.replace(/\/$/, "");
  return getIntroParam() === "preview" || path.endsWith("/intro-preview");
}

function shouldShowIntro() {
  const introParam = getIntroParam();
  if (isIntroPreview()) return true;
  if (introParam === "1") return true;
  if (introParam === "0") return false;
  return sessionStorage.getItem(INTRO_SESSION_KEY) !== "1";
}

function initIntroSplash() {
  const splash = $("#introSplash");
  const skipButton = $("#introSkipBtn");
  if (!splash || !skipButton || !shouldShowIntro()) {
    splash?.classList.add("hidden");
    return;
  }

  splash.classList.remove("hidden");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const duration = reducedMotion ? INTRO_REDUCED_MOTION_MS : INTRO_DURATION_MS;
  let closed = false;
  let timer = window.setTimeout(enterAppFromIntro, duration);

  function enterAppFromIntro() {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    if (!isIntroPreview()) {
      sessionStorage.setItem(INTRO_SESSION_KEY, "1");
    }
    splash.classList.add("leaving");
    window.setTimeout(() => {
      splash.classList.add("hidden");
      splash.classList.remove("leaving");
    }, 430);
  }

  skipButton.addEventListener("click", enterAppFromIntro, { once: true });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") enterAppFromIntro();
  }, { once: true });
}

/* ── 语言切换 ──
   index.html 里的静态文案（侧边栏、开屏动画、空状态模板、顶部按钮）不经过
   render()，所以先把中文原文存下来，每次切换语言拿原文重新翻译一遍。 */

const STATIC_I18N_NODES = [".sidebar", ".intro-splash", "#emptyTemplate", ".top-actions"];
const staticOriginals = new Map();

function captureStaticOriginals() {
  STATIC_I18N_NODES.forEach((selector) => {
    const node = $(selector);
    if (node) staticOriginals.set(selector, node.innerHTML);
  });
}

function applyStaticTranslations() {
  staticOriginals.forEach((originalHTML, selector) => {
    const node = $(selector);
    if (node) node.innerHTML = tr(originalHTML);
  });
  document.title = t("课题组管理台");
  document.documentElement.lang = getLang() === "zh" ? "zh-CN" : "en";
  document.querySelectorAll(".lang-switch button").forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === getLang());
  });
  /* 这个函数会用捕获的原始 HTML 重写侧栏，把角色可见性加的 hidden 冲掉，
     所以每次都要重新收敛一次导航——否则学生切一次语言就看见全部菜单。 */
  applyRoleVisibility();
}

function switchLanguage(lang) {
  if (lang === getLang()) return;
  setLang(lang);
  applyStaticTranslations();
  render();
}

/* ── 登录与启动 ── */

function showAuthGate(mode = "login") {
  const gate = $("#authGate");
  if (!gate) return;
  gate.classList.remove("hidden");
  $("#loginForm").classList.toggle("hidden", mode !== "login");
  $("#passwordForm").classList.toggle("hidden", mode !== "password");
  const focus = mode === "login" ? $("#loginUser") : $("#pwOld");
  window.setTimeout(() => focus?.focus(), 30);
}

function hideAuthGate() {
  $("#authGate")?.classList.add("hidden");
}

function showAuthError(selector, message) {
  const node = $(selector);
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("hidden", !message);
}

function renderIdentity() {
  const box = $("#whoami");
  if (!box) return;
  if (!API.user) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  const role = API.isPI ? t("导师") : t("学生");
  $("#whoamiName").textContent = `${API.user.display_name || API.user.username}（${role}）`;
}

/* 学生看不到横向、经费、账号这些模块。这只是界面收敛，
   真正的门在服务端——前端把按钮改出来也拿不到数据。 */
const PI_ONLY_VIEWS = new Set([
  "industry", "leads", "funding", "archive", "crawler", "alumni", "settings",
  "contracts",
]);

function applyRoleVisibility() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    const view = button.dataset.view;
    const hidden = !API.isPI && PI_ONLY_VIEWS.has(view);
    button.classList.toggle("hidden", hidden);
  });
  if (!API.isPI && PI_ONLY_VIEWS.has(currentView)) currentView = "dashboard";
}

async function enterApp() {
  await loadStateFromServer();
  await loadTodos(true);
  if (API.isPI) loadContracts(true);
  loadGoalsData(true);
  renderIdentity();
  applyRoleVisibility();
  hideAuthGate();
  render();
  maybeNotify();
}

function attachAuthEvents() {
  $("#loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    showAuthError("#loginError", "");
    try {
      await API.login($("#loginUser").value.trim(), $("#loginPass").value);
      $("#loginPass").value = "";
      if (API.mustChangePassword) {
        showAuthGate("password");
        return;
      }
      await enterApp();
    } catch (error) {
      showAuthError("#loginError", error.message);
    } finally {
      button.disabled = false;
    }
  });

  $("#passwordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthError("#pwError", "");
    const next = $("#pwNew").value;
    if (next !== $("#pwNew2").value) {
      showAuthError("#pwError", t("两次输入的新口令不一致。"));
      return;
    }
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await API.changePassword($("#pwOld").value, next);
      /* 服务端改完口令会把所有会话踢掉，包括当前这个，所以要重新登录。 */
      $("#pwOld").value = $("#pwNew").value = $("#pwNew2").value = "";
      showAuthGate("login");
      showAuthError("#loginError", t("口令已更新，请用新口令登录。"));
    } catch (error) {
      showAuthError("#pwError", error.message);
    } finally {
      button.disabled = false;
    }
  });

  $("#logoutBtn")?.addEventListener("click", async () => {
    await API.logout();
    location.reload();
  });
}

API.onUnauthorized = () => {
  renderIdentity();
  showAuthGate("login");
  showAuthError("#loginError", t("登录已过期，请重新登录。"));
};

async function bootstrap() {
  captureStaticOriginals();
  applyStaticTranslations();
  attachEvents();
  attachAuthEvents();
  initIntroSplash();
  try {
    await API.me();
    if (API.mustChangePassword) {
      showAuthGate("password");
      return;
    }
    await enterApp();
  } catch (error) {
    if (error.status === 503) {
      showAuthGate("login");
      showAuthError("#loginError", error.message);
      return;
    }
    showAuthGate("login");
  }
}

bootstrap();
