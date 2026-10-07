import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("adds a GraphQL endpoint from Apps for all bots", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `graphql-source-${stamp}@rakazo.test`, "password12", `GraphQL ${stamp}`);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Apps", exact: true }).click();
  const apps = page.getByRole("dialog");
  // The header's Add comes first; the catalog tiles' Add buttons follow it.
  await apps.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(apps.getByRole("heading", { name: "Add a server", exact: true })).toBeVisible();

  await apps.getByRole("button", { name: "GraphQL", exact: true }).click();
  await expect(apps.getByText("All your bots in this space can use it.")).toBeVisible();
  await apps.getByLabel("Name", { exact: true }).fill("Browser GraphQL");
  await apps.getByLabel("Address", { exact: true }).fill("https://graphql.example.test/graphql");
  await apps.getByRole("combobox", { name: "How to connect" }).click();
  await page.getByRole("option", { name: "No authentication", exact: true }).click();
  await captureScreenshot(page, testInfo, "01-graphql-add");

  // The form's own Add sits last.
  await apps.getByRole("button", { name: "Add", exact: true }).last().click();
  await expect(apps.getByRole("heading", { name: "Apps", exact: true })).toBeVisible();
  await expect(apps.getByText("Browser GraphQL", { exact: true })).toBeVisible();
  await expect(apps.getByText("GraphQL · No authentication · All your bots")).toBeVisible();
  await captureScreenshot(page, testInfo, "02-graphql-installed");
});
