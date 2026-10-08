import { Domain } from "chat-adapter-lark";
import { describe, expect, it, vi } from "vitest";
import {
  enrichSlackTeamRoom,
  isMessagingEnabled,
  isMessagingSurfaceEnabled,
  type MessagingEnvironmentValues,
  messagingEnvFromProcess,
  messagingPlatformsFromEnv,
  parseSendblueStatus,
} from "./messaging-platforms.js";

// Fake credentials: adapters are constructed offline, never called.
const fullEnv: MessagingEnvironmentValues = {
  sendblueApiKeyId: "sb-key-id",
  sendblueApiSecret: "sb-secret",
  sendblueSigningSecret: "sb-signing",
  sendbluePhoneNumber: "+15550009999",
  slackBotToken: "xoxb-fake",
  slackSigningSecret: "slack-signing",
  whatsappAccessToken: "wa-token",
  whatsappPhoneNumberId: "wa-phone-id",
  whatsappAppSecret: "wa-app-secret",
  whatsappVerifyToken: "wa-verify",
  telegramBotToken: "tg-token",
  telegramWebhookSecret: "tg-webhook-secret",
  larkAppId: "cli-fake",
  larkAppSecret: "lark-secret",
  larkVerificationToken: "lark-verify",
  googleChatSubscription: "projects/rakazo-test/subscriptions/chat-events",
  googleChatWorkloadIdentityProvider:
    "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/rakazo/providers/aws",
  googleChatServiceAccount: "rakazo-chat@rakazo-test.iam.gserviceaccount.com",
  awsRegion: "eu-west-1",
};

const googleChatKey = JSON.stringify({
  client_email: "rakazo-chat@rakazo-test.iam.gserviceaccount.com",
  private_key: "unused",
});

function providers(env: MessagingEnvironmentValues): string[] {
  return messagingPlatformsFromEnv(env).map((platform) => platform.provider);
}

describe("messagingPlatformsFromEnv", () => {
  it("mounts nothing without credentials and everything with full credentials", () => {
    expect(providers({})).toEqual([]);
    expect(providers(fullEnv)).toEqual([
      "sendblue",
      "slack",
      "whatsapp",
      "telegram",
      "lark",
      "gchat",
    ]);
  });

  it("requires all four sendblue values", () => {
    for (const key of [
      "sendblueApiKeyId",
      "sendblueApiSecret",
      "sendblueSigningSecret",
      "sendbluePhoneNumber",
    ] as const) {
      expect(providers({ ...fullEnv, [key]: undefined })).not.toContain("sendblue");
    }
  });

  it("requires each platform's full credential set", () => {
    expect(providers({ ...fullEnv, slackSigningSecret: undefined })).not.toContain("slack");
    expect(providers({ ...fullEnv, slackBotToken: undefined })).not.toContain("slack");
    for (const key of [
      "whatsappAccessToken",
      "whatsappPhoneNumberId",
      "whatsappAppSecret",
      "whatsappVerifyToken",
    ] as const) {
      expect(providers({ ...fullEnv, [key]: undefined })).not.toContain("whatsapp");
    }
    expect(providers({ ...fullEnv, telegramBotToken: undefined })).not.toContain("telegram");
    // Without the secret token the adapter would accept unsigned webhook
    // posts, so the secret is a mount gate, not optional hardening.
    expect(providers({ ...fullEnv, telegramWebhookSecret: undefined })).not.toContain("telegram");
    expect(providers({ telegramBotToken: "tg-token" })).toEqual([]);
    expect(
      providers({ telegramBotToken: "tg-token", telegramWebhookSecret: "tg-webhook-secret" }),
    ).toEqual(["telegram"]);
    expect(providers({ ...fullEnv, larkAppId: undefined })).not.toContain("lark");
    expect(providers({ ...fullEnv, larkAppSecret: undefined })).not.toContain("lark");
    // Without the verification token the adapter would accept unsigned
    // webhook posts, so the token is a mount gate, not optional hardening.
    expect(providers({ ...fullEnv, larkVerificationToken: undefined })).not.toContain("lark");
    expect(providers({ larkAppId: "cli-fake", larkAppSecret: "lark-secret" })).toEqual([]);
    expect(
      providers({
        larkAppId: "cli-fake",
        larkAppSecret: "lark-secret",
        larkVerificationToken: "lark-verify",
      }),
    ).toEqual(["lark"]);
  });

  it("mounts Google Chat with a subscription and either kind of credentials", () => {
    const keyless = {
      googleChatSubscription: fullEnv.googleChatSubscription,
      googleChatWorkloadIdentityProvider: fullEnv.googleChatWorkloadIdentityProvider,
      googleChatServiceAccount: fullEnv.googleChatServiceAccount,
      awsRegion: fullEnv.awsRegion,
    };
    expect(providers(keyless)).toEqual(["gchat"]);
    for (const key of Object.keys(keyless)) {
      expect(providers({ ...keyless, [key]: undefined })).toEqual([]);
    }
    expect(
      providers({
        googleChatSubscription: fullEnv.googleChatSubscription,
        googleChatCredentials: googleChatKey,
      }),
    ).toEqual(["gchat"]);
  });

  it("pulls Google Chat events only when asked to poll inbound messages", () => {
    const poll = (options?: { pollInboundMessages: boolean }) =>
      (
        messagingPlatformsFromEnv(fullEnv, options).find(
          (platform) => platform.provider === "gchat",
        )!.adapter as unknown as { poll: boolean }
      ).poll;
    expect(poll()).toBe(false);
    expect(poll({ pollInboundMessages: true })).toBe(true);
  });

  it("maps GOOGLE_CHAT_* process env", () => {
    expect(
      messagingEnvFromProcess({
        GOOGLE_CHAT_PUBSUB_SUBSCRIPTION: " projects/p/subscriptions/s ",
        GOOGLE_CHAT_CREDENTIALS: " {} ",
        GOOGLE_CHAT_WORKLOAD_IDENTITY_PROVIDER: " //iam.googleapis.com/provider ",
        GOOGLE_CHAT_SERVICE_ACCOUNT: " sa@p.iam.gserviceaccount.com ",
        GOOGLE_CHAT_BOT_USER_ID: " users/1 ",
        AWS_REGION: " eu-west-1 ",
      }),
    ).toMatchObject({
      googleChatSubscription: "projects/p/subscriptions/s",
      googleChatCredentials: "{}",
      googleChatWorkloadIdentityProvider: "//iam.googleapis.com/provider",
      googleChatServiceAccount: "sa@p.iam.gserviceaccount.com",
      googleChatBotUserId: "users/1",
      awsRegion: "eu-west-1",
    });
  });

  it("forces Telegram into webhook mode so worker initialize cannot long-poll", () => {
    const telegram = messagingPlatformsFromEnv({
      telegramBotToken: "tg-token",
      telegramWebhookSecret: "tg-webhook-secret",
    })[0]!;
    // mode is protected on the adapter class but readable at runtime.
    expect((telegram.adapter as unknown as { mode: string }).mode).toBe("webhook");
  });

  it("forces Lark into webhook inbound so worker initialize cannot open a long connection", () => {
    const lark = messagingPlatformsFromEnv({
      larkAppId: "cli-fake",
      larkAppSecret: "lark-secret",
      larkVerificationToken: "lark-verify",
    })[0]!;
    const incoming = lark.adapter as unknown as {
      incomingConfig: { events: string; callbacks: string };
      shouldStartWsClient: () => boolean;
    };
    expect(incoming.incomingConfig).toEqual({ events: "webhook", callbacks: "webhook" });
    expect(incoming.shouldStartWsClient()).toBe(false);
  });

  it("maps LARK_* process env and accepts the international domain switch", () => {
    expect(
      messagingEnvFromProcess({
        LARK_APP_ID: " cli-fake ",
        LARK_APP_SECRET: " lark-secret ",
        LARK_VERIFICATION_TOKEN: " lark-verify ",
        LARK_ENCRYPT_KEY: " lark-encrypt ",
        LARK_DOMAIN: " Lark ",
      }),
    ).toMatchObject({
      larkAppId: "cli-fake",
      larkAppSecret: "lark-secret",
      larkVerificationToken: "lark-verify",
      larkEncryptKey: "lark-encrypt",
      larkDomain: "Lark",
    });
    const international = messagingPlatformsFromEnv({
      larkAppId: "cli-fake",
      larkAppSecret: "lark-secret",
      larkVerificationToken: "lark-verify",
      larkDomain: "Lark",
    })[0]!;
    expect((international.adapter as unknown as { config: { domain: Domain } }).config.domain).toBe(
      Domain.Lark,
    );
  });

  it.each(["", "unknown", "feishu"])("uses normalized Lark defaults for domain %s", (domain) => {
    vi.stubEnv("LARK_DOMAIN", domain);
    vi.stubEnv("LARK_ENCRYPT_KEY", "   ");
    try {
      const lark = messagingPlatformsFromEnv({
        ...messagingEnvFromProcess(process.env),
        larkAppId: "cli-fake",
        larkAppSecret: "lark-secret",
        larkVerificationToken: "lark-verify",
      }).find((platform) => platform.provider === "lark")!;
      const config = (
        lark.adapter as unknown as {
          config: { domain: Domain; encryptKey: string };
        }
      ).config;
      expect(config.domain).toBe(Domain.Feishu);
      expect(config.encryptKey).toBe("");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("declares group and typing support only for sendblue", () => {
    const platforms = messagingPlatformsFromEnv(fullEnv);
    const capabilities = Object.fromEntries(
      platforms.map((platform) => [platform.provider, platform.capabilities]),
    );
    expect(capabilities.sendblue).toEqual({ direct: true, groups: true, typing: true });
    expect(capabilities.slack).toEqual({ direct: true, groups: true, typing: false });
    expect(capabilities.whatsapp).toEqual({ direct: true, groups: false, typing: false });
    expect(capabilities.telegram).toEqual({ direct: true, groups: false, typing: false });
    expect(capabilities.lark).toEqual({ direct: true, groups: false, typing: false });
    expect(capabilities.gchat).toEqual({ direct: true, groups: false, typing: false });
  });
});

describe("sendblue platform hooks", () => {
  const sendblue = messagingPlatformsFromEnv(fullEnv)[0]!;

  it("filters the deployment line and non-string entries out of the roster", () => {
    expect(
      sendblue.participants!({
        participants: ["+15551111111", "+15550009999", 42, null, "+15552222222"],
      }),
    ).toEqual(["+15551111111", "+15552222222"]);
    expect(sendblue.participants!({ participants: "not-a-list" })).toEqual([]);
    expect(sendblue.participants!(null)).toEqual([]);
  });

  it("reads the group display name only when present", () => {
    expect(sendblue.channelName!({ group_display_name: "Family" })).toBe("Family");
    expect(sendblue.channelName!({ group_display_name: "" })).toBeNull();
    expect(sendblue.channelName!({})).toBeNull();
    expect(sendblue.channelName!(null)).toBeNull();
  });

  it("accepts only supported per-message transports", () => {
    for (const service of ["iMessage", "SMS", "RCS"]) {
      expect(sendblue.transport!({ service })).toBe(service);
    }
    expect(sendblue.transport!({ service: "email" })).toBeNull();
    expect(sendblue.transport!({ service: 42 })).toBeNull();
    expect(sendblue.transport!(null)).toBeNull();
  });

  it("derives deterministic provider-prefixed direct thread ids", () => {
    expect(sendblue.directThreadId!("+15551234567")).toMatch(/^sendblue:/);
    expect(sendblue.adapter.isDM?.(sendblue.directThreadId!("+15551234567"))).toBe(true);
  });
});

describe("parseSendblueStatus", () => {
  const statusPayload = {
    content: "",
    is_outbound: true,
    status: "DELIVERED",
    message_handle: "handle-1",
    from_number: "+15550009999",
  };

  it("normalizes outbound delivery webhooks", () => {
    expect(parseSendblueStatus(statusPayload)).toEqual({
      type: "status",
      provider: "sendblue",
      handle: "handle-1",
      status: "DELIVERED",
    });
    expect(parseSendblueStatus({ ...statusPayload, status: 7 })).toEqual(
      expect.objectContaining({ status: "" }),
    );
  });

  it("ignores inbound and malformed payloads", () => {
    expect(parseSendblueStatus({ ...statusPayload, is_outbound: false })).toBeNull();
    expect(parseSendblueStatus({ ...statusPayload, message_handle: "" })).toBeNull();
    const { message_handle: _dropped, ...withoutHandle } = statusPayload;
    expect(parseSendblueStatus(withoutHandle)).toBeNull();
    expect(parseSendblueStatus(null)).toBeNull();
    expect(parseSendblueStatus("nope")).toBeNull();
  });
});

describe("isMessagingEnabled", () => {
  it("requires at least one platform", () => {
    vi.stubEnv("VITEST", "");
    expect(isMessagingEnabled(messagingPlatformsFromEnv(fullEnv))).toBe(true);
    expect(isMessagingEnabled([])).toBe(false);
    vi.unstubAllEnvs();
  });

  it("is disabled under vitest even with platforms configured", () => {
    expect(process.env.VITEST).toBeTruthy();
    expect(isMessagingEnabled(messagingPlatformsFromEnv(fullEnv))).toBe(false);
  });

  it.each(["0", "false"])("does not treat VITEST=%s as an active test runner", (value) => {
    vi.stubEnv("VITEST", value);
    expect(isMessagingEnabled(messagingPlatformsFromEnv(fullEnv))).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("isMessagingSurfaceEnabled", () => {
  it("requires a configured deployment model only for open signup", () => {
    vi.stubEnv("VITEST", "");
    const platforms = messagingPlatformsFromEnv(fullEnv);
    const options = (deploymentModelConfigured: boolean, openSignup: boolean) => ({
      deploymentModelConfigured,
      openSignup,
    });
    // Open signup provisions users with no credentials of their own.
    expect(isMessagingSurfaceEnabled(platforms, options(true, true))).toBe(true);
    expect(isMessagingSurfaceEnabled(platforms, options(false, true))).toBe(false);
    // Linking-only deployments run linked users on their own credentials.
    expect(isMessagingSurfaceEnabled(platforms, options(false, false))).toBe(true);
    expect(isMessagingSurfaceEnabled([], options(true, true))).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("enrichSlackTeamRoom", () => {
  const base = {
    type: "message" as const,
    provider: "slack",
    handle: "Ev1",
    threadId: "slack:C1",
    isDirect: false,
    from: "U_OTHER",
    fromLabel: "Ada",
    channelName: "launch",
    participants: ["U_OTHER"],
    content: "hello <@U_SOMEONE>",
    mediaUrl: null,
  };

  it("marks app_mention events as mention", () => {
    const enrichment = enrichSlackTeamRoom(
      {
        team_id: "T1",
        authorizations: [{ user_id: "U_BOT", is_bot: true }],
        event: { type: "app_mention", channel: "C1", text: "<@U_BOT> ship it", user: "U_OTHER" },
      },
      base,
    );
    expect(enrichment.kind).toBe("mention");
    expect(enrichment.workspaceId).toBe("T1");
    expect(enrichment.conversationKey).toBe("C1");
  });

  it("keeps ambient when another user is mentioned, not the bot", () => {
    const enrichment = enrichSlackTeamRoom(
      {
        team_id: "T1",
        authorizations: [{ user_id: "U_BOT", is_bot: true }],
        event: {
          type: "message",
          channel: "C1",
          text: "hey <@U_SOMEONE> can you look?",
          user: "U_OTHER",
        },
      },
      base,
    );
    expect(enrichment.kind).toBe("ambient");
  });

  it("marks message events that mention the authorized bot as mention", () => {
    const enrichment = enrichSlackTeamRoom(
      {
        team_id: "T1",
        authorizations: [{ user_id: "U_BOT", is_bot: true }],
        event: {
          type: "message",
          channel: "C1",
          text: "hey <@U_BOT> ship Friday?",
          user: "U_OTHER",
        },
      },
      base,
    );
    expect(enrichment.kind).toBe("mention");
  });
});
