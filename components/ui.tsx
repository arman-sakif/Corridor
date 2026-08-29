import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/** Presentational primitives. No state, no data fetching, no decisions. */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const buttonTone = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'bg-white text-ink-800 ring-1 ring-ink-200 hover:bg-ink-50',
  danger: 'bg-white text-bad-700 ring-1 ring-bad-100 hover:bg-bad-100',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
} as const;

const buttonSize = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
} as const;

export type ButtonTone = keyof typeof buttonTone;
export type ButtonSize = keyof typeof buttonSize;

export function buttonClass(tone: ButtonTone = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cx(buttonBase, buttonTone[tone], buttonSize[size], extra);
}

export function Button({
  tone = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { tone?: ButtonTone; size?: ButtonSize }) {
  return <button {...props} className={buttonClass(tone, size, className)} />;
}

export function ButtonLink({
  tone = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { tone?: ButtonTone; size?: ButtonSize }) {
  return <Link {...props} className={buttonClass(tone, size, className)} />;
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cx('rounded-xl bg-white shadow-sm ring-1 ring-ink-200', className)}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
      <div>
        <h2 className="font-semibold text-ink-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-ink-600">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

const badgeTone = {
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-50 text-brand-700',
  good: 'bg-good-100 text-good-700',
  warn: 'bg-warn-100 text-warn-700',
  bad: 'bg-bad-100 text-bad-700',
} as const;

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof badgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        badgeTone[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-800">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-ink-500">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-bad-700">{error}</span> : null}
    </label>
  );
}

const controlClass =
  'w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-ink-300 ' +
  'placeholder:text-ink-400 focus:outline-2 focus:outline-offset-0 focus:outline-brand-600 ' +
  'disabled:bg-ink-100 disabled:text-ink-500';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cx(controlClass, 'h-10', className)} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={cx(controlClass, 'h-10', className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx(controlClass, className)} />;
}

const alertTone = {
  info: 'bg-brand-50 text-brand-700 ring-brand-100',
  good: 'bg-good-100 text-good-700 ring-good-100',
  warn: 'bg-warn-100 text-warn-700 ring-warn-100',
  bad: 'bg-bad-100 text-bad-700 ring-bad-100',
} as const;

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof alertTone;
  children: ReactNode;
}) {
  return (
    <div className={cx('rounded-lg px-4 py-3 text-sm ring-1', alertTone[tone])} role="status">
      {children}
    </div>
  );
}

/** Empty states say what to do next, not just that there is nothing here. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 px-6 py-10 text-center">
      <p className="font-medium text-ink-800">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-600">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* Dense table primitives for the operator, driver, and admin surfaces. */

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table {...props} className={cx('w-full border-collapse text-sm', className)} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      {...props}
      className={cx(
        'border-b border-ink-200 px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-600 uppercase',
        className,
      )}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return <td {...props} className={cx('border-b border-ink-100 px-3 py-2 align-top', className)} />;
}
