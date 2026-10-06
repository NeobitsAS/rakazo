import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, IntegrationCatalogResult } from "@rakazo/contracts";
import {
  Button,
  ButtonGroup,
  Field,
  FieldLabel,
  FieldSeparator,
  Input,
  Label,
  OptionSelect,
  Switch,
} from "@rakazo/ui-web";
import { FileJson, Network, Plus, Search, Server } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { newClientId } from "../../lib/client-id";
import { rpc } from "../../lib/rpc";
import { SettingRow } from "../SettingRow";
import { ChoiceCard, ChoiceCards } from "./ChoiceCard";
import { ConnectedStatus } from "./ConnectedStatus";

type Kind = "mcp" | "api" | "graphql";
type Auth = "signin" | "token" | "header" | "none";

/** One spelling per address, so a trailing slash or letter case does not hide a match. */
function endpointKey(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

/** Quick fills for MCP servers people often add by hand. */
const PRESETS = [
  { name: "Executor", url: "http://localhost:8000/mcp", auth: "token" },
  { name: "Treg", url: "https://treg.to/mcp/", auth: "token" },
] as const;

/**
 * One way to add a tool server: find it or type its address, say what kind it is and how to
 * connect, and choose who can use it. MCP servers are stored as MCP servers and given to the
 * chosen bots; OpenAPI and GraphQL endpoints become tool sources for all your bots.
 */
export function AddIntegration({
  activeBotId,
  connectedEndpoints,
  onAdded,
  onCancel,
}: {
  activeBotId?: string;
  /** Addresses of the MCP servers this space already has; search shows them as connected. */
  connectedEndpoints: readonly string[];
  onAdded: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const fieldId = useId();
  const [kind, setKind] = useState<Kind>("mcp");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<Auth>("signin");
  const [headerName, setHeaderName] = useState("x-api-key");
  const [credential, setCredential] = useState("");
  const [bots, setBots] = useState<Bot[]>([]);
  const [botIds, setBotIds] = useState<ReadonlySet<string>>(
    new Set(activeBotId ? [activeBotId] : []),
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IntegrationCatalogResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingUrl, setAddingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void rpc.bots
      .list()
      .then(setBots)
      .catch(() => setBots([]));
  }, []);

  const authItems = useMemo<{ value: Auth; label: string }[]>(
    () =>
      kind === "mcp"
        ? [
            { value: "signin", label: t`Sign in with the service` },
            { value: "token", label: t`Access token` },
            { value: "none", label: t`No authentication` },
          ]
        : [
            { value: "token", label: t`Bearer token` },
            { value: "header", label: t`API key header` },
            { value: "none", label: t`No authentication` },
          ],
    [kind, t],
  );

  function chooseKind(next: Kind) {
    setKind(next);
    setAuth(next === "mcp" ? "signin" : "token");
    setError(null);
  }

  async function search() {
    setSearching(true);
    setError(null);
    try {
      const response = await rpc.capabilities.catalogSearch({ query, usePublicCatalog: true });
      setResults(response.results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not search catalog`);
    } finally {
      setSearching(false);
    }
  }

  /** Adds a server found in the search and gives it to the chosen bots; signing in comes later. */
  async function addResult(name: string, endpoint: string) {
    if (addingUrl !== null) return;
    setAddingUrl(endpoint);
    setError(null);
    try {
      const existing = (await rpc.mcp.servers.list()).find(
        (server) => server.endpoint === endpoint,
      );
      const server =
        existing ??
        (await rpc.mcp.servers.create({
          slug: `integration-${newClientId().slice(0, 8)}`,
          name,
          transport: "streamable_http",
          endpoint,
        }));
      await giveToBots(server.id);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not add the integration`);
    } finally {
      setAddingUrl(null);
    }
  }

  async function giveToBots(serverId: string) {
    for (const botId of botIds) {
      await rpc.mcp.assignments.approve({ botId, serverId });
    }
  }

  function toggleBot(botId: string, checked: boolean) {
    setBotIds((current) => {
      const next = new Set(current);
      if (checked) next.add(botId);
      else next.delete(botId);
      return next;
    });
  }

  async function add() {
    setAdding(true);
    setError(null);
    try {
      if (kind === "mcp") await addMcpServer();
      else await addToolSource();
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not add the integration`);
    } finally {
      setAdding(false);
    }
  }

  async function addMcpServer() {
    const server = await rpc.mcp.servers.create({
      slug: `integration-${newClientId().slice(0, 8)}`,
      name: name.trim() || t`MCP server`,
      transport: "streamable_http",
      endpoint: url.trim(),
      ...(auth === "token" && credential.trim() ? { secret: credential.trim() } : {}),
    });
    await giveToBots(server.id);
  }

  async function addToolSource() {
    const authConfig =
      auth === "header"
        ? { type: "header" as const, name: headerName.trim() }
        : { type: auth === "token" ? ("bearer" as const) : ("none" as const) };
    await rpc.capabilities.install({
      kind,
      name: name.trim() || (kind === "graphql" ? "GraphQL" : "OpenAPI"),
      source: url.trim(),
      credential: credential.trim() || undefined,
      config: kind === "api" ? { openApi: true, auth: authConfig } : { auth: authConfig },
    });
  }

  const connected = new Set(connectedEndpoints.map(endpointKey));
  // Only servers reachable over HTTPS can be added from here; one row per address.
  const remoteServers = [
    ...new Map(
      results.flatMap((result) =>
        result.surfaces.flatMap((surface) =>
          surface.kind === "mcp" && surface.source?.startsWith("https://")
            ? [[surface.source, { name: result.name, endpoint: surface.source }] as const]
            : [],
        ),
      ),
    ).values(),
  ];
  const needsCredential = auth === "token" || auth === "header";
  const canAdd =
    url.trim() !== "" &&
    (!needsCredential || credential.trim() !== "") &&
    (kind !== "mcp" || botIds.size > 0);

  return (
    <div className="@container w-full max-w-[592px] space-y-8">
      <section className="space-y-2">
        <Label htmlFor={`${fieldId}-search`}>
          <Trans>Find a server</Trans>
        </Label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <ButtonGroup className="w-full">
            <Input
              id={`${fieldId}-search`}
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
        </form>
        <p className="text-xs text-muted-foreground">
          <Trans>Results from integrations.sh.</Trans>
        </p>
        {remoteServers.length ? (
          <ul>
            {remoteServers.map((server) => (
              <li key={server.endpoint} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm">
                  {server.name}
                  <span className="ml-2 text-muted-foreground">
                    {new URL(server.endpoint).host}
                  </span>
                </span>
                {connected.has(endpointKey(server.endpoint)) ? (
                  <ConnectedStatus
                    label={<Trans>Added</Trans>}
                    onDisconnect={null}
                    pending={false}
                  />
                ) : (
                  <Button
                    variant="text"
                    disabled={addingUrl !== null || botIds.size === 0}
                    onClick={() => void addResult(server.name, server.endpoint)}
                  >
                    <Plus />
                    {addingUrl === server.endpoint ? <Trans>Adding…</Trans> : <Trans>Add</Trans>}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : searched ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No remote MCP servers found</Trans>
          </p>
        ) : null}
      </section>

      <div>
        <FieldSeparator>
          <Trans>Or add it manually</Trans>
        </FieldSeparator>
      </div>

      <section className="space-y-3">
        <Label>
          <Trans>What kind of server</Trans>
        </Label>
        <ChoiceCards label={t`Server type`}>
          <ChoiceCard
            icon={<Server className="size-5" />}
            label={t`MCP server`}
            selected={kind === "mcp"}
            onSelect={() => chooseKind("mcp")}
          />
          <ChoiceCard
            icon={<FileJson className="size-5" />}
            label="OpenAPI"
            selected={kind === "api"}
            onSelect={() => chooseKind("api")}
          />
          <ChoiceCard
            icon={<Network className="size-5" />}
            label="GraphQL"
            selected={kind === "graphql"}
            onSelect={() => chooseKind("graphql")}
          />
        </ChoiceCards>
        {kind === "mcp" ? (
          <p className="text-xs text-muted-foreground">
            <Trans>Fill in for:</Trans>{" "}
            {PRESETS.map((preset, index) => (
              <span key={preset.name}>
                {index > 0 ? " · " : null}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => {
                    setName(preset.name);
                    setUrl(preset.url);
                    setAuth(preset.auth);
                  }}
                >
                  {preset.name}
                </button>
              </span>
            ))}
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <Field>
          <FieldLabel htmlFor={`${fieldId}-name`}>
            <Trans>Name</Trans>
          </FieldLabel>
          <Input
            id={`${fieldId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t`What your bots will call it`}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${fieldId}-url`}>
            <Trans>Address</Trans>
          </FieldLabel>
          <Input
            id={`${fieldId}-url`}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={
              kind === "mcp"
                ? "https://example.com/mcp"
                : kind === "graphql"
                  ? "https://example.com/graphql"
                  : "https://example.com/openapi.json"
            }
          />
        </Field>
      </section>

      <section className="space-y-3">
        <Label>
          <Trans>How to connect</Trans>
        </Label>
        <OptionSelect
          aria-label={t`How to connect`}
          value={auth}
          onValueChange={setAuth}
          options={authItems}
        />
        {auth === "header" ? (
          <Input
            value={headerName}
            onChange={(event) => setHeaderName(event.target.value)}
            aria-label={t`Header name`}
            placeholder={t`Header name`}
          />
        ) : null}
        {needsCredential ? (
          <Input
            type="password"
            autoComplete="new-password"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            aria-label={t`Credential`}
            placeholder={t`Paste the token`}
          />
        ) : null}
        {auth === "signin" ? (
          <p className="text-xs text-muted-foreground">
            <Trans>
              Sign in from the server's page once it is added. Some services, like GitHub, only
              accept a token.
            </Trans>
          </p>
        ) : null}
        {needsCredential ? (
          <p className="text-xs text-muted-foreground">
            <Trans>Credentials are encrypted and never sent to the model.</Trans>
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <Label>
          <Trans>Who can use it</Trans>
        </Label>
        {kind === "mcp" ? (
          <ul className="divide-y divide-border">
            {bots.map((bot) => (
              <SettingRow
                key={bot.id}
                title={bot.name}
                description={
                  botIds.has(bot.id) ? (
                    <Trans>Can use this server's tools.</Trans>
                  ) : (
                    <Trans>Can't use this server.</Trans>
                  )
                }
                control={
                  <Switch
                    aria-label={t`Let ${bot.name} use this server`}
                    checked={botIds.has(bot.id)}
                    onCheckedChange={(checked) => toggleBot(bot.id, checked)}
                  />
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Trans>All your bots in this space can use it.</Trans>
          </p>
        )}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button variant="ghost" size="lg" disabled={adding} onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button size="lg" disabled={adding || !canAdd} onClick={() => void add()}>
          {adding ? <Trans>Adding…</Trans> : <Trans>Add</Trans>}
        </Button>
      </div>
    </div>
  );
}
