const LABELS = {
  reconnecting: "Reconnecting…",
  connected: "Connected",
  lost: "Connection lost",
};

const bridge = window.rakazoPill;
const pill = document.getElementById("pill");
const label = document.getElementById("pill-label");
const settings = document.getElementById("pill-settings");
const theme = window.matchMedia("(prefers-color-scheme: light)");

function applyTheme() {
  document.documentElement.dataset.theme = theme.matches ? "light" : "dark";
}

function render(status) {
  // Keep the last label while fading out, so the pill does not change size as it goes.
  if (status in LABELS) label.textContent = LABELS[status];
  pill.dataset.status = status;
  const { width, height } = document.body.getBoundingClientRect();
  bridge.resize(width, height);
}

applyTheme();
theme.addEventListener("change", applyTheme);
settings.addEventListener("click", () => bridge.activate());
bridge.onStatus(render);
