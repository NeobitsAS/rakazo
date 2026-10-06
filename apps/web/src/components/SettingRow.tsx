import type { ReactNode } from "react";

/**
 * One setting in a list: what it is and its state on the left, the control on the right. With
 * `revealControl`, the control shows on hover or keyboard focus, and always on touch screens.
 */
export function SettingRow({
  title,
  description,
  control,
  revealControl = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  revealControl?: boolean;
}) {
  return (
    <li className="group flex min-h-14 items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        {description ? (
          <div className="truncate text-xs text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {control ? (
        <div
          className={`flex shrink-0 items-center gap-1 ${revealControl ? "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100" : ""}`}
        >
          {control}
        </div>
      ) : null}
    </li>
  );
}
