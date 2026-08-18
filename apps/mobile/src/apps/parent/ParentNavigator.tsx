/**
 * Parent / Guardian app.
 *
 * Five tabs, chosen from PRD §2.5 by what a guardian opens the app *for*:
 * where the bus is, what they owe, who they need to talk to, and everything
 * else. Detail screens are pushed onto a stack above the tabs so a deep link
 * from a push notification lands on the right screen with a back button, not
 * inside a tab with no way out.
 */

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '@/design/ThemeProvider';
import { stackOptions, tabIcon, tabOptions } from '@/navigation/screenOptions';
import type { ParentStackParamList, ParentTabParamList } from '@/navigation/types';

import { ParentHomeScreen } from './ParentHomeScreen';
import { LiveTrackingScreen } from './LiveTrackingScreen';
import { TripHistoryScreen } from './TripHistoryScreen';
import { AttendanceScreen } from '@/features/attendance/AttendanceScreen';
import { ResultsScreen } from '@/features/results/ResultsScreen';
import { HomeworkScreen } from '@/features/homework/HomeworkScreen';
import { AssignmentDetailScreen } from '@/features/homework/AssignmentDetailScreen';
import { FeesScreen } from '@/features/fees/FeesScreen';
import { InvoiceDetailScreen } from '@/features/fees/InvoiceDetailScreen';
import { LibraryScreen } from '@/features/library/LibraryScreen';
import { TimetableScreen } from '@/features/timetable/TimetableScreen';
import { ConversationsScreen } from '@/features/chat/ConversationsScreen';
import { ChatThreadScreen } from '@/features/chat/ChatThreadScreen';
import { AnnouncementsScreen } from '@/features/announcements/AnnouncementsScreen';
import { NotificationsScreen } from '@/features/notifications/NotificationsScreen';
import { ProfileScreen } from '@/features/account/ProfileScreen';
import { SettingsScreen } from '@/features/account/SettingsScreen';
import { ChangePasswordScreen } from '@/features/account/ChangePasswordScreen';
import { SessionsScreen } from '@/features/account/SessionsScreen';
import { PrivacyScreen } from '@/features/account/PrivacyScreen';

const Tab = createBottomTabNavigator<ParentTabParamList>();
const Stack = createNativeStackNavigator<ParentStackParamList>();

function ParentTabs() {
  const theme = useTheme();

  return (
    <Tab.Navigator screenOptions={tabOptions(theme)}>
      <Tab.Screen name="Home" options={{ tabBarIcon: tabIcon('home') }}>
        {({ navigation }) => (
          <ParentHomeScreen
            onOpenTracking={() => navigation.navigate('Tracking')}
            onOpenFees={() => navigation.navigate('Fees')}
            onOpenMessages={() => navigation.navigate('Messages')}
            onOpenAttendance={() => navigation.getParent()?.navigate('Attendance')}
            onOpenResults={() => navigation.getParent()?.navigate('Results')}
            onOpenHomework={() => navigation.getParent()?.navigate('Homework')}
            onOpenTimetable={() => navigation.getParent()?.navigate('Timetable')}
            onOpenLibrary={() => navigation.getParent()?.navigate('Library')}
            onOpenAnnouncements={() => navigation.getParent()?.navigate('Announcements')}
            onOpenNotifications={() => navigation.getParent()?.navigate('Notifications')}
          />
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Tracking"
        options={{ tabBarLabel: 'Live bus', tabBarIcon: tabIcon('map') }}
      >
        {({ navigation }) => (
          <LiveTrackingScreen
            onOpenHistory={() => navigation.getParent()?.navigate('TripHistory')}
          />
        )}
      </Tab.Screen>

      <Tab.Screen name="Fees" options={{ tabBarIcon: tabIcon('fees') }}>
        {({ navigation }) => (
          <FeesScreen
            onOpenInvoice={(invoiceId) =>
              navigation.getParent()?.navigate('InvoiceDetail', { invoiceId })
            }
          />
        )}
      </Tab.Screen>

      <Tab.Screen name="Messages" options={{ tabBarIcon: tabIcon('chat') }}>
        {({ navigation }) => (
          <ConversationsScreen
            onOpenThread={(conversationId, title) =>
              navigation.getParent()?.navigate('ChatThread', { conversationId, title })
            }
          />
        )}
      </Tab.Screen>

      <Tab.Screen name="More" options={{ tabBarIcon: tabIcon('profile') }}>
        {({ navigation }) => (
          <ProfileScreen
            onOpenSettings={() => navigation.getParent()?.navigate('Settings')}
            onOpenChangePassword={() => navigation.getParent()?.navigate('ChangePassword')}
            onOpenSessions={() => navigation.getParent()?.navigate('Sessions')}
            onOpenPrivacy={() => navigation.getParent()?.navigate('Privacy')}
            onOpenNotifications={() => navigation.getParent()?.navigate('Notifications')}
            onOpenAnnouncements={() => navigation.getParent()?.navigate('Announcements')}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export function ParentNavigator() {
  const theme = useTheme();

  return (
    <Stack.Navigator screenOptions={stackOptions(theme)}>
      <Stack.Screen name="Tabs" component={ParentTabs} options={{ headerShown: false }} />

      <Stack.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{ title: 'Attendance' }}
      />
      <Stack.Screen name="Results" component={ResultsScreen} options={{ title: 'Results' }} />
      <Stack.Screen name="Timetable" component={TimetableScreen} options={{ title: 'Timetable' }} />
      <Stack.Screen name="Library" component={LibraryScreen} options={{ title: 'Library' }} />
      <Stack.Screen
        name="TripHistory"
        component={TripHistoryScreen}
        options={{ title: 'Trip history' }}
      />
      <Stack.Screen
        name="Announcements"
        component={AnnouncementsScreen}
        options={{ title: 'Announcements' }}
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

      <Stack.Screen name="Notifications" options={{ title: 'Notifications' }}>
        {() => <NotificationsScreen />}
      </Stack.Screen>

      <Stack.Screen name="Homework" options={{ title: 'Homework' }}>
        {({ navigation }) => (
          <HomeworkScreen
            onOpen={(assignmentId) => navigation.navigate('AssignmentDetail', { assignmentId })}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="AssignmentDetail" options={{ title: 'Assignment' }}>
        {({ route }) => <AssignmentDetailScreen assignmentId={route.params.assignmentId} />}
      </Stack.Screen>

      <Stack.Screen name="InvoiceDetail" options={{ title: 'Invoice' }}>
        {({ route }) => <InvoiceDetailScreen invoiceId={route.params.invoiceId} />}
      </Stack.Screen>

      <Stack.Screen
        name="ChatThread"
        options={({ route }) => ({ title: route.params.title })}
      >
        {({ route }) => <ChatThreadScreen conversationId={route.params.conversationId} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
