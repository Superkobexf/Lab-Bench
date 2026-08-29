/* 后端接口客户端。

   数据不再存在浏览器里，改由服务器保管。这个文件是前端和服务端之间
   唯一的通道：所有写请求都自动带上 CSRF 头，会话过期统一跳回登录页。

   注意 window.API 上的 role / studentId 只用来决定界面显示什么，
   真正的权限判定在服务端。前端把它改了也没用。 */

const API = {
  csrf: "",
  user: null,
  role: "",
  studentId: "",
  mustChangePassword: false,
  onUnauthorized: null,

  get isPI() {
    return this.role === "pi";
  },

  async request(method, path, body, options = {}) {
    const init = {
      method,
      credentials: "same-origin",
      headers: {},
    };
    if (method !== "GET" && method !== "HEAD") {
      init.headers["X-CSRF-Token"] = this.csrf;
    }
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(path, init);
    } catch {
      throw new APIError(t("连不上服务器，请检查网络或稍后重试。"), 0);
    }

    if (response.status === 401 && !options.allowAnonymous) {
      this.csrf = "";
      this.user = null;
      this.role = "";
      if (typeof this.onUnauthorized === "function") this.onUnauthorized();
      throw new APIError(t("登录已过期，请重新登录。"), 401);
    }

    let payload = null;
    const type = response.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      throw new APIError(
        apiErrorMessage(payload) || `${t("请求失败")}（${response.status}）`,
        response.status,
      );
    }
    return payload;
  },

  get(path, options) {
    return this.request("GET", path, undefined, options);
  },
  post(path, body, options) {
    return this.request("POST", path, body, options);
  },
  put(path, body) {
    return this.request("PUT", path, body);
  },
  patch(path, body) {
    return this.request("PATCH", path, body);
  },
  del(path) {
    return this.request("DELETE", path);
  },

  /* ── 登录 ── */

  async me() {
    const data = await this.get("/api/auth/me", { allowAnonymous: true });
    this.applyIdentity(data);
    return data;
  },

  async login(username, password) {
    const data = await this.post(
      "/api/auth/login",
      { username, password },
      { allowAnonymous: true },
    );
    this.applyIdentity(data);
    return data;
  },

  async logout() {
    try {
      await this.post("/api/auth/logout");
    } finally {
      this.csrf = "";
      this.user = null;
      this.role = "";
      this.studentId = "";
    }
  },

  applyIdentity(data) {
    this.csrf = data.csrf_token || "";
    this.user = data.user || null;
    this.role = data.user?.role || "";
    this.studentId = data.user?.student_id || "";
    this.mustChangePassword = Boolean(data.must_change_password);
  },

  changePassword(oldPassword, newPassword) {
    return this.post("/api/auth/password", {
      old_password: oldPassword,
      new_password: newPassword,
    });
  },

  /* ── 既有业务数据 ── */

  fetchState() {
    return this.get("/api/state");
  },
  putRecord(collection, id, payload) {
    return this.put(
      `/api/records/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
      { payload },
    );
  },
  deleteRecord(collection, id) {
    return this.del(
      `/api/records/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    );
  },
  putSettings(values) {
    return this.put("/api/settings", values);
  },
  importBackup(text) {
    return this.post("/api/import", text);
  },

  /* ── 账号 ── */

  listUsers() {
    return this.get("/api/users");
  },
  createUser(body) {
    return this.post("/api/users", body);
  },
  updateUser(id, body) {
    return this.patch(`/api/users/${id}`, body);
  },

  /* ── 目标 / 计划 / 批注 ── */

  listGoals(studentId = "") {
    return this.get(`/api/goals${studentId ? `?student_id=${encodeURIComponent(studentId)}` : ""}`);
  },
  createGoal(body) {
    return this.post("/api/goals", body);
  },
  updateGoal(id, body) {
    return this.patch(`/api/goals/${encodeURIComponent(id)}`, body);
  },
  deleteGoal(id) {
    return this.del(`/api/goals/${encodeURIComponent(id)}`);
  },

  listPlans(studentId = "") {
    return this.get(`/api/plans${studentId ? `?student_id=${encodeURIComponent(studentId)}` : ""}`);
  },
  savePlan(body) {
    return this.put("/api/plans", body);
  },
  deletePlan(id) {
    return this.del(`/api/plans/${encodeURIComponent(id)}`);
  },

  listAnnotations(params = {}) {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== "" && value != null),
    ).toString();
    return this.get(`/api/annotations${query ? `?${query}` : ""}`);
  },
  createAnnotation(body) {
    return this.post("/api/annotations", body);
  },
  updateAnnotation(id, body) {
    return this.patch(`/api/annotations/${encodeURIComponent(id)}`, body);
  },
  deleteAnnotation(id) {
    return this.del(`/api/annotations/${encodeURIComponent(id)}`);
  },

  /* ── 合同 ── */

  listContracts() {
    return this.get("/api/contracts");
  },
  createContract(body) {
    return this.post("/api/contracts", body);
  },
  deleteContract(id) {
    return this.del(`/api/contracts/${encodeURIComponent(id)}`);
  },
  uploadContractVersion(contractId, file, note = "") {
    const form = new FormData();
    form.append("file", file);
    form.append("version_note", note);
    return this.post(
      `/api/contracts/${encodeURIComponent(contractId)}/versions`,
      form,
    );
  },
  reparseVersion(versionId) {
    return this.post(
      `/api/contracts/versions/${encodeURIComponent(versionId)}/reparse`,
    );
  },
  listContractItems(versionId) {
    return this.get(
      `/api/contracts/versions/${encodeURIComponent(versionId)}/items`,
    );
  },
  contractText(versionId) {
    return this.get(
      `/api/contracts/versions/${encodeURIComponent(versionId)}/text`,
    );
  },
  patchContractItem(itemId, body) {
    return this.patch(`/api/contracts/items/${encodeURIComponent(itemId)}`, body);
  },

  /* ── 待办与倒数日 ── */

  listTodos(includeDone = false) {
    return this.get(`/api/todos${includeDone ? "?include_done=true" : ""}`);
  },
  createTodo(body) {
    return this.post("/api/todos", body);
  },
  updateTodo(id, body) {
    return this.patch(`/api/todos/${encodeURIComponent(id)}`, body);
  },
  deleteTodo(id) {
    return this.del(`/api/todos/${encodeURIComponent(id)}`);
  },
};

class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

/* 服务端错误信息是给人看的中文，直接用；
   Pydantic 的 422 是结构化的，挑第一条转成人话。 */
function apiErrorMessage(payload) {
  if (!payload) return "";
  if (typeof payload.error === "string") return payload.error;
  if (Array.isArray(payload.detail) && payload.detail.length) {
    const first = payload.detail[0];
    const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : "";
    return `${field ? `${field}：` : ""}${first.msg || t("提交的内容不合法。")}`;
  }
  if (typeof payload.detail === "string") return payload.detail;
  return "";
}

window.API = API;
window.APIError = APIError;
