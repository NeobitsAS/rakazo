import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostCredentialSource, resolveDeploymentModel } from "./deployment-model.js";

// Host credentials come from the process, so blank the ones a developer machine or CI
// host may carry; each case states its own.
const HOST_CREDENTIAL_ENV = [
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
];

describe("resolveDeploymentModel", () => {
  beforeEach(() => {
    for (const name of HOST_CREDENTIAL_ENV) vi.stubEnv(name, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pairs the deployment model key with the provider it belongs to", () => {
    const both = { OPENROUTER_API_KEY: "or-key", ANTHROPIC_API_KEY: "sk-ant-key" };
    expect(resolveDeploymentModel(both)).toEqual({
      provider: "openrouter",
      model: "openai/gpt-6-luna",
      key: "or-key",
      configured: true,
      hostCredentials: false,
    });
    // The whole point: switching the provider switches the key with it.
    expect(resolveDeploymentModel({ ...both, PI_DEFAULT_PROVIDER: "anthropic" })).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      key: "sk-ant-key",
      configured: true,
      hostCredentials: false,
    });
    // A provider with no key configured yields no key — never another vendor's.
    expect(
      resolveDeploymentModel({ OPENROUTER_API_KEY: "or-key", PI_DEFAULT_PROVIDER: "anthropic" }),
    ).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      key: undefined,
      configured: false,
      hostCredentials: false,
    });
  });

  it("runs a provider that authenticates from the host without a key", () => {
    vi.stubEnv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "/v2/credentials/example");
    const taskRole = {
      PI_DEFAULT_PROVIDER: "amazon-bedrock",
      PI_DEFAULT_MODEL: "eu.anthropic.claude-sonnet-5",
      PI_DEFAULT_CREDENTIALS: "host",
    };
    expect(resolveDeploymentModel(taskRole)).toEqual({
      provider: "amazon-bedrock",
      model: "eu.anthropic.claude-sonnet-5",
      key: undefined,
      configured: true,
      hostCredentials: true,
    });
  });

  it("leaves a deployment that did not opt in unchanged, even with host credentials", () => {
    vi.stubEnv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "/v2/credentials/example");
    const withoutOptIn = {
      PI_DEFAULT_PROVIDER: "amazon-bedrock",
      PI_DEFAULT_MODEL: "eu.anthropic.claude-sonnet-5",
    };
    expect(resolveDeploymentModel(withoutOptIn).configured).toBe(false);
    expect(
      resolveDeploymentModel({ ...withoutOptIn, PI_DEFAULT_CREDENTIALS: "true" }).configured,
    ).toBe(false);
  });

  it("needs both host credentials and an explicit model for a keyless provider", () => {
    const provider = { PI_DEFAULT_PROVIDER: "amazon-bedrock", PI_DEFAULT_CREDENTIALS: "host" };
    const model = { ...provider, PI_DEFAULT_MODEL: "eu.anthropic.claude-sonnet-5" };
    expect(resolveDeploymentModel(model).configured).toBe(false);
    vi.stubEnv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "/v2/credentials/example");
    expect(resolveDeploymentModel(provider).configured).toBe(false);
  });

  it("ignores credentials that only the passed env carries, since a run could not use them", () => {
    expect(
      resolveDeploymentModel({
        PI_DEFAULT_PROVIDER: "amazon-bedrock",
        PI_DEFAULT_MODEL: "eu.anthropic.claude-sonnet-5",
        PI_DEFAULT_CREDENTIALS: "host",
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/example",
      }).configured,
    ).toBe(false);
  });
});

describe("hostCredentialSource", () => {
  it("names the cloud identity a provider authenticates with from the host", () => {
    expect(hostCredentialSource("amazon-bedrock")).toBe("AWS IAM");
    expect(hostCredentialSource("google-vertex")).toBe("Google Cloud");
  });
});
