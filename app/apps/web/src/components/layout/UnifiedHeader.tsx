'use client';

import { Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { organizationsApi } from '@/lib/organizations-api';
import { BrainNav } from '@/components/brain/BrainNav';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { UserProfileMenu } from '@/components/public/UserProfileMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { authStorage, AUTH_CHANGE_EVENT } from '@/lib/auth-storage';
import {
  Header,
  HeaderBrand,
  HeaderActions,
  HeaderMobileMenuTrigger,
} from '@/components/ui/navigation';
import { Sheet, SheetTrigger, SheetContent } from '@/components/ui/Sheet';
import { LOGO_PATH } from '@/lib/brand';
import { Menu, Home, Building2, Settings } from 'lucide-react';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';

import { useAuth } from '@/hooks/use-auth';

import { getManagementUrl } from '@/lib/url-generator';

export function UnifiedHeader({
  customLogoUrl,
  logoHeight,
}: {
  customLogoUrl?: string | null;
  logoHeight?: number | null;
}) {
  const pathname = usePathname();
  const { isAuthenticated, isLoaded } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Before mount or during initial load, show unauthenticated UI to avoid flashing
  const showAuthenticatedUI = isLoaded && isAuthenticated;

  // Org pages: "<Org> Brain" brand, tabs inline, settings in the avatar menu.
  const orgId = /^\/organizations\/([^/]+)/.exec(pathname ?? '')?.[1];
  const org = useQuery({
    queryKey: ['organization', orgId],
    queryFn: () => organizationsApi.getOrganization(orgId as string),
    enabled: !!orgId && showAuthenticatedUI,
    retry: false,
  });
  const orgBrand = orgId && org.data?.name ? `${org.data.name} Brain` : null;
  useEffect(() => {
    if (orgBrand) document.title = orgBrand;
    else if (!orgId) document.title = 'Company Brain';
  }, [orgBrand, orgId, pathname]);

  return (
    <Header
      fixed={false}
      className="sticky top-0 z-50 w-full h-16 border-border bg-card/80 backdrop-blur-md px-0"
    >
      <div className="flex items-center justify-between h-full w-full">
        <div className="flex items-center gap-6 min-w-0">
          <HeaderBrand
            as={Link}
            href={orgId ? `/organizations/${orgId}/brain` : "/"}
            logoSrc={customLogoUrl || LOGO_PATH}
            logoAlt={orgBrand ?? 'Company Brain'}
            brandName={customLogoUrl ? '' : orgId ? (orgBrand ?? '') : 'Company Brain'}
            logoHeight={logoHeight}
            isCustomLogo={!!customLogoUrl}
            className={customLogoUrl && !logoHeight ? 'max-h-10 w-auto' : ''}
          />
          {orgId && showAuthenticatedUI && (
            <Suspense fallback={null}>
              <BrainNav organizationId={orgId} />
            </Suspense>
          )}
        </div>

        <HeaderActions className="gap-3">
          {showAuthenticatedUI ? (
            <>
              <NotificationCenter />
              <ThemeToggle />
              <UserProfileMenu orgSettingsHref={orgId ? `/organizations/${orgId}/settings` : undefined} />
            </>
          ) : (
            <>
              <Link href={getManagementUrl('/get-started')} className="hidden md:inline-flex">
                <Button>Get Started</Button>
              </Link>
              <Link href={getManagementUrl('/login')} className="hidden md:inline-flex">
                <Button variant="outline">Login</Button>
              </Link>
            </>
          )}

          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <HeaderMobileMenuTrigger aria-label="Open navigation menu">
                <Menu className="h-5 w-5" />
              </HeaderMobileMenuTrigger>
            </SheetTrigger>
            <SheetContent side="right">
              <div className="flex flex-col gap-3">
                {showAuthenticatedUI ? (
                  <nav className="flex flex-col gap-2" aria-label="Main navigation">
                    <Link
                      href={getManagementUrl('/dashboard')}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Home className="h-5 w-5 flex-shrink-0" />
                      <span>Home</span>
                    </Link>
                    <Link
                      href={getManagementUrl('/organizations')}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Building2 className="h-5 w-5 flex-shrink-0" />
                      <span>Organizations</span>
                    </Link>
                    <Link
                      href={getManagementUrl('/settings')}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Settings className="h-5 w-5 flex-shrink-0" />
                      <span>Settings</span>
                    </Link>
                  </nav>
                ) : (
                  <>
                    <Link
                      href={getManagementUrl('/get-started')}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center justify-center px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
                    >
                      Get Started
                    </Link>
                    <Link
                      href={getManagementUrl('/login')}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center justify-center px-4 py-2.5 rounded-xl border border-input bg-background font-medium hover:bg-muted transition-colors"
                    >
                      Login
                    </Link>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </HeaderActions>
      </div>
    </Header>
  );
}
