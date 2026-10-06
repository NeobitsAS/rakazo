import { Trans } from "@lingui/react/macro";
import { Check, X } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * "Connected", in green. When the connection can be undone it turns into "Disconnect" on hover or
 * keyboard focus; a touch shows "Disconnect" first and a second touch disconnects. The labels can
 * say what kind of connection it is, such as "Signed in" and "Sign out".
 */
export function ConnectedStatus({
  onDisconnect,
  pending,
  label,
  disconnectLabel,
  pendingLabel,
}: {
  onDisconnect: (() => void) | null;
  /** Disconnecting is under way. */
  pending: boolean;
  label?: ReactNode;
  disconnectLabel?: ReactNode;
  pendingLabel?: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const connected = (
    <>
      <Check />
      {label ?? <Trans>Connected</Trans>}
    </>
  );
  if (!onDisconnect) {
    return (
      <span className="flex h-9 items-center gap-1.5 text-sm font-medium text-success [&_svg]:size-4">
        {connected}
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      data-armed={armed || pending || undefined}
      onClick={(event) => {
        const touch =
          event.nativeEvent instanceof PointerEvent && event.nativeEvent.pointerType === "touch";
        if (touch && !armed) {
          setArmed(true);
          return;
        }
        onDisconnect();
      }}
      onBlur={() => setArmed(false)}
      className="group/connected flex h-9 items-center gap-1.5 rounded-md text-sm font-medium text-success outline-none hover:text-destructive focus-visible:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 data-armed:text-destructive [&_svg]:size-4"
    >
      <span className="flex items-center gap-1.5 group-hover/connected:hidden group-focus-visible/connected:hidden group-data-armed/connected:hidden">
        {connected}
      </span>
      <span className="hidden items-center gap-1.5 group-hover/connected:flex group-focus-visible/connected:flex group-data-armed/connected:flex">
        <X />
        {pending
          ? (pendingLabel ?? <Trans>Disconnecting…</Trans>)
          : (disconnectLabel ?? <Trans>Disconnect</Trans>)}
      </span>
    </button>
  );
}
