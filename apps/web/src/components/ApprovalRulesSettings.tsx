import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionApprovalRule, ActionAutoReviewSettings } from "@rakazo/contracts";
import { Button, SwitchField } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

function describeRule(rule: ActionApprovalRule): string {
  if (rule.effect === "require_approval") {
    if (rule.matchKind === "category") {
      if (rule.matchValue === "email") return t`Ask before email actions`;
      if (rule.matchValue === "purchase") return t`Ask before purchase actions`;
      return t`Ask before ${rule.matchValue} actions`;
    }
    if (rule.matchKind === "connector") return t`Ask before ${rule.matchValue} connector`;
    return t`Ask before ${rule.matchValue}`;
  }
  if (rule.matchKind === "category") {
    if (rule.matchValue === "email") return t`Allow email actions without asking`;
    if (rule.matchValue === "purchase") return t`Allow purchase actions without asking`;
    return t`Allow ${rule.matchValue} actions without asking`;
  }
  if (rule.matchKind === "connector") return t`Allow ${rule.matchValue} connector without asking`;
  return t`Allow ${rule.matchValue} without asking`;
}

/** The rule a preset switch stands for: ask before every action of that category. */
function isPresetRule(rule: ActionApprovalRule): boolean {
  return (
    rule.effect === "require_approval" &&
    rule.matchKind === "category" &&
    (rule.matchValue === "email" || rule.matchValue === "purchase")
  );
}

function presetRule(
  rules: readonly ActionApprovalRule[],
  matchValue: "email" | "purchase",
): ActionApprovalRule | undefined {
  return rules.find((rule) => isPresetRule(rule) && rule.matchValue === matchValue);
}

export function ApprovalRulesSettings() {
  const { t } = useLingui();
  const [rules, setRules] = useState<ActionApprovalRule[]>([]);
  const [autoReview, setAutoReview] = useState<ActionAutoReviewSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPreset, setSavingPreset] = useState<"email" | "purchase" | null>(null);
  const [savingAutoReview, setSavingAutoReview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextRules, nextAutoReview] = await Promise.all([
        rpc.approvalRules.list(),
        rpc.autoReview.get(),
      ]);
      setRules(nextRules);
      setAutoReview(nextAutoReview);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not load approval rules`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function setPreset(matchValue: "email" | "purchase") {
    if (loading || savingPreset) return;
    if (
      rules.some(
        (rule) =>
          rule.effect === "require_approval" &&
          rule.matchKind === "category" &&
          rule.matchValue === matchValue,
      )
    ) {
      return;
    }
    setSavingPreset(matchValue);
    setError(null);
    try {
      const saved = await rpc.approvalRules.set({
        effect: "require_approval",
        matchKind: "category",
        matchValue,
      });
      setRules((current) => [...current, saved]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save rule`);
    } finally {
      setSavingPreset(null);
    }
  }

  async function togglePreset(matchValue: "email" | "purchase", on: boolean) {
    if (on) {
      await setPreset(matchValue);
      return;
    }
    const rule = presetRule(rules, matchValue);
    if (!rule) return;
    setSavingPreset(matchValue);
    await removeRule(rule.id);
    setSavingPreset(null);
  }

  async function removeRule(id: string) {
    setError(null);
    try {
      await rpc.approvalRules.remove({ id });
      setRules((current) => current.filter((rule) => rule.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not remove rule`);
    }
  }

  async function toggleAutoReview(enabled: boolean) {
    if (loading || savingAutoReview) return;
    setSavingAutoReview(true);
    setError(null);
    try {
      setAutoReview(await rpc.autoReview.set({ enabled }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save Auto Review`);
    } finally {
      setSavingAutoReview(false);
    }
  }

  const otherRules = rules.filter((rule) => !isPresetRule(rule));
  const presetsBusy = loading || savingPreset !== null;
  return (
    <div data-testid="action-confirmation-settings" className="flex flex-col gap-4">
      <SwitchField
        data-testid="approval-email-toggle"
        label={<Trans>Ask before sending external email</Trans>}
        checked={presetRule(rules, "email") !== undefined}
        disabled={presetsBusy}
        onCheckedChange={(checked) => void togglePreset("email", checked)}
      />
      <SwitchField
        data-testid="approval-purchase-toggle"
        label={<Trans>Ask before purchases</Trans>}
        checked={presetRule(rules, "purchase") !== undefined}
        disabled={presetsBusy}
        onCheckedChange={(checked) => void togglePreset("purchase", checked)}
      />
      <SwitchField
        data-testid="auto-review-toggle"
        label={<Trans>Flag unexpected actions</Trans>}
        description={
          autoReview?.enabled && !autoReview.checkerAvailable ? (
            <Trans>Add a model in Settings to use this.</Trans>
          ) : null
        }
        checked={autoReview?.enabled ?? false}
        disabled={loading || savingAutoReview || !autoReview}
        onCheckedChange={(checked) => void toggleAutoReview(checked)}
      />
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      {otherRules.length > 0 ? (
        <ul className="space-y-2">
          {otherRules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2"
            >
              <span className="text-[13.5px] text-foreground/75">{describeRule(rule)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => void removeRule(rule.id)}
              >
                <Trans>Remove</Trans>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
