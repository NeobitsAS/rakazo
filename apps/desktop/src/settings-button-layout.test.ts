import { describe, expect, it } from "vitest";
import { settingsButtonBounds, showsSettingsButton } from "./settings-button-layout.js";

const SERVER = "http://127.0.0.1:18080";

describe("settings button", () => {
  it("shows on the server's signed-out pages", () => {
    for (const page of [
      "/",
      "/sign-in",
      "/sign-up?invite=1",
      "/forgot-password",
      "/reset-password",
    ]) {
      expect(showsSettingsButton(`${SERVER}${page}`, SERVER)).toBe(true);
    }
  });

  it("stays away from signed-in pages and other origins", () => {
    expect(showsSettingsButton(`${SERVER}/app`, SERVER)).toBe(false);
    expect(showsSettingsButton(`${SERVER}/onboarding`, SERVER)).toBe(false);
    expect(showsSettingsButton("https://accounts.example.com/sign-in", SERVER)).toBe(false);
    expect(showsSettingsButton("not a url", SERVER)).toBe(false);
  });

  it("sits in the top-right corner", () => {
    expect(settingsButtonBounds(1440)).toEqual({ x: 1394, y: 10, width: 36, height: 36 });
  });
});
