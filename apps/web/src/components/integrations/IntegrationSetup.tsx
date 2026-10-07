import { Trans, useLingui } from "@lingui/react/macro";
import type { IntegrationCatalogResult, IntegrationSetupState } from "@rakazo/contracts";
import {
  Button,
  ButtonGroup,
  Disclosure,
  Field,
  FieldLabel,
  Input,
  Label,
  Switch,
} from "@rakazo/ui-web";
import { ArrowLeft, Check, Plug, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { newClientId } from "../../lib/client-id";
import { connectMcpOauth } from "../../lib/mcp-connect";
import { rpc } from "../../lib/rpc";
import { ChoiceCard, ChoiceCards } from "./ChoiceCard";
import { ConnectedStatus } from "./ConnectedStatus";
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
  const isConfigured = (id: Choice) =>
    state?.providers.find((provider) => provider.id === id)?.configured === true;
  const configured = isConfigured(choice);
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
      // A server added only for this sign-in goes again when the sign-in does not finish.
      const forgetIfNew = async () => {
        if (!existing) await rpc.mcp.servers.remove({ id: server.id });
      };
      const result = await connectMcpOauth(server.id).catch(async (err: unknown) => {
        await forgetIfNew();
        throw err;
      });
      if (result === "cancelled") {
        await forgetIfNew();
        return;
      }
      // This tab is on its way to the provider; the sign-in is still under way.
      if (result === "redirected") return;
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

  const visibleChoices = choices.filter(
    ({ id }) => !managedOnly || id === "composio" || id === "pipedream",
  );
  function selectChoice(id: Choice) {
    setChoice(id);
    setApiKey("");
    setError(null);
  }

  // A server mid-connection counts too: finishing now would open the bot without it.
  const footerLocked = busy || pendingUrl !== null || finishingLabel !== null;
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
        page ? (
          <ChoiceCards label={t`Integration options`}>
            {visibleChoices.map(({ id, label }) => (
              <ChoiceCard
                key={id}
                icon={<IntegrationLogo service={id === "direct" ? "mcp" : id} />}
                label={label}
                selected={choice === id}
                connected={isConfigured(id)}
                disabled={busy}
                onSelect={() => selectChoice(id)}
              />
            ))}
          </ChoiceCards>
        ) : (
          <fieldset
            aria-label={t`Integration options`}
            className="overflow-hidden rounded-xl border border-border"
          >
            {visibleChoices.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={choice === id}
                disabled={busy}
                onClick={() => selectChoice(id)}
                className={`flex min-h-11 w-full items-center justify-between border-b border-border px-3.5 py-2.5 text-left last:border-0 ${choice === id ? "bg-muted" : "hover:bg-accent"}`}
              >
                <span className="flex-1">{label}</span>
                {isConfigured(id) ? (
                  <span className="text-[12px] text-success">
                    <Trans>Connected</Trans>
                  </span>
                ) : null}
                {choice === id ? <Check className="ml-3 size-4" aria-hidden /> : null}
              </button>
            ))}
          </fieldset>
        )
      ) : null}
      {choice === "composio" || choice === "pipedream" ? (
        <>
          {state?.canConfigure ? (
            <>
              {choice === "pipedream" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor={`${fieldId}-client-id`}>
                      <Trans>Client ID</Trans>
                    </FieldLabel>
                    <Input
                      id={`${fieldId}-client-id`}
                      placeholder={t`Paste your Pipedream client ID`}
                      value={clientId}
                      onChange={(event) => setClientId(event.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${fieldId}-project-id`}>
                      <Trans>Project ID</Trans>
                    </FieldLabel>
                    <Input
                      id={`${fieldId}-project-id`}
                      placeholder={t`Paste your Pipedream project ID`}
                      value={projectId}
                      onChange={(event) => setProjectId(event.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                </>
              ) : null}
              {/* The link belongs to the field above it, so it sits close. */}
              <div className="space-y-2">
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-key`}>
                    {choice === "composio" ? t`API key` : t`Client secret`}
                  </FieldLabel>
                  <Input
                    id={`${fieldId}-key`}
                    placeholder={
                      configured
                        ? t`Saved. Paste a new one to replace it.`
                        : choice === "composio"
                          ? t`Paste your Composio project API key (ak_…)`
                          : t`Paste your Pipedream client secret`
                    }
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="new-password"
                  />
                </Field>
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
                aria-label={t`Search apps`}
                placeholder={t`Search for an app, e.g. GitHub or Linear`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                type="submit"
                size="icon-lg"
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
          <Field>
            <FieldLabel htmlFor={`${fieldId}-endpoint`}>
              <Trans>Server URL</Trans>
            </FieldLabel>
            <Input
              id={`${fieldId}-endpoint`}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="http://localhost:8000/mcp"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-token`}>
              <Trans>Access token</Trans>
            </FieldLabel>
            <Input
              id={`${fieldId}-token`}
              placeholder={t`Paste your Executor access token`}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <Button
            variant="text"
            size={size}
            disabled={!endpoint.trim() || pendingUrl === endpoint.trim()}
            onClick={() => void connect("Executor", endpoint.trim())}
          >
            <Plug />
            {pendingUrl === endpoint.trim() ? t`Connecting…` : t`Connect`}
          </Button>
          <Disclosure className="text-sm text-muted-foreground" summary={<Trans>Setup help</Trans>}>
            <a
              href="https://executor.sh/#get-started"
              target="_blank"
              rel="noreferrer"
              className="mt-2 block underline"
            >
              <Trans>Download Executor</Trans>
            </a>
          </Disclosure>
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
      {!onDone && managed && state?.canConfigure ? (
        <div>
          <Button
            variant="secondary"
            size={size}
            disabled={busy || !credentialsReady}
            onClick={() => void saveProvider()}
          >
            {configured ? (
              busy ? (
                t`Saving…`
              ) : (
                t`Replace credentials`
              )
            ) : (
              <>
                <Plug />
                {busy ? t`Connecting…` : t`Connect`}
              </>
            )}
          </Button>
        </div>
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
