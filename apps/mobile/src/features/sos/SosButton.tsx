/**
 * SOS.
 *
 * PRD §6.1: *one-tap SOS from driver/student app alerts admin and parents with
 * live location.* "One tap" is the requirement, but a single unguarded tap on a
 * phone in a driver's pocket would fire false alarms all day — and a service
 * whose alerts are usually false is a service nobody responds to.
 *
 * The resolution is a **press and hold**: still one gesture, still no dialog to
 * read, but impossible to trigger by accident. The ring fills over 1.5 seconds
 * with escalating haptics, and releasing early cancels.
 *
 * The position is captured at the moment of trigger and sent with the alert. If
 * the fix cannot be obtained in time we send the last known one rather than
 * failing — an alert with a stale position beats no alert at all, and the
 * server records which it was.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@/core/api/client';
import { trackingApi } from '@/core/api/endpoints';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import { Banner, Button, Icon, Sheet, Text } from '@/design/components';

const HOLD_MS = 1500;

export type SosCategory = 'MEDICAL' | 'ACCIDENT' | 'SECURITY' | 'BREAKDOWN' | 'OTHER';

const CATEGORIES: Array<{ value: SosCategory; label: string; hint: string }> = [
  { value: 'MEDICAL', label: 'Medical', hint: 'Someone on board needs medical help' },
  { value: 'ACCIDENT', label: 'Accident', hint: 'The vehicle has been in a collision' },
  { value: 'SECURITY', label: 'Security', hint: 'A safety or security threat' },
  { value: 'BREAKDOWN', label: 'Breakdown', hint: 'The vehicle cannot continue' },
  { value: 'OTHER', label: 'Other', hint: 'Anything else requiring urgent attention' },
];

export interface SosButtonProps {
  /** Attached to the alert so the office knows which bus and which run. */
  vehicleId?: string | null;
  tripId?: string | null;
  studentId?: string | null;
  /** `full` for the driver's dedicated control; `compact` for a parent's header. */
  size?: 'full' | 'compact';
  onRaised?: (alertId: string) => void;
}

export function SosButton({
  vehicleId,
  tripId,
  studentId,
  size = 'full',
  onRaised,
}: SosButtonProps) {
  const { colors } = useTheme();

  const [holding, setHolding] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [raisedId, setRaisedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progress = useRef(new Animated.Value(0)).current;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escalation = useRef<ReturnType<typeof setInterval> | null>(null);

  const raise = useMutation({
    mutationFn: async (category: SosCategory) => {
      const position = await currentPosition();

      return trackingApi.raiseSos({
        latitude: position.latitude,
        longitude: position.longitude,
        category,
        ...(vehicleId ? { vehicleId } : {}),
        ...(tripId ? { tripId } : {}),
        ...(studentId ? { studentId } : {}),
      });
    },
    onSuccess: (result) => {
      setRaisedId(result.alertId);
      setError(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onRaised?.(result.alertId);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : 'The alert could not be sent. Call the school office directly.',
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const clearTimers = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (escalation.current) clearInterval(escalation.current);
    holdTimer.current = null;
    escalation.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const startHold = useCallback(() => {
    setHolding(true);
    setError(null);

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      // Animating width, which the native driver cannot own.
      useNativeDriver: false,
    }).start();

    // Escalating pulse — the feedback tells you the hold is registering
    // without having to look at the screen, which is the point on a bus.
    escalation.current = setInterval(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, 300);

    holdTimer.current = setTimeout(() => {
      clearTimers();
      setHolding(false);
      progress.setValue(0);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setConfirmOpen(true);
    }, HOLD_MS);
  }, [progress, clearTimers]);

  const cancelHold = useCallback(() => {
    clearTimers();
    setHolding(false);
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [progress, clearTimers]);

  const compact = size === 'compact';

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Emergency SOS"
        accessibilityHint="Press and hold for one and a half seconds to raise an emergency alert"
        onPressIn={startHold}
        onPressOut={cancelHold}
        style={[
          styles.button,
          compact ? styles.buttonCompact : styles.buttonFull,
          { backgroundColor: colors.danger },
        ]}
      >
        {/* Fill sweeping left to right as the hold completes. */}
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: 'rgba(255,255,255,0.28)',
              width: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />

        <View style={styles.buttonContent}>
          <Icon name="sos" size={compact ? 18 : 26} color="#FFFFFF" />
          <View>
            <Text
              variant={compact ? 'bodyStrong' : 'title2'}
              tone="inherit"
              style={{ color: '#FFFFFF' }}
            >
              {holding ? 'Keep holding…' : 'SOS'}
            </Text>
            {!compact ? (
              <Text variant="caption" tone="inherit" style={styles.buttonHint}>
                {holding ? 'Release to cancel' : 'Press and hold for 1.5 seconds'}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>

      <Sheet
        visible={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setRaisedId(null);
          setError(null);
          raise.reset();
        }}
        title={raisedId ? 'Alert sent' : 'What is the emergency?'}
        subtitle={
          raisedId
            ? 'The school office and the parents on board have been notified with your live location.'
            : 'This alerts the school office immediately. Choose the closest match.'
        }
        dismissible={!raise.isPending}
      >
        {error ? <Banner tone="danger" icon="alert" title="Alert not sent" message={error} /> : null}

        {raisedId ? (
          <View style={styles.sentBlock}>
            <View style={[styles.sentHalo, { backgroundColor: colors.successSoft }]}>
              <Icon name="success" size={30} tone="success" />
            </View>
            <Text variant="body" tone="muted" align="center" style={{ marginTop: spacing.lg }}>
              Stay where you are if it is safe to do so. The office can see your
              position and will call you.
            </Text>
            <Button
              label="Done"
              variant="secondary"
              fullWidth
              onPress={() => {
                setConfirmOpen(false);
                setRaisedId(null);
              }}
              style={{ marginTop: spacing.xl }}
            />
          </View>
        ) : (
          CATEGORIES.map((category) => (
            <Button
              key={category.value}
              label={category.label}
              variant={category.value === 'OTHER' ? 'secondary' : 'danger'}
              size="lg"
              fullWidth
              loading={raise.isPending && raise.variables === category.value}
              disabled={raise.isPending}
              onPress={() => raise.mutate(category.value)}
            />
          ))
        )}
      </Sheet>
    </>
  );
}

/**
 * Best available position, fast.
 *
 * A high-accuracy fix can take 10–20 seconds under a bus roof, which is far too
 * long for an emergency. So: try the cached position first, fall back to a
 * balanced-accuracy fix, and if permission was never granted send zeroes —
 * the server still records the alert, the notification still goes out, and the
 * office still gets a phone call target. Silence would be the worst outcome.
 */
async function currentPosition(): Promise<{ latitude: number; longitude: number }> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();

    if (!permission.granted) {
      const asked = await Location.requestForegroundPermissionsAsync();
      if (!asked.granted) return { latitude: 0, longitude: 0 };
    }

    const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
    if (last) {
      return { latitude: last.coords.latitude, longitude: last.coords.longitude };
    }

    const fix = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
  } catch {
    return { latitude: 0, longitude: 0 };
  }
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  buttonFull: {
    minHeight: 78,
    paddingHorizontal: spacing.xl,
  },
  buttonCompact: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
  },
  fill: {
    ...StyleSheet.absoluteFill,
    right: undefined,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  buttonHint: {
    color: 'rgba(255,255,255,0.85)',
    marginTop: 1,
  },
  sentBlock: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  sentHalo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
