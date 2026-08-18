/**
 * Sign in.
 *
 * One screen for all three products. The API's `identifier` field takes an
 * email *or* a phone number, because schools reliably issue one but not the
 * other — a driver usually has only a phone, a parent usually only an email,
 * and forcing either to guess which they were given is the most common reason
 * a first login fails.
 */

import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ApiError } from '@/core/api/client';
import { useAuth } from '@/core/auth/AuthProvider';
import { useTheme } from '@/design/ThemeProvider';
import { radii, spacing } from '@/design/tokens';
import {
  Banner,
  Button,
  Card,
  Icon,
  Input,
  PasswordToggle,
  Text,
  type InputRef,
} from '@/design/components';
import { env } from '@/config/env';

/** What each variant calls itself on the sign-in screen. */
const VARIANT_COPY: Record<string, { title: string; blurb: string }> = {
  parent: {
    title: 'Parent',
    blurb: "Your child's bus, attendance, results and fees — in one place.",
  },
  student: {
    title: 'Student',
    blurb: 'Timetable, homework, results and library — wherever you are.',
  },
  driver: {
    title: 'Driver',
    blurb: 'Your route, your stops, and the safety of everyone on board.',
  },
  all: {
    title: 'School ERP',
    blurb: 'Sign in with the account your school issued you.',
  },
};

export function LoginScreen({ onForgotPassword }: { onForgotPassword: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  const passwordRef = useRef<InputRef>(null);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const copy = VARIANT_COPY[env.variant] ?? VARIANT_COPY['all']!;

  const canSubmit = identifier.trim().length >= 3 && password.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      await signIn(identifier, password);
      // No navigation here: the root navigator swaps trees on auth status, so
      // a success simply causes this screen to unmount.
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.details ?? {});
        setError(
          err.status === 401
            ? 'That email or phone and password do not match an account.'
            : err.message,
        );
      } else {
        setError('Something went wrong. Please try again.');
      }
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <StatusBar style="light" />

      {/* Brand header. A gradient rather than a flat fill because the login
          screen is the only place the product gets to make an impression
          before it has any data to show. */}
      <LinearGradient
        colors={[colors.brand700, colors.brand500]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing['3xl'] }]}
      >
        <View style={styles.logoMark}>
          <Icon name="shield" size={26} color="#FFFFFF" />
        </View>

        <Text variant="display" tone="inherit" style={styles.wordmark}>
          EduSphere
        </Text>
        <Text variant="callout" tone="inherit" style={styles.headerBlurb}>
          {copy.blurb}
        </Text>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.formWrap}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[styles.formScroll, { paddingBottom: insets.bottom + spacing['3xl'] }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Card elevation="md" style={styles.card}>
            <Text variant="title2">Sign in</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
              {copy.title} account
            </Text>

            {error ? (
              <Banner tone="danger" icon="alert" title={error} />
            ) : null}

            <Input
              label="Email or phone"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="you@school.edu.in"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              keyboardType="email-address"
              returnKeyType="next"
              editable={!submitting}
              error={fieldErrors['identifier']?.[0] ?? null}
              onSubmitEditing={() => passwordRef.current?.focus()}
              leading={<Icon name="profile" size={18} tone="subtle" />}
              containerStyle={{ marginTop: spacing.lg }}
            />

            <Input
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              editable={!submitting}
              error={fieldErrors['password']?.[0] ?? null}
              onSubmitEditing={submit}
              leading={<Icon name="lock" size={18} tone="subtle" />}
              trailing={
                <PasswordToggle
                  visible={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                />
              }
              containerStyle={{ marginTop: spacing.lg }}
            />

            <Pressable
              accessibilityRole="button"
              onPress={onForgotPassword}
              hitSlop={8}
              style={styles.forgot}
            >
              <Text variant="caption" tone="brand" weight="600">
                Forgot password?
              </Text>
            </Pressable>

            <Button
              label="Sign in"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={!canSubmit}
              onPress={submit}
              style={{ marginTop: spacing.xl }}
            />
          </Card>

          {/* Where accounts come from. Schools create them; nobody self-serves,
              and saying so here saves a support call. */}
          <View style={styles.footnote}>
            <Icon name="info" size={14} tone="subtle" />
            <Text variant="caption" tone="subtle" style={styles.footnoteText}>
              Accounts are issued by your school. If you have not received your
              sign-in details, contact the school office.
            </Text>
          </View>

          {env.isDev ? (
            <Text variant="micro" tone="subtle" align="center" style={{ marginTop: spacing.lg }}>
              {`DEV · ${env.apiUrl}`}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['4xl'],
    borderBottomLeftRadius: radii['2xl'],
    borderBottomRightRadius: radii['2xl'],
    borderCurve: 'continuous',
  },
  logoMark: {
    width: 52,
    height: 52,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: spacing.lg,
  },
  wordmark: {
    color: '#FFFFFF',
  },
  headerBlurb: {
    color: 'rgba(255,255,255,0.86)',
    marginTop: spacing.sm,
    maxWidth: 300,
  },
  formWrap: {
    flex: 1,
  },
  formScroll: {
    paddingHorizontal: spacing.lg,
    // Pulls the card up so it overlaps the gradient — the one flourish on the
    // screen, and the thing that stops it looking like a plain form.
    marginTop: -spacing['2xl'],
  },
  card: {
    padding: spacing.xl,
    gap: 0,
  },
  forgot: {
    alignSelf: 'flex-end',
    marginTop: spacing.md,
  },
  footnote: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  footnoteText: {
    flex: 1,
  },
});
