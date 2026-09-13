import { IconArrowRight } from '@/components/icons';
import { chooseAccountMode } from '@/lib/auth/mode-actions';
import { MODE_BLURB, MODE_LABEL, type AccountMode } from '@/lib/auth/modes';

/**
 * One button per account type. Each carries its own `data-mode`, so it wears
 * that type's palette before it is chosen: the choice looks like where it
 * leads.
 */
export function AccountPicker({
  modes,
  current,
  next,
}: {
  modes: AccountMode[];
  current: AccountMode | null;
  next?: string | null;
}) {
  return (
    <form action={chooseAccountMode} className="space-y-2.5">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {modes.map((mode) => (
        <button
          key={mode}
          type="submit"
          name="mode"
          value={mode}
          data-mode={mode}
          className="group flex w-full items-center gap-3 rounded-xl bg-brand-50 px-4 py-3 text-left ring-1 ring-brand-200 transition-[background-color,box-shadow] duration-150 hover:bg-brand-600 hover:shadow-raised hover:ring-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:translate-y-px"
        >
          <span
            aria-hidden="true"
            className="h-9 w-1.5 shrink-0 rounded-full bg-brand-600 transition-colors group-hover:bg-white"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-semibold text-brand-800 transition-colors group-hover:text-white">
              {MODE_LABEL[mode]}
              {current === mode ? (
                <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-brand-700 uppercase">
                  Current
                </span>
              ) : null}
            </span>
            <span className="block text-sm text-brand-700 transition-colors group-hover:text-brand-50">
              {MODE_BLURB[mode]}
            </span>
          </span>
          <IconArrowRight className="shrink-0 text-brand-600 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-white" />
        </button>
      ))}
    </form>
  );
}
