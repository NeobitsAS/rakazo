import { defaultProvider } from "@aws-sdk/credential-provider-node";
import {
  AwsClient,
  type AwsSecurityCredentials,
  type AwsSecurityCredentialsSupplier,
  JWT,
} from "google-auth-library";
import { z } from "zod";

/** Sending as the Chat app, and pulling its interaction events from Pub/Sub. */
export const GOOGLE_CHAT_SCOPES = [
  "https://www.googleapis.com/auth/chat.bot",
  "https://www.googleapis.com/auth/pubsub",
];

const AWS_SUBJECT_TOKEN_TYPE = "urn:ietf:params:aws:token-type:aws4_request";

/**
 * How the deployment proves it is the Chat app's service account: with that
 * account's JSON key, or keyless through workload identity federation from
 * the AWS identity it already runs as.
 */
export type GoogleChatCredentials =
  | { kind: "service-account"; keyJson: string }
  | {
      kind: "aws-workload-identity";
      /** //iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider> */
      provider: string;
      serviceAccount: string;
      awsRegion: string;
    };

export type GoogleChatAuthClient = JWT | AwsClient;

const serviceAccountKeySchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});

export function createGoogleChatAuthClient(
  credentials: GoogleChatCredentials,
): GoogleChatAuthClient {
  if (credentials.kind === "service-account") {
    const key = serviceAccountKeySchema.parse(JSON.parse(credentials.keyJson));
    return new JWT({ email: key.client_email, key: key.private_key, scopes: GOOGLE_CHAT_SCOPES });
  }
  return new AwsClient({
    audience: credentials.provider,
    subject_token_type: AWS_SUBJECT_TOKEN_TYPE,
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${credentials.serviceAccount}:generateAccessToken`,
    aws_security_credentials_supplier: new AwsSdkCredentialsSupplier(credentials.awsRegion),
    scopes: GOOGLE_CHAT_SCOPES,
  });
}

/**
 * google-auth-library finds AWS credentials only in environment variables or
 * EC2 instance metadata. On ECS the latter is the host's role, not the
 * task's, so resolve them with the AWS SDK's default chain instead (container
 * credentials, web identity, profiles, ...).
 */
class AwsSdkCredentialsSupplier implements AwsSecurityCredentialsSupplier {
  private readonly provider = defaultProvider();

  constructor(private readonly region: string) {}

  async getAwsRegion(): Promise<string> {
    return this.region;
  }

  async getAwsSecurityCredentials(): Promise<AwsSecurityCredentials> {
    const credentials = await this.provider();
    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      token: credentials.sessionToken,
    };
  }
}
