'use client';

import { useRef } from 'react';

import { cancelBooking } from '@/lib/booking/actions';
import { SubmitButton } from '@/components/form';
import { Button } from '@/components/ui';

/**
 * Cancelling asks first. It is free but final, and operators see it the next
 * time this passenger requests a seat — too much to hang on one stray tap.
 * The same native <dialog> as SwitchAccount: focus trap and Escape for free.
 */
export function CancelRideForm({
  bookingId,
  operatorName,
  when,
}: {
  bookingId: string;
  operatorName: string | null;
  when: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button type="button" tone="danger" onClick={() => dialog.current?.showModal()}>
        Cancel this ride
      </Button>

      <dialog
        ref={dialog}
        aria-labelledby="cancel-ride-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 text-left shadow-hero backdrop:bg-ink-950/40 backdrop:backdrop-blur-sm"
      >
        <form action={cancelBooking} className="p-6">
          <input type="hidden" name="booking_id" value={bookingId} />
          <h2 id="cancel-ride-title" className="text-lg font-semibold text-ink-900">
            Cancel this ride?
          </h2>
          <p className="mt-2 text-sm text-ink-600">
            Your seat{operatorName ? ` with ${operatorName}` : ''}
            {when ? ` on ${when}` : ''} goes back on sale straight away. This cannot be undone, and
            operators can see it when they decide on your next request.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" tone="secondary" onClick={() => dialog.current?.close()}>
              Keep my seat
            </Button>
            <SubmitButton tone="danger" pendingLabel="Cancelling…">
              Yes, cancel ride
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
