import { PROVIDER_LOGOS } from "../lib/provider-logos.generated";

/**
 * Brand colours of providers that have one beyond black and white. Variants share their maker's
 * colour; providers left out keep the neutral tile.
 */
const BRAND_COLORS: Readonly<Record<string, string>> = {
  "amazon-bedrock": "#01A88D",
  anthropic: "#D97757",
  "azure-openai-responses": "#0078D4",
  cerebras: "#F15A29",
  "cloudflare-ai-gateway": "#F38020",
  "cloudflare-workers-ai": "#F38020",
  deepseek: "#4D6BFE",
  fireworks: "#6720FF",
  google: "#4285F4",
  "google-vertex": "#4285F4",
  groq: "#F55036",
  huggingface: "#FFD21E",
  meta: "#0081FB",
  mistral: "#FA520F",
  nvidia: "#76B900",
  "qwen-token-plan": "#FF6A00",
  "qwen-token-plan-cn": "#FF6A00",
  "qwen-token-plan-individual": "#FF6A00",
  together: "#0F6FFF",
  xiaomi: "#FF6900",
  "xiaomi-token-plan-ams": "#FF6900",
  "xiaomi-token-plan-cn": "#FF6900",
  "xiaomi-token-plan-sgp": "#FF6900",
};

/** Dark marks on light brand colours, white marks on the rest. */
function markColor(hex: string): string {
  const channel = (start: number) => Number.parseInt(hex.slice(start, start + 2), 16);
  const brightness = 0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5);
  return brightness > 160 ? "#1A1A1A" : "#FFFFFF";
}

/**
 * A model provider's logo on a small tile, or the first letter of its name when the provider has
 * no logo. Plain tiles draw the logo in the text colour so it suits both themes; `branded` puts it
 * on the provider's own colour where it has one.
 */
export function ProviderLogo({
  provider,
  name,
  branded = false,
}: {
  provider: string;
  name: string;
  branded?: boolean;
}) {
  const brand = branded ? BRAND_COLORS[provider] : undefined;
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-sm font-semibold text-foreground"
      style={brand ? { backgroundColor: brand, color: markColor(brand) } : undefined}
    >
      {PROVIDER_LOGOS.has(provider) ? (
        <span
          className="size-4.5 bg-current"
          style={{
            maskImage: `url(/providers/${provider}.svg)`,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
          }}
        />
      ) : (
        name[0]
      )}
    </span>
  );
}
