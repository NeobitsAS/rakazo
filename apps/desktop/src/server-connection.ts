import type { DesktopSetup, DesktopTunnel } from "@rakazo/contracts";
import type { BrowserWindow } from "electron";
import type { ConnectionStatus } from "./connection-pill.js";
import { ConnectionPill } from "./connection-pill.js";
import { desktop } from "./desktop-state.js";
import { t } from "./i18n.js";
import { ServerMonitor } from "./server-monitor.js";
import type { TunnelPhase, TunnelState } from "./tunnel.js";
import { TunnelSupervisor } from "./tunnel.js";

type ServerConnectionDeps = {
  /** True when the server answers, sent the setup's headers. */
  healthy: (serverUrl: string, headers: Record<string, string> | undefined) => Promise<boolean>;
  /** The app menu shows the tunnel's state, so it is rebuilt when that changes. */
  menuChanged: () => void;
};

const TUNNEL_CONNECTION_STATUS: Record<TunnelPhase, ConnectionStatus> = {
  starting: "reconnecting",
  "signing-in": "reconnecting",
  connected: "connected",
  failed: "lost",
  stopped: "hidden",
};

function sameTunnel(a: DesktopTunnel, b: DesktopTunnel) {
  return a.command === b.command && a.signInCommand === b.signInCommand;
}

export type ServerConnection = ReturnType<typeof createServerConnection>;

/**
 * Keeps the open server reachable and watched: through its tunnel when its setup has one, or
 * with a health monitor when it is reached directly. A pill over the app window shows when the
 * connection drops, with a way to reconnect.
 */
export function createServerConnection({ healthy, menuChanged }: ServerConnectionDeps) {
  /** The tunnel the open (or opening) server is reached through, if its setup has one. */
  let tunnel: { supervisor: TunnelSupervisor; serverUrl: string } | null = null;
  /** Watches the open (or opening) server when it is reached directly, without a tunnel. */
  let serverWatch: { monitor: ServerMonitor; serverUrl: string } | null = null;
  const pills = new WeakMap<BrowserWindow, ConnectionPill>();

  /**
   * Brings up what keeps a setup's server reachable and watched. Reuses what already serves it
   * and stops what it does not need. Resolves with null once the server answers through a
   * tunnel, or with why it could not.
   */
  async function connect(setup: DesktopSetup | null): Promise<string | null> {
    const wanted = setup?.mode === "existing" ? setup.tunnel : undefined;
    if (
      wanted !== undefined &&
      tunnel !== null &&
      tunnel.serverUrl === setup?.serverUrl &&
      sameTunnel(tunnel.supervisor.tunnel, wanted) &&
      tunnel.supervisor.state().phase === "connected"
    ) {
      return null;
    }
    if (
      wanted === undefined &&
      serverWatch !== null &&
      serverWatch.serverUrl === setup?.serverUrl
    ) {
      return null;
    }
    stop();
    showStatus(null, "hidden");
    if (setup === null) {
      menuChanged();
      return null;
    }
    const serverUrl = setup.serverUrl;
    if (wanted === undefined) {
      watchServer(serverUrl, setup.headers);
      menuChanged();
      return null;
    }
    const supervisor: TunnelSupervisor = new TunnelSupervisor({
      tunnel: wanted,
      healthy: () => healthy(serverUrl, setup.headers),
      onState: (state) => onTunnelState(supervisor, state),
    });
    tunnel = { supervisor, serverUrl };
    const error = await supervisor.connect();
    return error === null ? null : t("The tunnel did not connect. {detail}", { detail: error });
  }

  function watchServer(serverUrl: string, headers: Record<string, string> | undefined) {
    const monitor: ServerMonitor = new ServerMonitor({
      healthy: () => healthy(serverUrl, headers),
      onDropped: () => {
        if (serverWatch?.monitor !== monitor) return;
        showStatus(serverUrl, "lost");
      },
    });
    serverWatch = { monitor, serverUrl };
    monitor.start();
  }

  function onTunnelState(supervisor: TunnelSupervisor, state: TunnelState) {
    // A replaced tunnel can still report while it winds down.
    if (tunnel?.supervisor !== supervisor) return;
    menuChanged();
    showStatus(tunnel.serverUrl, TUNNEL_CONNECTION_STATUS[state.phase]);
  }

  /**
   * Shows a connection change in the pill over the app window, when the change is about the
   * server that window shows (setup can be trying another one). A null server hides any pill.
   */
  function showStatus(serverUrl: string | null, status: ConnectionStatus) {
    const win = desktop.mainWindow;
    if (win === null || win.isDestroyed()) return;
    if (serverUrl !== null && serverUrl !== desktop.currentTargetUrl) return;
    let pill = pills.get(win);
    if (pill === undefined) {
      if (status === "hidden") return;
      pill = new ConnectionPill(win, () => void reconnect());
      pills.set(win, pill);
    }
    pill.show(status);
  }

  /**
   * Tries the open server again, once: the pill's refresh button and the Reconnect menu item.
   * Nothing reconnects in the background; a failure leaves the pill on "Connection lost".
   */
  async function reconnect() {
    if (tunnel !== null) {
      // A fresh tunnel, with the sign-in command if the first attempt fails.
      tunnel.supervisor.stop();
      tunnel = null;
      await connect(desktop.currentSetup);
      return;
    }
    if (serverWatch === null) return;
    const { monitor, serverUrl } = serverWatch;
    showStatus(serverUrl, "reconnecting");
    const answered = await monitor.check();
    if (serverWatch?.monitor !== monitor) return;
    showStatus(serverUrl, answered ? "connected" : "lost");
  }

  function stop() {
    tunnel?.supervisor.stop();
    tunnel = null;
    serverWatch?.monitor.stop();
    serverWatch = null;
  }

  return {
    connect,
    reconnect,
    stop,
    /** Null when the open server is reached directly. */
    tunnelPhase: (): TunnelPhase | null => tunnel?.supervisor.state().phase ?? null,
  };
}
