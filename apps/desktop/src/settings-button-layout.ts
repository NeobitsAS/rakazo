/** The web app's pages for signed-out visitors, where nothing else leads back to setup. */
const SIGNED_OUT_PATHS = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
]);

/** Room the view takes, including the button's focus ring. */
export const SETTINGS_BUTTON_SIZE = 36;
const EDGE_OFFSET_PX = 10;

/** Whether the app window shows a signed-out page of the server it was opened on. */
export function showsSettingsButton(pageUrl: string, serverOrigin: string): boolean {
  try {
    const url = new URL(pageUrl);
    return url.origin === serverOrigin && SIGNED_OUT_PATHS.has(url.pathname);
  } catch {
    return false;
  }
}

/** Places the button in the top-right corner of a window's content area. */
export function settingsButtonBounds(contentWidth: number): Electron.Rectangle {
  return {
    x: Math.max(0, contentWidth - SETTINGS_BUTTON_SIZE - EDGE_OFFSET_PX),
    y: EDGE_OFFSET_PX,
    width: SETTINGS_BUTTON_SIZE,
    height: SETTINGS_BUTTON_SIZE,
  };
}
