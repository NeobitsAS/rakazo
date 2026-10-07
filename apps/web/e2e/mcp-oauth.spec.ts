import { expect, type Route, test } from "@playwright/test";
import type { McpServer } from "@rakazo/contracts";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("connects an MCP server through the OAuth popup callback", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mcp-oauth-${stamp}@rakazo.test`, "password12", "MCP OAuth");
  await completeOnboarding(page);

  let oauthStatus: McpServer["oauthStatus"] = "none";
  let hasSecret = false;
  const server: McpServer = {
    id: "mcp-oauth-server",
    spaceId: "mcp-oauth-workspace",
    slug: "linear",
    name: "Linear MCP",
    description: "",
    transport: "streamable_http",
    endpoint: "https://mcp.linear.test/mcp",
    command: null,
    args: [],
    envKeys: [],
    headerKeys: [],
    hasSecret,
    oauthStatus,
    enabled: true,
    revision: 1,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
  const browserOrigin = new URL(page.url()).origin;
  let releaseCompletion = () => {};
  let markCompletionStarted = () => {};
  const completionGate = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });
  const completionStarted = new Promise<void>((resolve) => {
    markCompletionStarted = resolve;
  });

  await page.context().route("**/rpc/mcp/servers/list", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: [{ ...server, hasSecret, oauthStatus }] }),
    });
  });
  await page.context().route("**/rpc/mcp/assignments/all", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ json: [] }) });
  });
  await page.context().route("**/rpc/mcp/oauth/begin", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      json: {
        serverId: server.id,
        redirectUri: `${browserOrigin}/mcp/oauth/callback`,
      },
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: {
          status: "authorization_required",
          sessionId: "mcp-oauth-session",
          authorizationUrl: `${browserOrigin}/mcp/oauth/callback?code=fake-code&state=mcp-oauth-session`,
        },
      }),
    });
  });
  await page.context().route("**/rpc/mcp/oauth/complete", async (route: Route) => {
    expect(route.request().postDataJSON()).toEqual({
      json: {
        sessionId: "mcp-oauth-session",
        code: "fake-code",
        state: "mcp-oauth-session",
      },
    });
    markCompletionStarted();
    await completionGate;
    oauthStatus = "connected";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: { ok: true } }),
    });
  });

  await page.getByRole("button", { name: "Apps", exact: true }).click();
  const apps = page.getByRole("dialog");
  await expect(apps.getByText("Linear MCP", { exact: true })).toBeVisible();
  await apps.getByRole("button", { name: "Edit Linear MCP", exact: true }).click();
  await expect(apps.getByRole("heading", { name: "Linear MCP", exact: true })).toBeVisible();
  await expect(apps.getByText("Not signed in.", { exact: true })).toBeVisible();
  // Until it signs in, the server also takes an access token.
  await expect(apps.getByLabel("Access token")).toBeVisible();
  await captureScreenshot(page, testInfo, "mcp-oauth-ready");

  const popupPromise = page.waitForEvent("popup");
  await apps.getByRole("button", { name: "Connect", exact: true }).click();
  const popup = await popupPromise;
  await completionStarted;
  await expect(popup.getByText("Finishing MCP connection…", { exact: true })).toBeVisible();
  await captureScreenshot(popup, testInfo, "mcp-oauth-callback");

  releaseCompletion();
  await expect(apps.getByText("Signed in with the service.", { exact: true })).toBeVisible();
  await expect(apps.getByRole("button", { name: "Signed in", exact: true })).toBeVisible();
  await expect(apps.getByLabel("Access token")).toBeHidden();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await captureScreenshot(page, testInfo, "mcp-oauth-connected");

  // Apps reads the server again when it opens, and offers to sign in again once it expired.
  oauthStatus = "reconnect";
  hasSecret = true;
  await page.getByRole("button", { name: "Close apps" }).click();
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await apps.getByRole("button", { name: "Edit Linear MCP", exact: true }).click();
  await expect(apps.getByText("The sign-in has expired.", { exact: true })).toBeVisible();
  await expect(apps.getByRole("button", { name: "Sign in again", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "mcp-oauth-expired");
});
