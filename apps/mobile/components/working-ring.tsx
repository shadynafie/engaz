import { WORKING_RING, workingRingLayout } from "@engaz/ui-tokens";
import { useEffect, useId } from "react";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  FeDropShadow,
  Filter,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg";

export function WorkingRing({
  size,
  color,
  label,
}: {
  size: number;
  color: string;
  label: string;
}) {
  const id = `comet-${useId().replace(/[^a-zA-Z0-9-_]/g, "")}`;
  const layout = workingRingLayout(size);
  const rotation = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    cancelAnimation(rotation);
    rotation.value = 0;
    if (!reducedMotion) {
      rotation.value = withRepeat(
        withTiming(360, { duration: WORKING_RING.durationMs, easing: Easing.linear }),
        -1,
      );
    }
    return () => cancelAnimation(rotation);
  }, [reducedMotion, rotation]);
  const motion = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (
    <Animated.View
      accessible
      accessibilityLabel={label}
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: layout.inset,
          top: layout.inset,
          width: layout.size,
          height: layout.size,
        },
        motion,
      ]}
    >
      <Svg
        width={layout.size}
        height={layout.size}
        viewBox={WORKING_RING.viewBox}
        fill="none"
        accessible={false}
        style={{ overflow: "visible" }}
      >
        <Defs>
          <LinearGradient
            id={id}
            x1={WORKING_RING.startX}
            y1={WORKING_RING.startY}
            x2={WORKING_RING.headX}
            y2={WORKING_RING.headY}
            gradientUnits="userSpaceOnUse"
          >
            {WORKING_RING.gradientStops.map((stop) => (
              <Stop
                key={stop.offset}
                offset={stop.offset}
                stopColor={color}
                stopOpacity={stop.opacity}
              />
            ))}
          </LinearGradient>
          <Filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <FeDropShadow dx={0} dy={0} stdDeviation={WORKING_RING.blur} floodColor={color} />
          </Filter>
        </Defs>
        <Path
          d={WORKING_RING.path}
          stroke={`url(#${id})`}
          strokeWidth={WORKING_RING.strokeWidth}
          strokeLinecap="round"
          filter={`url(#${id}-glow)`}
        />
        <Circle
          cx={WORKING_RING.headX}
          cy={WORKING_RING.headY}
          r={WORKING_RING.headRadius}
          fill={color}
        />
      </Svg>
    </Animated.View>
  );
}
