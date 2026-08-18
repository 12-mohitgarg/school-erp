/**
 * Root.
 *
 * Decides which of the three products this session is. In a combined build the
 * signed-in role picks the tree; in a per-role binary (`APP_VARIANT=driver`)
 * the variant is also checked, so a driver who is handed the parent app is
 * told plainly rather than dropped into a screen with no data.
 *
 * Roles that belong on the web get a short explanation rather than a broken
 * mobile experience — `ROLE_SURFACE` in `@erp/shared` already records which
 * surface each role is designed for, so this is not a second opinion.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ROLE_LABELS, ROLE_SURFACE, type Role } from '@erp/shared';
import { env } from '@/config/env';
import { useAuth } from '@/core/auth/AuthProvider';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import { Button, EmptyState, Screen, Skeleton } from '@/design/components';
import { AuthNavigator } from '@/features/auth/AuthNavigator';
import { ParentNavigator } from '@/apps/parent/ParentNavigator';
import { StudentNavigator } from '@/apps/student/StudentNavigator';
import { DriverNavigator } from '@/apps/driver/DriverNavigator';

/** Which roles each binary is willing to serve. */
const VARIANT_ROLES: Record<string, Role[]> = {
  parent: ['PARENT'],
  student: ['STUDENT'],
  driver: ['DRIVER'],
  all: ['PARENT', 'STUDENT', 'DRIVER'],
};

export function RootNavigator() {
  const { status, role, signOut } = useAuth();

  const allowed = useMemo(() => VARIANT_ROLES[env.variant] ?? VARIANT_ROLES['all']!, []);

  if (status === 'loading') return <BootSkeleton />;
  if (status === 'signedOut') return <AuthNavigator />;

  if (!role) return <BootSkeleton />;

  // Signed in, but this binary is not for them.
  if (!allowed.includes(role)) {
    return <WrongApp role={role} onSignOut={() => void signOut()} />;
  }

  switch (role) {
    case 'PARENT':
      return <ParentNavigator />;
    case 'STUDENT':
      return <StudentNavigator />;
    case 'DRIVER':
      return <DriverNavigator />;
    default:
      return <WrongApp role={role} onSignOut={() => void signOut()} />;
  }
}

/**
 * Cold-start placeholder.
 *
 * The shape of a home screen rather than a spinner, for the same reason every
 * other wait in this app is a skeleton: the tokens are being read from the
 * keystore and `/auth/me` is in flight, and a spinner makes ~400ms feel like
 * a failure.
 */
function BootSkeleton() {
  const { colors } = useTheme();

  return (
    <View style={[styles.boot, { backgroundColor: colors.canvas }]}>
      <Skeleton width="100%" height={150} radius={20} />
      <View style={styles.bootRow}>
        <Skeleton width="47%" height={92} radius={16} />
        <Skeleton width="47%" height={92} radius={16} />
      </View>
      <View style={styles.bootRow}>
        <Skeleton width="47%" height={92} radius={16} />
        <Skeleton width="47%" height={92} radius={16} />
      </View>
      <Skeleton width="100%" height={120} radius={16} />
    </View>
  );
}

function WrongApp({ role, onSignOut }: { role: Role; onSignOut: () => void }) {
  const label = ROLE_LABELS[role];
  const surface = ROLE_SURFACE[role];

  const message =
    surface === 'web'
      ? `${label} accounts work in the EduSphere web portal, which has the full set of tools this role needs. Sign in there with the same credentials.`
      : `This app is built for a different role. Please install the EduSphere app for ${label} accounts.`;

  return (
    <Screen scroll>
      <View style={styles.wrongApp}>
        <EmptyState
          icon="lock"
          title={`Signed in as ${label}`}
          message={message}
        />
        <Button label="Sign out" variant="secondary" fullWidth onPress={onSignOut} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    padding: spacing.lg,
    paddingTop: spacing['5xl'],
    gap: spacing.md,
  },
  bootRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  wrongApp: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: spacing['4xl'],
    gap: spacing.xl,
  },
});
