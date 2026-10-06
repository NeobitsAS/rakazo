import { useEffect, useRef } from "react";

/** The eye colour of the app icon (public/favicon.svg). */
const EYE = "#F2F2F0";

/** Where the eyes look, in icon units, and how long they rest there in milliseconds. */
const GLANCES = [
  { x: 0, y: 0, rest: 900 },
  { x: -44, y: 0, rest: 500 },
  { x: -40, y: -28, rest: 300 },
  { x: 44, y: -12, rest: 700 },
  { x: 40, y: 14, rest: 400 },
  { x: 0, y: 0, rest: 800 },
  { x: 32, y: -32, rest: 350 },
  { x: -36, y: 18, rest: 600 },
] as const;
/** A glance is a quick jump, like an eye moving. */
const GLANCE_MS = 70;
const GLANCE_LOOP_MS = GLANCES.reduce((total, glance) => total + glance.rest + GLANCE_MS, 0);
const GLANCE_KEYFRAMES = [
  ...GLANCES.flatMap((glance, index) => {
    const start = GLANCES.slice(0, index).reduce((total, g) => total + g.rest + GLANCE_MS, 0);
    const transform = `translate(${glance.x}px, ${glance.y}px)`;
    return [
      { transform, offset: (start + GLANCE_MS) / GLANCE_LOOP_MS },
      { transform, offset: (start + GLANCE_MS + glance.rest) / GLANCE_LOOP_MS },
    ];
  }),
  { transform: "translate(0px, 0px)", offset: 1 },
];

/**
 * The app icon, alive: its eyes look around, and it takes the brand accent (lib/brand-accent.ts)
 * of the page it sits on. Its eyes hold still for people who ask for less motion.
 */
export function LivelyLogo({ className }: { className?: string }) {
  const eyesRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const eyes = eyesRef.current;
    if (!eyes) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = eyes.animate(GLANCE_KEYFRAMES, {
      duration: GLANCE_LOOP_MS,
      iterations: Infinity,
    });
    return () => animation.cancel();
  }, []);

  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <rect width="512" height="512" rx="148" className="fill-(--brand-accent)" />
      <g ref={eyesRef}>
        <rect x="157" y="196" width="62" height="120" rx="31" fill={EYE} />
        <rect x="293" y="196" width="62" height="120" rx="31" fill={EYE} />
      </g>
    </svg>
  );
}
