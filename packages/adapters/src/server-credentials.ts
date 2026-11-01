import type { AssistantMessage, Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { hostCredentialsPresent, supportedHostCredentialSource } from "./deployment-model.js";

/**
 * Where a deployment default that runs on the server's own credentials stands:
 * - `missing`: the operator opted in, but this server has no usable credentials for the provider;
 * - `unchecked`: credentials are present, but no check has settled whether they work yet (or the
 *   last one hit something transient, such as throttling);
 * - `ready`: a check invoked the model;
 * - `denied`: the credentials may not invoke the model;
 * - `unavailable`: the model is not offered to these credentials (an unknown id, or a region or
 *   account it isn't enabled in).
 */
export type ServerCredentialStatus = "missing" | "unchecked" | "ready" | "denied" | "unavailable";

export interface ServerCredentialSetup {
  provider: string;
  model: string;
  /** The kind of credentials, e.g. "AWS IAM". */
  source: string;
}

export interface ServerCredentialState extends ServerCredentialSetup {
  status: ServerCredentialStatus;
}

/**
 * The operator's opt-in to running the deployment default on the server's own credentials
 * (`PI_DEFAULT_CREDENTIALS=host` with `PI_DEFAULT_PROVIDER` and `PI_DEFAULT_MODEL`), or null when
 * the deployment default doesn't use them.
 */
export function serverCredentialSetup(
  env: NodeJS.ProcessEnv = process.env,
): ServerCredentialSetup | null {
  const provider = env.PI_DEFAULT_PROVIDER?.trim();
  const model = env.PI_DEFAULT_MODEL?.trim();
  const source = provider ? supportedHostCredentialSource(provider) : undefined;
  if (env.PI_DEFAULT_CREDENTIALS?.trim() !== "host" || !provider || !model || !source) return null;
  return { provider, model, source };
}

/** Enough output to prove the model answers, and little enough to cost next to nothing. */
const CHECK_MAX_TOKENS = 16;

/** Invokes the model once with the server's own credentials and reports what that shows. */
export async function checkServerCredentials(
  setup: ServerCredentialSetup,
  models: Models = builtinModels(),
): Promise<ServerCredentialStatus> {
  if (!hostCredentialsPresent(setup.provider)) return "missing";
  const model = models.getModel(setup.provider, setup.model);
  if (!model) return "unavailable";
  try {
    const reply = await models.completeSimple(
      model,
      { messages: [{ role: "user", content: "Reply with: ok", timestamp: Date.now() }] },
      { maxTokens: CHECK_MAX_TOKENS },
    );
    return reply.stopReason === "error" ? classifyCheckFailure(reply) : "ready";
  } catch {
    return "unchecked";
  }
}

/** AWS error codes that mean the credentials themselves don't work, rather than the model. */
const UNUSABLE_CREDENTIAL_CODES = new Set([
  "UnrecognizedClientException",
  "ExpiredTokenException",
  "InvalidSignatureException",
]);

/**
 * Sorts a failed check into a status the user can act on, from the AWS error code Pi attaches to
 * Bedrock failures. Anything not recognized stays `unchecked`, so a transient error never reports
 * working credentials as broken.
 */
export function classifyCheckFailure(
  reply: Pick<AssistantMessage, "errorMessage" | "diagnostics">,
): ServerCredentialStatus {
  const details = reply.diagnostics?.find(
    (diagnostic) => diagnostic.type === "bedrock_response_failure",
  )?.details;
  const code = typeof details?.errorCode === "string" ? details.errorCode : undefined;
  const message = reply.errorMessage ?? "";
  if (code !== undefined && UNUSABLE_CREDENTIAL_CODES.has(code)) return "missing";
  if (/could not load credentials/i.test(message)) return "missing";
  if (code === "AccessDeniedException") return "denied";
  if (code === "ResourceNotFoundException") return "unavailable";
  if (code === "ValidationException" && /model identifier is invalid/i.test(message)) {
    return "unavailable";
  }
  return "unchecked";
}

/** A check is reused this long, so repeated "check again" clicks don't each invoke the model. */
const CHECK_REUSE_MS = 30_000;

/**
 * The server-credential state for one process: set up once from the environment, then settled by
 * checks that run on demand. Concurrent callers share a running check.
 */
export class ServerCredentialCheck {
  private status: ServerCredentialStatus;
  private checkedAt: number | null = null;
  private running: Promise<ServerCredentialStatus> | null = null;

  constructor(
    private readonly setup: ServerCredentialSetup | null,
    private readonly check: (
      setup: ServerCredentialSetup,
    ) => Promise<ServerCredentialStatus> = checkServerCredentials,
    private readonly now: () => number = Date.now,
  ) {
    this.status = setup && !hostCredentialsPresent(setup.provider) ? "missing" : "unchecked";
  }

  /** The current state, or null when the deployment default doesn't use server credentials. */
  state(): ServerCredentialState | null {
    return this.setup ? { ...this.setup, status: this.status } : null;
  }

  /** Whether a check showed the deployment default can't run on these credentials. */
  failed(): boolean {
    return this.status === "missing" || this.status === "denied" || this.status === "unavailable";
  }

  /** Runs a check, unless one finished moments ago, and returns the resulting state. */
  async refresh(): Promise<ServerCredentialState | null> {
    if (!this.setup) return null;
    if (this.checkedAt !== null && this.now() - this.checkedAt < CHECK_REUSE_MS) {
      return this.state();
    }
    this.running ??= this.check(this.setup).finally(() => {
      this.running = null;
    });
    this.status = await this.running;
    this.checkedAt = this.now();
    return this.state();
  }
}
