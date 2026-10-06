import { useLingui } from "@lingui/react/macro";
import type { AvatarStyle, SpaceMemoryConfig } from "@rakazo/contracts";
import { Dialog, DialogContent } from "@rakazo/ui-web";
import { Brain, CloudDownload, Cpu, Gauge, Monitor, Settings, Volume2 } from "lucide-react";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { computersAreUnavailable } from "../components/ComputersUnavailableHint";
import { DialogPageHeader } from "../components/DialogPageHeader";
import {
  ComputerSettingsPanel,
  GeneralSettingsPanels,
  UpdatesSettingsPanel,
  UsageSettingsPanel,
} from "./AccountSettingsOverlay";
import { MemorySettingsOverlay } from "./MemorySettingsOverlay";
import { ModelSettingsOverlay } from "./ModelSettingsOverlay";
import { VoiceSettingsOverlay } from "./VoiceSettingsOverlay";

export type SettingsSection =
  | "general"
  | "models"
  | "memory"
  | "voice"
  | "usage"
  | "computer"
  | "updates";

type NavItem = {
  id: SettingsSection;
  label: string;
  /** Shown under the page title: what the page is for. */
  description: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
};

export function SettingsOverlay({
  email,
  name,
  usage,
  initialSection = "general",
  avatarStyle,
  onAvatarStyleChange,
  isDeploymentOwner = false,
  sandboxProvider,
  messagingEnabled = false,
  onOpenMessaging,
  memoryConfig,
  onMemoryConfigChange,
  onClose,
  onVoiceStatusMaybeChanged,
}: {
  email?: string | null;
  name: string;
  usage?: { runs: number; inputTokens: number; outputTokens: number } | null;
  initialSection?: SettingsSection;
  avatarStyle: AvatarStyle;
  onAvatarStyleChange: (style: AvatarStyle) => Promise<void>;
  isDeploymentOwner?: boolean;
  sandboxProvider?: string | null;
  messagingEnabled?: boolean;
  onOpenMessaging?: () => void;
  memoryConfig: SpaceMemoryConfig | null | undefined;
  onMemoryConfigChange: (config: SpaceMemoryConfig | null) => void;
  onClose: () => void;
  onVoiceStatusMaybeChanged?: () => void | Promise<void>;
}) {
  const { t } = useLingui();
  const panelRef = useRef<HTMLDivElement>(null);
  const usageRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const showComputer = isDeploymentOwner && computersAreUnavailable(sandboxProvider);
  const panelBusy = memoryBusy || voiceBusy;

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (section === "usage") {
      usageRef.current?.focus();
    }
  }, [section]);

  const navItems: NavItem[] = [
    {
      id: "general",
      label: t`General`,
      description: t`Your account and password, how Rakazo looks, and the language it speaks.`,
      icon: Settings,
    },
    {
      id: "models",
      label: t`Models`,
      description: t`Choose the model your bots think with, and connect the providers that run it.`,
      icon: Cpu,
    },
    {
      id: "memory",
      label: t`Memory`,
      description: t`Your bots keep shared notes in MEMORY.md. Add a provider so they can also recall past conversations.`,
      icon: Brain,
    },
    {
      id: "voice",
      label: t`Voice`,
      description: t`Connect a voice provider so your bots can read replies aloud and understand what you say.`,
      icon: Volume2,
    },
    {
      id: "usage",
      label: t`Usage`,
      description: t`How much your bots have run, and how many tokens they have used.`,
      icon: Gauge,
    },
    ...(showComputer
      ? [
          {
            id: "computer" as const,
            label: t`Computer`,
            description: t`Give your bots a computer to run code and work with files.`,
            icon: Monitor,
          },
        ]
      : []),
    {
      id: "updates",
      label: t`Updates`,
      description: t`See which version you are running, and install new releases when they are out.`,
      icon: CloudDownload,
    },
  ];

  const sectionItem = navItems.find((item) => item.id === section);
  const sectionTitle = sectionItem?.label ?? (section === "general" ? t`General` : t`Settings`);

  const closeLabel =
    section === "models"
      ? t`Close model settings`
      : section === "memory"
        ? t`Close memory settings`
        : section === "voice"
          ? t`Close voice settings`
          : t`Close user settings`;

  async function refreshVoiceStatus() {
    await onVoiceStatusMaybeChanged?.();
  }

  function leaveSettings(next: () => void) {
    if (panelBusy) return;
    void refreshVoiceStatus().finally(next);
  }

  function requestClose() {
    leaveSettings(onClose);
  }

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (panelBusy) {
          details.cancel();
          return;
        }
        requestClose();
      }}
    >
      <DialogContent
        ref={panelRef}
        data-testid="user-settings"
        data-settings-section={section}
        showCloseButton={false}
        initialFocus={() =>
          section === "usage" ? (usageRef.current ?? panelRef.current) : panelRef.current
        }
        className="flex h-[min(760px,calc(100%-2rem))] max-h-[calc(100%-2rem)] w-[min(1080px,calc(100%-2rem))] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[calc(100%-5rem)] sm:max-w-[1080px]"
      >
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            data-testid="settings-nav"
            aria-label={t`Settings`}
            className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border bg-muted px-3 py-3 md:w-[200px] md:flex-col md:overflow-y-auto md:border-b-0 md:border-e md:px-3 md:py-4"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`settings-nav-${item.id}`}
                  aria-current={active ? "page" : undefined}
                  disabled={panelBusy}
                  onClick={() => setSection(item.id)}
                  className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13.5px] transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <DialogPageHeader
              title={sectionTitle}
              description={sectionItem?.description}
              closeLabel={closeLabel}
              closeDisabled={panelBusy}
            />

            <div
              className={`min-h-0 flex-1 ${
                section === "models" || section === "voice" || section === "memory"
                  ? "flex flex-col overflow-hidden"
                  : "rk-scroll overflow-y-auto overscroll-contain px-6 pb-6 sm:px-8 sm:pb-8"
              }`}
            >
              {section === "general" ? (
                <GeneralSettingsPanels
                  email={email}
                  name={name}
                  avatarStyle={avatarStyle}
                  onAvatarStyleChange={onAvatarStyleChange}
                  messagingEnabled={messagingEnabled}
                  onOpenMessaging={
                    onOpenMessaging ? () => leaveSettings(onOpenMessaging) : undefined
                  }
                />
              ) : null}
              {section === "usage" ? (
                <UsageSettingsPanel usage={usage} panelRef={usageRef} />
              ) : null}
              {section === "computer" && showComputer ? <ComputerSettingsPanel /> : null}
              {section === "updates" ? (
                <UpdatesSettingsPanel isDeploymentOwner={isDeploymentOwner} />
              ) : null}
              {section === "models" ? (
                <ModelSettingsOverlay embedded onClose={requestClose} />
              ) : null}
              {section === "memory" ? (
                <MemorySettingsOverlay
                  embedded
                  onClose={requestClose}
                  config={memoryConfig}
                  onConfigChange={onMemoryConfigChange}
                  onBusyChange={setMemoryBusy}
                />
              ) : null}
              {section === "voice" ? (
                <VoiceSettingsOverlay embedded onClose={requestClose} onBusyChange={setVoiceBusy} />
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
