import { useLingui } from "@lingui/react/macro";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A row of cards to pick one option from: an icon with its label below it, a radio in the
 * bottom right, and the accent fill when selected. Two across when space is narrow. An option
 * that is already set up gets a check in the top right, whether or not it is selected.
 */
export function ChoiceCards({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset aria-label={label} className="grid max-w-[592px] grid-cols-2 gap-3 @lg:grid-cols-4">
      {children}
    </fieldset>
  );
}

export function ChoiceCard({
  icon,
  label,
  selected,
  connected = false,
  disabled = false,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  /** The option is already set up. */
  connected?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const { t } = useLingui();
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`relative flex aspect-[4/3] flex-col justify-between rounded-xl border p-3 text-left text-sm font-medium shadow-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-link/50 disabled:opacity-50 ${selected ? "border-transparent bg-link text-white" : "border-border bg-card hover:bg-accent"}`}
    >
      <span className="flex min-w-0 flex-col items-start gap-2">
        {icon}
        <span className="max-w-full truncate">{label}</span>
      </span>
      <span
        aria-hidden="true"
        className={`grid size-4 shrink-0 place-items-center self-end rounded-full border-2 ${selected ? "border-white" : "border-muted-foreground/60"}`}
      >
        {selected ? <span className="size-1.5 rounded-full bg-white" /> : null}
      </span>
      {/* After the label, so the card reads "Composio, Connected". */}
      {connected ? (
        <span
          role="img"
          aria-label={t`Connected`}
          title={t`Connected`}
          className="absolute top-3 right-3"
        >
          <Check className="size-4" aria-hidden />
        </span>
      ) : null}
    </button>
  );
}
