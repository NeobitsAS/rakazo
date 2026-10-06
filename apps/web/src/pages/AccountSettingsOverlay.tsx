import { Trans, useLingui } from "@lingui/react/macro";
import type { AvatarStyle } from "@rakazo/contracts";
import {
  BotAvatar,
  Button,
  Disclosure,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  OptionSelect,
  SwitchField,
  Toggle,
} from "@rakazo/ui-web";
import { Check } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";
import { ApprovalRulesSettings } from "../components/ApprovalRulesSettings";
import { SuccessPop } from "../components/ai/primitives";
import { ComputersUnavailableHint } from "../components/ComputersUnavailableHint";
import { DesktopUpdateSection } from "../components/DesktopUpdates";
import { SoftwareUpdateSection } from "../components/SoftwareUpdateSection";
import { authClient } from "../lib/auth";
import { getActiveUiLocale, setUiLocale } from "../lib/i18n";
import {
  getResponseStreamingPreference,
  setResponseStreamingPreference,
} from "../lib/response-streaming";
import {
  getToolActivityPreference,
  setToolActivityPreference,
} from "../lib/tool-activity-preference";
import {
  type AppearancePreference,
  getUiAppearancePreference,
  setUiAppearance,
} from "../lib/ui-appearance";
import { UI_LOCALE_LABELS, UI_LOCALES, type UiLocale } from "../lib/ui-locale";

export type SettingsGeneralProps = {
  email?: string | null;
  name: string;
  avatarStyle: AvatarStyle;
  onAvatarStyleChange: (style: AvatarStyle) => Promise<void>;
  messagingEnabled?: boolean;
  onOpenMessaging?: () => void;
};

export function GeneralSettingsPanels({
  email,
  name,
  avatarStyle,
  onAvatarStyleChange,
  messagingEnabled = false,
  onOpenMessaging,
}: SettingsGeneralProps) {
  const { t } = useLingui();
  const [locale, setLocale] = useState<UiLocale>(() => getActiveUiLocale());
  const localeRequestRef = useRef(0);
  const [appearance, setAppearance] = useState<AppearancePreference>(() =>
    getUiAppearancePreference(),
  );
  const [streamReplies, setStreamReplies] = useState(
    () => getResponseStreamingPreference() === "on",
  );
  const [showToolActivity, setShowToolActivity] = useState(
    () => getToolActivityPreference() === "on",
  );
  const [avatarPending, setAvatarPending] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  function chooseLocale(next: UiLocale) {
    if (next === locale) return;
    const requestId = ++localeRequestRef.current;
    setLocale(next);
    void setUiLocale(next).then((activated) => {
      if (requestId !== localeRequestRef.current) return;
      setLocale(activated);
    });
  }

  async function chooseAvatarStyle(next: AvatarStyle) {
    if (avatarPending || next === avatarStyle) return;
    setAvatarPending(true);
    setAvatarError(null);
    try {
      await onAvatarStyleChange(next);
    } catch {
      setAvatarError(t`Couldn't update avatars`);
    } finally {
      setAvatarPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="py-4">
        <h3 className="text-[15px] font-medium text-foreground">
          <Trans>Account</Trans>
        </h3>
        <p className="mt-3 text-[14px] text-foreground/75">{name}</p>
        {email ? <p className="mt-1 text-[13px] text-muted-foreground/70">{email}</p> : null}
      </section>

      <ChangePasswordSection email={email} />

      {messagingEnabled && onOpenMessaging ? (
        <section className="py-4">
          <h3 className="text-[15px] font-medium text-foreground">
            <Trans>Messaging</Trans>
          </h3>
          <p className="mt-3 text-[13px] text-muted-foreground/70">
            <Trans>Chat apps, group channels, and agent connections.</Trans>
          </p>
          <Button variant="secondary" className="mt-3" onClick={onOpenMessaging}>
            <Trans>Manage messaging settings</Trans>
          </Button>
        </section>
      ) : null}

      <section className="py-4">
        <h3 className="text-[15px] font-medium text-foreground">
          <Trans>Appearance</Trans>
        </h3>
        <AppearancePicker
          value={appearance}
          onChange={(next) => {
            setAppearance(next);
            setUiAppearance(next);
          }}
        />
      </section>

      <section className="py-4">
        <h3 className="text-[15px] font-medium text-foreground">
          <Trans>Language</Trans>
        </h3>
        <OptionSelect<UiLocale>
          className="mt-3"
          data-testid="ui-locale-select"
          aria-label={t`Language`}
          value={locale}
          onValueChange={chooseLocale}
          options={UI_LOCALES.map((code) => ({ value: code, label: UI_LOCALE_LABELS[code] }))}
        />
      </section>

      <section className="py-4" data-testid="avatar-style-select">
        <h3 className="text-[15px] font-medium text-foreground">
          <Trans>Avatars</Trans>
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {(["robot", "organic"] as const).map((style) => (
            <Toggle
              key={style}
              variant="outline"
              pressed={style === avatarStyle}
              disabled={avatarPending}
              onPressedChange={() => void chooseAvatarStyle(style)}
              data-testid={`avatar-style-${style}`}
              className="h-auto justify-start gap-3 px-3.5 py-3 text-[14px] font-normal aria-pressed:ring-2 aria-pressed:ring-link"
            >
              <BotAvatar
                color="#D9508A"
                identity="avatar-style-preview"
                size={32}
                variant={style}
              />
              <span className="flex-1 text-start">
                {style === "robot" ? <Trans>Robot</Trans> : <Trans>Organic</Trans>}
              </span>
              {style === avatarStyle ? (
                <Check aria-hidden="true" className="size-4 shrink-0 text-foreground" />
              ) : null}
            </Toggle>
          ))}
        </div>
        {avatarError ? (
          <p role="alert" className="mt-3 text-[12.5px] text-destructive">
            {avatarError}
          </p>
        ) : null}
      </section>

      <Disclosure
        data-testid="advanced-settings"
        summaryClassName="py-4 text-[15px] font-medium text-foreground"
        summary={<Trans>Advanced</Trans>}
      >
        <div className="flex flex-col gap-4 pt-1 pb-5">
          <SwitchField
            data-testid="response-streaming-toggle"
            label={<Trans>Stream replies</Trans>}
            checked={streamReplies}
            onCheckedChange={(checked) => {
              setStreamReplies(checked);
              setResponseStreamingPreference(checked ? "on" : "off");
            }}
          />
          <SwitchField
            data-testid="tool-activity-toggle"
            label={<Trans>Show tool activity</Trans>}
            checked={showToolActivity}
            onCheckedChange={(checked) => {
              setShowToolActivity(checked);
              setToolActivityPreference(checked ? "on" : "off");
            }}
          />
          <ApprovalRulesSettings />
        </div>
      </Disclosure>
    </div>
  );
}

export function UsageSettingsPanel({
  usage,
  panelRef,
}: {
  usage?: { runs: number; inputTokens: number; outputTokens: number } | null;
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={panelRef} tabIndex={-1} data-testid="usage-settings" className="py-4 outline-none">
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Usage</Trans>
      </h3>
      {usage ? (
        <p className="mt-3 text-[14px] text-foreground/75">
          <Trans>
            {usage.runs} runs · {usage.inputTokens + usage.outputTokens} tokens
          </Trans>
        </p>
      ) : null}
      <p className={`text-[12.5px] text-muted-foreground/80 ${usage ? "mt-2" : "mt-3"}`}>
        <Trans>Model spend uses your provider keys.</Trans>
      </p>
    </div>
  );
}

export function ComputerSettingsPanel() {
  return (
    <div data-testid="computers-setup-settings" className="py-4">
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Computers</Trans>
      </h3>
      <ComputersUnavailableHint className="mt-3 text-[13px] leading-relaxed text-muted-foreground" />
    </div>
  );
}

export function UpdatesSettingsPanel({
  isDeploymentOwner = false,
}: {
  isDeploymentOwner?: boolean;
}) {
  return (
    <div className="space-y-5">
      <DesktopUpdateSection />
      <SoftwareUpdateSection isDeploymentOwner={isDeploymentOwner} />
    </div>
  );
}

function ChangePasswordSection({ email }: { email?: string | null }) {
  const { t } = useLingui();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changePassword() {
    if (pending) return;
    if (newPassword !== confirmation) {
      setError(t`Passwords do not match`);
      return;
    }
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(result.error.message ?? t`Could not change password`);
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setSaved(true);
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="py-4">
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Password</Trans>
      </h3>
      <FieldGroup className="mt-4">
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={email ?? ""}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
        <SettingsPasswordInput
          label={t`Current password`}
          placeholder={t`Your current password`}
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <SettingsPasswordInput
          label={t`New password`}
          placeholder={t`At least 8 characters`}
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
        />
        <SettingsPasswordInput
          label={t`Confirm password`}
          placeholder={t`Type the new password again`}
          autoComplete="new-password"
          value={confirmation}
          onChange={setConfirmation}
        />
      </FieldGroup>
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex items-center gap-3">
        <Button
          disabled={pending || currentPassword.length < 8 || newPassword.length < 8}
          onClick={() => void changePassword()}
        >
          {pending ? <Trans>Changing…</Trans> : <Trans>Change password</Trans>}
        </Button>
        {saved ? <SuccessPop label={t`Password updated`} /> : null}
      </div>
    </section>
  );
}

function SettingsPasswordInput({
  label,
  placeholder,
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={8}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function AppearancePicker({
  value,
  onChange,
}: {
  value: AppearancePreference;
  onChange: (next: AppearancePreference) => void;
}) {
  const { t } = useLingui();
  const options: { value: AppearancePreference; label: string }[] = [
    { value: "system", label: t`System` },
    { value: "light", label: t`Light` },
    { value: "dark", label: t`Dark` },
  ];

  return (
    <fieldset
      aria-label={t`Appearance`}
      data-testid="ui-appearance-select"
      className="mt-3 grid min-w-0 grid-cols-3 gap-1 rounded-lg bg-muted p-1"
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          data-testid={`ui-appearance-${option.value}`}
          pressed={option.value === value}
          onPressedChange={() => onChange(option.value)}
          className="text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm"
        >
          {option.label}
        </Toggle>
      ))}
    </fieldset>
  );
}
