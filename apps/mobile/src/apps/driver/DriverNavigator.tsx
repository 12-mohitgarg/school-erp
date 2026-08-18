/**
 * Driver app.
 *
 * Four tabs, and the first one is the job. A driver is working while using
 * this, often one-handed at a stop, so the app is deliberately shallow: the
 * two things that matter — the trip and the boarding list — are both tabs, not
 * screens you navigate to.
 *
 * "Alerts" is the per-user notification inbox rather than the school-wide
 * safety feed: `GET /tracking/alerts` is scoped to the tenant, not to the
 * driver's own vehicle, so it would show every bus in the school.
 *
 * Route-deviation and over-speed warnings are *not* here — they never become
 * notification rows, so they are surfaced live on the trip screen instead,
 * filtered to this driver's own bus.
 */

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '@/design/ThemeProvider';
import { stackOptions, tabIcon, tabOptions } from '@/navigation/screenOptions';
import type { DriverStackParamList, DriverTabParamList } from '@/navigation/types';

import { TripScreen } from './TripScreen';
import { ManifestScreen } from './ManifestScreen';
import { NotificationsScreen } from '@/features/notifications/NotificationsScreen';
import { ProfileScreen } from '@/features/account/ProfileScreen';
import { SettingsScreen } from '@/features/account/SettingsScreen';
import { ChangePasswordScreen } from '@/features/account/ChangePasswordScreen';
import { SessionsScreen } from '@/features/account/SessionsScreen';
import { PrivacyScreen } from '@/features/account/PrivacyScreen';

const Tab = createBottomTabNavigator<DriverTabParamList>();
const Stack = createNativeStackNavigator<DriverStackParamList>();

function DriverTabs() {
  const theme = useTheme();

  return (
    <Tab.Navigator screenOptions={tabOptions(theme)}>
      <Tab.Screen name="Trip" options={{ tabBarIcon: tabIcon('trip') }}>
        {({ navigation }) => (
          <TripScreen onOpenManifest={() => navigation.navigate('Manifest')} />
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Manifest"
        component={ManifestScreen}
        options={{ tabBarLabel: 'Boarding', tabBarIcon: tabIcon('manifest') }}
      />

      <Tab.Screen
        name="Alerts"
        component={NotificationsScreen}
        options={{ tabBarIcon: tabIcon('bell') }}
      />

      <Tab.Screen name="More" options={{ tabBarIcon: tabIcon('profile') }}>
        {({ navigation }) => (
          <ProfileScreen
            onOpenSettings={() => navigation.getParent()?.navigate('Settings')}
            onOpenChangePassword={() => navigation.getParent()?.navigate('ChangePassword')}
            onOpenSessions={() => navigation.getParent()?.navigate('Sessions')}
            onOpenPrivacy={() => navigation.getParent()?.navigate('Privacy')}
            onOpenNotifications={() => navigation.navigate('Alerts')}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export function DriverNavigator() {
  const theme = useTheme();

  return (
    <Stack.Navigator screenOptions={stackOptions(theme)}>
      <Stack.Screen name="Tabs" component={DriverTabs} options={{ headerShown: false }} />

      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: 'Alerts' }}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{ title: 'Change password' }}
      />
      <Stack.Screen name="Sessions" component={SessionsScreen} options={{ title: 'Devices' }} />
      <Stack.Screen
        name="Privacy"
        component={PrivacyScreen}
        options={{ title: 'Privacy & consent' }}
      />
    </Stack.Navigator>
  );
}
