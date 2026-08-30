import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { IconInfo, IconWarning, IconCheck } from '@/components/icons';

/** Presentational primitives. No state, no data fetching, no decisions. */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ----------------------------------------------------------------- buttons */

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium ' +
  'transition-[background-color,box-shadow,transform,color] duration-150 ' +
  'active:translate-y-px ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0';

const buttonTone = {
  primary: 'bg-brand-600 text-white shadow-card hover:bg-brand-700 hover:shadow-raised',
  secondary: 'bg-white text-ink-800 ring-1 ring-ink-200 shadow-card hover:bg-ink-50 hover:ring-ink-300',
  danger: 'bg-white text-bad-700 ring-1 ring-bad-100 hover:bg-bad-50 hover:ring-bad-600/30',
  ghost: 'text-ink-600 hover:bg-ink-150 hover:text-ink-900',
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

/* ------------------------------------------------------------------- cards */

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cx('rounded-2xl bg-white shadow-card ring-1 ring-ink-200/70', className)}
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
    <div className="flex items-start justify-between gap-4 border-b border-ink-150 px-5 py-4">
      <div className="min-w-0">
        <h2 className="font-semibold tracking-tight text-ink-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-ink-600">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ badges */

const badgeTone = {
  neutral: 'bg-ink-150 text-ink-700 ring-ink-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  accent: 'bg-accent-100 text-accent-700 ring-accent-100',
  good: 'bg-good-50 text-good-700 ring-good-100',
  warn: 'bg-warn-50 text-warn-700 ring-warn-100',
  bad: 'bg-bad-50 text-bad-700 ring-bad-100',
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
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        badgeTone[tone],
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- forms */

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
      {hint && !error ? <span className="mt-1.5 block text-xs text-ink-500">{hint}</span> : null}
      {error ? (
        <span className="mt-1.5 flex items-start gap-1 text-xs font-medium text-bad-700">
          <IconWarning className="mt-px shrink-0 text-sm" />
          {error}
        </span>
      ) : null}
    </label>
  );
}

const controlClass =
  'w-full rounded-xl bg-white px-3.5 text-sm text-ink-900 ring-1 ring-ink-300 ' +
  'transition-shadow placeholder:text-ink-400 ' +
  'focus:ring-2 focus:ring-brand-500 focus:outline-none ' +
  'disabled:bg-ink-150 disabled:text-ink-500';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cx(controlClass, 'h-11', className)} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={cx(controlClass, 'h-11 pr-9', className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx(controlClass, 'py-2.5', className)} />;
}

/* ------------------------------------------------------------------ alerts */

const alertTone = {
  info: { box: 'bg-brand-50 text-brand-800 ring-brand-100', Icon: IconInfo },
  good: { box: 'bg-good-50 text-good-700 ring-good-100', Icon: IconCheck },
  warn: { box: 'bg-warn-50 text-warn-700 ring-warn-100', Icon: IconWarning },
  bad: { box: 'bg-bad-50 text-bad-700 ring-bad-100', Icon: IconWarning },
} as const;

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof alertTone;
  children: ReactNode;
}) {
  const { box, Icon } = alertTone[tone];
  return (
    <div className={cx('flex gap-2.5 rounded-xl px-4 py-3 text-sm ring-1', box)} role="status">
      <Icon className="mt-0.5 shrink-0 text-base" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Empty states say what to do next, not just that there is nothing here. */
export function EmptyState({
  title,
  children,
  action,
  icon,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-300 bg-ink-50/60 px-6 py-12 text-center">
      {icon ? (
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-lg text-ink-400 ring-1 ring-ink-200">
          {icon}
        </div>
      ) : null}
      <p className="font-medium text-ink-900">{title}</p>
      {children ? (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">{children}</p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
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
      <div className="min-w-0">
        <h1 className="display text-2xl font-semibold text-ink-900">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-ink-600">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
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
        'border-b border-ink-200 bg-ink-50/80 px-3 py-2.5 text-left text-xs font-semibold tracking-wider text-ink-500 uppercase',
        className,
      )}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td {...props} className={cx('border-b border-ink-150 px-3 py-3 align-top', className)} />
  );
}

/** A row that highlights on hover — worth it on a table an operator scans daily. */
export function Tr({ className, ...props }: ComponentProps<'tr'>) {
  return <tr {...props} className={cx('transition-colors hover:bg-ink-50/70', className)} />;
}
