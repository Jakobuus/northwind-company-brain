import type { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}

// Tabs live in the one-line header (UnifiedHeader); the icon sidebar is hidden on org pages,
// so undo the root layout's sidebar margin here.
export default function OrganizationLayout({ children }: LayoutProps) {
  return <div className="md:-ml-16">{children}</div>;
}
