import { useLingui } from "@lingui/react/macro";
import { Button, DialogClose, DialogDescription, DialogHeader, DialogTitle } from "@rakazo/ui-web";
import { ChevronLeft, X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The top of a page inside a dialog: the title, a back arrow when the page sits under another,
 * an icon and a detail line when the page is about one thing (a server's logo and address, say),
 * and the close button. Every dialog page uses it so they all read the same.
 */
export function DialogPageHeader({
  title,
  description,
  icon,
  onBack,
  closeLabel,
  closeDisabled = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  onBack?: () => void;
  closeLabel: string;
  closeDisabled?: boolean;
}) {
  const { t } = useLingui();
  return (
    <DialogHeader className="flex-row items-start justify-between gap-4 px-6 pt-6 pb-5 sm:px-8 sm:pt-7">
      <div className="flex min-w-0 items-start gap-2">
        {onBack ? (
          <Button
            variant="ghost"
            size="icon-sm"
            // Centred on the icon when there is one, otherwise on the title's first line.
            className={icon ? "mt-1" : undefined}
            aria-label={t`Back`}
            onClick={onBack}
          >
            <ChevronLeft />
          </Button>
        ) : null}
        {icon ? <div className="mr-1 shrink-0">{icon}</div> : null}
        <div className="min-w-0">
          <DialogTitle className="truncate text-2xl font-medium text-foreground">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
              {description}
            </DialogDescription>
          ) : null}
        </div>
      </div>
      <DialogClose
        aria-label={closeLabel}
        disabled={closeDisabled}
        render={<Button variant="ghost" size="icon-sm" />}
      >
        <X />
      </DialogClose>
    </DialogHeader>
  );
}
