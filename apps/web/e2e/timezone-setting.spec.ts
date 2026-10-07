import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  chooseOption,
  completeOnboarding,
  openUserSettings,
  signup,
} from "./helpers";

test.use({ timezoneId: "Pacific/Auckland" });

test("timezone setting adopts the browser zone, saves a choice, and offers this device's zone back", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `timezone-${stamp}@rakazo.test`, "password12", "Timezone QA");
  await completeOnboarding(page);

  const settings = await openUserSettings(page);
  await expect(settings.getByRole("heading", { name: "Timezone", exact: true })).toBeVisible();
  const select = settings.getByRole("combobox", { name: "Timezone" });
  // First sign-in saves the browser's zone without asking.
  await expect(select).toHaveText("Pacific/Auckland");
  await expect(settings.getByTestId("timezone-use-device")).toHaveCount(0);

  await chooseOption(select, "Europe/London");
  const useDevice = settings.getByRole("button", { name: "Use Pacific/Auckland" });
  await expect(useDevice).toBeVisible();
  await useDevice.scrollIntoViewIfNeeded();
  await captureScreenshot(page, testInfo, "account-timezone-setting");

  // A saved choice survives a reload; the browser zone does not overwrite it.
  await page.reload();
  const reopened = await openUserSettings(page);
  await expect(reopened.getByRole("combobox", { name: "Timezone" })).toHaveText("Europe/London");

  await reopened.getByRole("button", { name: "Use Pacific/Auckland" }).click();
  await expect(reopened.getByRole("combobox", { name: "Timezone" })).toHaveText("Pacific/Auckland");
  await expect(reopened.getByTestId("timezone-use-device")).toHaveCount(0);
});
