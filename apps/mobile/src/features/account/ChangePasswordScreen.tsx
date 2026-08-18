/**
 * Change password.
 *
 * The API revokes the refresh cookie on success and requires a fresh sign-in,
 * so this screen ends by signing the user out — announcing that up front
 * rather than surprising them with a login wall after a successful change.
 */

import { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { ApiError } from '@/core/api/client';
import { authApi } from '@/core/api/endpoints';
import { useAuth } from '@/core/auth/AuthProvider';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import {
  Banner,
  Button,
  Card,
  Icon,
  Input,
  PasswordToggle,
  ProgressBar,
  Screen,
  Text,
  type InputRef,
} from '@/design/components';

/**
 * Mirrors the server's `passwordSchema`. Checked here purely so the user is
 * told *before* a round trip — the server remains the authority and rejects
 * anything that slips past.
 */
const RULES = [
  { test: (v: string) => v.length >= 8, label: 'At least 8 characters' },
  { test: (v: string) => /[A-Z]/.test(v), label: 'One uppercase letter' },
  { test: (v: string) => /[a-z]/.test(v), label: 'One lowercase letter' },
  { test: (v: string) => /\d/.test(v), label: 'One number' },
  { test: (v: string) => /[^A-Za-z0-9]/.test(v), label: 'One symbol' },
];

export function ChangePasswordScreen() {
  const { colors } = useTheme();
  const { signOut } = useAuth();

  const newRef = useRef<InputRef>(null);
  const confirmRef = useRef<InputRef>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState(false);

  const satisfied = useMemo(() => RULES.filter((r) => r.test(next)).length, [next]);
  const strength = (satisfied / RULES.length) * 100;

  const mismatch = confirm.length > 0 && confirm !== next;
  const sameAsOld = next.length > 0 && next === current;

  const canSubmit =
    current.length > 0 &&
    satisfied === RULES.length &&
    !mismatch &&
    !sameAsOld &&
    confirm.length > 0 &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      await authApi.changePassword(current, next, confirm);
      setDone(true);
      // Give the confirmation a beat to be read before the tree swaps out.
      setTimeout(() => void signOut(), 1600);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.details ?? {});
        setError(err.message);
      } else {
        setError('Could not change your password. Please try again.');
      }
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Screen scroll>
        <Card elevation="sm" style={styles.doneCard}>
          <View style={[styles.doneHalo, { backgroundColor: colors.successSoft }]}>
            <Icon name="success" size={30} tone="success" />
          </View>
          <Text variant="title2" align="center" style={{ marginTop: spacing.lg }}>
            Password changed
          </Text>
          <Text variant="body" tone="muted" align="center" style={{ marginTop: spacing.sm }}>
            Signing you out so you can sign back in with your new password.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen scroll>
        <Banner
          tone="info"
          icon="info"
          title="You will be signed out"
          message="Changing your password ends every session, on this device and any others."
        />

        <Card elevation="sm" style={{ marginTop: spacing.lg }}>
          {error ? <Banner tone="danger" icon="alert" title={error} /> : null}

          <Input
            label="Current password"
            value={current}
            onChangeText={setCurrent}
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoComplete="current-password"
            returnKeyType="next"
            editable={!submitting}
            error={fieldErrors['currentPassword']?.[0] ?? null}
            onSubmitEditing={() => newRef.current?.focus()}
            leading={<Icon name="lock" size={18} tone="subtle" />}
            containerStyle={{ marginTop: error ? spacing.lg : 0 }}
          />

          <Input
            ref={newRef}
            label="New password"
            value={next}
            onChangeText={setNext}
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoComplete="new-password"
            returnKeyType="next"
            editable={!submitting}
            error={
              sameAsOld
                ? 'Your new password must be different from the current one.'
                : (fieldErrors['newPassword']?.[0] ?? null)
            }
            onSubmitEditing={() => confirmRef.current?.focus()}
            leading={<Icon name="lock" size={18} tone="subtle" />}
            trailing={<PasswordToggle visible={visible} onToggle={() => setVisible((v) => !v)} />}
            containerStyle={{ marginTop: spacing.lg }}
          />

          {next.length > 0 ? (
            <View style={styles.strength}>
              <ProgressBar value={strength} height={5} />
              <View style={styles.rules}>
                {RULES.map((rule) => {
                  const ok = rule.test(next);
                  return (
                    <View key={rule.label} style={styles.rule}>
                      <Icon
                        name={ok ? 'success' : 'close'}
                        size={13}
                        tone={ok ? 'success' : 'subtle'}
                      />
                      <Text variant="caption" tone={ok ? 'success' : 'subtle'}>
                        {rule.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          <Input
            ref={confirmRef}
            label="Confirm new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoComplete="new-password"
            returnKeyType="go"
            editable={!submitting}
            error={mismatch ? 'Passwords do not match.' : null}
            onSubmitEditing={submit}
            leading={<Icon name="lock" size={18} tone="subtle" />}
            containerStyle={{ marginTop: spacing.lg }}
          />

          <Button
            label="Change password"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            onPress={submit}
            style={{ marginTop: spacing.xl }}
          />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  strength: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  rules: {
    gap: spacing.xs + 2,
  },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  doneCard: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
    marginTop: spacing['3xl'],
  },
  doneHalo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
