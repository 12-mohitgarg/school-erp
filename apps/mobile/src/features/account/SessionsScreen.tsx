/**
 * Signed-in devices.
 *
 * The API scopes a refresh-token *family* to a device id, which is what makes
 * this list meaningful — each row is a real device, not a token. Revoking one
 * kills its whole family, so a stolen phone loses access immediately rather
 * than at the next 15-minute access-token expiry.
 */

import { Alert, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/core/api/endpoints';
import { formatDateTime, formatRelative } from '@/core/utils/format';
import { spacing } from '@/design/tokens';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListSkeleton,
  Screen,
  Text,
} from '@/design/components';
import type { SessionRow } from '@/core/api/types';

const SESSIONS_KEY = ['auth', 'sessions'] as const;

export function SessionsScreen() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => authApi.sessions(),
  });

  const revoke = useMutation({
    mutationFn: (sessionId: string) => authApi.revokeSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });

  if (query.isPending) {
    return (
      <Screen scroll>
        <ListSkeleton rows={3} />
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen scroll>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const sessions = query.data ?? [];
  const others = sessions.filter((s) => !s.isCurrent);

  return (
    <Screen scroll onRefresh={() => void query.refetch()} refreshing={query.isFetching}>
      <Banner
        tone="info"
        icon="shield"
        title="One row per device"
        message="Signing out a device revokes its access straight away — it cannot refresh its session."
      />

      {sessions.length === 0 ? (
        <EmptyState icon="shield" title="No other sessions" compact />
      ) : (
        <View style={styles.list}>
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              busy={revoke.isPending && revoke.variables === session.id}
              onRevoke={() =>
                Alert.alert(
                  'Sign out this device?',
                  'It will need the account password to sign in again.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Sign out',
                      style: 'destructive',
                      onPress: () => revoke.mutate(session.id),
                    },
                  ],
                )
              }
            />
          ))}
        </View>
      )}

      {others.length > 1 ? (
        <Text variant="caption" tone="subtle" style={styles.footnote}>
          Seeing a device you do not recognise? Sign it out, then change your
          password — that ends every session at once.
        </Text>
      ) : null}
    </Screen>
  );
}

function SessionCard({
  session,
  busy,
  onRevoke,
}: {
  session: SessionRow;
  busy: boolean;
  onRevoke: () => void;
}) {
  return (
    <Card elevation="sm">
      <View style={styles.row}>
        <Icon name="profile" size={22} tone={session.isCurrent ? 'brand' : 'muted'} />

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
              {describeDevice(session)}
            </Text>
            {session.isCurrent ? <Badge label="This device" tone="brand" /> : null}
          </View>

          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            Last used {formatRelative(session.lastUsedAt)}
          </Text>
          <Text variant="micro" tone="subtle" style={{ marginTop: 2 }}>
            {`SIGNED IN ${formatDateTime(session.createdAt).toUpperCase()}`}
            {session.ipAddress ? ` · ${session.ipAddress}` : ''}
          </Text>
        </View>
      </View>

      {!session.isCurrent ? (
        <Button
          label="Sign out this device"
          variant="secondary"
          size="sm"
          loading={busy}
          onPress={onRevoke}
          style={{ marginTop: spacing.md }}
        />
      ) : null}
    </Card>
  );
}

/**
 * A readable device name.
 *
 * The user agent is the only hint the server has for a mobile client, and
 * showing it raw ("okhttp/4.12.0") tells nobody anything.
 */
function describeDevice(session: SessionRow): string {
  const ua = session.userAgent ?? '';

  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/okhttp|CFNetwork|Expo/i.test(ua)) return 'EduSphere app';
  if (/Chrome|Safari|Firefox|Edg/i.test(ua)) return 'Web browser';

  return 'Unknown device';
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  body: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  footnote: {
    marginTop: spacing.xl,
  },
});
