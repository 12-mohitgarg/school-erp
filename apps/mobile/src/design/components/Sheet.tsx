/**
 * Bottom sheet.
 *
 * Used for the child switcher, the SOS confirmation and the boarding-action
 * picker. A modal rather than a navigation screen because all three are
 * *decisions about the current screen* — pushing a route would lose the
 * context the decision is being made against.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/design/ThemeProvider';
import { motion, radii, spacing } from '@/design/tokens';
import { Icon } from './Icon';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Content taller than this scrolls rather than pushing off-screen. */
  maxHeightRatio?: number;
  /** Hides the close affordance for a sheet that demands an explicit choice. */
  dismissible?: boolean;
}

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  maxHeightRatio = 0.8,
  dismissible = true,
}: SheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? motion.base : motion.fast,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  /** Android back closes the sheet before it closes the screen behind it. */
  useEffect(() => {
    if (!visible || !dismissible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, dismissible, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissible ? onClose : undefined}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
          onPress={dismissible ? onClose : undefined}
        />

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: insets.bottom + spacing.lg,
              maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
              transform: [
                {
                  translateY: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [400, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.hairline }]} />

          {title ? (
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text variant="title2">{title}</Text>
                {subtitle ? (
                  <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>

              {dismissible ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={onClose}
                  hitSlop={10}
                  style={[styles.closeButton, { backgroundColor: colors.surfaceSunken }]}
                >
                  <Icon name="close" size={18} tone="muted" />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    borderTopLeftRadius: radii['2xl'],
    borderTopRightRadius: radii['2xl'],
    borderCurve: 'continuous',
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: {
    flex: 1,
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
});
