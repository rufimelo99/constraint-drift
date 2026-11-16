const root = document.documentElement, key = "theme";
try { const s = localStorage.getItem(key); if (s) root.dataset.theme = s; } catch (_) {}
document.getElementById("theme").onclick = () => {
  const next = (root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem(key, next); } catch (_) {}
};
