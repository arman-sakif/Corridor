import Link from 'next/link';

import { IconGoogle } from '@/components/icons';
import { buttonClass } from '@/components/ui';
import { dynamicRoute } from '@/lib/routes';

/**
 * Google sign-in is written but has no OAuth credentials behind it yet, so the
 * button cannot do what it says. A real `disabled` button would swallow the
 * press and leave someone tapping a dead control, so this one stays reachable
 * and explains itself instead: grey, a note on hover, and a page that says
 * what to use in the meantime.
 *
 * It is deliberately not `aria-disabled` either. That would announce a control
 * that cannot be used and then move the page anyway; the note is wired up as
 * the link's description instead, so it is read out with the label.
 *
 * When credentials land, this whole file goes and both forms go back to the
 * shape they had, which was:
 *
 *     <form action={signInWithGoogle}>
 *       <input type="hidden" name="next" value={next} />
 *       <Button type="submit" tone="secondary" size="lg" className="w-full">
 *         <IconGoogle className="text-lg" />
 *         Continue with Google
 *       </Button>
 *     </form>
 *
 * See README, *Google sign-in*.
 */
export function GoogleButton({ next }: { next: string }) {
  return (
    <div className="group relative">
      <Link
        href={dynamicRoute(`/google-unavailable?next=${encodeURIComponent(next)}`)}
        aria-describedby="google-unavailable-note"
        className={buttonClass('muted', 'lg', 'w-full')}
      >
        <IconGoogle className="text-lg opacity-40 grayscale" />
        Continue with Google
      </Link>

      <span
        id="google-unavailable-note"
        role="tooltip"
        className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full
          rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white
          opacity-0 shadow-raised transition-opacity duration-150
          group-hover:opacity-100 group-focus-within:opacity-100"
      >
        Not available in current version
      </span>
    </div>
  );
}
