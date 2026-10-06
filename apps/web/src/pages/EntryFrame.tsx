import type { ReactNode } from "react";
import { BrandMark } from "../components/BrandMark";
import { WindowStrip } from "./WindowChrome";

/**
 * The frame of the sign-in and setup pages: the brand mark and title centred on the page, under
 * a strip that carries the desktop window controls and lets the window be dragged.
 */
export function EntryFrame({
  title,
  wide = false,
  align = "center",
  children,
}: {
  title: ReactNode;
  /** Room for content wider than a form, such as the integration cards. */
  wide?: boolean;
  /**
   * "top" keeps the title in place on pages whose content changes height (choices that open
   * different fields); centring would move everything each time.
   */
  align?: "center" | "top";
  children: ReactNode;
}) {
  return (
    // The desktop app waits for a marked surface before it shows the page.
    <div
      data-rakazo-surface="entry"
      className="flex min-h-full flex-col bg-background text-foreground"
    >
      <WindowStrip />
      <div
        className={`flex flex-1 justify-center px-6 pb-16 ${align === "top" ? "pt-[10vh]" : "items-center"}`}
      >
        <div
          className={`flex max-w-full flex-col items-center ${wide ? "w-[592px]" : "w-[460px]"}`}
        >
          <BrandMark />
          <h1
            aria-live="polite"
            className="mb-9 mt-7 text-center text-4xl font-medium tracking-tight"
          >
            {title}
          </h1>
          {children}
        </div>
      </div>
    </div>
  );
}
