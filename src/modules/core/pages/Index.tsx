import React, { useRef } from 'react';
import { motion, useInView, useScroll, useTransform } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle,
  Calendar,
  CalendarDays,
  Users,
  Clock,
  BarChart3,
  Shield,
  Repeat,
  Bell,
  Smartphone,
  Zap,
  Building2,
  Award,
  ChevronRight,
  Play,
  Star,
  ArrowUpRight,
  Sparkles,
  Globe,
  Lock,
  TrendingUp,
  UserCheck,
  CalendarCheck,
  MessageSquare,
  FileText,
  Settings,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';

// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const fadeInLeft = {
  hidden: { opacity: 0, x: -40 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const fadeInRight = {
  hidden: { opacity: 0, x: 40 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: 'easeOut' },
  },
};

// Animated Section Wrapper
const AnimatedSection: React.FC<{
  children: React.ReactNode;
  className?: string;
  id?: string;
}> = ({ children, className, id }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <motion.section
      id={id}
      ref={ref}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      variants={staggerContainer}
      className={className}
    >
      {children}
    </motion.section>
  );
};

// Feature Card Component
const FeatureCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  gradient: string;
  delay?: number;
}> = ({ icon, title, description, gradient, delay = 0 }) => (
  <motion.div
    variants={fadeInUp}
    whileHover={{ y: -8, transition: { duration: 0.3 } }}
    className="group relative bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl p-6 hover:border-white/20 transition-all duration-500"
  >
    <div
      className={cn(
        'absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500',
        gradient
      )}
    />
    <div className="relative z-10">
      <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-white/60 leading-relaxed">{description}</p>
    </div>
  </motion.div>
);

// Stat Card Component
const StatCard: React.FC<{
  value: string;
  label: string;
  icon: React.ReactNode;
}> = ({ value, label, icon }) => (
  <motion.div
    variants={scaleIn}
    className="text-center p-6 bg-white/[0.02] rounded-2xl border border-white/5"
  >
    <div className="flex justify-center mb-3">{icon}</div>
    <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
      {value}
    </div>
    <div className="text-sm text-white/50 mt-1">{label}</div>
  </motion.div>
);

// Process Step Component
const ProcessStep: React.FC<{
  number: string;
  title: string;
  description: string;
  isLast?: boolean;
}> = ({ number, title, description, isLast }) => (
  <motion.div variants={fadeInUp} className="relative flex gap-4">
    <div className="flex flex-col items-center">
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
        {number}
      </div>
      {!isLast && (
        <div className="w-px h-full bg-gradient-to-b from-purple-500/50 to-transparent mt-2" />
      )}
    </div>
    <div className="pb-8">
      <h4 className="text-white font-semibold mb-1">{title}</h4>
      <p className="text-sm text-white/60">{description}</p>
    </div>
  </motion.div>
);

const Index: React.FC = () => {
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  const features = [
    {
      icon: <Calendar className="h-6 w-6 text-purple-400" />,
      title: 'Smart Roster Management',
      description:
        'Create and publish staff rosters with intelligent drag-and-drop scheduling. View by day, 3-day, week, or month.',
      gradient: 'bg-gradient-to-br from-purple-500/10 to-transparent',
    },
    {
      icon: <Repeat className="h-6 w-6 text-blue-400" />,
      title: 'Shift Swap System',
      description:
        'Enable seamless shift swaps between staff with manager approval workflows and automatic notifications.',
      gradient: 'bg-gradient-to-br from-blue-500/10 to-transparent',
    },
    {
      icon: <Bell className="h-6 w-6 text-pink-400" />,
      title: 'Broadcast Messaging',
      description:
        'Send targeted announcements to specific groups. Track engagement and ensure critical updates reach your team.',
      gradient: 'bg-gradient-to-br from-pink-500/10 to-transparent',
    },
    {
      icon: <CalendarDays className="h-6 w-6 text-green-400" />,
      title: 'Availability Tracking',
      description:
        'Staff can easily input preferences and availability. Prevent conflicts with real-time scheduling checks.',
      gradient: 'bg-gradient-to-br from-green-500/10 to-transparent',
    },
    {
      icon: <BarChart3 className="h-6 w-6 text-amber-400" />,
      title: 'Advanced Analytics',
      description:
        'Data-driven insights on labor costs, scheduling efficiency, attendance patterns, and workforce optimization.',
      gradient: 'bg-gradient-to-br from-amber-500/10 to-transparent',
    },
    {
      icon: <Shield className="h-6 w-6 text-cyan-400" />,
      title: 'Role-Based Access',
      description:
        'Granular permissions for Admins, Managers, Team Leads, and Members. Secure, compliant access control.',
      gradient: 'bg-gradient-to-br from-cyan-500/10 to-transparent',
    },
    {
      icon: <Clock className="h-6 w-6 text-orange-400" />,
      title: 'Timesheet Management',
      description:
        'Automated timesheet generation from actual hours worked. Seamless payroll integration and exports.',
      gradient: 'bg-gradient-to-br from-orange-500/10 to-transparent',
    },
    {
      icon: <UserCheck className="h-6 w-6 text-emerald-400" />,
      title: 'Shift Bidding',
      description:
        'Empower employees to bid on open shifts based on qualifications. Managers approve with a single click.',
      gradient: 'bg-gradient-to-br from-emerald-500/10 to-transparent',
    },
  ];

  const benefits = [
    {
      icon: <Zap className="h-5 w-5" />,
      title: '80% Faster Scheduling',
      description: 'Automate roster creation and reduce manual work',
    },
    {
      icon: <TrendingUp className="h-5 w-5" />,
      title: '30% Cost Reduction',
      description: 'Optimize labor allocation based on real demand',
    },
    {
      icon: <Shield className="h-5 w-5" />,
      title: '100% Compliant',
      description: 'Meet labor laws, break requirements, and regulations',
    },
    {
      icon: <Star className="h-5 w-5" />,
      title: '95% Staff Satisfaction',
      description: 'Better work-life balance with preference matching',
    },
  ];

  return (
    <div className="min-h-screen w-full bg-[#030014] text-white overflow-hidden">
      {/* Gradient Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-500/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-pink-500/20 rounded-full blur-[128px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500/10 rounded-full blur-[128px]" />
      </div>

      {/* Navigation */}
      <motion.nav
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-black/20 border-b border-white/5"
      >
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Calendar className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-lg">ShiftoPia</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a
              href="#features"
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              How it Works
            </a>
            <a
              href="#benefits"
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              Benefits
            </a>
            <a
              href="#icc"
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              For ICC Sydney
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              className="text-white/70 hover:text-white"
              asChild
            >
              <a href="/login">Login</a>
            </Button>
            <Button
              className="bg-gradient-to-r from-purple-500 to-pink-500 border-0 hover:opacity-90"
              asChild
            >
              <a href="/login">Get Started</a>
            </Button>
          </div>
        </div>
      </motion.nav>

      {/* Hero Section */}
      <section
        ref={heroRef}
        className="relative min-h-screen flex items-center justify-center pt-16"
      >
        <motion.div
          style={{ y: heroY, opacity: heroOpacity }}
          className="container mx-auto px-6 text-center max-w-5xl relative z-10"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Badge className="mb-6 bg-white/5 border-white/10 text-white/80 backdrop-blur-sm px-4 py-1.5">
              <Sparkles className="h-3 w-3 mr-2 text-purple-400" />
              Trusted by ICC Sydney & Leading Venues
            </Badge>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-tight tracking-tight"
          >
            Roster management,{' '}
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient">
              re-imagined for scale
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="mx-auto mt-6 max-w-2xl text-lg md:text-xl text-white/60"
          >
            Streamline workforce scheduling at Australia's premier convention
            centre. ShiftoPia delivers intelligent rostering, real-time shift
            management, and seamless team communication—all in one powerful
            platform.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Button
              size="lg"
              className="bg-gradient-to-r from-purple-500 to-pink-500 border-0 hover:opacity-90 transition-all duration-300 px-8 h-12 text-base group"
              asChild
            >
              <a href="/login">
                Start Free Trial
                <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/20 bg-white/5 backdrop-blur-sm hover:bg-white/10 h-12 px-8 text-base"
            >
              <Play className="mr-2 h-4 w-4" />
              Watch Demo
            </Button>
          </motion.div>

          {/* Trust Badges */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-16 flex flex-wrap items-center justify-center gap-8 text-white/40"
          >
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              <span className="text-sm">ICC Sydney</span>
            </div>
            <div className="flex items-center gap-2">
              <Award className="h-5 w-5" />
              <span className="text-sm">Award Winning</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              <span className="text-sm">Enterprise Ready</span>
            </div>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              <span className="text-sm">SOC 2 Compliant</span>
            </div>
          </motion.div>
        </motion.div>

        {/* Hero Dashboard Preview */}
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-5xl px-6"
        >
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-t from-[#030014] via-transparent to-transparent z-10 h-32 bottom-0 top-auto" />
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-t-2xl p-4 shadow-2xl">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <div className="grid grid-cols-7 gap-2">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
                  (day, i) => (
                    <div key={day} className="text-center">
                      <div className="text-xs text-white/40 mb-2">{day}</div>
                      <div
                        className={cn(
                          'h-16 rounded-lg border',
                          i === 2
                            ? 'bg-purple-500/20 border-purple-500/30'
                            : i === 4
                            ? 'bg-green-500/20 border-green-500/30'
                            : 'bg-white/5 border-white/10'
                        )}
                      />
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Stats Section */}
      <AnimatedSection className="py-20 relative z-10">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatCard
              value="50K+"
              label="Shifts Managed Monthly"
              icon={<Calendar className="h-6 w-6 text-purple-400" />}
            />
            <StatCard
              value="2,500+"
              label="Active Staff Members"
              icon={<Users className="h-6 w-6 text-blue-400" />}
            />
            <StatCard
              value="98%"
              label="Schedule Accuracy"
              icon={<CheckCircle className="h-6 w-6 text-green-400" />}
            />
            <StatCard
              value="4.9/5"
              label="User Satisfaction"
              icon={<Star className="h-6 w-6 text-amber-400" />}
            />
          </div>
        </div>
      </AnimatedSection>

      {/* Features Section */}
      <AnimatedSection id="features" className="py-20 relative z-10">
        <div className="container mx-auto px-6">
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <Badge className="mb-4 bg-purple-500/10 border-purple-500/20 text-purple-400">
              Powerful Features
            </Badge>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">
              Powerful Features for{' '}
              <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Modern Teams
              </span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-white/60 text-lg">
              Everything you need to manage complex workforce scheduling at
              scale. Built specifically for large venue operations like ICC
              Sydney.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <FeatureCard key={index} {...feature} delay={index * 0.1} />
            ))}
          </div>
        </div>
      </AnimatedSection>

      {/* Dashboard Showcase Section */}
      <AnimatedSection className="py-20 relative z-10">
        <div className="container mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div variants={fadeInLeft}>
              <Badge className="mb-4 bg-blue-500/10 border-blue-500/20 text-blue-400">
                Intuitive Dashboard
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                See Your Entire Operation{' '}
                <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  at a Glance
                </span>
              </h2>
              <p className="text-white/60 text-lg mb-8">
                Our unified dashboard gives managers real-time visibility into
                schedules, availability, shift swaps, and team
                communications—all from one screen.
              </p>

              <div className="space-y-4">
                {[
                  {
                    icon: <CalendarCheck className="h-5 w-5" />,
                    text: 'Multi-view calendar (Day, 3-Day, Week, Month)',
                  },
                  {
                    icon: <Repeat className="h-5 w-5" />,
                    text: 'Real-time shift swap approvals',
                  },
                  {
                    icon: <MessageSquare className="h-5 w-5" />,
                    text: 'Integrated broadcast messaging',
                  },
                  {
                    icon: <BarChart3 className="h-5 w-5" />,
                    text: 'Live analytics and reporting',
                  },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    variants={fadeInLeft}
                    className="flex items-center gap-3 text-white/80"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-purple-400">
                      {item.icon}
                    </div>
                    {item.text}
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div variants={fadeInRight} className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-3xl blur-3xl" />
              <div className="relative bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
                {/* Mock Dashboard */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500" />
                      <div>
                        <div className="font-semibold">ICC Sydney</div>
                        <div className="text-xs text-white/50">
                          Convention Centre
                        </div>
                      </div>
                    </div>
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                      Live
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="text-2xl font-bold text-purple-400">
                        156
                      </div>
                      <div className="text-xs text-white/50">Shifts Today</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="text-2xl font-bold text-green-400">
                        12
                      </div>
                      <div className="text-xs text-white/50">Swap Requests</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="text-2xl font-bold text-blue-400">
                        98%
                      </div>
                      <div className="text-xs text-white/50">Coverage</div>
                    </div>
                  </div>

                  <div className="bg-white/5 rounded-lg p-4">
                    <div className="text-sm font-medium mb-3">
                      Weekly Overview
                    </div>
                    <div className="flex items-end justify-between h-24 gap-2">
                      {[40, 65, 80, 55, 90, 45, 30].map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 flex flex-col items-center gap-1"
                        >
                          <div
                            className="w-full bg-gradient-to-t from-purple-500 to-pink-500 rounded-t"
                            style={{ height: `${h}%` }}
                          />
                          <span className="text-[10px] text-white/40">
                            {['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </AnimatedSection>

      {/* How It Works Section */}
      <AnimatedSection
        id="how-it-works"
        className="py-20 relative z-10 bg-white/[0.02]"
      >
        <div className="container mx-auto px-6">
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <Badge className="mb-4 bg-green-500/10 border-green-500/20 text-green-400">
              Simple Process
            </Badge>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">
              From Chaos to{' '}
              <span className="bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                Control
              </span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-white/60 text-lg">
              Get your team up and running in minutes, not months.
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <div className="space-y-2">
              <ProcessStep
                number="1"
                title="Smart Scheduling"
                description="Import your team data and let our AI suggest optimal roster patterns based on availability, skills, and labor rules."
              />
              <ProcessStep
                number="2"
                title="Intelligent Distribution"
                description="Automatically assign shifts based on qualifications, certifications, and preferences. Fair distribution across your team."
              />
              <ProcessStep
                number="3"
                title="Seamless Communication"
                description="Publish rosters instantly. Staff receive notifications and can view schedules on any device."
              />
              <ProcessStep
                number="4"
                title="Live Compliance"
                description="Real-time monitoring ensures all schedules meet award requirements, break rules, and fatigue management."
                isLast
              />
            </div>

            <motion.div variants={fadeInRight} className="relative">
              <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <Smartphone className="h-4 w-4 text-green-400" />
                  </div>
                  <span className="font-semibold">Mobile-First Experience</span>
                </div>

                {/* Mock Phone UI */}
                <div className="bg-black rounded-3xl p-3 max-w-[280px] mx-auto">
                  <div className="bg-white/5 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">My Roster</span>
                      <Badge className="bg-purple-500/20 text-purple-400 text-[10px]">
                        This Week
                      </Badge>
                    </div>

                    {['Monday', 'Tuesday', 'Wednesday'].map((day, i) => (
                      <div key={day} className="bg-white/5 rounded-lg p-3">
                        <div className="text-xs text-white/50 mb-1">{day}</div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">
                            {
                              [
                                '9:00 AM - 5:00 PM',
                                '2:00 PM - 10:00 PM',
                                'Day Off',
                              ][i]
                            }
                          </span>
                          {i !== 2 && (
                            <div
                              className={cn(
                                'w-2 h-2 rounded-full',
                                i === 0 ? 'bg-green-500' : 'bg-blue-500'
                              )}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </AnimatedSection>

      {/* Benefits Section */}
      <AnimatedSection id="benefits" className="py-20 relative z-10">
        <div className="container mx-auto px-6">
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <Badge className="mb-4 bg-amber-500/10 border-amber-500/20 text-amber-400">
              Proven Results
            </Badge>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">
              Transform Your{' '}
              <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                Workforce Management
              </span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {benefits.map((benefit, i) => (
              <motion.div
                key={i}
                variants={fadeInUp}
                whileHover={{ scale: 1.02 }}
                className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl p-6 text-center"
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-4 text-amber-400">
                  {benefit.icon}
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {benefit.title}
                </h3>
                <p className="text-sm text-white/60">{benefit.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      {/* ICC Sydney Section */}
      <AnimatedSection
        id="icc"
        className="py-20 relative z-10 bg-gradient-to-b from-purple-500/5 to-transparent"
      >
        <div className="container mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div variants={fadeInLeft}>
              <Badge className="mb-4 bg-purple-500/10 border-purple-500/20 text-purple-400">
                <Building2 className="h-3 w-3 mr-2" />
                Built for ICC Sydney
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                Powering Australia's Premier{' '}
                <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Convention Centre
                </span>
              </h2>
              <p className="text-white/60 text-lg mb-8">
                ShiftoPia was purpose-built to handle the unique challenges of
                large-scale venue operations. From conventions to exhibitions to
                theatre productions, manage it all seamlessly.
              </p>

              <div className="grid grid-cols-2 gap-4">
                {[
                  {
                    label: 'Convention',
                    icon: <Building2 className="h-4 w-4" />,
                  },
                  { label: 'Exhibition', icon: <Globe className="h-4 w-4" /> },
                  { label: 'Theatre', icon: <Award className="h-4 w-4" /> },
                  { label: 'Events', icon: <Calendar className="h-4 w-4" /> },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    variants={scaleIn}
                    className="flex items-center gap-3 p-4 bg-white/5 rounded-xl border border-white/10"
                  >
                    <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400">
                      {item.icon}
                    </div>
                    <span className="font-medium">{item.label}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div variants={fadeInRight} className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/30 to-pink-500/30 rounded-3xl blur-3xl" />
              <div className="relative bg-gradient-to-br from-purple-500/20 to-pink-500/20 backdrop-blur-xl border border-white/20 rounded-3xl p-8 text-center">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-6">
                  <Building2 className="h-10 w-10 text-white" />
                </div>
                <h3 className="text-2xl font-bold mb-2">
                  International Convention Centre Sydney
                </h3>
                <p className="text-white/60 mb-6">
                  Australia's premier integrated convention, exhibition, and
                  entertainment venue
                </p>
                <div className="flex justify-center gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-400">
                      2,500+
                    </div>
                    <div className="text-xs text-white/50">Staff Managed</div>
                  </div>
                  <div className="w-px bg-white/10" />
                  <div className="text-center">
                    <div className="text-2xl font-bold text-pink-400">500+</div>
                    <div className="text-xs text-white/50">Events Yearly</div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </AnimatedSection>

      {/* CTA Section */}
      <AnimatedSection className="py-20 relative z-10">
        <div className="container mx-auto px-6">
          <motion.div
            variants={scaleIn}
            className="relative bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-purple-500/10 backdrop-blur-xl border border-white/10 rounded-3xl p-12 text-center overflow-hidden"
          >
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
                Ready to transform your{' '}
                <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  workforce?
                </span>
              </h2>
              <p className="mx-auto max-w-xl text-white/60 text-lg mb-8">
                Join Australia's leading venues in modernizing workforce
                management. Start your free trial today—no credit card required.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-purple-500 to-pink-500 border-0 hover:opacity-90 px-8 h-12 text-base"
                  asChild
                >
                  <a href="/login">
                    Start Free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/20 bg-white/5 hover:bg-white/10 h-12 px-8 text-base"
                  asChild
                >
                  <a href="/login">
                    View Pricing
                    <ArrowUpRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </AnimatedSection>

      {/* Footer */}
      <footer className="py-12 border-t border-white/10 relative z-10">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <Calendar className="h-4 w-4 text-white" />
                </div>
                <span className="font-bold text-lg">ShiftoPia</span>
              </div>
              <p className="text-sm text-white/50">
                Enterprise workforce management for Australia's leading venues.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-white/50">
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Features
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Pricing
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Integrations
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    API
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-white/50">
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    About
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Blog
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Careers
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Contact
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-white/50">
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Privacy
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Terms
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Security
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-white/10">
            <p className="text-sm text-white/40">
              © 2024 ShiftoPia. All rights reserved.
            </p>
            <div className="flex items-center gap-4 mt-4 md:mt-0">
              <a
                href="#"
                className="text-white/40 hover:text-white transition-colors"
              >
                <svg
                  className="h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z" />
                </svg>
              </a>
              <a
                href="#"
                className="text-white/40 hover:text-white transition-colors"
              >
                <svg
                  className="h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* CSS for gradient animation */}
      <style>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient {
          animation: gradient 3s ease infinite;
        }
      `}</style>
    </div>
  );
};

export default Index;
