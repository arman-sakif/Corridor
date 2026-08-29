import { Badge } from '@/components/ui';
import type { BookingStatus } from '@/lib/supabase/database.types';

/**
 * Status words a passenger would use, not the enum. "held" means nothing to
 * someone waiting to hear back; "waiting on the operator" does.
 */
const passengerWords: Record<BookingStatus, { label: string; tone: 'neutral' | 'brand' | 'good' | 'warn' | 'bad' }> = {
  held: { label: 'Waiting on the operator', tone: 'warn' },
  approved: { label: 'Confirmed', tone: 'good' },
  declined: { label: 'Declined', tone: 'bad' },
  expired: { label: 'Expired — no answer in time', tone: 'neutral' },
  cancelled_by_passenger: { label: 'You cancelled', tone: 'neutral' },
  cancelled_by_operator: { label: 'Operator cancelled', tone: 'bad' },
  completed: { label: 'Trip finished', tone: 'brand' },
  no_show: { label: 'Marked as a no-show', tone: 'bad' },
  settled: { label: 'Paid and done', tone: 'good' },
};

const operatorWords: Record<BookingStatus, { label: string; tone: 'neutral' | 'brand' | 'good' | 'warn' | 'bad' }> = {
  held: { label: 'Waiting on you', tone: 'warn' },
  approved: { label: 'Confirmed', tone: 'good' },
  declined: { label: 'You declined', tone: 'neutral' },
  expired: { label: 'Lapsed', tone: 'neutral' },
  cancelled_by_passenger: { label: 'Passenger cancelled', tone: 'neutral' },
  cancelled_by_operator: { label: 'You cancelled', tone: 'neutral' },
  completed: { label: 'Trip finished', tone: 'brand' },
  no_show: { label: 'No-show', tone: 'bad' },
  settled: { label: 'Paid', tone: 'good' },
};

export function BookingStatusBadge({
  status,
  audience = 'passenger',
}: {
  status: BookingStatus;
  audience?: 'passenger' | 'operator';
}) {
  const word = (audience === 'operator' ? operatorWords : passengerWords)[status];
  return <Badge tone={word.tone}>{word.label}</Badge>;
}

export function bookingStatusLabel(
  status: BookingStatus,
  audience: 'passenger' | 'operator' = 'passenger',
): string {
  return (audience === 'operator' ? operatorWords : passengerWords)[status].label;
}
