'use client';

import { useActionState } from 'react';

import { confirmPaymentAsPassenger } from '@/lib/booking/day-actions';
import { FormMessage, SubmitButton } from '@/components/form';
import { idleState } from '@/lib/forms';

export function PaymentConfirmForm({ bookingId }: { bookingId: string }) {
  const [state, action] = useActionState(confirmPaymentAsPassenger, idleState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="booking_id" value={bookingId} />

      <div className="grid grid-cols-2 gap-3">
        {[
          { value: 'cash', label: 'Cash' },
          { value: 'etransfer', label: 'E-transfer' },
        ].map((option) => (
          <label
            key={option.value}
            className="cursor-pointer rounded-lg px-4 py-3 text-center text-sm font-medium ring-1 ring-ink-200 select-none has-checked:bg-brand-600 has-checked:text-white has-checked:ring-brand-600"
          >
            <input
              type="radio"
              name="payment_method"
              value={option.value}
              className="sr-only"
              required
            />
            {option.label}
          </label>
        ))}
      </div>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Saving…">Confirm how I paid</SubmitButton>
    </form>
  );
}
