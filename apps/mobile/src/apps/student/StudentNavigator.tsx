/**
 * Student app.
 *
 * PRD §2.4 — self-service: academic content, timetable, assignment submission,
 * results, attendance and library history. The tabs are the four things a
 * student uses daily; fees, library and the calendar sit one level down
 * because they are consulted, not lived in.
 */

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '@/design/ThemeProvider';
import { stackOptions, tabIcon, tabOptions } from '@/navigation/screenOptions';
import type { StudentStackParamList, StudentTabParamList } from '@/navigation/types';

import { StudentHomeScreen } from './StudentHomeScreen';
import { TimetableScreen } from '@/features/timetable/TimetableScreen';
import { HomeworkScreen } from '@/features/homework/HomeworkScreen';
import { AssignmentDetailScreen } from '@/features/homework/AssignmentDetailScreen';
import { ResultsScreen } from '@/features/results/ResultsScreen';
import { AttendanceScreen } from '@/features/attendance/AttendanceScreen';
import { LibraryScreen } from '@/features/library/LibraryScreen';
import { FeesScreen } from '@/features/fees/FeesScreen';
import { InvoiceDetailScreen } from '@/features/fees/InvoiceDetailScreen';
import { CalendarScreen } from '@/features/calendar/CalendarScreen';
import { AnnouncementsScreen } from '@/features/announcements/AnnouncementsScreen';
import { NotificationsScreen } from '@/features/notifications/NotificationsScreen';
import { ProfileScreen } from '@/features/account/ProfileScreen';
import { SettingsScreen } from '@/features/account/SettingsScreen';
import { ChangePasswordScreen } from '@/features/account/ChangePasswordScreen';
import { SessionsScreen } from '@/features/account/SessionsScreen';
import { PrivacyScreen } from '@/features/account/PrivacyScreen';

const Tab = createBottomTabNavigator<StudentTabParamList>();
const Stack = createNativeStackNavigator<StudentStackParamList>();

function StudentTabs() {
  const theme = useTheme();

  return (
    <Tab.Navigator screenOptions={tabOptions(theme)}>
      <Tab.Screen name="Home" options={{ tabBarIcon: tabIcon('home') }}>
        {({ navigation }) => (
          <StudentHomeScreen
            onOpenTimetable={() => navigation.navigate('Timetable')}
            onOpenHomework={() => navigation.navigate('Homework')}
            onOpenResults={() => navigation.navigate('Results')}
            onOpenAssignment={(assignmentId) =>
              navigation.getParent()?.navigate('AssignmentDetail', { assignmentId })
            }
            onOpenAttendance={() => navigation.getParent()?.navigate('Attendance')}
            onOpenLibrary={() => navigation.getParent()?.navigate('Library')}
            onOpenFees={() => navigation.getParent()?.navigate('Fees')}
            onOpenCalendar={() => navigation.getParent()?.navigate('Calendar')}
            onOpenAnnouncements={() => navigation.getParent()?.navigate('Announcements')}
            onOpenNotifications={() => navigation.getParent()?.navigate('Notifications')}
          />
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Timetable"
        component={TimetableScreen}
        options={{ tabBarIcon: tabIcon('timetable') }}
      />

      <Tab.Screen name="Homework" options={{ tabBarIcon: tabIcon('homework') }}>
        {({ navigation }) => (
          <HomeworkScreen
            onOpen={(assignmentId) =>
              navigation.getParent()?.navigate('AssignmentDetail', { assignmentId })
            }
          />
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Results"
        component={ResultsScreen}
        options={{ tabBarIcon: tabIcon('results') }}
      />

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

export function StudentNavigator() {
  const theme = useTheme();

  return (
    <Stack.Navigator screenOptions={stackOptions(theme)}>
      <Stack.Screen name="Tabs" component={StudentTabs} options={{ headerShown: false }} />

      <Stack.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{ title: 'My attendance' }}
      />
      <Stack.Screen name="Library" component={LibraryScreen} options={{ title: 'Library' }} />
      <Stack.Screen name="Calendar" component={CalendarScreen} options={{ title: 'Calendar' }} />
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

      <Stack.Screen name="Fees" options={{ title: 'Fees' }}>
        {({ navigation }) => (
          <FeesScreen
            onOpenInvoice={(invoiceId) => navigation.navigate('InvoiceDetail', { invoiceId })}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="InvoiceDetail" options={{ title: 'Invoice' }}>
        {({ route }) => <InvoiceDetailScreen invoiceId={route.params.invoiceId} />}
      </Stack.Screen>

      <Stack.Screen name="AssignmentDetail" options={{ title: 'Assignment' }}>
        {({ route }) => <AssignmentDetailScreen assignmentId={route.params.assignmentId} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
