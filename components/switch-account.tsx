'use client';

import { useRef } from 'react';

/**
 * Switch in the header: the same "Log in as" picker, as a pop-up, without
 * signing out. A native <dialog> gives focus trapping, Escape to close and the
 * top layer for free — the header's scrolling nav cannot clip it.
 */
export function SwitchAccount({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-brand-700 ring-1 ring-brand-200 transition-colors ring-inset hover:bg-brand-50"
      >
        {label}
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="switch-account-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 text-left shadow-hero backdrop:bg-ink-950/40 backdrop:backdrop-blur-sm"
      >
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="switch-account-title" className="text-lg font-semibold text-ink-900">
              Log in as
            </h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="-mt-1 -mr-2 rounded-lg px-2 py-1 text-sm text-ink-500 transition-colors hover:bg-ink-150 hover:text-ink-900"
            >
              Close
            </button>
          </div>
          <p className="mt-1 text-sm text-ink-600">
            Same email and password. Choose which account to use now.
          </p>
          <div className="mt-5">{children}</div>
        </div>
      </dialog>
    </>
  );
}
