import { getEnvApiKey } from "@earendil-works/pi-ai/compat";

export const DEFAULT_OPENROUTER_MODEL_ID = "openai/gpt-6-luna";

/**
 * What Pi reports for a provider that authenticates from the host instead of a key: an AWS
 * profile or task role for Amazon Bedrock, Application Default Credentials for Vertex.
 */
const HOST_CREDENTIALS = "<authenticated>";

/** What a provider's host credentials are, for telling a user what a deployment runs on. */
const HOST_CREDENTIAL_SOURCES: Record<string, string> = {
  "amazon-bedrock": "AWS IAM",
  "google-vertex": "Google Cloud",
};

/** The kind of host credentials a provider authenticates with, e.g. "AWS IAM". */
export function hostCredentialSource(provider: string): string {
  return HOST_CREDENTIAL_SOURCES[provider] ?? "host";
}

/**
 * The deployment-wide model default: which provider a run falls back to when no user
 * credential applies, and the key for that provider.
 *
 * `configured` is whether that default can run: the provider has a deployment key, or the
 * operator opted in with `PI_DEFAULT_CREDENTIALS=host`, the provider authenticates from the host
 * (`hostCredentials`), and `PI_DEFAULT_MODEL` names the model, since no default model id is
 * assumed for such a provider. The opt-in keeps a host that merely has cloud credentials from paying for every
 * user's runs without anyone choosing it. Host credentials are never returned as `key`; Pi
 * resolves them itself when a run passes no key. They are read from the process, where the
 * runtime authenticates from, never from `env`: credentials only `env` carries could not be
 * used by a run.
 *
 * Vendor env names and model ids live here, in the adapter layer, not in core.
 */
export function resolveDeploymentModel(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.PI_DEFAULT_PROVIDER?.trim() || "openrouter";
  // A row per provider that ships a deployment key. A third one adds a row here, not a
  // branch at each call site — and an unknown provider gets no key rather than another
  // vendor's, which a ternary on one provider would not give.
  const keys: Record<string, string | undefined> = {
    openrouter: env.OPENROUTER_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
  };
  const models: Record<string, string> = {
    openrouter: DEFAULT_OPENROUTER_MODEL_ID,
    anthropic: "claude-sonnet-5",
  };
  const explicitModel = env.PI_DEFAULT_MODEL?.trim();
  const key = keys[provider];
  const hostCredentials =
    !key &&
    Boolean(explicitModel) &&
    env.PI_DEFAULT_CREDENTIALS?.trim() === "host" &&
    getEnvApiKey(provider) === HOST_CREDENTIALS;
  return {
    provider,
    model: explicitModel || models[provider] || models.openrouter!,
    key,
    configured: Boolean(key) || hostCredentials,
    hostCredentials,
  };
}
