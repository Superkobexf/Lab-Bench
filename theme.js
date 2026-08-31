/* 主题标记。必须在样式表之前执行，否则深色模式的用户会先看到一帧白屏。

   为什么单独一个文件而不是内联：CSP 是 script-src 'self'，内联脚本会被
   自己的安全策略拦掉。为了省一个请求去放宽 CSP 不划算——这个文件只有
   几百字节，而且会被缓存。

   三态：
     null   跟随系统（不打标记，由 prefers-color-scheme 决定）
     light  显式浅色（即使系统是深色）
     dark   显式深色
*/

(function () {
  var KEY = "lab-bench-theme";

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "dark" || v === "light" ? v : null;
    } catch (e) {
      /* 隐私模式下 localStorage 会抛异常。忽略，跟随系统即可。 */
      return null;
    }
  }

  var saved = stored();
  if (saved) document.documentElement.setAttribute("data-theme", saved);

  /* 供 app.js 使用，避免两处重复实现读写逻辑 */
  window.LabBenchTheme = {
    KEY: KEY,
    get: stored,

    /* 返回当前实际生效的主题，用于按钮上显示"现在是什么" */
    effective: function () {
      var s = stored();
      if (s) return s;
      return window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    },

    set: function (mode) {
      if (mode === "system") {
        document.documentElement.removeAttribute("data-theme");
        try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
      } else {
        document.documentElement.setAttribute("data-theme", mode);
        try { localStorage.setItem(KEY, mode); } catch (e) { /* 忽略 */ }
      }
    },
  };
})();
