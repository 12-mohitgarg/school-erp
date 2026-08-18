/**
 * Crash boundary.
 *
 * A render error in one screen must not take the whole app down — least of all
 * in the driver app, where the running trip is what everyone downstream
 * depends on. This catches it, shows something recoverable, and lets the user
 * retry without a force-quit.
 *
 * Class component because React still offers no hook equivalent of
 * `componentDidCatch`.
 *
 * Styled from raw tokens and React Native primitives rather than the design
 * system: the boundary wraps everything, and a fallback that itself depends on
 * a theme context could fail to render, leaving a blank white app.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { lightPalette, radii, spacing } from '@/design/tokens';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The API is wired for Sentry; this is where a native crash reporter would
    // hook in. Logging stays unconditional so a field report has something to
    // quote even from a release build's device log.
    console.error('[EduSphere] Unhandled render error', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.icon}>
            <Text style={styles.iconGlyph}>!</Text>
          </View>

          <Text style={styles.title}>Something went wrong</Text>

          <Text style={styles.body}>
            The app hit an unexpected problem on this screen. Your data is safe —
            nothing was lost.
          </Text>

          {__DEV__ ? <Text style={styles.stack}>{error.message}</Text> : null}

          <Pressable
            accessibilityRole="button"
            onPress={this.reset}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonLabel}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: lightPalette.canvas,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  icon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: lightPalette.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 28,
    fontWeight: '700',
    color: lightPalette.danger,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: lightPalette.ink,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: lightPalette.inkMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
    maxWidth: 320,
  },
  stack: {
    fontSize: 12,
    color: lightPalette.inkSubtle,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing['2xl'],
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: lightPalette.brand600,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
