/**
 * Password reset request.
 *
 * The API deliberately answers identically whether or not the account exists,
 * so this screen must not imply otherwise. It confirms that *if* an account
 * matches, a link has gone out — anything more specific would turn the form
 * into an account-enumeration oracle.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/core/api/client';
import { authApi } from '@/core/api/endpoints';
import { useTheme } from '@/design/ThemeProvider';
import { spacing } from '@/design/tokens';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Screen,
  Text,
} from '@/design/components';

export function ForgotPasswordScreen({ onBack }: { onBack: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [identifier, setIdentifier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (identifier.trim().length < 3 || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await authApi.forgotPassword(identifier.trim());
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <Screen>
        <View style={[styles.centered, { paddingTop: insets.top }]}>
          <EmptyState
            icon="success"
            title="Check your inbox"
            message={
              'If an account matches what you entered, a reset link is on its way. ' +
              'The link expires in 48 hours.'
            }
            actionLabel="Back to sign in"
            onAction={onBack}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={[styles.content, { paddingTop: insets.top + spacing.lg }]}>
          <Button
            label="Back"
            variant="ghost"
            size="sm"
            leading={<Icon name="back" size={16} tone="brand" />}
            onPress={onBack}
            style={styles.backButton}
          />

          <Text variant="title1" style={{ marginTop: spacing.xl }}>
            Reset your password
          </Text>
          <Text variant="body" tone="muted" style={{ marginTop: spacing.sm }}>
            Enter the email or phone number your school has on file. We will send
            you a link to set a new password.
          </Text>

          <Card elevation="sm" style={{ marginTop: spacing['2xl'] }}>
            {error ? <Banner tone="danger" icon="alert" title={error} /> : null}

            <Input
              label="Email or phone"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="you@school.edu.in"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="send"
              editable={!submitting}
              onSubmitEditing={submit}
              leading={<Icon name="profile" size={18} tone="subtle" />}
              containerStyle={{ marginTop: error ? spacing.lg : 0 }}
            />

            <Button
              label="Send reset link"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={identifier.trim().length < 3}
              onPress={submit}
              style={{ marginTop: spacing.xl }}
            />
          </Card>

          <View style={[styles.note, { borderColor: colors.hairline }]}>
            <Icon name="lock" size={14} tone="subtle" />
            <Text variant="caption" tone="subtle" style={styles.noteText}>
              For your security we do not confirm whether an account exists. If no
              link arrives, contact the school office.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  noteText: {
    flex: 1,
  },
});
