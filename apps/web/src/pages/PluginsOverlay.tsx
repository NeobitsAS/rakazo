import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type {
  Bot,
  BotMcpServer,
  CapabilityInstall,
  Connection,
  ConnectionCatalogItem,
  McpServer,
} from "@rakazo/contracts";
import {
  abortableDelay,
  buildFeaturedConnectorTiles,
  CONNECTION_CATALOG_PAGE_SIZE,
  type FeaturedConnectorTile,
  filterConnectionCatalogItems,
  humanizeToolName,
} from "@rakazo/core";
import {
  Button,
  ButtonGroup,
  Dialog,
  DialogContent,
  Field,
  FieldLabel,
  Input,
  Switch,
} from "@rakazo/ui-web";
import { Pencil, Plug, Plus, RotateCw, Settings, Trash } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { DialogPageHeader } from "../components/DialogPageHeader";
import { AddIntegration } from "../components/integrations/AddIntegration";
import { ConnectedStatus } from "../components/integrations/ConnectedStatus";
import { IntegrationSetup } from "../components/integrations/IntegrationSetup";
import { Loader } from "../components/PageLoader";
import { SettingRow } from "../components/SettingRow";
import { connectMcpOauth } from "../lib/mcp-connect";
import { rpc } from "../lib/rpc";

type ConnectionTool = { name: string; description: string };

/** An app's logo, or the first letter of its name when it has none. */
function AppIcon({ name, logo }: { name: string; logo?: string | null }) {
  return logo ? (
    <img src={logo} alt="" className="size-10 rounded-xl bg-accent object-contain" />
  ) : (
    <div className="grid size-10 place-items-center rounded-xl bg-accent text-base font-semibold text-foreground">
      {name[0]}
    </div>
  );
}

/** Tools shown for an app before "Show all". */
const TOOL_PREVIEW_COUNT = 5;

function itemKey(item: Pick<ConnectionCatalogItem, "connectorId" | "slug">) {
  return `${item.connectorId}:${item.slug}`;
}

function markConnected(
  items: ConnectionCatalogItem[],
  connectorId: string,
  slug: string,
  connected: boolean,
) {
  return items.map((entry) =>
    entry.connectorId === connectorId && entry.slug === slug ? { ...entry, connected } : entry,
  );
}

function activeAccounts(
  connections: Connection[],
  item: Pick<ConnectionCatalogItem, "connectorId" | "slug">,
) {
  return connections.filter(
    (row) =>
      row.connectorId === item.connectorId &&
      row.provider === item.slug &&
      (row.status === "connected" || row.status === "pending"),
  );
}

function nextAccountLabel(itemName: string, existingCount: number) {
  return existingCount <= 0 ? itemName : `${itemName} ${existingCount + 1}`;
}
export function PluginsOverlay({
  onClose,
  activeBotId,
  isDeploymentOwner = false,
}: {
  onClose: () => void;
  activeBotId?: string;
  /** The owner sets up the catalog's provider (Composio or Pipedream) right here. */
  isDeploymentOwner?: boolean;
}) {
  const { t } = useLingui();
  /** The list, adding a tool server, or the owner's setup of the catalog's provider. */
  const [view, setView] = useState<"list" | "add" | "server">("list");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(CONNECTION_CATALOG_PAGE_SIZE);
  const [catalog, setCatalog] = useState<ConnectionCatalogItem[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<CapabilityInstall[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [assignments, setAssignments] = useState<BotMcpServer[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  /** An access token typed on a server's page, for services that do not sign in. */
  const [serverToken, setServerToken] = useState("");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailKey, setDetailKey] = useState<{ connectorId: string; slug: string } | null>(null);
  const [serverDetailId, setServerDetailId] = useState<string | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [tools, setTools] = useState<ConnectionTool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [allToolsShown, setAllToolsShown] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [toolsTick, setToolsTick] = useState(0);
  const connectionAttempt = useRef<AbortController | null>(null);

  /** A provider was just set up: list its apps. */
  function refreshAfterSetup() {
    void refresh().catch((err: unknown) =>
      setCatalogError(err instanceof Error ? err.message : t`Could not load integrations`),
    );
  }

  async function refresh() {
    const [items, installs, rows, servers, serverAssignments, spaceBots] = await Promise.all([
      rpc.connections.catalog({}),
      rpc.capabilities.list(),
      rpc.connections.list(),
      rpc.mcp.servers.list(),
      rpc.mcp.assignments.all(),
      rpc.bots.list(),
    ]);
    setBots(spaceBots);
    setMcpServers(servers);
    setAssignments(serverAssignments);
    setCatalog(items);
    setConnections(rows);
    setLabelDrafts((current) => {
      const next: Record<string, string> = {};
      for (const row of rows) {
        if (row.status === "connected" || row.status === "pending") {
          next[row.id] = current[row.id] ?? row.displayName;
        }
      }
      return next;
    });
    setSources(
      installs.filter(
        (install) => install.kind === "mcp" || install.kind === "api" || install.kind === "graphql",
      ),
    );
    return items;
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setCatalogError(err instanceof Error ? err.message : t`Could not load integrations`),
      )
      .finally(() => setLoading(false));
    return () => connectionAttempt.current?.abort();
  }, []);

  const serverDetail = mcpServers.find((server) => server.id === serverDetailId) ?? null;
  const detailItem = useMemo(() => {
    if (!detailKey) return null;
    return (
      catalog.find(
        (entry) => entry.connectorId === detailKey.connectorId && entry.slug === detailKey.slug,
      ) ?? null
    );
  }, [catalog, detailKey]);

  useEffect(() => {
    if (!detailKey) {
      setTools([]);
      setToolsLoading(false);
      return;
    }
    let cancelled = false;
    setToolsLoading(true);
    void rpc.connections
      .tools({ connectorId: detailKey.connectorId, provider: detailKey.slug })
      .then((list) => {
        if (!cancelled) setTools(list);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailKey, toolsTick]);

  const featuredTiles = useMemo(() => buildFeaturedConnectorTiles(catalog), [catalog]);
  const showFeatured = !query.trim();

  const visible = useMemo(() => filterConnectionCatalogItems(catalog, query), [catalog, query]);
  const rendered = visible.slice(0, visibleCount);

  function openDetail(item: ConnectionCatalogItem) {
    setCatalogError(null);
    setAllToolsShown(false);
    setRenamingId(null);
    setDetailKey({ connectorId: item.connectorId, slug: item.slug });
  }

  function closeDetail() {
    setDetailKey(null);
    setTools([]);
  }

  function itemConnected(item: ConnectionCatalogItem) {
    return (
      item.connected || activeAccounts(connections, item).some((row) => row.status === "connected")
    );
  }

  async function notifyAppConnected(item: ConnectionCatalogItem) {
    if (!activeBotId) return;
    await rpc.onboarding
      .appConnected({ botId: activeBotId, provider: item.slug, connectorId: item.connectorId })
      .catch(() => undefined);
  }

  function setItemConnected(item: ConnectionCatalogItem, connected: boolean) {
    setCatalog((prev) => markConnected(prev, item.connectorId, item.slug, connected));
  }

  async function connect(item: ConnectionCatalogItem) {
    connectionAttempt.current?.abort();
    const controller = new AbortController();
    connectionAttempt.current = controller;
    setCatalogError(null);
    const key = itemKey(item);
    setPending(key);
    try {
      const existing = activeAccounts(connections, item).filter(
        (row) => row.status === "connected",
      );
      const started = await rpc.connections.begin({
        connectorId: item.connectorId,
        provider: item.slug,
        displayName: nextAccountLabel(item.name, existing.length),
      });
      if (started.authorizationUrl)
        window.open(started.authorizationUrl, "rakazo-plugin-connect", "noopener,noreferrer");
      if (item.noAuth && !started.authorizationUrl) {
        if (controller.signal.aborted) return;
        setItemConnected(item, true);
        void notifyAppConnected(item);
        await refresh().catch(() => undefined);
        setToolsTick((tick) => tick + 1);
        return;
      }
      for (let i = 0; i < 45; i += 1) {
        if (controller.signal.aborted) return;
        const row = await rpc.connections
          .complete({ connectionId: started.connectionId })
          .catch(() => undefined);
        if (row?.status === "connected") {
          if (controller.signal.aborted) return;
          setItemConnected(item, true);
          void notifyAppConnected(item);
          await refresh().catch(() => undefined);
          setToolsTick((tick) => tick + 1);
          return;
        }
        await abortableDelay(2_000, controller.signal);
      }
      if (controller.signal.aborted) return;
      setCatalogError(
        t`Connection to ${item.name} is still pending. You can close this and check again.`,
      );
      await refresh().catch(() => undefined);
    } catch (err) {
      if (controller.signal.aborted) return;
      setCatalogError(err instanceof Error ? err.message : t`Could not connect`);
    } finally {
      if (connectionAttempt.current === controller) {
        connectionAttempt.current = null;
        setPending(null);
      }
    }
  }

  async function revokeAccount(row: Connection, item: ConnectionCatalogItem) {
    setCatalogError(null);
    setPending(row.id);
    try {
      await rpc.connections.revoke({ connectionId: row.id });
      const remaining = activeAccounts(connections, item).filter((entry) => entry.id !== row.id);
      if (remaining.every((entry) => entry.status !== "connected")) {
        setItemConnected(item, false);
      }
      await refresh().catch(() => undefined);
      setToolsTick((tick) => tick + 1);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : t`Could not revoke connection`);
    } finally {
      setPending(null);
    }
  }

  async function uninstall(item: ConnectionCatalogItem) {
    const matches = activeAccounts(connections, item);
    if (matches.length === 0) {
      setItemConnected(item, false);
      closeDetail();
      return;
    }
    setCatalogError(null);
    setPending(`uninstall:${itemKey(item)}`);
    try {
      for (const row of matches) {
        await rpc.connections.revoke({ connectionId: row.id });
      }
      setItemConnected(item, false);
      await refresh().catch(() => undefined);
      closeDetail();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : t`Could not revoke connection`);
      await refresh().catch(() => undefined);
    } finally {
      setPending(null);
    }
  }

  async function renameAccount(row: Connection) {
    const displayName = (labelDrafts[row.id] ?? row.displayName).trim();
    if (!displayName || displayName === row.displayName) return;
    setPending(`rename:${row.id}`);
    setCatalogError(null);
    try {
      const updated = await rpc.connections.rename({ connectionId: row.id, displayName });
      setConnections((current) =>
        current.map((entry) =>
          entry.id === row.id ? { ...entry, displayName: updated.displayName } : entry,
        ),
      );
      setLabelDrafts((current) => ({ ...current, [row.id]: updated.displayName }));
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : t`Could not rename connection`);
    } finally {
      setPending(null);
    }
  }

  async function removeSource(install: CapabilityInstall) {
    setPending(install.id);
    setSourceError(null);
    try {
      await rpc.capabilities.remove({ id: install.id });
      setSources((current) => current.filter((source) => source.id !== install.id));
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not remove connector`);
    } finally {
      setPending(null);
    }
  }

  async function removeMcpServer(server: McpServer) {
    setPending(server.id);
    setSourceError(null);
    try {
      await rpc.mcp.servers.remove({ id: server.id });
      setMcpServers((current) => current.filter((entry) => entry.id !== server.id));
      // Its assignments go with it; replace() would otherwise send its id back.
      setAssignments((current) => current.filter((entry) => entry.serverId !== server.id));
      setServerDetailId(null);
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not remove the server`);
    } finally {
      setPending(null);
    }
  }

  function mcpServerDetail(server: McpServer) {
    const auth =
      server.oauthStatus === "connected"
        ? t`Signed in`
        : server.oauthStatus === "reconnect"
          ? t`Needs sign-in again`
          : server.hasSecret
            ? t`Access token`
            : t`Not signed in`;
    const botCount = assignments.filter((entry) => entry.serverId === server.id).length;
    return (
      <>
        {t`MCP server`} · {auth} · <Plural value={botCount} one="# bot" other="# bots" />
      </>
    );
  }

  function sourceDetail(source: CapabilityInstall) {
    const kind = source.kind === "graphql" ? "GraphQL" : source.kind === "api" ? "OpenAPI" : "MCP";
    const auth = source.secretConfigured ? t`Access token` : t`No authentication`;
    return `${kind} · ${auth} · ${t`All your bots`}`;
  }

  function renderConnectedRow({
    id,
    name,
    detail,
    logo,
    onEdit,
    onRemove,
  }: {
    id: string;
    name: string;
    detail: ReactNode;
    logo?: string | null;
    onEdit?: () => void;
    onRemove: () => void;
  }) {
    return (
      <li key={id} className="group flex min-w-0 items-center gap-3 py-2.5">
        {logo ? (
          <img src={logo} alt="" className="size-8 shrink-0 rounded-lg bg-accent object-contain" />
        ) : (
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-sm font-semibold text-foreground">
            {name[0]}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{detail}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          {onEdit ? (
            <Button variant="ghost" size="icon-sm" aria-label={t`Edit ${name}`} onClick={onEdit}>
              <Pencil />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Remove ${name}`}
            disabled={pending === id}
            onClick={onRemove}
          >
            <Trash />
          </Button>
        </div>
      </li>
    );
  }

  /** Gives a bot this server's tools, or takes them away. */
  async function setBotAccess(server: McpServer, botId: string, allowed: boolean) {
    setPending(`access:${server.id}:${botId}`);
    setSourceError(null);
    try {
      if (allowed) {
        await rpc.mcp.assignments.approve({ botId, serverId: server.id });
      } else {
        // replace() overwrites the bot's whole list, so keep its other servers.
        await rpc.mcp.assignments.replace({
          botId,
          assignments: assignments
            .filter((entry) => entry.botId === botId && entry.serverId !== server.id)
            .map(({ serverId, allowAllTools, allowedTools }) => ({
              serverId,
              allowAllTools,
              allowedTools,
            })),
        });
      }
      setAssignments(await rpc.mcp.assignments.all());
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not change who can use it`);
    } finally {
      setPending(null);
    }
  }

  async function changeServerSignIn(server: McpServer) {
    setPending(`signin:${server.id}`);
    setSourceError(null);
    try {
      if (server.oauthStatus === "connected") {
        await rpc.mcp.oauth.disconnect({ serverId: server.id });
      } else {
        await connectMcpOauth(server.id);
      }
      setMcpServers(await rpc.mcp.servers.list());
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not change the sign-in`);
    } finally {
      setPending(null);
    }
  }

  /** Opens a server's page, or goes back from it; a token typed on another page is dropped. */
  function openServer(id: string | null) {
    setServerToken("");
    setServerDetailId(id);
  }

  async function saveServerToken(server: McpServer) {
    setPending(`token:${server.id}`);
    setSourceError(null);
    try {
      await rpc.mcp.servers.update({ id: server.id, secret: serverToken.trim() });
      setServerToken("");
      setMcpServers(await rpc.mcp.servers.list());
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : t`Could not save the access token`);
    } finally {
      setPending(null);
    }
  }

  function renderServerDetail(server: McpServer) {
    const signInPending = pending === `signin:${server.id}`;
    const tokenPending = pending === `token:${server.id}`;
    return (
      <div data-testid="mcp-server-detail" className="space-y-8">
        <ul className="divide-y divide-border">
          <SettingRow
            title={<Trans>Account</Trans>}
            description={
              server.oauthStatus === "connected" ? (
                <Trans>Signed in with the service.</Trans>
              ) : server.oauthStatus === "reconnect" ? (
                <Trans>The sign-in has expired.</Trans>
              ) : server.hasSecret ? (
                <Trans>Uses an access token.</Trans>
              ) : (
                <Trans>Not signed in.</Trans>
              )
            }
            control={
              server.oauthStatus === "connected" ? (
                <ConnectedStatus
                  label={<Trans>Signed in</Trans>}
                  disconnectLabel={<Trans>Sign out</Trans>}
                  pendingLabel={<Trans>Signing out…</Trans>}
                  pending={signInPending}
                  onDisconnect={() => void changeServerSignIn(server)}
                />
              ) : server.oauthStatus === "reconnect" ? (
                <Button
                  variant="text"
                  className="text-warning hover:text-warning"
                  disabled={signInPending}
                  onClick={() => void changeServerSignIn(server)}
                >
                  <RotateCw />
                  <Trans>Sign in again</Trans>
                </Button>
              ) : server.hasSecret ? null : (
                <Button
                  variant="text"
                  disabled={signInPending}
                  onClick={() => void changeServerSignIn(server)}
                >
                  <Plug />
                  {signInPending ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
                </Button>
              )
            }
          />
          {bots.map((bot) => {
            const allowed = assignments.some(
              (entry) => entry.botId === bot.id && entry.serverId === server.id,
            );
            return (
              <SettingRow
                key={bot.id}
                title={bot.name}
                description={
                  allowed ? (
                    <Trans>Can use this server's tools.</Trans>
                  ) : (
                    <Trans>Can't use this server.</Trans>
                  )
                }
                control={
                  <Switch
                    aria-label={t`Let ${bot.name} use this server`}
                    checked={allowed}
                    disabled={pending === `access:${server.id}:${bot.id}`}
                    onCheckedChange={(next) => void setBotAccess(server, bot.id, next)}
                  />
                }
              />
            );
          })}
        </ul>

        {server.oauthStatus === "connected" ? null : (
          <Field>
            <FieldLabel htmlFor={`server-token-${server.id}`}>
              <Trans>Access token</Trans>
            </FieldLabel>
            <ButtonGroup className="w-full">
              <Input
                id={`server-token-${server.id}`}
                type="password"
                autoComplete="new-password"
                value={serverToken}
                onChange={(event) => setServerToken(event.target.value)}
                placeholder={
                  server.hasSecret
                    ? t`Saved. Paste a new one to replace it.`
                    : t`Paste an access token`
                }
              />
              <Button
                variant="secondary"
                disabled={tokenPending || !serverToken.trim()}
                onClick={() => void saveServerToken(server)}
              >
                {tokenPending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
              </Button>
            </ButtonGroup>
          </Field>
        )}

        <Button
          variant="destructive"
          disabled={pending === server.id}
          onClick={() => void removeMcpServer(server)}
        >
          {pending === server.id ? <Trans>Removing…</Trans> : <Trans>Remove server</Trans>}
        </Button>
      </div>
    );
  }

  /** Everything this space can use, whichever system it is stored in. */
  function renderConnected() {
    const apps = catalog.filter((item) => itemConnected(item));
    const empty = apps.length === 0 && mcpServers.length === 0 && sources.length === 0;
    return (
      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground/75">
            <Trans>Connected</Trans>
          </h3>
          <Button variant="outline" size="sm" onClick={() => setView("add")}>
            <Plus />
            <Trans>Add</Trans>
          </Button>
        </div>
        {empty ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              Nothing connected yet. Pick an app from the catalog, or add a server of your own.
            </Trans>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {apps.map((item) =>
              renderConnectedRow({
                id: `uninstall:${itemKey(item)}`,
                name: item.name,
                detail: t`App`,
                logo: item.logo,
                onEdit: () => openDetail(item),
                onRemove: () => void uninstall(item),
              }),
            )}
            {mcpServers.map((server) =>
              renderConnectedRow({
                id: server.id,
                name: server.name,
                detail: mcpServerDetail(server),
                onEdit: () => openServer(server.id),
                onRemove: () => void removeMcpServer(server),
              }),
            )}
            {sources.map((source) =>
              renderConnectedRow({
                id: source.id,
                name: source.name,
                detail: sourceDetail(source),
                onRemove: () => void removeSource(source),
              }),
            )}
          </ul>
        )}
      </section>
    );
  }

  function renderCatalogActions(item: ConnectionCatalogItem) {
    const key = itemKey(item);
    const connected = itemConnected(item);
    const connecting = pending === key;
    if (connected) {
      return (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={connecting}
          onClick={(event) => {
            event.stopPropagation();
            openDetail(item);
          }}
        >
          {connecting ? <Trans>Adding…</Trans> : <Trans>Added</Trans>}
        </Button>
      );
    }
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={connecting}
        onClick={(event) => {
          event.stopPropagation();
          void connect(item);
        }}
      >
        {connecting ? <Trans>Adding…</Trans> : <Trans>Add</Trans>}
      </Button>
    );
  }

  function renderFeaturedTile(tile: FeaturedConnectorTile) {
    const item = tile.item;
    const key = item ? itemKey(item) : tile.id;
    const disabled = tile.missing || !item;
    if (item && !tile.missing) {
      // Featured is the stable hit target for connection-tile-* in E2E.
      return renderCatalogTile(item, tile.label, item.logo, {
        tileTestId: true,
      });
    }
    return (
      <div
        key={key}
        className={`flex min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 ${
          disabled ? "opacity-70" : ""
        }`}
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-sm font-semibold text-foreground">
          {tile.label[0]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium text-foreground">{tile.label}</div>
          {disabled ? (
            <div className="truncate text-[12.5px] text-muted-foreground">
              <Trans>Not in the plugin catalog</Trans>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderCatalogTile(
    item: ConnectionCatalogItem,
    label: string,
    logo?: string | null,
    opts?: { tileTestId?: boolean },
  ) {
    const connected = itemConnected(item);
    const tileTestId = opts?.tileTestId !== false && connected;
    const icon = logo ? (
      <img
        src={logo}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-9 w-9 shrink-0 rounded-xl bg-accent object-contain"
      />
    ) : (
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-sm font-semibold text-foreground">
        {label[0]}
      </div>
    );
    const title = (
      <div className="min-w-0 flex-1 text-start">
        <div className="truncate text-[15px] font-medium text-foreground">{label}</div>
      </div>
    );
    return (
      <div
        key={itemKey(item)}
        data-testid={tileTestId ? `connection-tile-${item.slug.toLowerCase()}` : undefined}
        className="flex min-w-0 items-center gap-3 rounded-xl px-2.5 py-2"
      >
        {connected ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-start hover:bg-accent/60"
            onClick={() => openDetail(item)}
          >
            {icon}
            {title}
          </button>
        ) : (
          <>
            {icon}
            {title}
          </>
        )}
        {renderCatalogActions(item)}
      </div>
    );
  }

  function renderAccount(row: Connection, item: ConnectionCatalogItem, uninstalling: boolean) {
    if (renamingId === row.id) {
      return (
        <li key={row.id} className="flex min-h-14 items-center py-2.5">
          <Input
            autoFocus
            value={labelDrafts[row.id] ?? row.displayName}
            aria-label={t`Account name`}
            onChange={(event) =>
              setLabelDrafts((current) => ({ ...current, [row.id]: event.target.value }))
            }
            onBlur={() => {
              setRenamingId(null);
              void renameAccount(row);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.stopPropagation();
                setLabelDrafts((current) => ({ ...current, [row.id]: row.displayName }));
                setRenamingId(null);
              }
            }}
          />
        </li>
      );
    }
    return (
      <SettingRow
        key={row.id}
        title={row.displayName}
        description={
          row.status === "pending" ? <Trans>Waiting for sign-in.</Trans> : <Trans>Signed in.</Trans>
        }
        revealControl
        control={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Rename ${row.displayName}`}
              onClick={() => setRenamingId(row.id)}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Remove ${row.displayName}`}
              disabled={pending === row.id || uninstalling}
              onClick={() => void revokeAccount(row, item)}
            >
              <Trash />
            </Button>
          </>
        }
      />
    );
  }

  function renderDetail(item: ConnectionCatalogItem) {
    const accounts = activeAccounts(connections, item);
    const key = itemKey(item);
    const connecting = pending === key;
    const uninstalling = pending === `uninstall:${key}`;
    const shownTools = allToolsShown ? tools : tools.slice(0, TOOL_PREVIEW_COUNT);

    return (
      <div data-testid="connection-detail" className="space-y-8">
        <section data-testid="connection-accounts">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground/75">
              <Trans>Accounts</Trans>
            </h3>
            <Button
              variant="outline"
              size="sm"
              disabled={connecting || uninstalling}
              onClick={() => void connect(item)}
            >
              <Plus />
              {connecting ? <Trans>Adding…</Trans> : <Trans>Add another</Trans>}
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {accounts.map((row) => renderAccount(row, item, uninstalling))}
          </ul>
        </section>

        <section data-testid="connection-tools">
          <h3 className="mb-2 text-sm font-medium text-foreground/75">
            {toolsLoading ? (
              <Trans>Tools</Trans>
            ) : (
              <Plural value={tools.length} one="# tool" other="# tools" />
            )}
          </h3>
          {toolsLoading ? (
            <p className="text-sm text-muted-foreground">
              <Trans>Loading tools…</Trans>
            </p>
          ) : tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No tools available.</Trans>
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {shownTools.map((tool) => (
                  <SettingRow
                    key={tool.name}
                    title={humanizeToolName(tool.name)}
                    description={tool.description}
                  />
                ))}
              </ul>
              {tools.length > TOOL_PREVIEW_COUNT ? (
                <Button
                  variant="text"
                  size="sm"
                  className="mt-2"
                  onClick={() => setAllToolsShown((shown) => !shown)}
                >
                  {allToolsShown ? (
                    <Trans>Show fewer</Trans>
                  ) : (
                    <Trans>Show all {tools.length}</Trans>
                  )}
                </Button>
              ) : null}
            </>
          )}
        </section>

        <Button
          variant="destructive"
          disabled={uninstalling || connecting}
          onClick={() => void uninstall(item)}
        >
          {uninstalling ? <Trans>Removing…</Trans> : <Trans>Remove app</Trans>}
        </Button>
      </div>
    );
  }

  const heading: { title: string; description?: string; icon?: ReactNode; onBack?: () => void } =
    view === "server"
      ? {
          title: t`Catalog settings`,
          onBack: () => setView("list"),
        }
      : view === "add"
        ? {
            title: t`Add a server`,
            onBack: () => setView("list"),
          }
        : serverDetail
          ? {
              title: serverDetail.name,
              description: serverDetail.endpoint ?? t`MCP server`,
              icon: <AppIcon name={serverDetail.name} />,
              onBack: () => openServer(null),
            }
          : detailItem
            ? {
                title: detailItem.name,
                icon: <AppIcon name={detailItem.name} logo={detailItem.logo} />,
                onBack: closeDetail,
              }
            : { title: t`Apps` };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[760px] max-h-[calc(100%-2rem)] w-[576px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[576px]"
      >
        <DialogPageHeader
          title={heading.title}
          description={heading.description}
          icon={heading.icon}
          onBack={heading.onBack}
          closeLabel={t`Close apps`}
        />

        {view === "server" ? (
          <div className="rk-scroll flex-1 overflow-y-auto px-6 pb-6 sm:px-8">
            <IntegrationSetup
              serverSetup
              managedOnly
              layout="page"
              onSaved={() => {
                setView("list");
                refreshAfterSetup();
              }}
            />
          </div>
        ) : null}

        {view === "add" ? (
          <div className="rk-scroll flex-1 overflow-y-auto px-6 pb-6 sm:px-8">
            <AddIntegration
              activeBotId={activeBotId}
              connectedEndpoints={mcpServers.flatMap((server) =>
                server.endpoint ? [server.endpoint] : [],
              )}
              onAdded={() => {
                setView("list");
                refreshAfterSetup();
              }}
              onCancel={() => setView("list")}
            />
          </div>
        ) : null}

        <div
          id="integration-list"
          hidden={view !== "list"}
          className="rk-scroll flex-1 overflow-y-auto px-6 pb-6 sm:px-8"
        >
          {catalogError ? <p className="mb-4 text-sm text-destructive">{catalogError}</p> : null}
          {sourceError ? <p className="mb-4 text-sm text-destructive">{sourceError}</p> : null}

          {detailItem ? (
            renderDetail(detailItem)
          ) : serverDetail ? (
            renderServerDetail(serverDetail)
          ) : loading ? (
            <div role="status" className="grid h-full place-items-center">
              <Loader />
            </div>
          ) : (
            <>
              {renderConnected()}
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground/75">
                  <Trans>Catalog</Trans>
                </h3>
                {isDeploymentOwner ? (
                  <Button variant="text" size="sm" onClick={() => setView("server")}>
                    <Settings />
                    <Trans>Settings</Trans>
                  </Button>
                ) : null}
              </div>
              {catalog.length > 0 ? (
                <Input
                  className="mb-4"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setVisibleCount(CONNECTION_CATALOG_PAGE_SIZE);
                  }}
                  aria-label={t`Search the catalog`}
                  placeholder={t`Search the catalog`}
                />
              ) : null}

              {showFeatured && catalog.length === 0 ? (
                isDeploymentOwner ? (
                  <p className="text-[13.5px] leading-6 text-muted-foreground/80">
                    <Trans>Set up Composio or Pipedream to bring their apps here.</Trans>
                  </p>
                ) : (
                  <p className="text-[13.5px] leading-6 text-muted-foreground/80">
                    <Trans>
                      Ask the server owner to set up Composio or Pipedream to connect apps.
                    </Trans>
                  </p>
                )
              ) : null}

              {catalog.length === 0 && !showFeatured ? (
                <p className="text-muted-foreground/80">
                  <Trans>No managed app catalog is configured on this deployment.</Trans>
                </p>
              ) : null}
              {catalog.length > 0 && visible.length === 0 && !showFeatured ? (
                <p className="text-muted-foreground/80">
                  <Trans>No apps match your search.</Trans>
                </p>
              ) : null}
              {/* One grid: the featured apps lead, the rest of the catalog follows. */}
              {catalog.length > 0 && (showFeatured || visible.length > 0) ? (
                <div
                  className="grid grid-cols-2 gap-2"
                  data-testid={showFeatured ? "featured-connectors" : undefined}
                >
                  {showFeatured ? featuredTiles.map(renderFeaturedTile) : null}
                  {rendered.map((item) =>
                    renderCatalogTile(item, item.name, item.logo, {
                      // Avoid duplicate connection-tile-* ids while featured is also shown.
                      tileTestId: !showFeatured,
                    }),
                  )}
                </div>
              ) : null}
              {rendered.length < visible.length ? (
                <div className="mt-4 flex justify-center">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setVisibleCount((count) => count + CONNECTION_CATALOG_PAGE_SIZE)}
                  >
                    <Trans>Show more</Trans>
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
