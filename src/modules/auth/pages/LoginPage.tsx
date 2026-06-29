import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { Mail, Lock, Loader2, AlertCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { login, isAuthenticated, isLoading, error: authError } = useAuth();

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const from = (location.state as any)?.from?.pathname || '/my-roster';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      setLoginError('Please enter both email and password');
      return;
    }

    setIsSubmitting(true);
    setLoginError(null);

    try {
      await login(email.trim(), password);

      toast({
        title: 'Welcome back!',
        description: 'You have successfully signed in.',
      });

      const from = (location.state as any)?.from?.pathname || '/my-roster';
      navigate(from, { replace: true });
    } catch (err: any) {
      setLoginError(err.message || 'Invalid email or password');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f1113]">
        <Loader2 className="h-10 w-10 text-purple-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-[#0f1113] font-sans">

      {/* LEFT SIDE */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8 }}
        className="hidden md:flex md:w-1/2 relative overflow-hidden md:rounded-l-2xl"
      >
        {/* Image */}
        <img
          src="/auth-bg.jpeg"
          alt="Background"
          className="absolute inset-0 w-full h-full object-cover scale-105"
        />

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1113]/80 via-transparent to-transparent" />

        {/* Inner shadow (premium depth) */}
        <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.6)]" />

        {/* Content */}
        <div className="absolute bottom-12 left-12 z-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
              <ShieldCheck className="w-5 h-5 text-purple-400" />
            </div>
            <span className="text-white/80 text-xs uppercase tracking-wider">
              Enterprise Grade Security
            </span>
          </div>

          <h2 className="text-4xl font-bold text-white mb-2 leading-tight">
            Manage your workforce <br /> with intelligence.
          </h2>

          <p className="text-white/60 text-lg max-w-md">
            The ultimate platform for shift scheduling and labor optimization.
          </p>
        </div>

        {/* Glass divider edge */}
        <div className="absolute right-0 top-0 h-full w-[2px] bg-white/10 backdrop-blur-md" />
      </motion.div>

      {/* RIGHT SIDE */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8 }}
        className="flex-1 flex items-center justify-center p-6 md:p-12 bg-[#1a1c1e]"
      >
        <div className="w-full max-w-md">

          {/* Header */}
          <header className="mb-10">
            <h1 className="text-4xl font-bold text-white mb-3">Sign In</h1>
            <p className="text-gray-400">
              Already have an account?{' '}
              <Link
                to="/signup"
                className="text-purple-400 hover:text-purple-300 underline underline-offset-4"
              >
                Create one
              </Link>
            </p>
          </header>

          {/* Error */}
          <AnimatePresence>
            {(loginError || authError) && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-sm"
              >
                <AlertCircle className="w-5 h-5" />
                <p>{loginError || authError}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Email */}
            <div>
              <label className="text-sm text-gray-300">Email Address</label>
              <div className="relative mt-2">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <Input
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-14 pl-12 bg-[#25282c] text-base text-white rounded-xl"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-sm text-gray-300">Password</label>
              <div className="relative mt-2">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-14 pl-12 pr-12 bg-[#25282c] text-base text-white rounded-xl"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500"
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-between text-sm">
              <label className="flex items-center gap-2 text-gray-400">
                <input type="checkbox" className="w-4 h-4" />
                Remember me
              </label>

              <Link to="/forgot-password" className="text-purple-400">
                Forgot password?
              </Link>
            </div>

            {/* Button */}
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-14 bg-purple-600 hover:bg-purple-500 rounded-xl"
            >
              {isSubmitting ? <Loader2 className="animate-spin" /> : 'Sign In'}
            </Button>
          </form>

          {/* Divider */}
          <div className="mt-8 text-center text-gray-500 text-xs">
            Or continue with
          </div>

          {/* OneLogin */}
          <Button
            variant="outline"
            className="w-full h-14 mt-4 border-gray-700 text-white rounded-xl"
          >
            Login with OneLogin
          </Button>

          <footer className="mt-12 text-center text-xs text-gray-600">
            © 2026 Shiftopia Labor Management
          </footer>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
