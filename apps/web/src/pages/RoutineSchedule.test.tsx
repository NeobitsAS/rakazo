// @vitest-environment jsdom
import type { CronPreset } from "@rakazo/core";
import type { ReactNode } from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// The macro compiles away in the app build; tests run the source.
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    i18n: { locale: "en" },
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

import { RoutineSchedule } from "./RoutineSchedule";

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  vi.unstubAllGlobals();
});

function render(node: ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
}

function IntervalSchedule() {
  const [value, setValue] = useState<CronPreset>({
    freq: "Interval",
    n: 3,
    unit: "minutes",
    time: "9:00 AM",
    cron: "",
  });
  return <RoutineSchedule value={value} onChange={setValue} />;
}

function press(target: Element) {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    const init = { bubbles: true, cancelable: true, button: 0, detail: 1 };
    target.dispatchEvent(
      type.startsWith("pointer")
        ? new PointerEvent(type, { ...init, pointerType: "mouse" })
        : new MouseEvent(type, init),
    );
  }
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

async function choose(label: string, option: string) {
  const trigger = document.querySelector(`[aria-label="${label}"]`);
  if (!trigger) throw new Error(`Missing ${label}`);
  await act(async () => press(trigger));
  await settle();
  const item = [...document.querySelectorAll('[role="option"]')].find(
    (node) => node.textContent === option,
  );
  if (!item) throw new Error(`Missing option ${option}`);
  await act(async () => press(item));
  await settle();
}

describe("RoutineSchedule", () => {
  it("clamps an interval amount the new unit can't run instead of resetting it", async () => {
    render(<IntervalSchedule />);
    await choose("Interval amount", "45");
    await choose("Interval unit", "hours");
    expect(document.querySelector('[aria-label="Interval amount"]')?.textContent).toBe("15");
  });
});
