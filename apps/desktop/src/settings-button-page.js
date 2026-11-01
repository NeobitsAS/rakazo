const theme = window.matchMedia("(prefers-color-scheme: light)");

function applyTheme() {
  document.documentElement.dataset.theme = theme.matches ? "light" : "dark";
}

applyTheme();
theme.addEventListener("change", applyTheme);
const button = document.getElementById("settings");
button.addEventListener("click", () => window.rakazoSettingsButton.open());
// The shell sends the label in the app's language once the page has loaded.
window.rakazoSettingsButton.onLabel((label) => {
  button.title = label;
  button.setAttribute("aria-label", label);
});
