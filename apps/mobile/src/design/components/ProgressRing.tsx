/**
 * Progress ring and bar.
 *
 * Attendance percentage is the number a parent looks for first, and a ring
 * communicates "how much of the whole" far faster than a figure alone. The
 * figure is still there in the middle — the ring is the gloss, not the data.
 */

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '@/design/ThemeProvider';
import { radii } from '@/design/tokens';
import { Text } from './Text';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface ProgressRingProps {
  /** 0–100. */
  value: number;
  size?: number;
  thickness?: number;
  label?: string;
  /** Overrides the automatic threshold colour. */
  color?: string;
}

/**
 * Thresholds match how Indian schools actually talk about attendance: 75% is
 * the usual minimum for exam eligibility, so below it is a warning, and below
 * 60% is a genuine problem — not arbitrary thirds.
 */
function thresholdColor(
  value: number,
  colors: { success: string; warning: string; danger: string },
): string {
  if (value >= 85) return colors.success;
  if (value >= 75) return colors.warning;
  return colors.danger;
}

export function ProgressRing({
  value,
  size = 96,
  thickness = 9,
  label,
  color,
}: ProgressRingProps) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  const progress = useRef(new Animated.Value(circumference)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: circumference * (1 - clamped / 100),
      duration: 700,
      // `strokeDashoffset` is not a transform, so this cannot go native.
      useNativeDriver: false,
    }).start();
  }, [clamped, circumference, progress]);

  const stroke = color ?? thresholdColor(clamped, colors);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      accessibilityLabel={label}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.surfaceSunken}
          strokeWidth={thickness}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke}
          strokeWidth={thickness}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={progress}
          // Start at 12 o'clock rather than 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>

      <View style={styles.ringCentre} pointerEvents="none">
        <Text variant="title2" tabular tone="inherit" style={{ color: stroke }}>
          {Math.round(clamped)}%
        </Text>
        {label ? (
          <Text variant="micro" tone="subtle" numberOfLines={1}>
            {label.toUpperCase()}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Horizontal variant, for subject-wise marks and fee collection progress. */
export function ProgressBar({
  value,
  color,
  height = 8,
  trackColor,
}: {
  value: number;
  color?: string;
  height?: number;
  trackColor?: string;
}) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const width = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: clamped,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [clamped, width]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      style={{
        height,
        borderRadius: radii.pill,
        backgroundColor: trackColor ?? colors.surfaceSunken,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          height: '100%',
          borderRadius: radii.pill,
          backgroundColor: color ?? thresholdColor(clamped, colors),
          width: width.interpolate({
            inputRange: [0, 100],
            outputRange: ['0%', '100%'],
          }),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ringCentre: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
