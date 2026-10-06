const theme = window.matchMedia("(prefers-color-scheme: light)");

function applyTheme() {
  document.documentElement.dataset.theme = theme.matches ? "light" : "dark";
}

applyTheme();
theme.addEventListener("change", applyTheme);
document
  .getElementById("settings")
  .addEventListener("click", () => window.rakazoSettingsButton.open());
