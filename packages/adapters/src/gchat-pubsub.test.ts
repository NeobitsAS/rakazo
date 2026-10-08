import type { MessagingInboundEvent } from "@rakazo/adapter-kit";
import { JWT } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatSdkMessagingSurface } from "./chat-sdk-surface.js";
import { GoogleChatPubSubAdapter } from "./gchat-pubsub.js";

const SUBSCRIPTION = "projects/rakazo-test/subscriptions/chat-events";

type FakeRequest = { url?: string | URL; data?: unknown; signal?: AbortSignal };

function chatEvent(space: Record<string, unknown>, text: string) {
  return {
    chat: {
      messagePayload: {
        space,
        message: {
          name: `${space.name}/messages/M1`,
          sender: { name: "users/42", displayName: "Ada", type: "HUMAN" },
          text,
          createTime: "2026-10-08T10:00:00Z",
          thread: { name: `${space.name}/threads/T1` },
        },
      },
    },
  };
}

const directMessage = chatEvent(
  { name: "spaces/DM1", type: "DM", spaceType: "DIRECT_MESSAGE" },
  "hello",
);
const spaceMention = chatEvent({ name: "spaces/ROOM1", type: "ROOM", spaceType: "SPACE" }, "hi");

function encode(event: unknown): string {
  return Buffer.from(JSON.stringify(event)).toString("base64");
}

/**
 * A JWT whose Pub/Sub calls are served from `batches`: each pull takes the
 * next batch, and once they run out a pull waits until it is aborted, as an
 * idle subscription's pull does.
 */
function fakeClient(batches: { ackId: string; data?: string }[][]) {
  const client = new JWT({ email: "rakazo@rakazo-test.iam.gserviceaccount.com", key: "unused" });
  const acks: string[][] = [];
  const pulls = vi.fn();
  const request = async ({ url, data, signal }: FakeRequest) => {
    if (String(url) === `https://pubsub.googleapis.com/v1/${SUBSCRIPTION}:acknowledge`) {
      acks.push((data as { ackIds: string[] }).ackIds);
      return { data: {} };
    }
    pulls();
    const batch = batches.shift();
    if (batch) {
      return {
        data: { receivedMessages: batch.map(({ ackId, data }) => ({ ackId, message: { data } })) },
      };
    }
    return new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  };
  vi.spyOn(client, "request").mockImplementation(request as unknown as JWT["request"]);
  return { client, acks, pulls };
}

function surfaceFor(client: JWT, poll: boolean) {
  const surface = new ChatSdkMessagingSurface([
    {
      provider: "gchat",
      capabilities: { direct: true, groups: false, typing: false },
      adapter: new GoogleChatPubSubAdapter({
        subscription: SUBSCRIPTION,
        auth: client,
        botUserId: undefined,
        poll,
      }),
    },
  ]);
  const inbound: MessagingInboundEvent[] = [];
  surface.onInbound(async (event) => {
    inbound.push(event);
  });
  return { surface, inbound };
}

describe("GoogleChatPubSubAdapter", () => {
  let shutdown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await shutdown?.();
    shutdown = undefined;
  });

  it("delivers a pulled direct message, then acknowledges it", async () => {
    const { client, acks } = fakeClient([[{ ackId: "ack-1", data: encode(directMessage) }]]);
    const { surface, inbound } = surfaceFor(client, true);
    shutdown = () => surface.shutdown();

    await surface.initialize();

    await vi.waitFor(() => expect(acks).toEqual([["ack-1"]]));
    expect(inbound).toEqual([
      expect.objectContaining({
        provider: "gchat",
        isDirect: true,
        from: "users/42",
        content: "hello",
        handle: "spaces/DM1/messages/M1",
      }),
    ]);
  });

  it("acknowledges events it does not deliver", async () => {
    const { client, acks } = fakeClient([
      [
        { ackId: "mention", data: encode(spaceMention) },
        { ackId: "added", data: encode({ chat: { addedToSpacePayload: { space: {} } } }) },
        { ackId: "garbage", data: "bm90IGpzb24=" },
        { ackId: "empty" },
      ],
    ]);
    const { surface, inbound } = surfaceFor(client, true);
    shutdown = () => surface.shutdown();

    await surface.initialize();

    await vi.waitFor(() => expect(acks).toEqual([["mention", "added", "garbage", "empty"]]));
    expect(inbound).toEqual([]);
  });

  it("does not pull in a process that only sends", async () => {
    const { client, pulls } = fakeClient([[{ ackId: "ack-1", data: encode(directMessage) }]]);
    const { surface } = surfaceFor(client, false);
    shutdown = () => surface.shutdown();

    await surface.initialize();

    expect(pulls).not.toHaveBeenCalled();
  });

  it("refuses events over HTTP", async () => {
    const { client } = fakeClient([]);
    const { surface } = surfaceFor(client, false);
    const request = new Request("http://127.0.0.1/api/v1/messaging/webhook/gchat", {
      method: "POST",
      body: JSON.stringify(directMessage),
    });

    const response = await surface.handleWebhook("gchat", request);

    expect(response?.status).toBe(404);
  });
});
