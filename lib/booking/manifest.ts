import 'server-only';

import { formatCents } from '@/lib/money';
import { formatServiceDate, formatTime } from '@/lib/time';
import type { BookingStatus, PaymentMethod } from '@/lib/supabase/database.types';

/**
 * The manifest: one vehicle, one departure, one file.
 *
 * It is printed and carried in a van, so it is a CSV that opens cleanly in
 * Excel and nothing cleverer. It does not include a passenger's platform
 * history or their red flags — the driver needs a phone number and a pickup
 * point, not a dossier.
 */

export type ManifestRow = {
  from_stop: string;
  to_stop: string;
  passenger_name: string;
  phone: string;
  seats: number;
  luggage_count: number;
  total_cents: number;
  status: BookingStatus;
  payment_method: PaymentMethod | null;
  driver_confirmed_at: string | null;
  passenger_note: string | null;
  from_seq: number;
};

const COLUMNS = [
  'Pickup',
  'Drop-off',
  'Passenger',
  'Phone',
  'Seats',
  'Bags',
  'Fare',
  'Paid',
  'Note',
] as const;

/**
 * Excel splits on commas and chokes on a bare quote, so every field is quoted
 * and inner quotes are doubled. The BOM is what makes Excel read it as UTF-8
 * rather than mangling an accented name.
 */
function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function manifestCsv({
  operatorName,
  routeName,
  serviceDate,
  departureTime,
  vehicleLabel,
  driverName,
  rows,
}: {
  operatorName: string;
  routeName: string;
  serviceDate: string;
  departureTime: string;
  vehicleLabel: string;
  driverName: string | null;
  rows: ManifestRow[];
}): string {
  const lines: string[] = [];

  lines.push([csvCell(operatorName), csvCell(routeName)].join(','));
  lines.push(
    [
      csvCell(`${formatServiceDate(serviceDate)} ${formatTime(departureTime)}`),
      csvCell(vehicleLabel),
      csvCell(driverName ? `Driver: ${driverName}` : 'Driver: not assigned'),
    ].join(','),
  );
  lines.push('');
  lines.push(COLUMNS.map(csvCell).join(','));

  // In stop order, so the driver reads down the list as they drive the route.
  const ordered = [...rows].sort(
    (a, b) => a.from_seq - b.from_seq || a.passenger_name.localeCompare(b.passenger_name),
  );

  for (const row of ordered) {
    lines.push(
      [
        csvCell(row.from_stop),
        csvCell(row.to_stop),
        csvCell(row.passenger_name),
        csvCell(row.phone),
        csvCell(row.seats),
        csvCell(row.luggage_count),
        csvCell(formatCents(row.total_cents)),
        csvCell(paidLabel(row)),
        csvCell(row.passenger_note ?? ''),
      ].join(','),
    );
  }

  lines.push('');
  lines.push(
    [
      csvCell('Total'),
      csvCell(''),
      csvCell(`${ordered.reduce((sum, row) => sum + row.seats, 0)} seats`),
      csvCell(''),
      csvCell(''),
      csvCell(''),
      csvCell(formatCents(ordered.reduce((sum, row) => sum + row.total_cents, 0))),
    ].join(','),
  );

  return `﻿${lines.join('\r\n')}\r\n`;
}

function paidLabel(row: ManifestRow): string {
  if (row.status === 'settled') return `Yes — ${row.payment_method === 'cash' ? 'cash' : 'e-transfer'}`;
  if (row.driver_confirmed_at) return 'Yes';
  if (row.status === 'no_show') return 'No-show';
  return 'To collect';
}

/** A filename a driver can find again in their downloads folder. */
export function manifestFilename(
  operatorName: string,
  serviceDate: string,
  departureTime: string,
  vehicleLabel: string,
): string {
  const safe = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  return `manifest-${safe(operatorName)}-${serviceDate}-${departureTime.slice(0, 5).replace(':', '')}-${safe(vehicleLabel)}.csv`;
}
