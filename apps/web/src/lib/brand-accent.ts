import { botColors } from "@rakazo/ui-tokens";
import { useEffect } from "react";

const BLUE = "#3B82F6";
/** The accent palette starting at blue, back to blue so the loop has no seam. */
const CYCLE = [
  ...botColors.slice(botColors.indexOf(BLUE)),
  ...botColors.slice(0, botColors.indexOf(BLUE) + 1),
];
const SECONDS_PER_COLOR = 15;
/** Each colour holds for most of its turn; blending two accents for long looks muddy. */
const HOLD = 0.75;
const KEYFRAMES = [
  ...CYCLE.slice(0, -1).flatMap((color, index) => [
    { "--brand-accent": color, offset: index / (CYCLE.length - 1) },
    { "--brand-accent": color, offset: (index + HOLD) / (CYCLE.length - 1) },
  ]),
  { "--brand-accent": BLUE, offset: 1 },
];

/**
 * Cycles `--brand-accent` (registered in styles.css) through the accent palette on an element,
 * so everything inside that reads it changes colour together. It stays blue for people who ask
 * for less motion.
 */
export function useBrandAccentCycle(element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate(KEYFRAMES, {
      duration: (CYCLE.length - 1) * SECONDS_PER_COLOR * 1000,
      iterations: Infinity,
    });
    return () => animation.cancel();
  }, [element]);
}
