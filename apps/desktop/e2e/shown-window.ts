import type { ElectronApplication, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { appWindows } from "./windows.js";

/**
 * The window the app shows. Before opening a saved server the app loads it in a hidden window
 * to look for older default-session storage and then destroys it, so `firstWindow()` can
 * return a page that closes under the test.
 */
export async function shownWindow(app: ElectronApplication): Promise<Page> {
  let shown: Page | undefined;
  await expect
    .poll(
      async () => {
        // The shell's overlays are views over a shown window, not windows of their own.
        for (const page of await appWindows(app)) {
          const visible = await app
            .browserWindow(page)
            .then((window) => window.evaluate((win) => win.isVisible()))
            .catch(() => false);
          if (visible) {
            shown = page;
            return true;
          }
        }
        return false;
      },
      // Like firstWindow(), wait as long as the test may run.
      { timeout: 0 },
    )
    .toBe(true);
  return shown!;
}
