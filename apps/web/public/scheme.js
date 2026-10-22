// 页面脚本加载前按外观设置定好深浅（ThemeProvider 存在 bt.scheme 里），深色下打开不闪白。
// 在 index.html 的 <head> 里同步加载；单独放一个文件而不是内联，CSP 才能只允许本站的脚本。
(function () {
  var scheme = "system";
  try {
    scheme = JSON.parse(localStorage.getItem("bt.scheme")) || "system";
  } catch (e) {}
  if (scheme === "system") {
    scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.scheme = scheme === "dark" ? "dark" : "light";
})();
