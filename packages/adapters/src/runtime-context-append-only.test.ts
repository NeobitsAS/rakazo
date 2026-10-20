import { createHash } from "node:crypto";
import type { Api, Context, Message, Model } from "@earendil-works/pi-ai";
import type { AgentRunRequest } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { ContextCacheTracker, providerContextPrefix } from "./context-selection.js";
import { createRuntimeContextPolicy } from "./runtime-context.js";

const model = {
  id: "synthetic-model",
  provider: "synthetic-provider",
  baseUrl: "https://synthetic.invalid",
  contextWindow: 200_000,
  maxTokens: 4096,
} as Model<Api>;

type Step =
  | { tool: "shell"; text: string }
  | { tool: "browser_snapshot"; text: string }
  | { tool: "computer_observe"; screenshot: true }
  | { steer: string };

function request(overrides: Partial<AgentRunRequest> = {}, historyCount = 30): AgentRunRequest {
  return {
    botId: "bot",
    threadId: `thread-${Math.random()}`,
    runId: "run",
    instructions: "Stable instructions",
    prompt: "Current objective",
    history: Array.from({ length: historyCount }, (_, index) => ({
      id: `message-${index}`,
      createdAt: "2026-01-01T00:00:00Z",
      role: index % 2 ? ("assistant" as const) : ("user" as const),
      content: `Original discussion ${index}: ${"synthetic history ".repeat(30)}`,
    })),
    tools: [],
    model: { provider: "synthetic-provider", id: "synthetic-model" },
    ...overrides,
  };
}

/** Pi's view of the run before the first model call: saved history, then the current prompt. */
function initialMessages(input: AgentRunRequest): Message[] {
  return [
    ...input.history.map(
      (item): Message =>
        ({
          role: "user",
          content: item.role === "assistant" ? `Assistant: ${item.content}` : item.content,
          timestamp: 0,
          rakazoHistory: true,
          rakazoMessageId: item.id,
        }) as Message,
    ),
    { role: "user", content: input.prompt, timestamp: 1 },
  ];
}

/**
 * Signs a reasoning block the way providers that bind reasoning to its conversation do: the
 * signature records the instructions, tools and every message before the block's message.
 */
function prefixSignature(context: Context, count: number): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        providerContextPrefix(
          context.systemPrompt ?? "",
          context.tools ?? [],
          context.messages.slice(0, count),
        ),
      ),
    )
    .digest("hex");
}

/** Thinking blocks the provider would reject: their message's prefix changed since signing. */
function staleThinking(context: Context): number[] {
  return context.messages.flatMap((message, index) =>
    message.role === "assistant" &&
    message.content.some(
      (part) =>
        part.type === "thinking" && part.thinkingSignature !== prefixSignature(context, index),
    )
      ? [index]
      : [],
  );
}

function thinkingCount(context: Context): number {
  return context.messages.reduce(
    (count, message) =>
      count +
      (message.role === "assistant"
        ? message.content.filter((part) => part.type === "thinking").length
        : 0),
    0,
  );
}

function imageCount(context: Context): number {
  return context.messages.reduce(
    (count, message) =>
      count +
      (Array.isArray(message.content)
        ? (message.content as Array<{ type: string }>).filter((part) => part.type === "image")
            .length
        : 0),
    0,
  );
}

/** Whether `next` sends everything `previous` sent, unchanged, before anything new. */
function extendsPrevious(previous: Context, next: Context): boolean {
  return (
    previous.systemPrompt === next.systemPrompt &&
    JSON.stringify(previous.tools ?? []) === JSON.stringify(next.tools ?? []) &&
    next.messages.length >= previous.messages.length &&
    JSON.stringify(
      providerContextPrefix("", [], next.messages.slice(0, previous.messages.length)),
    ) === JSON.stringify(providerContextPrefix("", [], previous.messages))
  );
}

/**
 * Runs a tool loop through one policy, as the Pi runtime does: every model call gets the run's
 * messages so far, and the model answers each call with signed thinking and a tool call.
 */
function simulateRun(
  input: AgentRunRequest,
  steps: Step[],
  options: {
    cacheTracker?: ContextCacheTracker;
    tick?: () => void;
    systemPrompt?: (step: number) => string;
  } = {},
) {
  const policy = createRuntimeContextPolicy(input, undefined, {
    cacheTracker: options.cacheTracker,
  });
  const messages = initialMessages(input);
  const sent: Context[] = [];
  const send = (step: number) => {
    const context = policy.prepareContext(
      {
        systemPrompt: options.systemPrompt?.(step) ?? input.instructions,
        tools: [],
        messages: [...messages],
      },
      model,
    );
    sent.push(context);
    policy.onUsage({ inputTokens: 1000, outputTokens: 10, cacheReadTokens: 900 });
    options.tick?.();
    return context;
  };
  for (const [index, step] of steps.entries()) {
    const context = send(index);
    if ("steer" in step) {
      messages.push({ role: "user", content: step.steer, timestamp: 1000 + index });
      continue;
    }
    const id = `call-${index}`;
    messages.push({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: `Plan step ${index}`,
          thinkingSignature: prefixSignature(context, context.messages.length),
        },
        { type: "toolCall", id, name: step.tool, arguments: {} },
      ],
      timestamp: 1000 + index,
    } as unknown as Message);
    messages.push({
      role: "toolResult",
      toolCallId: id,
      toolName: step.tool,
      content:
        "screenshot" in step
          ? [{ type: "image", data: `frame-${index}`, mimeType: "image/png" }]
          : [{ type: "text", text: step.text }],
      ...("screenshot" in step ? { details: { frameId: `frame-${index}` } } : {}),
      isError: false,
      timestamp: 1000 + index,
    } as Message);
  }
  send(steps.length);
  return sent;
}

/** Indexes of calls whose transcript did not extend the previous call's transcript. */
function rewrites(sent: Context[]): number[] {
  return sent.flatMap((context, index) =>
    index > 0 && !extendsPrevious(sent[index - 1]!, context) ? [index] : [],
  );
}

const toolHeavyRun: Step[] = [
  { tool: "shell", text: `first log line ${"synthetic shell output ".repeat(150)}` },
  { tool: "browser_snapshot", text: `page one ${"node ".repeat(400)}` },
  { tool: "computer_observe", screenshot: true },
  { tool: "shell", text: "synthetic shell output ".repeat(150) },
  { tool: "browser_snapshot", text: `page two ${"node ".repeat(400)}` },
  { tool: "computer_observe", screenshot: true },
  { steer: "Also check the second dashboard" },
  { tool: "browser_snapshot", text: `page three ${"node ".repeat(400)}` },
  { tool: "computer_observe", screenshot: true },
  { tool: "browser_snapshot", text: `page four ${"node ".repeat(400)}` },
  { tool: "shell", text: "synthetic shell output ".repeat(150) },
  { tool: "computer_observe", screenshot: true },
  { tool: "browser_snapshot", text: `page five ${"node ".repeat(400)}` },
];

describe("append-only run transcript", () => {
  it.each(["current", "retrieval", "snapshots", "cache-aware"] as const)(
    "never rewrites what a %s run already sent",
    (contextStrategy) => {
      const sent = simulateRun(request({ contextStrategy }), toolHeavyRun);
      expect(sent).toHaveLength(toolHeavyRun.length + 1);
      expect(rewrites(sent)).toEqual([]);
      for (const context of sent) expect(staleThinking(context)).toEqual([]);
      // Old tool output, page state and screenshots stay as first sent; nothing was trimmed.
      const last = JSON.stringify(sent.at(-1));
      expect(last).toContain("first log line");
      expect(last).toContain("page one");
      expect(last).not.toContain("Tool result truncated");
      expect(last).not.toContain("Earlier page state trimmed");
      expect(imageCount(sent.at(-1)!)).toBe(4);
      expect(thinkingCount(sent.at(-1)!)).toBe(toolHeavyRun.length - 1);
    },
  );

  it("keeps the history it chose while the predicted cache warmth changes mid-run", () => {
    let now = 0;
    const cacheTracker = new ContextCacheTracker(() => now);
    const input = request({
      contextStrategy: "cache-aware",
      model: {
        provider: "synthetic-provider",
        id: "synthetic-model",
        cacheCapabilities: { scope: "account", retentionMs: 300_000, minimumTokens: 1 },
      },
    });
    // Every other call lands after the cache window, so a fresh selection would flip between
    // full history and navigation snapshots.
    const sent = simulateRun(input, toolHeavyRun, {
      cacheTracker,
      tick: () => {
        now += now % 2 ? 1 : 400_000;
      },
    });
    expect(rewrites(sent)).toEqual([]);
    for (const context of sent) expect(staleThinking(context)).toEqual([]);
  });

  it("sends the same transcript again when a call is retried", () => {
    const input = request({ contextStrategy: "retrieval" });
    const policy = createRuntimeContextPolicy(input);
    const context: Context = {
      systemPrompt: input.instructions,
      tools: [],
      messages: initialMessages(input),
    };
    const first = policy.prepareContext(context, model);
    expect(policy.prepareContext(context, model).messages).toEqual(first.messages);
  });

  it("rebuilds once the run outgrows the model, then appends again", () => {
    const small = {
      ...model,
      contextWindow: 40_000,
    } as Model<Api>;
    const input = request({
      contextStrategy: "retrieval",
      model: { provider: "synthetic-provider", id: "synthetic-model", contextWindow: 40_000 },
    });
    const steps: Step[] = Array.from({ length: 30 }, (_, index) => ({
      tool: "shell",
      text: `output ${index} ${"synthetic shell output ".repeat(130)}`,
    }));
    const sent = simulateRun(input, steps);
    const rebuilt = rewrites(sent);
    expect(rebuilt.length).toBeGreaterThan(0);
    expect(rebuilt.length).toBeLessThan(steps.length / 4);
    // Each rebuild leaves room, so the next calls append instead of rebuilding again.
    for (const index of rebuilt) expect(rebuilt).not.toContain(index + 1);
    for (const context of sent) {
      expect(staleThinking(context)).toEqual([]);
      expect(JSON.stringify(context).length / 4).toBeLessThan(small.contextWindow);
    }
  });

  it("keeps thinking before the first rewritten message and drops it after", () => {
    const input = request({
      contextStrategy: "retrieval",
      model: { provider: "synthetic-provider", id: "synthetic-model", contextWindow: 40_000 },
    });
    const steps: Step[] = [
      { tool: "shell", text: "short" },
      { tool: "shell", text: "short" },
      ...Array.from({ length: 16 }, (_, index) => ({
        tool: "shell" as const,
        text: `output ${index} ${"synthetic shell output ".repeat(130)}`,
      })),
    ];
    const sent = simulateRun(input, steps);
    const [first] = rewrites(sent);
    expect(first).toBeDefined();
    const rebuilt = sent[first!]!;
    expect(staleThinking(rebuilt)).toEqual([]);
    // The two short results were not rewritten, so the thinking before them survives.
    const kept = rebuilt.messages.filter(
      (message) =>
        message.role === "assistant" && message.content.some((part) => part.type === "thinking"),
    );
    expect(kept.length).toBeGreaterThanOrEqual(2);
    expect(thinkingCount(rebuilt)).toBeLessThan(thinkingCount(sent[first! - 1]!));
  });

  it("rebuilds at the model's image limit and keeps the two latest screenshots", () => {
    const input = request({
      contextStrategy: "retrieval",
      model: { provider: "synthetic-provider", id: "synthetic-model", maxImagesPerPrompt: 5 },
    });
    const steps: Step[] = Array.from({ length: 10 }, () => ({
      tool: "computer_observe",
      screenshot: true,
    }));
    const sent = simulateRun(input, steps);
    expect(sent.map(imageCount)).toEqual([0, 1, 2, 3, 4, 5, 2, 3, 4, 5, 2]);
    expect(rewrites(sent)).toEqual([6, 10]);
    for (const context of sent) expect(staleThinking(context)).toEqual([]);
  });

  it("rebuilds a browsing run only when dropping stale pages pays for the broken cache", () => {
    const input = request({ contextStrategy: "retrieval" }, 0);
    const steps: Step[] = Array.from({ length: 24 }, (_, index) => ({
      tool: "browser_snapshot",
      text: `page ${index} ${"node ".repeat(4_000)}`,
    }));
    const sent = simulateRun(input, steps);
    const rebuilt = rewrites(sent);
    expect(rebuilt.length).toBeGreaterThan(0);
    expect(rebuilt.length).toBeLessThanOrEqual(steps.length / 4);
    for (const index of rebuilt) expect(rebuilt).not.toContain(index + 1);
    for (const context of sent) expect(staleThinking(context)).toEqual([]);
    expect(JSON.stringify(sent.at(-1))).toContain("Earlier page state trimmed");
  });

  it("drops earlier thinking when the instructions change mid-run", () => {
    const input = request({ contextStrategy: "retrieval" });
    const sent = simulateRun(input, toolHeavyRun.slice(0, 4), {
      systemPrompt: (step) => (step < 3 ? "Stable instructions" : "Changed instructions"),
    });
    expect(rewrites(sent)).toEqual([3]);
    expect(thinkingCount(sent[3]!)).toBe(0);
    for (const context of sent) expect(staleThinking(context)).toEqual([]);
    expect(extendsPrevious(sent[3]!, sent[4]!)).toBe(true);
  });
});
