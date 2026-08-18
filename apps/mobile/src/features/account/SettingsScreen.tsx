/**
 * App settings.
 *
 * Two groups: appearance, which is local, and notification channels, which are
 * server-side because the same preferences govern the SMS and email the school
 * sends. Changing "Push" here stops push on *every* device this account uses —
 * that is what the API models, so the copy says so rather than implying it is
 * a per-handset switch.
 *
 * Quiet hours are honoured for everything except EMERGENCY, which the server
 * overrides by design (PRD gap: "emergency channel override for SOS events").
 */

import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { communicationApi } from '@/core/api/endpoints';
import { qk } from '@/core/api/queryClient';
import { useTheme, type ThemePreference } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import {
  Banner,
  Card,
  ErrorState,
  ListSkeleton,
  RowDivider,
  Screen,
  SectionHeader,
  SegmentedControl,
  Text,
  ToggleRow,
} from '@/design/components';
import type { NotificationPreferences } from '@/core/api/types';

export function SettingsScreen() {
  const { preference, setPreference } = useTheme();
  const queryClient = useQueryClient();

  const prefs = useQuery({
    queryKey: qk.preferences(),
    queryFn: () => communicationApi.preferences(),
  });

  const update = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) =>
      communicationApi.updatePreferences(patch),
    // Optimistic: a toggle that waits for a round trip before moving feels
    // broken, and the only failure mode is that it springs back.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: qk.preferences() });
      const previous = queryClient.getQueryData<NotificationPreferences>(qk.preferences());

      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(qk.preferences(), {
          ...previous,
          ...patch,
        });
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(qk.preferences(), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.preferences() });
    },
  });

  const set = useCallback(
    (key: keyof NotificationPreferences) => (value: boolean) =>
      update.mutate({ [key]: value } as Partial<NotificationPreferences>),
    [update],
  );

  const data = prefs.data;

  return (
    <Screen scroll>
      <SectionHeader
        title="Appearance"
        subtitle="Dark mode is easier to read on a bus at dawn"
      />
      <Card elevation="sm">
        <SegmentedControl<ThemePreference>
          segments={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          value={preference}
          onChange={setPreference}
        />
      </Card>

      <View style={styles.section}>
        <SectionHeader
          title="Notifications"
          subtitle="These apply to every device signed in to this account"
        />

        {prefs.isPending ? (
          <ListSkeleton rows={3} />
        ) : prefs.isError ? (
          <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} compact />
        ) : data ? (
          <>
            <Card elevation="sm">
              <ToggleRow
                title="Push notifications"
                subtitle="Bus alerts, absence notices and messages on this phone"
                leadingIcon="bell"
                value={data.pushEnabled}
                onValueChange={set('pushEnabled')}
                disabled={update.isPending}
              />
              <RowDivider inset={50} />
              <ToggleRow
                title="SMS"
                subtitle="Text messages to your registered mobile number"
                leadingIcon="call"
                value={data.smsEnabled}
                onValueChange={set('smsEnabled')}
                disabled={update.isPending}
              />
              <RowDivider inset={50} />
              <ToggleRow
                title="Email"
                subtitle="Receipts, report cards and school notices"
                leadingIcon="document"
                value={data.emailEnabled}
                onValueChange={set('emailEnabled')}
                disabled={update.isPending}
              />
            </Card>

            {data.quietHoursStart && data.quietHoursEnd ? (
              <Banner
                tone="info"
                icon="clock"
                title={`Quiet hours: ${data.quietHoursStart} – ${data.quietHoursEnd}`}
                message="Routine notifications are held during these hours. Emergency and SOS alerts always come through."
              />
            ) : null}

            <Banner
              tone="warning"
              icon="sos"
              title="Emergency alerts cannot be turned off"
              message="SOS and safety alerts override every preference on this screen, including quiet hours. This is deliberate."
            />
          </>
        ) : null}
      </View>

      <Text variant="caption" tone="subtle" style={styles.footnote}>
        The in-app inbox always receives everything, regardless of the channels
        above — so nothing is ever lost, only delivered differently.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing['2xl'],
    gap: spacing.md,
  },
  footnote: {
    marginTop: spacing['2xl'],
  },
});
