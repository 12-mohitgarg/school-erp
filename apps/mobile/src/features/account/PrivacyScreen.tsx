/**
 * Privacy & consent.
 *
 * PRD §6.3 and the DPDP gap item, made operable rather than described:
 *
 *  * Location tracking is consented to explicitly, and the consent is recorded
 *    server-side (`POST /auth/consent`) so it survives a reinstall and can be
 *    produced during a compliance review.
 *  * The disclosure states plainly *who* can see the location and *for how
 *    long* it is kept — before the toggle, not in a policy the user has to go
 *    looking for.
 *  * Withdrawal is one tap, and it is honest about the consequence: the live
 *    map stops working.
 */

import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { DEFAULT_LOCATION_RETENTION_DAYS } from '@erp/shared';
import { ApiError } from '@/core/api/client';
import { authApi } from '@/core/api/endpoints';
import { useAuth } from '@/core/auth/AuthProvider';
import { spacing } from '@/design/tokens';
import {
  Banner,
  Card,
  Icon,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  Text,
  ToggleRow,
} from '@/design/components';

export function PrivacyScreen() {
  const { role, activeChild } = useAuth();

  const isGuardian = role === 'PARENT';

  /**
   * The server holds the authoritative consent record; this mirrors it for the
   * duration of the screen. It starts from whether the child's link already
   * carries location access, which is what the API derived it from.
   */
  const [locationConsent, setLocationConsent] = useState(
    activeChild?.canViewLocation ?? true,
  );
  const [error, setError] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: (granted: boolean) =>
      authApi.recordConsent('LOCATION_TRACKING', granted),
    onError: (err, granted) => {
      // Put the switch back — a consent that failed to record is a consent
      // that does not exist, and showing it as saved would be a lie.
      setLocationConsent(!granted);
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not save your choice. Check your connection and try again.',
      );
    },
    onSuccess: () => setError(null),
  });

  const toggleLocation = (granted: boolean) => {
    if (!granted) {
      Alert.alert(
        'Turn off location tracking?',
        "You will no longer be able to see your child's bus on the live map, or receive " +
          'boarding and geofence alerts. SOS alerts are unaffected.',
        [
          { text: 'Keep it on', style: 'cancel' },
          {
            text: 'Turn off',
            style: 'destructive',
            onPress: () => {
              setLocationConsent(false);
              record.mutate(false);
            },
          },
        ],
      );
      return;
    }

    setLocationConsent(true);
    record.mutate(true);
  };

  return (
    <Screen scroll>
      {error ? <Banner tone="danger" icon="alert" title="Not saved" message={error} /> : null}

      {isGuardian ? (
        <>
          <SectionHeader
            title="Location tracking"
            subtitle="Required for the live bus map"
          />

          <Card elevation="sm">
            <ToggleRow
              title="Allow live location"
              subtitle={
                activeChild
                  ? `See ${activeChild.fullName}'s bus in real time`
                  : "See your child's bus in real time"
              }
              leadingIcon="map"
              value={locationConsent}
              onValueChange={toggleLocation}
              disabled={record.isPending}
            />
          </Card>

          {/* The disclosure the PRD asks to be transparent about. Stated as
              facts the reader can check, not reassurance. */}
          <Card elevation="none" style={styles.disclosure}>
            <Disclosure
              icon="eye"
              title="Who can see it"
              body={
                'Only you, as a verified guardian of this child, and authorised school ' +
                'staff. Other parents on the same bus cannot see your child, and you ' +
                'cannot see theirs.'
              }
            />
            <RowDivider />
            <Disclosure
              icon="clock"
              title="How long it is kept"
              body={`Location history is deleted automatically after ${DEFAULT_LOCATION_RETENTION_DAYS} days, or sooner if your school sets a shorter window.`}
            />
            <RowDivider />
            <Disclosure
              icon="shield"
              title="Every view is logged"
              body={
                'Each time anyone opens your child’s location — including school staff — ' +
                'it is written to an audit log with who, when and why.'
              }
            />
            <RowDivider />
            <Disclosure
              icon="trip"
              title="Only during trips"
              body={
                'The bus reports its position while a trip is running. Outside trip hours ' +
                'nothing is tracked.'
              }
            />
          </Card>
        </>
      ) : null}

      <View style={styles.section}>
        <SectionHeader title="Your data" subtitle="Rights under the DPDP Act" />
        <Card elevation="sm">
          <ListRow
            title="Request a copy of your data"
            subtitle="Everything held about you and your children"
            leadingIcon="document"
            onPress={() => contactOffice('Data access request')}
          />
          <RowDivider inset={50} />
          <ListRow
            title="Request a correction"
            subtitle="Something recorded about you is wrong"
            leadingIcon="settings"
            onPress={() => contactOffice('Data correction request')}
          />
          <RowDivider inset={50} />
          <ListRow
            title="Request erasure"
            subtitle="Withdraw and have your records deleted"
            leadingIcon="close"
            onPress={() => contactOffice('Data erasure request')}
          />
        </Card>

        <Text variant="caption" tone="subtle" style={styles.footnote}>
          Your school is the data controller and handles these requests. The
          office will verify your identity before acting on any of them.
        </Text>
      </View>
    </Screen>
  );
}

function Disclosure({
  icon,
  title,
  body,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  body: string;
}) {
  return (
    <View style={styles.disclosureRow}>
      <Icon name={icon} size={18} tone="brand" />
      <View style={styles.disclosureBody}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
          {body}
        </Text>
      </View>
    </View>
  );
}

/**
 * These requests are handled by the school, not by the app — the school is the
 * controller. Opening the mail client with a pre-filled subject is the honest
 * implementation; a form that pretended to file the request would not be.
 */
function contactOffice(subject: string): void {
  void Linking.openURL(
    `mailto:?subject=${encodeURIComponent(`${subject} — EduSphere`)}`,
  ).catch(() =>
    Alert.alert(
      'No email app',
      'Please contact your school office directly to make this request.',
    ),
  );
}

const styles = StyleSheet.create({
  disclosure: {
    marginTop: spacing.md,
  },
  disclosureRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  disclosureBody: {
    flex: 1,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  footnote: {
    marginTop: spacing.lg,
  },
});
