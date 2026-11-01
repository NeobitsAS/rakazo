import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The macro compiles away in the app build; tests run the source, so render the English text.
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import {
  ServerCredentialsUnavailable,
  serverCredentialsBlocker,
} from "./ServerCredentialsUnavailable";

const bedrock = {
  provider: "amazon-bedrock",
  model: "eu.anthropic.claude-opus-5-5",
  source: "AWS IAM",
};

describe("serverCredentialsBlocker", () => {
  it("says the server isn't set up when it doesn't run this provider on its own credentials", () => {
    expect(serverCredentialsBlocker(null, "amazon-bedrock")).toBe("not-set-up");
    expect(serverCredentialsBlocker({ ...bedrock, status: "ready" }, "google-vertex")).toBe(
      "not-set-up",
    );
  });

  it("passes on what a check showed", () => {
    expect(serverCredentialsBlocker({ ...bedrock, status: "missing" }, "amazon-bedrock")).toBe(
      "missing",
    );
    expect(serverCredentialsBlocker({ ...bedrock, status: "denied" }, "amazon-bedrock")).toBe(
      "denied",
    );
    expect(serverCredentialsBlocker({ ...bedrock, status: "unavailable" }, "amazon-bedrock")).toBe(
      "unavailable",
    );
  });

  it("doesn't block credentials that work or haven't been checked yet", () => {
    expect(serverCredentialsBlocker({ ...bedrock, status: "ready" }, "amazon-bedrock")).toBeNull();
    expect(
      serverCredentialsBlocker({ ...bedrock, status: "unchecked" }, "amazon-bedrock"),
    ).toBeNull();
  });
});

describe("ServerCredentialsUnavailable", () => {
  function render(blocker: "not-set-up" | "denied") {
    return renderToStaticMarkup(
      <ServerCredentialsUnavailable
        blocker={blocker}
        source="AWS IAM"
        modelLabel="Claude Opus 5.5"
        onCheck={async () => {}}
      />,
    );
  }

  it("shows the switch off and disabled, with what the check found", () => {
    const html = render("denied");

    expect(html).toContain("disabled");
    expect(html).toContain("credentials aren&#x27;t allowed to use");
    expect(html).toContain("Check again");
  });

  it("offers no check when only the operator can set it up", () => {
    const html = render("not-set-up");

    expect(html).toContain("PI_DEFAULT_CREDENTIALS=host");
    expect(html).not.toContain("Check again");
  });
});
