import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, GraduationCap, Loader2, Lock, Mail, ShieldCheck, MapPin, BarChart3 } from 'lucide-react';
import { useAppDispatch } from '@/store';
import { signedIn } from '@/store/authSlice';
import { errorMessage } from '@/lib/api';
import { Alert, Button, Input } from '@/components/ui';
import { landingRoute } from '@/lib/navigation';
import { useAuth } from './useAuth';
import { useLoginMutation } from './authApi';

/** Demo accounts, shown in development so the panels are easy to explore. */
const DEMO_ACCOUNTS = [
  { label: 'School Admin', email: 'principal@dpsdelhi.edu.in' },
  { label: 'Teacher', email: 'teacher.math@dpsdelhi.edu.in' },
  { label: 'Accountant', email: 'accounts@dpsdelhi.edu.in' },
  { label: 'Librarian', email: 'library@dpsdelhi.edu.in' },
  { label: 'HR', email: 'hr@dpsdelhi.edu.in' },
  { label: 'Parent', email: 'parent.1a@example.com' },
];

export function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, user } = useAuth();

  const [login, { isLoading }] = useLoginMutation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={landingRoute(user?.permissions ?? [], from)} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const result = await login({ identifier, password }).unwrap();
      dispatch(signedIn({ user: result.user, accessToken: result.tokens.accessToken }));

      // Only follow the deep link if this role can open it.
      const from = (location.state as { from?: string } | null)?.from;
      navigate(landingRoute(result.user.permissions, from), { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed. Please try again.'));
    }
  }

  return (
    <div className="flex min-h-full">
      {/* Brand panel — hidden on small screens where it would just push the form down. */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-violet-700 p-10 lg:flex xl:w-[55%]">
        {/* Decorative mesh */}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.35) 0, transparent 45%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.25) 0, transparent 40%)',
          }}
          aria-hidden="true"
        />

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <GraduationCap className="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-semibold text-white">EduSphere</p>
            <p className="text-xs text-white/70">School ERP Platform</p>
          </div>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white text-balance">
            One system for academics, finance, operations and student safety.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-white/80">
            Admissions to report cards, fee collection to payroll, and every school bus on
            a live map — connected through a single source of truth.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              { Icon: MapPin, text: 'Live GPS tracking with geofencing, ETA and one-tap SOS' },
              { Icon: ShieldCheck, text: 'Role-based access with a full audit trail on every change' },
              { Icon: BarChart3, text: 'Academic, financial and safety analytics in one place' },
            ].map(({ Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/85">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="h-3.5 w-3.5 text-white" aria-hidden="true" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          © {new Date().getFullYear()} EduSphere Solutions. Confidential.
        </p>
      </aside>

      {/* Form */}
      <main className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-1/2 xl:w-[45%]">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-brand-glow">
              <GraduationCap className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <p className="text-lg font-semibold text-ink">EduSphere</p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Sign in to continue to your dashboard.
          </p>

          {error && (
            <Alert tone="danger" className="mt-5" onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Input
              label="Email or phone"
              type="text"
              autoComplete="username"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@school.edu.in"
              leftIcon={<Mail className="h-4 w-4" aria-hidden="true" />}
            />

            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="rounded p-1.5 text-ink-subtle transition-colors hover:text-ink"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />

            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm font-medium text-brand-600 transition-colors hover:text-brand-700"
              >
                Forgot password?
              </button>
            </div>

            <Button type="submit" size="lg" fullWidth loading={isLoading}>
              {isLoading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {import.meta.env.DEV && (
            <div className="mt-8 rounded-xl border border-hairline bg-surface-sunken/50 p-4">
              <p className="text-xs font-medium text-ink">Demo accounts</p>
              <p className="mt-0.5 text-xs text-ink-subtle">
                Password for all: <code className="font-mono">Password@123</code>
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => {
                      setIdentifier(account.email);
                      setPassword('Password@123');
                    }}
                    className="rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink-muted transition-colors hover:border-brand-500/50 hover:text-brand-600"
                  >
                    {account.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/** Full-screen loader shown while the session is being restored. */
export function AuthBootScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden="true" />
        <p className="text-sm text-ink-muted">Restoring your session…</p>
      </div>
    </div>
  );
}

