/** The Rakazo mark on the sign-in pages: two eyes in a circle. */
export function BrandMark() {
  return (
    <div
      aria-hidden="true"
      className="flex size-[74px] shrink-0 items-center justify-center gap-[11px] rounded-full bg-muted"
    >
      <span className="h-5 w-[9px] rounded-full bg-primary" />
      <span className="h-5 w-[9px] rounded-full bg-primary" />
    </div>
  );
}
