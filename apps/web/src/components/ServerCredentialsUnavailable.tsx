import { Trans } from "@lingui/react/macro";
import type { ServerCredentialState } from "@rakazo/contracts";
import { Button, Label, Switch } from "@rakazo/ui-web";
import { useId, useState } from "react";

/**
 * Why a provider that can run on the server's own credentials can't here: `not-set-up` when the
 * operator hasn't opted in for it, otherwise what the last check showed. Null when it can.
 */
export type ServerCredentialsBlocker = "not-set-up" | "missing" | "denied" | "unavailable";

export function serverCredentialsBlocker(
  state: ServerCredentialState | null | undefined,
  provider: string,
): ServerCredentialsBlocker | null {
  if (!state || state.provider !== provider) return "not-set-up";
  if (state.status === "missing" || state.status === "denied" || state.status === "unavailable") {
    return state.status;
  }
  return null;
}

/**
 * The "Use server credentials" switch, turned off and disabled, with the reason it can't be used
 * and, when the server could fix it on its own (credentials or permissions changed), a way to
 * check again.
 */
export function ServerCredentialsUnavailable({
  blocker,
  source,
  modelLabel,
  onCheck,
}: {
  blocker: ServerCredentialsBlocker;
  /** The kind of credentials, e.g. "AWS IAM". */
  source: string;
  /** The model the server is set up to run. */
  modelLabel: string;
  onCheck: () => Promise<void>;
}) {
  const switchId = useId();
  const [checking, setChecking] = useState(false);

  async function checkAgain() {
    setChecking(true);
    try {
      await onCheck();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div data-testid="server-credentials-unavailable">
      <div className="flex items-start gap-3">
        {/* The light theme's off track barely shows against the page, and a disabled switch would
            fade it further; this one is meant to be seen, with the reason below. */}
        <Switch
          id={switchId}
          className="mt-0.5 data-disabled:opacity-100 data-unchecked:bg-muted-foreground/60"
          checked={false}
          disabled
        />
        <Label htmlFor={switchId} className="text-[14px] font-normal text-muted-foreground">
          <Trans>Use server credentials</Trans>
        </Label>
      </div>
      <p className="mt-3 text-sm leading-[1.5] text-muted-foreground">
        {blocker === "not-set-up" ? (
          <Trans>
            This server isn't set up to use its own {source} credentials. To enable it, set
            PI_DEFAULT_CREDENTIALS=host with PI_DEFAULT_PROVIDER and PI_DEFAULT_MODEL on the server.
          </Trans>
        ) : blocker === "missing" ? (
          <Trans>This server has no usable {source} credentials.</Trans>
        ) : blocker === "denied" ? (
          <Trans>
            This server's {source} credentials aren't allowed to use {modelLabel}.
          </Trans>
        ) : (
          <Trans>
            {modelLabel} isn't available to this server's {source} credentials.
          </Trans>
        )}
      </p>
      {blocker === "not-set-up" ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={checking}
          onClick={() => void checkAgain()}
        >
          {checking ? <Trans>Checking…</Trans> : <Trans>Check again</Trans>}
        </Button>
      )}
    </div>
  );
}
