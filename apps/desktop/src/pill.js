const bridge = window.rakazoPill;
const pill = document.getElementById("pill");
const label = document.getElementById("pill-label");
const reconnect = document.getElementById("pill-reconnect");
const theme = window.matchMedia("(prefers-color-scheme: light)");

function applyTheme() {
  document.documentElement.dataset.theme = theme.matches ? "light" : "dark";
}

/** The shell sends each status with its labels, in the app's language. */
function render(status, labels) {
  // Keep the last label while fading out, so the pill does not change size as it goes.
  if (status !== "hidden" && labels[status]) label.textContent = labels[status];
  reconnect.title = labels.reconnect;
  reconnect.setAttribute("aria-label", labels.reconnect);
  pill.dataset.status = status;
  const { width, height } = document.body.getBoundingClientRect();
  bridge.resize(width, height);
}

applyTheme();
theme.addEventListener("change", applyTheme);
reconnect.addEventListener("click", () => bridge.reconnect());
bridge.onStatus(render);
