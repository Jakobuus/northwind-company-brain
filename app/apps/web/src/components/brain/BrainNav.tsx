'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/** Org tabs, shown inline in the one-line header. Brain, Frameworks and How it works share one map page. */
export const BrainNav = ({ organizationId }: { organizationId: string }) => {
  const pathname = usePathname() ?? '';
  const search = useSearchParams();
  const root = `/organizations/${organizationId}`;
  const view = search?.get('view') || 'brain';
  const onBrain = pathname === `${root}/brain`;
  const items = [
    { href: `${root}/brain`, label: 'Brain', active: onBrain && view === 'brain' },
    { href: `${root}/brain?view=frameworks`, label: 'Frameworks', active: onBrain && view === 'frameworks' },
    { href: `${root}/brain?view=how`, label: 'How it works', active: onBrain && view === 'how' },
    { href: `${root}/access`, label: 'Access', active: pathname.startsWith(`${root}/access`) },
    { href: `${root}/approvals`, label: 'Approvals', active: pathname.startsWith(`${root}/approvals`) },
    { href: `${root}/space`, label: 'My space', active: pathname.startsWith(`${root}/space`) },
  ];

  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Brain navigation">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={[
            'inline-flex items-center whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            item.active
              ? 'bg-[var(--color-mist)] text-[var(--color-soil)]'
              : 'text-[var(--color-leaf)] hover:bg-[var(--color-mist)] hover:text-[var(--color-soil)]',
          ].join(' ')}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
};
