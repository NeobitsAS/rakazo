import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyCheckFailure,
  ServerCredentialCheck,
  type ServerCredentialSetup,
  type ServerCredentialStatus,
  serverCredentialSetup,
} from "./server-credentials.js";

const OPTED_IN = {
  PI_DEFAULT_CREDENTIALS: "host",
  PI_DEFAULT_PROVIDER: "amazon-bedrock",
  PI_DEFAULT_MODEL: "eu.anthropic.claude-opus-5-5",
};

const SETUP: ServerCredentialSetup = {
  provider: "amazon-bedrock",
  model: "eu.anthropic.claude-opus-5-5",
  source: "AWS IAM",
};

function bedrockFailure(errorCode: string, errorMessage = `${errorCode}: failed`) {
  return {
    errorMessage,
    diagnostics: [
      { type: "bedrock_response_failure", timestamp: 0, details: { status: 400, errorCode } },
    ],
  };
}

describe("serverCredentialSetup", () => {
  it("reads the operator's opt-in to server credentials", () => {
    expect(serverCredentialSetup(OPTED_IN)).toEqual(SETUP);
  });

  it("is null without the opt-in, a model, or a provider that can use host credentials", () => {
    expect(serverCredentialSetup({ ...OPTED_IN, PI_DEFAULT_CREDENTIALS: "" })).toBeNull();
    expect(serverCredentialSetup({ ...OPTED_IN, PI_DEFAULT_MODEL: "" })).toBeNull();
    expect(serverCredentialSetup({ ...OPTED_IN, PI_DEFAULT_PROVIDER: "openrouter" })).toBeNull();
  });
});

describe("classifyCheckFailure", () => {
  it("tells credentials that don't work from a model they may not use", () => {
    expect(classifyCheckFailure(bedrockFailure("UnrecognizedClientException"))).toBe("missing");
    expect(classifyCheckFailure(bedrockFailure("ExpiredTokenException"))).toBe("missing");
    expect(classifyCheckFailure(bedrockFailure("AccessDeniedException"))).toBe("denied");
    expect(classifyCheckFailure(bedrockFailure("ResourceNotFoundException"))).toBe("unavailable");
    expect(
      classifyCheckFailure(
        bedrockFailure(
          "ValidationException",
          "Validation error: The provided model identifier is invalid.",
        ),
      ),
    ).toBe("unavailable");
  });

  it("reports no credentials when the AWS SDK found none", () => {
    expect(
      classifyCheckFailure({ errorMessage: "Could not load credentials from any providers" }),
    ).toBe("missing");
  });

  it("leaves anything transient or unknown unchecked", () => {
    expect(classifyCheckFailure(bedrockFailure("ThrottlingException"))).toBe("unchecked");
    expect(classifyCheckFailure(bedrockFailure("ValidationException", "Too many tokens"))).toBe(
      "unchecked",
    );
    expect(classifyCheckFailure({ errorMessage: "socket hang up" })).toBe("unchecked");
  });
});

describe("ServerCredentialCheck", () => {
  beforeEach(() => {
    // Pi finds Bedrock credentials on the host through any of these; a task role is enough.
    vi.stubEnv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "/v2/credentials/test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("has no state when the deployment default doesn't use server credentials", async () => {
    const check = new ServerCredentialCheck(null, vi.fn());

    expect(check.state()).toBeNull();
    await expect(check.refresh()).resolves.toBeNull();
  });

  it("starts unchecked, then reports what a check shows", async () => {
    const check = new ServerCredentialCheck(SETUP, async () => "denied");

    expect(check.state()).toEqual({ ...SETUP, status: "unchecked" });
    expect(check.failed()).toBe(false);
    await expect(check.refresh()).resolves.toEqual({ ...SETUP, status: "denied" });
    expect(check.failed()).toBe(true);
  });

  it("starts missing when the host has no credentials for the provider", () => {
    for (const name of [
      "AWS_PROFILE",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
    ]) {
      vi.stubEnv(name, "");
    }
    const check = new ServerCredentialCheck(SETUP, vi.fn());

    expect(check.state()?.status).toBe("missing");
    expect(check.failed()).toBe(true);
  });

  it("reuses a recent check and shares one that is running", async () => {
    let now = 0;
    let finish: (status: ServerCredentialStatus) => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<ServerCredentialStatus>((resolve) => {
          finish = resolve;
        }),
    );
    const check = new ServerCredentialCheck(SETUP, run, () => now);

    const first = check.refresh();
    const second = check.refresh();
    finish("ready");
    await Promise.all([first, second]);
    now = 10_000;
    await check.refresh();
    expect(run).toHaveBeenCalledTimes(1);

    now = 60_000;
    const third = check.refresh();
    finish("unavailable");
    await expect(third).resolves.toEqual({ ...SETUP, status: "unavailable" });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
