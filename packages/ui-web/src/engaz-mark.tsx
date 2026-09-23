import { ENGAZ_FACE_PATH, ENGAZ_FACE_VIEWBOX } from "@engaz/ui-tokens";
import { cn } from "./lib/utils.js";

/** The Engaz app icon in theme colors: the face on a muted tile, cropped by its corners. */
export function EngazMark({ className }: { className?: string }) {
  return (
    <span className={cn("block overflow-hidden rounded-[22%] bg-muted text-foreground", className)}>
      <svg viewBox={ENGAZ_FACE_VIEWBOX} aria-hidden="true" className="block size-full">
        <path fill="currentColor" fillRule="evenodd" d={ENGAZ_FACE_PATH} />
      </svg>
    </span>
  );
}
