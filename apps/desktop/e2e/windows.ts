import type { ElectronApplication, Page } from "@playwright/test";

/** The pages of the views the shell draws its own controls in, over an app window. */
const OVERLAY_PAGES = /\/(pill|settings-button)\.html$/;

/**
 * Whether a page is one of the shell's overlays (the connection pill, the settings button).
 * They are views of their own, which Playwright reports as windows too.
 */
async function isOverlay(page: Page): Promise<boolean> {
  // The shell loads an overlay's page as soon as it creates the view.
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  return OVERLAY_PAGES.test(page.url());
}

/**
 * The next window the app opens, skipping the shell's overlays. Like
 * `app.waitForEvent("window")`, it listens from the moment it is called.
 */
export function nextWindow(app: ElectronApplication): Promise<Page> {
  return new Promise((resolve) => {
    const onWindow = (page: Page) => {
      void isOverlay(page).then((overlay) => {
        if (overlay) return;
        app.off("window", onWindow);
        resolve(page);
      });
    };
    app.on("window", onWindow);
  });
}

/** The app's first window, skipping the shell's overlays, like `app.firstWindow()`. */
export async function firstWindow(app: ElectronApplication): Promise<Page> {
  const next = nextWindow(app);
  for (const page of app.windows()) {
    if (!(await isOverlay(page))) return page;
  }
  return next;
}

/** The app's open windows, without the shell's overlays. */
export async function appWindows(app: ElectronApplication): Promise<Page[]> {
  const pages: Page[] = [];
  for (const page of app.windows()) {
    if (!(await isOverlay(page))) pages.push(page);
  }
  return pages;
}
