import { Input as InputPrimitive } from "@base-ui/react/input";
import { Button } from "@rakazo/ui-web/components/ui/button";
import { cn } from "@rakazo/ui-web/lib/utils";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import * as React from "react";

type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: "default" | "lg" | "xl";
};

const inputClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-[size=lg]:h-9 data-[size=lg]:px-3 data-[size=xl]:h-12 data-[size=xl]:rounded-xl data-[size=xl]:px-4 data-[size=xl]:md:text-base";

/** The labels of the show/hide button on hidden fields; the kit itself is not translated. */
const RevealLabelsContext = React.createContext({ show: "Show password", hide: "Hide password" });

/** Supplies translated labels for the show/hide button of every hidden field below it. */
function InputRevealLabelsProvider({
  show,
  hide,
  children,
}: {
  show: string;
  hide: string;
  children: React.ReactNode;
}) {
  const labels = React.useMemo(() => ({ show, hide }), [show, hide]);
  return <RevealLabelsContext.Provider value={labels}>{children}</RevealLabelsContext.Provider>;
}

function Input({ className, type, size = "default", ...props }: InputProps) {
  if (type === "password") return <HiddenInput className={className} size={size} {...props} />;
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(inputClass, className)}
      {...props}
    />
  );
}

/**
 * A field whose value is hidden, with a button that shows it. The caller's classes go on the
 * wrapper, where layout such as margins belongs, so the button stays centred on the field.
 */
function HiddenInput({ className, size, disabled, ...props }: Omit<InputProps, "type">) {
  const labels = React.useContext(RevealLabelsContext);
  const [shown, setShown] = React.useState(false);
  return (
    <div data-slot="input-reveal" className={cn("relative w-full min-w-0", className)}>
      <InputPrimitive
        type={shown ? "text" : "password"}
        data-slot="input"
        data-size={size}
        disabled={disabled}
        className={cn(inputClass, "pr-9 data-[size=xl]:pr-12")}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size={size === "xl" ? "icon" : "icon-sm"}
        disabled={disabled}
        aria-label={shown ? labels.hide : labels.show}
        aria-pressed={shown}
        onClick={() => setShown((current) => !current)}
        className={cn(
          "absolute inset-y-0 my-auto text-muted-foreground",
          size === "xl" ? "right-2" : "right-1",
        )}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  );
}

export { Input, InputRevealLabelsProvider };
