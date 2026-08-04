import { useState } from 'react';
import { ArrowLeft, Mail, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore, type AuthUser } from '@/lib/store';
import { apiRequest } from '@/lib/queryClient';
import bombinoLogo from '@/assets/bombino-logo.png';

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Set when the session lapsed under the user rather than them signing out.
  // Without it, being thrown back here reads as the app losing their login for
  // no reason.
  const expired = new URLSearchParams(window.location.search).get('expired') === '1';

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await apiRequest('POST', '/api/auth/login', { email: email.trim(), password });
      const user = (await res.json()) as AuthUser;
      login(user);
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect') || '/home';
      setLocation(redirect);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      // Strip the leading status code if present (e.g. "401: Invalid credentials")
      setError(message.replace(/^\d+:\s*/, ''));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background safe-top safe-bottom" data-testid="screen-login">
      <header className="sticky top-0 z-50 bg-white border-b border-border">
        <div className="flex items-center h-14 px-4">
          <button
            onClick={() => setLocation('/home')}
            className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
            data-testid="button-back-login"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="ml-2 font-semibold">Sign In</h1>
        </div>
      </header>

      <main className="px-4 py-8 flex flex-col items-center">
        <div className="max-w-md mx-auto w-full">
          <div className="flex flex-col items-center mb-8">
            <img src={bombinoLogo} alt="Bombino Express" className="h-auto w-[180px] mb-6 object-contain" />
            <h2 className="text-xl font-semibold text-[lab(34.0831_-9.57756_-27.7093)]">Sign In</h2>
            <p className="text-sm text-muted-foreground mt-1">Bringing the world closer</p>
          </div>

          {expired && (
            <div
              className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
              role="status"
              data-testid="notice-session-expired"
            >
              <p className="text-sm font-semibold text-amber-900">Your session expired</p>
              <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                You were signed out for security. Sign in again to pick up where you left off.
              </p>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_2px_12px_oklch(17%_0.048_248_/_0.06),_0_1px_3px_oklch(17%_0.048_248_/_0.04)] p-6 space-y-5 animate-fade-in">
            <div>
              <Label className="text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)]">Email</Label>
              <div className="relative mt-2">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  placeholder="Enter your email"
                  className="pl-10 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl"
                  autoComplete="email"
                  data-testid="input-email"
                />
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium text-[lab(34.0831_-9.57756_-27.7093)]">Password</Label>
              <div className="relative mt-2">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground z-10" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  placeholder="Enter your password"
                  className="pl-10 pr-12 h-12 bg-[#F3F4F6] border border-[#E2E8F0] rounded-xl"
                  autoComplete="current-password"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <Button
              onClick={handleSubmit}
              disabled={isLoading}
              className="w-full h-12 text-base font-semibold bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] rounded-xl shadow-[0_4px_20px_oklch(17%_0.048_248_/_0.10)] disabled:opacity-70 mt-1"
              data-testid="button-sign-in"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Sign In'
              )}
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-5">
            By signing in you agree to our{' '}
            <a href="/privacy" className="text-[#F2A123] underline hover:text-[#F2A123]/80">
              Privacy Policy
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

