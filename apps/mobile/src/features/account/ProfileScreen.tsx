/**
 * Profile / "More".
 *
 * The hub every tab bar's last item points at. Its contents are role-aware:
 * a guardian gets the child switcher and privacy controls, a driver gets the
 * sync status, and everyone gets sessions and sign-out.
 */

import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Application from 'expo-application';
import { useAuth } from '@/core/auth/AuthProvider';
import { useNetwork } from '@/core/offline/NetworkProvider';
import { useSocket } from '@/core/realtime/SocketProvider';
import { humanise } from '@/core/utils/format';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  Text,
} from '@/design/components';
import { ChildSwitcherSheet } from '@/features/account/ChildSwitcherSheet';

export interface ProfileScreenProps {
  onOpenSettings: () => void;
  onOpenChangePassword: () => void;
  onOpenSessions: () => void;
  onOpenPrivacy: () => void;
  onOpenNotifications: () => void;
  onOpenAnnouncements?: () => void;
}

export function ProfileScreen({
  onOpenSettings,
  onOpenChangePassword,
  onOpenSessions,
  onOpenPrivacy,
  onOpenNotifications,
  onOpenAnnouncements,
}: ProfileScreenProps) {
  const { colors } = useTheme();
  const { user, role, children, activeChild, signOut } = useAuth();
  const { connection } = useSocket();
  const { isOnline, pending } = useNetwork();

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  const confirmSignOut = () => {
    Alert.alert(
      'Sign out?',
      pending > 0
        ? `${pending} queued update${pending === 1 ? '' : 's'} have not been sent yet. ` +
          'Signing out now will discard them.'
        : 'You will need your password to sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            setSigningOut(true);
            void signOut().finally(() => setSigningOut(false));
          },
        },
      ],
    );
  };

  return (
    <Screen scroll padded={false}>
      {/* Identity header. Brand gradient so the "More" tab does not read as an
          afterthought pile of settings. */}
      <LinearGradient
        colors={[colors.brand700, colors.brand500]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <Avatar name={user.fullName} uri={user.avatarUrl} size="xl" />

        <Text variant="title1" tone="inherit" style={styles.headerName}>
          {user.fullName}
        </Text>

        <View style={styles.headerMeta}>
          <Badge label={humanise(role ?? '')} tone="neutral" variant="solid" />
          <Text variant="caption" tone="inherit" style={styles.headerSchool} numberOfLines={1}>
            {user.tenantName}
          </Text>
        </View>

        {user.email ? (
          <Text variant="caption" tone="inherit" style={styles.headerContact}>
            {user.email}
          </Text>
        ) : null}
      </LinearGradient>

      <View style={styles.body}>
        {/* Connection state, stated plainly. A parent whose map has stopped
            updating deserves to know it is the connection, not the bus. */}
        <Card elevation="sm">
          <ListRow
            title={connection === 'live' ? 'Live updates connected' : 'Live updates offline'}
            subtitle={
              connection === 'live'
                ? 'Bus positions and messages arrive in real time.'
                : isOnline
                  ? 'Reconnecting…'
                  : 'No network. Data will refresh when you reconnect.'
            }
            leadingIcon={connection === 'live' ? 'online' : 'offline'}
            leadingTone={connection === 'live' ? 'success' : 'warning'}
            showChevron={false}
          />
          {pending > 0 ? (
            <>
              <RowDivider inset={50} />
              <ListRow
                title={`${pending} update${pending === 1 ? '' : 's'} waiting to sync`}
                subtitle="These will be sent automatically once you are back online."
                leadingIcon="refresh"
                leadingTone="warning"
                showChevron={false}
              />
            </>
          ) : null}
        </Card>

        {/* Guardians with more than one child switch here as well as from the
            home screen — whichever they reach for first. */}
        {children.length > 1 ? (
          <View style={styles.section}>
            <SectionHeader title="Children" subtitle={`${children.length} linked to this account`} />
            <Card elevation="sm">
              <ListRow
                title={activeChild?.fullName ?? 'Select a child'}
                subtitle={
                  activeChild
                    ? `${activeChild.className} · ${activeChild.sectionName}`
                    : undefined
                }
                leading={
                  activeChild ? (
                    <Avatar name={activeChild.fullName} uri={activeChild.avatarUrl} size="md" />
                  ) : undefined
                }
                trailing={<Icon name="swap" size={16} tone="brand" />}
                showChevron={false}
                onPress={() => setSwitcherOpen(true)}
              />
            </Card>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader title="Inbox" />
          <Card elevation="sm">
            <ListRow
              title="Notifications"
              subtitle="Alerts addressed to you"
              leadingIcon="bell"
              leadingTone="brand"
              onPress={onOpenNotifications}
            />
            {onOpenAnnouncements ? (
              <>
                <RowDivider inset={50} />
                <ListRow
                  title="Announcements"
                  subtitle="Notices published by the school"
                  leadingIcon="megaphone"
                  leadingTone="info"
                  onPress={onOpenAnnouncements}
                />
              </>
            ) : null}
          </Card>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Account & security" />
          <Card elevation="sm">
            <ListRow
              title="App settings"
              subtitle="Appearance and notification channels"
              leadingIcon="settings"
              onPress={onOpenSettings}
            />
            <RowDivider inset={50} />
            <ListRow
              title="Change password"
              leadingIcon="lock"
              onPress={onOpenChangePassword}
            />
            <RowDivider inset={50} />
            <ListRow
              title="Signed-in devices"
              subtitle="Review and sign out other devices"
              leadingIcon="shield"
              onPress={onOpenSessions}
            />
            <RowDivider inset={50} />
            <ListRow
              title="Privacy & consent"
              subtitle="Location tracking, data rights"
              leadingIcon="eye"
              onPress={onOpenPrivacy}
            />
          </Card>
        </View>

        <Button
          label="Sign out"
          variant="secondary"
          fullWidth
          loading={signingOut}
          leading={<Icon name="logout" size={16} tone="danger" />}
          onPress={confirmSignOut}
          style={styles.signOut}
        />

        <Text variant="micro" tone="subtle" align="center" style={styles.version}>
          {`EDUSPHERE ${Application.nativeApplicationVersion ?? '1.0.0'}`}
          {Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ''}
        </Text>
      </View>

      <ChildSwitcherSheet visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    paddingTop: spacing['3xl'],
    paddingBottom: spacing['2xl'],
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: radii['2xl'],
    borderBottomRightRadius: radii['2xl'],
    borderCurve: 'continuous',
  },
  headerName: {
    color: '#FFFFFF',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  headerSchool: {
    color: 'rgba(255,255,255,0.88)',
    maxWidth: 190,
  },
  headerContact: {
    color: 'rgba(255,255,255,0.72)',
    marginTop: spacing.xs,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  section: {
    marginTop: spacing.xl,
  },
  signOut: {
    marginTop: spacing['2xl'],
  },
  version: {
    marginTop: spacing.xl,
  },
});
