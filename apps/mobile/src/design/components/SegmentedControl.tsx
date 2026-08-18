/**
 * Segmented control.
 *
 * The selected pill slides between segments rather than cutting, which is what
 * makes it read as one control with a moving selection instead of a row of
 * buttons that light up. Uses the native driver, so the animation holds at
 * 60fps while the screen behind it is fetching.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useTheme } from '@/design/ThemeProvider';
import { motion, radii, spacing } from '@/design/tokens';
import { Text } from './Text';

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Optional count badge, e.g. "Unread 3". */
  count?: number;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Array<Segment<T>>;
  value: T;
  onChange: (next: T) => void;
}) {
  const { colors } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const offset = useRef(new Animated.Value(0)).current;

  const index = Math.max(
    0,
    segments.findIndex((s) => s.value === value),
  );
  const segmentWidth = segments.length > 0 ? trackWidth / segments.length : 0;

  useEffect(() => {
    Animated.spring(offset, {
      toValue: index * segmentWidth,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  }, [index, segmentWidth, offset]);

  const onLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width - PADDING * 2);
  };

  return (
    <View
      accessibilityRole="tablist"
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: colors.surfaceSunken }]}
    >
      {segmentWidth > 0 ? (
        <Animated.View
          style={[
            styles.thumb,
            {
              width: segmentWidth,
              backgroundColor: colors.surface,
              shadowColor: colors.shadow,
              transform: [{ translateX: offset }],
            },
          ]}
        />
      ) : null}

      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={segment.label}
            onPress={() => onChange(segment.value)}
            style={styles.segment}
          >
            <Text
              variant="callout"
              weight={selected ? '600' : '500'}
              numberOfLines={1}
              tone={selected ? 'default' : 'muted'}
            >
              {segment.label}
              {segment.count !== undefined && segment.count > 0 ? `  ${segment.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Expand/collapse helper used by the timetable day rows and the report-card
 * subject breakdown. `LayoutAnimation` rather than a measured height animation:
 * the content is variable-height and measuring it costs a layout pass we do
 * not need.
 */
export function animateNextLayout(): void {
  LayoutAnimation.configureNext({
    duration: motion.base,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

const PADDING = 3;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radii.md,
    borderCurve: 'continuous',
    padding: PADDING,
  },
  thumb: {
    position: 'absolute',
    top: PADDING,
    left: PADDING,
    bottom: PADDING,
    borderRadius: radii.sm + 2,
    borderCurve: 'continuous',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 1,
    paddingHorizontal: spacing.xs,
  },
});
