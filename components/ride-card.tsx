import Link from 'next/link';

import { BookingStatusBadge } from '@/components/booking-status';
import { Card } from '@/components/ui';
import { IconArrowRight, IconClock } from '@/components/icons';
import { effectiveStatus, isWaiting } from '@/lib/booking/ride-list';
import { dynamicRoute } from '@/lib/routes';
import { formatCents } from '@/lib/money';
import { formatRelative, formatServiceDate, formatTime } from '@/lib/time';
import type { BookingStatus } from '@/lib/supabase/database.types';

export type Ride = {
  id: string;
  seats: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  total_cents: number;
  created_at: string;
  from_stop: { label: string; city: { name: string } | null } | null;
  to_stop: { label: string; city: { name: string } | null } | null;
  departure: {
    service_date: string;
    departure_time: string;
    operator: { name: string } | null;
  } | null;
};

/** One of a passenger's own bookings, as it appears on My rides and History. */
export function RideCard({ ride, now }: { ride: Ride; now: Date }) {
  return (
    <Link href={dynamicRoute(`/my-rides/${ride.id}`)} className="group block">
      <Card className="p-4 transition-shadow hover:shadow-raised">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-semibold text-ink-900">
              {ride.from_stop?.city?.name ?? ride.from_stop?.label}
              <IconArrowRight className="text-sm text-ink-400" />
              {ride.to_stop?.city?.name ?? ride.to_stop?.label}
            </p>
            <p className="numeric mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-600">
              <IconClock className="text-sm text-ink-400" />
              {ride.departure ? formatServiceDate(ride.departure.service_date) : ''}
              <span className="text-ink-300">·</span>
              {ride.departure ? formatTime(ride.departure.departure_time) : ''}
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {ride.departure?.operator?.name} · {ride.seats} seat{ride.seats === 1 ? '' : 's'}
            </p>
          </div>

          <div className="text-right">
            <BookingStatusBadge status={effectiveStatus(ride, now)} />
            <p className="numeric mt-2 text-lg font-semibold text-ink-900">
              {formatCents(ride.total_cents)}
            </p>
            {isWaiting(ride, now) && ride.hold_expires_at ? (
              <p className="mt-0.5 text-xs font-medium text-warn-700">
                Held until {formatRelative(ride.hold_expires_at)}
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </Link>
  );
}
