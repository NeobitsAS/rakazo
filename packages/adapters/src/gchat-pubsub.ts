import { setTimeout as delay } from "node:timers/promises";
import { GoogleChatAdapter, type GoogleChatEvent } from "@chat-adapter/gchat";
import { getLogger } from "@rakazo/logging";
import type { ChatInstance } from "chat";
import { z } from "zod";
import type { GoogleChatAuthClient } from "./gchat-auth.js";

const PUBSUB_API_URL = "https://pubsub.googleapis.com/v1";
const PULL_MAX_MESSAGES = 10;
const PULL_RETRY_MIN_MS = 1_000;
const PULL_RETRY_MAX_MS = 60_000;

const pullResponseSchema = z.object({
  receivedMessages: z
    .array(z.object({ ackId: z.string(), message: z.object({ data: z.string().optional() }) }))
    .optional(),
});

export interface GoogleChatPubSubAdapterOptions {
  /** Pull subscription on the Chat app's topic: projects/<project>/subscriptions/<subscription>. */
  subscription: string;
  auth: GoogleChatAuthClient;
  /** The app's own users/<id>, for exact self-message detection. */
  botUserId: string | undefined;
  /**
   * Pull only in the process that registers the inbound sink: a second
   * puller would take messages from it and drop them (see
   * messagingPlatformsFromEnv).
   */
  poll: boolean;
}

/**
 * Google Chat app on the "Cloud Pub/Sub" connection setting. Chat publishes
 * each interaction event to a topic and this adapter pulls them from a
 * subscription, so the deployment needs no public endpoint: every call goes
 * out to Google. Replies go through the Chat API like the webhook adapter's.
 */
export class GoogleChatPubSubAdapter extends GoogleChatAdapter {
  private readonly subscription: string;
  private readonly client: GoogleChatAuthClient;
  private readonly poll: boolean;
  private pulling: { controller: AbortController; loop: Promise<void> } | null = null;

  constructor(options: GoogleChatPubSubAdapterOptions) {
    // Nothing is accepted over HTTP (handleWebhook below), so there is no
    // webhook token to verify: access to the subscription is the boundary.
    super({
      auth: options.auth,
      ...(options.botUserId ? { botUserId: options.botUserId } : {}),
      disableSignatureVerification: true,
    });
    this.subscription = options.subscription;
    this.client = options.auth;
    this.poll = options.poll;
  }

  override async initialize(chat: ChatInstance): Promise<void> {
    await super.initialize(chat);
    if (!this.poll || this.pulling) return;
    const controller = new AbortController();
    this.pulling = { controller, loop: this.pullLoop(controller.signal) };
  }

  /** Called by ChatSdkMessagingSurface on shutdown and on a failed initialize. */
  async stopPolling(): Promise<void> {
    const pulling = this.pulling;
    this.pulling = null;
    if (!pulling) return;
    pulling.controller.abort();
    await pulling.loop;
  }

  override async handleWebhook(): Promise<Response> {
    return new Response("Google Chat events arrive through Pub/Sub", { status: 404 });
  }

  private async pullLoop(signal: AbortSignal): Promise<void> {
    let retryMs = PULL_RETRY_MIN_MS;
    while (!signal.aborted) {
      try {
        await this.pullOnce(signal);
        retryMs = PULL_RETRY_MIN_MS;
      } catch (error) {
        if (signal.aborted) return;
        getLogger().error("google chat pub/sub pull failed", error);
        await delay(retryMs, undefined, { signal }).catch(() => undefined);
        retryMs = Math.min(retryMs * 2, PULL_RETRY_MAX_MS);
      }
    }
  }

  private async pullOnce(signal: AbortSignal): Promise<void> {
    const response = await this.client.request({
      url: `${PUBSUB_API_URL}/${this.subscription}:pull`,
      method: "POST",
      data: { maxMessages: PULL_MAX_MESSAGES },
      signal,
    });
    const received = pullResponseSchema.parse(response.data).receivedMessages ?? [];
    if (received.length === 0) return;
    // In order, so two quick messages in a conversation keep their order.
    for (const { message } of received) await this.dispatch(message.data);
    // Not aborted with the loop: once handled, a message is acknowledged. One
    // that is redelivered anyway is deduplicated by its handle downstream.
    await this.client.request({
      url: `${PUBSUB_API_URL}/${this.subscription}:acknowledge`,
      method: "POST",
      data: { ackIds: received.map((entry) => entry.ackId) },
    });
  }

  /**
   * Only messages need handling: 1:1 chats, and @-mentions in spaces, which
   * the surface drops while groups are unsupported. Anything unparseable is
   * acknowledged too, since a redelivery cannot fix it.
   */
  private async dispatch(data: string | undefined): Promise<void> {
    const event = parseMessageEvent(data);
    if (!event) return;
    const pending: Promise<unknown>[] = [];
    this.handleMessageEvent(event, { waitUntil: (task) => pending.push(task) });
    await Promise.allSettled(pending);
  }
}

function parseMessageEvent(data: string | undefined): GoogleChatEvent | null {
  if (!data) return null;
  try {
    const event: unknown = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    return isMessageEvent(event) ? event : null;
  } catch {
    return null;
  }
}

/** The Workspace add-on event shape GoogleChatAdapter.handleMessageEvent reads. */
function isMessageEvent(value: unknown): value is GoogleChatEvent {
  const payload = asRecord(asRecord(asRecord(value)?.chat)?.messagePayload);
  const space = asRecord(payload?.space);
  const message = asRecord(payload?.message);
  return (
    typeof space?.name === "string" &&
    typeof message?.name === "string" &&
    asRecord(message.sender) !== null
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
