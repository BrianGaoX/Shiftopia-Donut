import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { SettingsFunctionBar } from '../ui/components/SettingsFunctionBar';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Tabs, TabsContent } from '@/modules/core/ui/primitives/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { Button } from '@/modules/core/ui/primitives/button';
import { Check, User, Shield, Bell, CreditCard, Link, Loader2, Save, Palette } from 'lucide-react';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { useSettings, SUPPORTED_LOCALES } from '../hooks/useSettings';
import { supabase } from '@/platform/supabase/client';
import { toast } from '@/modules/core/ui/primitives/use-toast';
import { useTranslation } from 'react-i18next';
import i18n from '@/platform/i18n';

/* ============================================================
   HELPERS
   ============================================================ */
function hexToHsl(hex: string): string {
  hex = hex.replace(/^#/, '');
  if (hex.length !== 6) return '239 84% 67%'; // Fallback
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const DEFAULT_BRAND_COLOR = '#A48AFB';

/* ============================================================
   APPEARANCE SETTINGS
   ============================================================ */
const AppearanceSettings: React.FC = () => {
  const { t } = useTranslation();
  const { orgBranding, updateBranding, updateLanguage, isOrgLoading } = useSettings();
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [chartStyle, setChartStyle] = useState('default');
  const [language, setLanguage] = useState('en-GB');
  const [cookieBanner, setCookieBanner] = useState('default');
  const [enableGroupColoring, setEnableGroupColoring] = useState(false);
  const [hexError, setHexError] = useState(false);

  useEffect(() => {
    if (orgBranding && !updateBranding.isPending && !updateLanguage.isPending) {
      const b = orgBranding as any;
      setBrandColor(b.brand_color || DEFAULT_BRAND_COLOR);
      setChartStyle(b.chart_style || 'default');
      setLanguage(b.language || 'en-GB');
      setCookieBanner(b.cookie_banner || 'default');
      setEnableGroupColoring(b.enable_group_coloring || false);
    }
  }, [orgBranding, updateBranding.isPending]);

  // Live Preview Effect
  const updateLivePreview = (color: string) => {
    const hex = color.replace('#', '');
    if (/^[0-9A-F]{6}$/i.test(hex)) {
      const hsl = hexToHsl(hex);
      document.documentElement.style.setProperty('--primary', hsl);
      document.documentElement.style.setProperty('--ring', hsl);
      setHexError(false);
    } else {
      setHexError(true);
    }
  };

  const handleBrandColorChange = (value: string) => {
    const sanitized = value.toUpperCase().replace(/[^0-9A-F]/g, '').substring(0, 6);
    const newColor = `#${sanitized}`;
    setBrandColor(newColor);
    updateLivePreview(newColor);
  };

  const handleReset = () => {
    setBrandColor(DEFAULT_BRAND_COLOR);
    updateLivePreview(DEFAULT_BRAND_COLOR);
  };

  const handleSave = () => {
    if (hexError) {
      toast({ title: "Invalid brand color", description: "Please enter a valid 6-character hex code.", variant: "destructive" });
      return;
    }
    updateBranding.mutate({
      brand_color: brandColor,
      chart_style: chartStyle,
      cookie_banner: cookieBanner,
      enable_group_coloring: enableGroupColoring,
    });
  };

  if (isOrgLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Brand Color Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        <div>
          <h3 className="text-base font-semibold text-white">{t('settings.brand_color')}</h3>
          <p className="text-sm text-blue-200/60 mt-1">
            Global color for your organization.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4 p-6 rounded-2xl bg-white/5 border border-white/5">
            <div 
              className="h-12 w-12 rounded-xl ring-2 ring-white/10 shadow-lg transition-colors duration-300" 
              style={{ backgroundColor: /^[0-9A-F]{6}$/i.test(brandColor.replace('#','')) ? brandColor : '#333' }}
            ></div>
            <div className="relative flex-1 max-w-[200px]">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-white/40 font-mono">
                #
              </div>
              <Input
                value={brandColor.replace('#', '')}
                onChange={(e) => handleBrandColorChange(e.target.value)}
                maxLength={6}
                className={`pl-8 h-12 bg-black/20 border-white/10 text-white font-mono tracking-wide transition-all ${
                  hexError ? 'border-red-500/50 ring-1 ring-red-500/20' : 'focus:border-primary/50'
                }`}
              />
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleReset}
              className="text-white/40 hover:text-white hover:bg-white/5"
            >
              {t('common.cancel')}
            </Button>
          </div>
          {hexError && <p className="text-xs text-red-400 ml-1">Please enter a valid hex code (e.g. A48AFB)</p>}
        </div>
      </div>

      <div className="h-px bg-white/5 w-full"></div>

      {/* Chart Style Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        <div>
          <h3 className="text-base font-semibold text-white">{t('settings.chart_style')}</h3>
          <p className="text-sm text-blue-200/60 mt-1">
            Visual style for analytics.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {['default', 'simplified', 'custom-css'].map((style) => (
            <div 
              key={style}
              onClick={() => setChartStyle(style)}
              className={`relative group cursor-pointer transition-all duration-300 ${
                chartStyle === style ? 'scale-[1.02]' : ''
              }`}
            >
              <div className={`overflow-hidden rounded-xl border-2 bg-[#1a2744]/50 transition-all ${
                chartStyle === style ? 'border-primary shadow-glow/20' : 'border-white/10 hover:border-white/20'
              }`}>
                <div className="bg-white/5 p-3 text-xs font-medium text-white/80 border-b border-white/5 capitalize">
                  {style.replace('-', ' ')}
                </div>
                <div className="p-6 h-36 flex items-center justify-center">
                  <div className={`w-full h-full bg-primary/20 rounded-lg flex items-end gap-1 p-2 ${chartStyle !== style ? 'grayscale opacity-50' : ''}`}>
                    <div className="w-1/4 h-[40%] bg-primary/40 rounded-sm"></div>
                    <div className="w-1/4 h-[70%] bg-primary/60 rounded-sm"></div>
                    <div className="w-1/4 h-[50%] bg-primary/40 rounded-sm"></div>
                    <div className="w-1/4 h-[90%] bg-primary rounded-sm shadow-[0_0_10px_rgba(var(--primary),0.5)]"></div>
                  </div>
                </div>
              </div>
              {chartStyle === style && (
                <div className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-primary border-4 border-[#0d1424] flex items-center justify-center shadow-lg z-10 animate-scale-in">
                  <Check className="h-3.5 w-3.5 text-white" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-white/5 w-full"></div>

      {/* Language Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        <div>
          <h3 className="text-base font-semibold text-white">{t('settings.language')}</h3>
          <p className="text-sm text-blue-200/60 mt-1">
            {t('settings.language_description')}
          </p>
        </div>
        <div>
          <Select value={language} onValueChange={(newLang) => {
            const previous = language;
            setLanguage(newLang);
            i18n.changeLanguage(newLang);
            window.dispatchEvent(new CustomEvent('branding-updated', { detail: { language: newLang } }));
            updateLanguage.mutate(
              { language: newLang },
              {
                onError: () => {
                  setLanguage(previous);
                  i18n.changeLanguage(previous);
                  window.dispatchEvent(new CustomEvent('branding-updated', { detail: { language: previous } }));
                },
              }
            );
          }}>
            <SelectTrigger className="w-full sm:w-[280px] h-11 bg-white/5 border-white/10 text-white hover:bg-white/10 focus:border-primary/50">
              <div className="flex items-center gap-3">
                <span className="text-lg">
                  {SUPPORTED_LOCALES.find(l => l.code === language)?.flag ?? '🌐'}
                </span>
                <SelectValue placeholder="Select language" />
              </div>
            </SelectTrigger>
            <SelectContent className="bg-[#1a2744] border-white/10 text-white backdrop-blur-xl">
              {SUPPORTED_LOCALES.map(({ code, label, flag }) => (
                <SelectItem key={code} value={code} className="focus:bg-white/10 focus:text-white">
                  {flag} {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="h-px bg-white/5 w-full"></div>

      {/* Cookie Banner Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        <div>
          <h3 className="text-base font-semibold text-white">{t('settings.cookie_banner')}</h3>
          <p className="text-sm text-blue-200/60 mt-1">
            Display cookie banners to visitors.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {['default', 'simplified', 'none'].map((option) => (
            <div 
              key={option}
              onClick={() => setCookieBanner(option)}
              className={`relative group cursor-pointer transition-all duration-300 ${
                cookieBanner === option ? 'scale-[1.02]' : ''
              }`}
            >
              <div className={`overflow-hidden rounded-xl border-2 bg-[#1a2744]/50 transition-all ${
                cookieBanner === option ? 'border-primary shadow-glow/20' : 'border-white/10 hover:border-white/20'
              }`}>
                <div className="bg-white/5 p-3 text-xs font-medium text-white/80 border-b border-white/5 capitalize">
                  {option}
                </div>
                <div className="p-4 h-32 flex items-end justify-center">
                  {option === 'none' ? (
                    <div className="text-xs text-white/30 font-medium px-3 py-1 bg-white/5 rounded-full mb-4">No banner</div>
                  ) : (
                    <div className={`w-full h-8 ${option === 'simplified' ? 'h-6 w-3/4' : ''} bg-primary/20 rounded-md border border-primary/30 flex items-center justify-center mb-2`}>
                      <div className="w-12 h-1.5 bg-primary/40 rounded-full"></div>
                    </div>
                  )}
                </div>
              </div>
              {cookieBanner === option && (
                <div className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-primary border-4 border-[#0d1424] flex items-center justify-center shadow-lg z-10">
                  <Check className="h-3.5 w-3.5 text-white" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-white/5 w-full"></div>

      {/* Group Coloring Section */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
        <div>
          <h3 className="text-base font-semibold text-white">Advanced coloring</h3>
          <p className="text-sm text-blue-200/60 mt-1">
            Group-based card themes.
          </p>
        </div>
        <div className="p-6 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Palette className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Group-based Card Coloring</p>
              <p className="text-xs text-blue-200/40 mt-0.5">Automatically color-code timecards by center (Convention, Exhibition, Theatre).</p>
            </div>
          </div>
          <Switch 
            checked={enableGroupColoring} 
            onCheckedChange={setEnableGroupColoring}
          />
        </div>
      </div>

      <div className="pt-6 border-t border-white/5 flex justify-end">
        <Button 
          onClick={handleSave} 
          disabled={updateBranding.isPending}
          className="bg-primary hover:bg-primary/90 text-white h-11 px-8 rounded-xl shadow-glow transition-all"
        >
          {updateBranding.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
};

/* ============================================================
   PROFILE SETTINGS
   ============================================================ */
const ProfileSettings: React.FC = () => {
  const { user, updateProfile } = useSettings();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    if (user) {
      setFormData({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        phone: (user as any).phone || '',
      });
    }
  }, [user]);

  const handleSave = () => {
    updateProfile.mutate({
      ...formData,
      fullName: `${formData.firstName} ${formData.lastName}`.trim(),
    });
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-white/60">First name</Label>
          <Input 
            value={formData.firstName} 
            onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
            className="bg-white/5 border-white/10 text-white" 
          />
        </div>
        <div className="space-y-2">
          <Label className="text-white/60">Last name</Label>
          <Input 
            value={formData.lastName} 
            onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
            className="bg-white/5 border-white/10 text-white" 
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-white/60">Email address</Label>
        <Input 
          value={formData.email} 
          disabled
          className="bg-white/5 border-white/10 text-white/40 cursor-not-allowed" 
        />
        <p className="text-xs text-blue-200/40">Email cannot be changed directly for security reasons.</p>
      </div>
      <div className="space-y-2">
        <Label className="text-white/60">Phone number</Label>
        <Input 
          value={formData.phone} 
          onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
          className="bg-white/5 border-white/10 text-white" 
        />
      </div>
      <div className="pt-4 flex justify-end">
        <Button 
          onClick={handleSave} 
          disabled={updateProfile.isPending}
          className="bg-primary hover:bg-primary/90 text-white px-8 rounded-xl h-11"
        >
          {updateProfile.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Update Profile
        </Button>
      </div>
    </div>
  );
};

/* ============================================================
   SECURITY SETTINGS
   ============================================================ */
const SecuritySettings: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);

  const handleResetPassword = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("User not found");
      
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/settings/security`,
      });
      if (error) throw error;
      toast({ title: "Reset email sent", description: "Please check your inbox." });
    } catch (e: any) {
      toast({ title: "Failed to send reset email", description: e.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-white font-medium">Password</h4>
            <p className="text-sm text-blue-200/60 mt-1">Change your account password regularly for better security.</p>
          </div>
          <Button 
            variant="outline" 
            onClick={handleResetPassword}
            disabled={isLoading}
            className="border-white/10 text-white hover:bg-white/5"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Request Password Reset"}
          </Button>
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-white/5 border border-white/10 opacity-50 cursor-not-allowed">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-white font-medium">Two-factor Authentication</h4>
            <p className="text-sm text-blue-200/60 mt-1">Add an extra layer of security to your account.</p>
          </div>
          <Button variant="ghost" disabled className="text-white/40">Coming Soon</Button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   MAIN SETTINGS PAGE
   ============================================================ */
const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const { section = 'appearance' } = useParams<{ section?: string }>();

  const { isDark } = useTheme();
  const navigate = useNavigate();

  const handleSectionChange = (newSection: string) => {
    navigate(`/settings/${newSection}`);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 lg:p-6 space-y-4">
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 pt-4 pb-4 lg:pb-6">
        <div className={cn(
            "rounded-[32px] p-4 lg:p-6 transition-all border",
            isDark 
                ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {/* Row 1 & 2: Identity & Scope Filter */}
          <PersonalPageHeader
            title={t('settings.title')}
            Icon={Palette}
            mode="managerial" // Settings is usually org-wide/managerial
            className="mb-4 lg:mb-6"
          />

          {/* Row 3: Settings Function Bar */}
          <SettingsFunctionBar
            activeSection={section}
            onSectionChange={handleSectionChange}
            transparent
          />
        </div>
      </div>

      {/* ── Main Content Area ─────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden pt-2 lg:pt-4">
        <div className={cn(
            "h-full rounded-[32px] overflow-auto transition-all border p-6 lg:p-10",
            isDark 
                ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          <Tabs value={section} className="w-full">
            <TabsContent value="appearance">
              <AppearanceSettings />
            </TabsContent>
            <TabsContent value="profile">
              <ProfileSettings />
            </TabsContent>
            <TabsContent value="security">
              <SecuritySettings />
            </TabsContent>
            
            {/* Static placeholders for pending features */}
            {['account', 'notifications', 'billing', 'integrations'].map(tab => (
              <TabsContent key={tab} value={tab}>
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <div className="p-4 rounded-full bg-white/5 border border-white/10">
                    {tab === 'notifications' ? <Bell className="h-8 w-8 text-white/40" /> : 
                     tab === 'billing' ? <CreditCard className="h-8 w-8 text-white/40" /> : 
                     tab === 'integrations' ? <Link className="h-8 w-8 text-white/40" /> :
                     <User className="h-8 w-8 text-white/40" />}
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-white capitalize">{tab} Settings</h3>
                    <p className="text-blue-200/60 max-w-sm mt-1">This section is currently under development.</p>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
