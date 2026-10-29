import { WORKING_RING, workingRingLayout } from "@engaz/ui-tokens";
import { useId } from "react";

/** One centred comet for every avatar; omitted colour follows the theme. */
export function WorkingRing({ size, color }: { size: number; color?: string }) {
  const id = `comet-${useId().replace(/[^a-zA-Z0-9-_]/g, "")}`;
  const layout = workingRingLayout(size);
  return (
    <svg
      className="engaz-bot-avatar-ring absolute overflow-visible pointer-events-none text-foreground"
      style={{
        inset: layout.inset,
        animationDuration: `${WORKING_RING.durationMs}ms`,
        color,
        width: layout.size,
        height: layout.size,
      }}
      viewBox={WORKING_RING.viewBox}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={id}
          x1={WORKING_RING.startX}
          y1={WORKING_RING.startY}
          x2={WORKING_RING.headX}
          y2={WORKING_RING.headY}
          gradientUnits="userSpaceOnUse"
        >
          {WORKING_RING.gradientStops.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              stopColor="currentColor"
              stopOpacity={stop.opacity}
            />
          ))}
        </linearGradient>
      </defs>
      <path
        d={WORKING_RING.path}
        stroke={`url(#${id})`}
        strokeWidth={WORKING_RING.strokeWidth}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 ${WORKING_RING.blur}px currentColor)` }}
      />
      <circle
        cx={WORKING_RING.headX}
        cy={WORKING_RING.headY}
        r={WORKING_RING.headRadius}
        fill="currentColor"
      />
    </svg>
  );
}
