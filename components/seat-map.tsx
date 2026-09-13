import type { Seat, SeatState } from '@/lib/booking/seat-map';

/**
 * How full a departure is, as a row of seats. Not a seating plan — Corridor's
 * seats are not numbered — just a picture an operator can read at a glance.
 * The numbers are in the label for anyone who cannot see the colours.
 */

const COLOUR: Record<SeatState, string> = {
  empty: 'bg-good-100 ring-good-600/40 text-good-700',
  held: 'bg-warn-100 ring-warn-600/60 text-warn-700',
  taken: 'bg-ink-300 ring-ink-400/60 text-ink-800',
};

const SIZE = {
  // Eight to a row, so a 14-seat van reads as two rows rather than one long one.
  sm: { seat: 'h-4 w-4 text-[10px]', row: 'max-w-[9.75rem]' },
  md: { seat: 'h-6 w-6 text-xs', row: 'max-w-[13.75rem]' },
} as const;

const swatch = 'flex shrink-0 items-center justify-center rounded-[3px] font-bold leading-none ring-1 ring-inset';

export function SeatMap({
  seats,
  overflow = 0,
  size = 'sm',
}: {
  seats: Seat[];
  overflow?: number;
  size?: keyof typeof SIZE;
}) {
  const taken = seats.filter((seat) => seat.state === 'taken').length;
  const held = seats.filter((seat) => seat.state === 'held').length;
  const free = seats.filter((seat) => seat.state === 'empty').length;
  const shared = seats.filter((seat) => seat.shared).length;

  const label =
    `${seats.length - overflow} seats: ${taken} confirmed, ${held} held, ${free} free` +
    (shared > 0 ? `, ${shared} shared by passengers on different legs` : '') +
    (overflow > 0 ? `, ${overflow} over capacity` : '');

  return (
    <div className="flex flex-col items-start gap-1">
      <div role="img" aria-label={label} title={label} className={`flex flex-wrap gap-1 ${SIZE[size].row}`}>
        {seats.map((seat, index) => (
          <span key={index} className={`${swatch} ${SIZE[size].seat} ${COLOUR[seat.state]}`}>
            {seat.shared ? '*' : null}
          </span>
        ))}
      </div>
      {overflow > 0 ? (
        <span className="text-xs font-medium text-bad-700">{overflow} over capacity</span>
      ) : null}
    </div>
  );
}

export function SeatLegend({ className = '' }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600 ${className}`}>
      <LegendItem state="empty">Free</LegendItem>
      <LegendItem state="taken">Confirmed</LegendItem>
      <LegendItem state="held">Held, waiting on an answer</LegendItem>
      <LegendItem state="taken" shared>
        Shared by passengers on different legs
      </LegendItem>
    </ul>
  );
}

function LegendItem({
  state,
  shared = false,
  children,
}: {
  state: SeatState;
  shared?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className={`${swatch} ${SIZE.sm.seat} ${COLOUR[state]}`}>
        {shared ? '*' : null}
      </span>
      {children}
    </li>
  );
}
