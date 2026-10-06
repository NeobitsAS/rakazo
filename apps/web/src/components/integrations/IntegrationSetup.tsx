import { Trans, useLingui } from "@lingui/react/macro";
import type { IntegrationCatalogResult, IntegrationSetupState } from "@rakazo/contracts";
import { Button, ButtonGroup, Input, Label, Switch } from "@rakazo/ui-web";
import { ArrowLeft, Check, Plug, Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { newClientId } from "../../lib/client-id";
import { connectMcpOauth } from "../../lib/mcp-connect";
import { rpc } from "../../lib/rpc";
import { IntegrationLogo } from "./IntegrationLogo";

type Choice = "direct" | "composio" | "pipedream" | "executor";

export function IntegrationSetup({
  onDone,
  serverSetup = false,
  managedOnly = false,
  initialState,
  botId,
  onServerConnected,
  onServerDisconnected,
  onSaved,
  onBack,
  finishingLabel = null,
  finishError = null,
  layout = "panel",
}: {
  onDone?: () => void;
  serverSetup?: boolean;
  /** Local host settings can configure providers, but cannot access account MCP servers. */
  managedOnly?: boolean;
  initialState?: IntegrationSetupState | null;
  botId?: string;
  onServerConnected?: (id: string) => void;
  onServerDisconnected?: (id: string) => void;
  /** A provider's credentials were saved (its apps can be listed now). */
  onSaved?: () => void;
  /** Shown as a Back button in the page layout. */
  onBack?: () => void;
  /** Shown on Continue while the page acts on it (opening the chat, say); the footer waits. */
  finishingLabel?: string | null;
  /** Why that last action failed; Continue tries it again. */
  finishError?: string | null;
  /** "page" sits in the entry frame, which shows the title, and uses the entry pages' sizes. */
  layout?: "panel" | "page";
}) {
  const { t } = useLingui();
  const fieldId = useId();
  const page = layout === "page";
  const size = page ? "lg" : "default";
  const [state, setState] = useState<IntegrationSetupState | null>(initialState ?? null);
  const [selectedChoice, setChoice] = useState<Choice>(managedOnly ? "composio" : "direct");
  const choice = serverSetup ? selectedChoice : "direct";
  const [apiKey, setApiKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IntegrationCatalogResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [addingUrl, setAddingUrl] = useState(false);
  /** Saving a provider's credentials; the whole panel waits for it. */
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  /** The server address being connected or disconnected; only its own row waits. */
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Servers connected here, by address; `created` when this panel added the server. */
  const [connected, setConnected] = useState<
    ReadonlyMap<string, { serverId: string; created: boolean }>
  >(new Map());
  const choices: { id: Choice; label: string }[] = [
    { id: "direct", label: t`Direct MCP` },
    { id: "composio", label: "Composio" },
    { id: "pipedream", label: "Pipedream" },
    { id: "executor", label: "Executor" },
  ];
  const managed = choice === "composio" || choice === "pipedream";
  const hasCredentials = Boolean(apiKey.trim());
  const credentialsReady =
    hasCredentials && (choice !== "pipedream" || Boolean(clientId.trim() && projectId.trim()));
  const remoteResults = [
    ...new Map(
      results.flatMap((result) =>
        result.surfaces
          .filter((surface) => surface.kind === "mcp" && surface.source?.startsWith("https://"))
          .map(
            (surface) =>
              [surface.source!, { name: result.name, endpoint: surface.source! }] as const,
          ),
      ),
    ).values(),
  ];
  const configured = state?.providers.find((provider) => provider.id === choice)?.configured;
  useEffect(() => {
    if (!serverSetup || initialState) return;
    void rpc.integrationSetup
      .get()
      .then(setState)
      .catch(() => setError(t`Could not load integrations`));
  }, [serverSetup, initialState]);

  async function run(
    action: () => Promise<void>,
    setPending: (pending: boolean) => void = setBusy,
  ) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not connect`);
    } finally {
      setPending(false);
    }
  }

  const pendingFor = (url: string) => (pending: boolean) => setPendingUrl(pending ? url : null);

  async function saveProvider() {
    await run(async () => {
      await rpc.integrationSetup.save(
        choice === "composio"
          ? { provider: "composio", apiKey }
          : {
              provider: "pipedream",
              clientId,
              clientSecret: apiKey,
              projectId,
              environment: "production",
            },
      );
      setApiKey("");
      setState(await rpc.integrationSetup.get());
      onSaved?.();
      onDone?.();
    });
  }

  async function connect(name: string, url: string) {
    if (pendingUrl !== null) return;
    await run(async () => {
      const existing = (await rpc.mcp.servers.list()).find((server) => server.endpoint === url);
      const server =
        existing ??
        (await rpc.mcp.servers.create({
          slug: `integration-${newClientId().slice(0, 8)}`,
          name,
          transport: "streamable_http",
          endpoint: url,
          ...(apiKey.trim() ? { secret: apiKey.trim() } : {}),
        }));
      if (existing && apiKey.trim()) {
        await rpc.mcp.servers.update({ id: existing.id, secret: apiKey.trim() });
      }
      const result = await connectMcpOauth(server.id);
      if (result === "cancelled") return;
      if (botId) await rpc.mcp.assignments.approve({ botId, serverId: server.id });
      setConnected((current) =>
        new Map(current).set(url, { serverId: server.id, created: !existing }),
      );
      onServerConnected?.(server.id);
    }, pendingFor(url));
  }

  /** Undoes a connection: a server added here is deleted, one that existed is only let go. */
  async function disconnect(url: string) {
    const connection = connected.get(url);
    if (!connection || pendingUrl !== null) return;
    await run(async () => {
      if (connection.created) await rpc.mcp.servers.remove({ id: connection.serverId });
      setConnected((current) => {
        const next = new Map(current);
        next.delete(url);
        return next;
      });
      onServerDisconnected?.(connection.serverId);
    }, pendingFor(url));
  }

  const footerLocked = busy || finishingLabel !== null;
  const skipButton = (
    <Button
      variant="ghost"
      size={size}
      className={page ? "ml-auto" : undefined}
      disabled={footerLocked}
      onClick={onDone}
    >
      <Trans>Skip</Trans>
    </Button>
  );

  if (serverSetup && !state?.canConfigure) return error ? <p role="alert">{error}</p> : null;

  return (
    <div className="@container w-full space-y-6">
      {page ? null : (
        <h1 className="text-[32px] font-medium text-foreground">
          {serverSetup ? t`Server integrations` : t`Add MCP server`}
        </h1>
      )}
      {serverSetup ? (
        <fieldset
          aria-label={t`Integration options`}
          className={
            page
              ? "grid grid-cols-2 gap-3 @lg:grid-cols-4"
              : "overflow-hidden rounded-xl border border-border"
          }
        >
          {choices
            .filter(({ id }) => !managedOnly || id === "composio" || id === "pipedream")
            .map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={choice === id}
                disabled={busy}
                onClick={() => {
                  setChoice(id);
                  setApiKey("");
                  setError(null);
                }}
                className={
                  page
                    ? `flex aspect-[4/3] flex-col justify-between rounded-xl border p-3 text-left text-sm font-medium shadow-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-link/50 ${choice === id ? "border-transparent bg-link text-white" : "border-border bg-card hover:bg-accent"}`
                    : `flex min-h-11 w-full items-center justify-between border-b border-border px-3.5 py-2.5 text-left last:border-0 ${choice === id ? "bg-muted" : "hover:bg-accent"}`
                }
              >
                {page ? (
                  <>
                    <span className="flex min-w-0 items-center gap-2">
                      <IntegrationLogo service={id === "direct" ? "mcp" : id} />
                      <span className="truncate">{label}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`grid size-4 shrink-0 place-items-center self-end rounded-full border-2 ${choice === id ? "border-white" : "border-muted-foreground/60"}`}
                    >
                      {choice === id ? <span className="size-1.5 rounded-full bg-white" /> : null}
                    </span>
                  </>
                ) : (
                  <>
                    <span>{label}</span>
                    {choice === id ? <Check className="size-4" aria-hidden /> : null}
                  </>
                )}
              </button>
            ))}
        </fieldset>
      ) : null}
      {choice === "composio" || choice === "pipedream" ? (
        <>
          {configured ? (
            <p className="text-sm text-success">
              <Trans>Connected</Trans>
            </p>
          ) : null}
          {state?.canConfigure ? (
            <>
              {choice === "pipedream" ? (
                <>
                  <label htmlFor={`${fieldId}-client-id`} className="block text-sm">
                    <Trans>Client ID</Trans>
                    <Input
                      size={size}
                      id={`${fieldId}-client-id`}
                      placeholder={t`Paste your Pipedream client ID`}
                      className="mt-2"
                      value={clientId}
                      onChange={(event) => setClientId(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label htmlFor={`${fieldId}-project-id`} className="block text-sm">
                    <Trans>Project ID</Trans>
                    <Input
                      size={size}
                      id={`${fieldId}-project-id`}
                      placeholder={t`Paste your Pipedream project ID`}
                      className="mt-2"
                      value={projectId}
                      onChange={(event) => setProjectId(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                </>
              ) : null}
              {/* The link belongs to the field above it, so it sits close. */}
              <div className="space-y-2">
                <label htmlFor={`${fieldId}-key`} className="block text-sm">
                  {choice === "composio" ? t`API key` : t`Client secret`}
                  <Input
                    size={size}
                    id={`${fieldId}-key`}
                    placeholder={
                      choice === "composio"
                        ? t`Paste your Composio API key`
                        : t`Paste your Pipedream client secret`
                    }
                    className="mt-2"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <a
                  className="inline-block text-sm text-muted-foreground underline"
                  href={
                    choice === "composio"
                      ? "https://dashboard.composio.dev"
                      : "https://pipedream.com/docs/connect/mcp/developers"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  <Trans>Get credentials</Trans>
                </a>
                {!onDone ? (
                  <Button
                    size={size}
                    className="ml-3"
                    disabled={busy || !credentialsReady}
                    onClick={() => void saveProvider()}
                  >
                    {busy ? t`Connecting…` : t`Connect`}
                  </Button>
                ) : null}
              </div>
            </>
          ) : state && !configured ? (
            <p className="text-sm text-muted-foreground">
              <Trans>Ask the server owner to configure this provider.</Trans>
            </p>
          ) : null}
        </>
      ) : null}
      {choice === "direct" ? (
        <>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const response = await rpc.capabilities.catalogSearch({
                  query,
                  usePublicCatalog: true,
                });
                setResults(response.results);
                setSearched(true);
              }, setSearching);
            }}
          >
            <ButtonGroup className="w-full">
              <Input
                size={size}
                aria-label={t`Search apps`}
                placeholder={t`Search for an app, e.g. GitHub or Linear`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                type="submit"
                size={page ? "icon-lg" : "icon"}
                aria-label={t`Search`}
                disabled={searching || !query.trim()}
              >
                <Search />
              </Button>
            </ButtonGroup>
            <p className="text-xs text-muted-foreground">
              <Trans>Results from integrations.sh</Trans>
            </p>
          </form>
          {remoteResults.length ? (
            <ul>
              {remoteResults.map((result) => (
                <li key={result.endpoint} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm">{result.name}</span>
                  {connected.has(result.endpoint) ? (
                    <ConnectedStatus
                      // A bot keeps a server that existed before; there is nothing here to undo.
                      onDisconnect={
                        connected.get(result.endpoint)?.created || !botId
                          ? () => void disconnect(result.endpoint)
                          : null
                      }
                      pending={pendingUrl === result.endpoint}
                    />
                  ) : (
                    <Button
                      size={size}
                      variant="text"
                      disabled={pendingUrl === result.endpoint}
                      onClick={() => void connect(result.name, result.endpoint)}
                    >
                      <Plug />
                      {pendingUrl === result.endpoint ? t`Connecting…` : t`Connect`}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {searched && !remoteResults.length ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No remote MCP servers found</Trans>
            </p>
          ) : null}
          <div className="flex items-start gap-3">
            <Switch
              id={`${fieldId}-add-url`}
              className="mt-0.5"
              checked={addingUrl}
              onCheckedChange={setAddingUrl}
            />
            <Label
              htmlFor={`${fieldId}-add-url`}
              className="text-[14px] font-normal text-foreground/75"
            >
              <Trans>Add server URL</Trans>
            </Label>
          </div>
          {addingUrl ? (
            <div className="space-y-3">
              <Input
                size={size}
                aria-label={t`Server URL`}
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://example.com/mcp"
              />
              <Button
                variant="text"
                size={size}
                disabled={!endpoint.trim() || pendingUrl === endpoint.trim()}
                onClick={() => void connect("MCP server", endpoint.trim())}
              >
                <Plug />
                {pendingUrl === endpoint.trim() ? t`Connecting…` : t`Connect`}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {choice === "executor" ? (
        <div className="space-y-3">
          <label htmlFor={`${fieldId}-endpoint`} className="block text-sm">
            <Trans>Server URL</Trans>
            <Input
              size={size}
              id={`${fieldId}-endpoint`}
              className="mt-2"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="http://localhost:8000/mcp"
            />
          </label>
          <label htmlFor={`${fieldId}-token`} className="block text-sm">
            <Trans>Access token</Trans>
            <Input
              size={size}
              id={`${fieldId}-token`}
              placeholder={t`Paste your Executor access token`}
              className="mt-2"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </label>
          <Button
            variant="text"
            size={size}
            disabled={!endpoint.trim() || pendingUrl === endpoint.trim()}
            onClick={() => void connect("Executor", endpoint.trim())}
          >
            <Plug />
            {pendingUrl === endpoint.trim() ? t`Connecting…` : t`Connect`}
          </Button>
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">
              <Trans>Setup help</Trans>
            </summary>
            <a
              href="https://executor.sh/#get-started"
              target="_blank"
              rel="noreferrer"
              className="mt-2 block underline"
            >
              <Trans>Download Executor</Trans>
            </a>
          </details>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {finishError ? (
        <p role="alert" className="text-sm text-destructive">
          {finishError}
        </p>
      ) : null}
      {onDone ? (
        <div className={page ? "flex items-center gap-3 pt-2" : "flex gap-3"}>
          {page && onBack ? (
            <Button variant="outline" size={size} disabled={footerLocked} onClick={onBack}>
              <ArrowLeft />
              <Trans>Back</Trans>
            </Button>
          ) : null}
          {page ? skipButton : null}
          <Button
            size={size}
            disabled={
              footerLocked ||
              (managed &&
                state?.canConfigure &&
                !credentialsReady &&
                (!configured || hasCredentials))
            }
            onClick={() => {
              if (managed && hasCredentials) void saveProvider();
              else onDone();
            }}
          >
            {finishingLabel ?? (busy ? t`Connecting…` : t`Continue`)}
          </Button>
          {page ? null : skipButton}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Connected", in green. When the connection can be undone it turns into "Disconnect" on hover or
 * keyboard focus; a touch shows "Disconnect" first and a second touch disconnects.
 */
function ConnectedStatus({
  onDisconnect,
  pending,
}: {
  onDisconnect: (() => void) | null;
  /** Disconnecting is under way. */
  pending: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const connected = (
    <>
      <Check />
      <Trans>Connected</Trans>
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
        {pending ? <Trans>Disconnecting…</Trans> : <Trans>Disconnect</Trans>}
      </span>
    </button>
  );
}
