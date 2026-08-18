/**
 * Loading, empty and error states.
 *
 * The rule this file exists to enforce, carried over from the web app: **every
 * waiting screen shows the shape of what is coming — never a spinner, never
 * the word "Loading…"**. A skeleton that mirrors the real composition means
 * nothing shifts when the data lands, and the app feels fast even when the
 * network is not.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import { Button } from './Button';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

/**
 * A single shimmering block. The pulse is opacity-only and runs on the native
 * driver, so a screen full of them costs nothing on the JS thread — which is
 * the thread that is already busy parsing the response we are waiting for.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = radii.sm,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.surfaceSunken,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

/** Placeholder for a list of cards — the most common wait in the app. */
export function ListSkeleton({ rows = 4, showAvatar = false }: { rows?: number; showAvatar?: boolean }) {
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i} elevation="none">
          <View style={styles.skeletonRow}>
            {showAvatar ? <Skeleton width={40} height={40} radius={20} /> : null}
            <View style={styles.skeletonRowBody}>
              <Skeleton width="62%" height={15} />
              <Skeleton width="40%" height={12} />
            </View>
            <Skeleton width={54} height={20} radius={radii.pill} />
          </View>
        </Card>
      ))}
    </View>
  );
}

/** Placeholder for the stat grid at the top of every home screen. */
export function StatGridSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <View style={styles.statGrid}>
      {Array.from({ length: tiles }, (_, i) => (
        <Card key={i} elevation="none" style={styles.statTile}>
          <Skeleton width="55%" height={11} />
          <Skeleton width="72%" height={26} style={{ marginTop: spacing.sm }} />
        </Card>
      ))}
    </View>
  );
}

/** Placeholder for the live map — same footprint, so nothing jumps. */
export function MapSkeleton({ height = 280 }: { height?: number }) {
  return <Skeleton width="100%" height={height} radius={radii.lg} />;
}

// ---------------------------------------------------------------------------
// Empty & error
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  /** Say what would put something here, not merely that there is nothing. */
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({
  icon = 'info',
  title,
  message,
  actionLabel,
  onAction,
  compact = false,
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.centered, compact ? styles.centeredCompact : null]}>
      <View style={[styles.iconHalo, { backgroundColor: colors.surfaceSunken }]}>
        <Icon name={icon} size={26} tone="subtle" />
      </View>

      <Text variant="title3" align="center" style={{ marginTop: spacing.lg }}>
        {title}
      </Text>

      {message ? (
        <Text variant="callout" tone="muted" align="center" style={styles.centeredMessage}>
          {message}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          variant="secondary"
          size="sm"
          onPress={onAction}
          style={{ marginTop: spacing.xl }}
        />
      ) : null}
    </View>
  );
}

/**
 * Error state.
 *
 * Shows the server's own message rather than a generic apology — "You are not
 * authorised to view this student" tells a guardian something actionable;
 * "Something went wrong" does not. Retry is offered only when retrying could
 * actually help.
 */
export function ErrorState({
  error,
  onRetry,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { message, retryable, icon } = describeError(error);

  return (
    <EmptyState
      icon={icon}
      title={retryable ? 'Could not load this' : 'Not available'}
      message={message}
      actionLabel={retryable && onRetry ? 'Try again' : undefined}
      onAction={retryable ? onRetry : undefined}
      compact={compact}
    />
  );
}

function describeError(error: unknown): {
  message: string;
  retryable: boolean;
  icon: IconName;
} {
  const candidate = error as
    | { status?: number; message?: string; isTransient?: boolean; isOffline?: boolean }
    | null;

  if (candidate?.isOffline) {
    return {
      message: 'You appear to be offline. This will load as soon as you reconnect.',
      retryable: true,
      icon: 'offline',
    };
  }

  if (candidate?.status === 403) {
    return {
      message: candidate.message ?? 'You do not have access to this.',
      retryable: false,
      icon: 'lock',
    };
  }

  if (candidate?.status === 404) {
    return {
      message: candidate.message ?? 'That record no longer exists.',
      retryable: false,
      icon: 'info',
    };
  }

  return {
    message: candidate?.message ?? 'The server did not respond as expected.',
    retryable: candidate?.isTransient ?? true,
    icon: 'alert',
  };
}

// ---------------------------------------------------------------------------
// Inline banner
// ---------------------------------------------------------------------------

/**
 * A persistent strip at the top of a screen — offline notice, queued-events
 * count, consent still outstanding. Not a toast: these describe a *state*, and
 * a state that disappears after three seconds cannot be acted on.
 */
export function Banner({
  tone = 'info',
  icon,
  title,
  message,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const { colors } = useTheme();

  const palette = {
    info: { bg: colors.infoSoft, fg: colors.info },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    success: { bg: colors.successSoft, fg: colors.success },
  }[tone];

  return (
    <View style={[styles.banner, { backgroundColor: palette.bg, borderColor: palette.fg }]}>
      <Icon name={icon ?? 'info'} size={18} color={palette.fg} />

      <View style={styles.bannerBody}>
        <Text variant="callout" weight="600" tone="inherit" style={{ color: palette.fg }}>
          {title}
        </Text>
        {message ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {message}
          </Text>
        ) : null}
      </View>

      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  skeletonRowBody: {
    flex: 1,
    gap: spacing.sm,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statTile: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 92,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['4xl'],
    paddingHorizontal: spacing.lg,
  },
  centeredCompact: {
    paddingVertical: spacing['2xl'],
  },
  centeredMessage: {
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  iconHalo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    borderLeftWidth: 3,
  },
  bannerBody: {
    flex: 1,
  },
});
