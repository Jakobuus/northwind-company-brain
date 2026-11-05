import Link from 'next/link';
import { Bot, Building2, Lock, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UniversalLayout } from '@/components/layout/UniversalLayout';

export const metadata = {
  title: 'Company Brain',
  description: 'Your company knowledge, with who-sees-what built in.',
};

const CAPABILITIES = [
  {
    icon: Building2,
    title: 'One brain for the company',
    description:
      'Documents, decisions and facts from every department, mapped in rings: company core, department core, team-only, private.',
  },
  {
    icon: Lock,
    title: 'Who sees what, built in',
    description:
      'Every answer, search and card is filtered by what the reader may open. Private notes stay with their author.',
  },
  {
    icon: Users,
    title: 'Whose word wins',
    description:
      'Leads approve what moves inward. When sources disagree, the brain shows which one counts and why.',
  },
  {
    icon: Bot,
    title: 'Works in Claude and ChatGPT',
    description:
      'Each person gets a personal connector link. Ask in the chat you already use; it only answers with what you can read.',
  },
];

/**
 * Marketing home. Authenticated users are sent to /dashboard by the header,
 * so this stays a plain public page rather than redirecting.
 */
export default function HomePage() {
  return (
    <UniversalLayout>
      <main className="mx-auto max-w-5xl px-4 py-20">
        <section className="space-y-6 text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Company Brain
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Your company&apos;s knowledge in one place. Everyone sees only what they are allowed
            to, and everyone knows whose word wins.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/login">Get started</Link>
            </Button>
          </div>
        </section>

        <section className="mt-20 grid gap-8 sm:grid-cols-2">
          {CAPABILITIES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex gap-4">
              <Icon className="mt-1 h-6 w-6 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <h2 className="font-medium">{title}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
    </UniversalLayout>
  );
}
