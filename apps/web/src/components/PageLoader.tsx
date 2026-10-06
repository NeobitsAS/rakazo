import { useLingui } from "@lingui/react/macro";
import type * as React from "react";
import { LoadingState } from "./ai/primitives";

/** The app's loader for something that is loading: pixels, a shimmering label and a timer. */
export function Loader() {
  const { t } = useLingui();
  return <LoadingState label={t`Loading`} />;
}

/** A whole page waiting for something to show: the loader, centred. */
export function PageLoader(props: React.ComponentProps<"div">) {
  return (
    <div role="status" className="grid h-full place-items-center bg-background" {...props}>
      <Loader />
    </div>
  );
}
