/**
 * The signed-out tree.
 *
 * Two screens and no navigator: a stack here would cost a native container and
 * a transition for what is a single toggle, and the login screen is the first
 * thing a user sees, so its time-to-first-paint is worth protecting.
 */

import { useState } from 'react';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';
import { LoginScreen } from './LoginScreen';

export function AuthNavigator() {
  const [showForgot, setShowForgot] = useState(false);

  return showForgot ? (
    <ForgotPasswordScreen onBack={() => setShowForgot(false)} />
  ) : (
    <LoginScreen onForgotPassword={() => setShowForgot(true)} />
  );
}
