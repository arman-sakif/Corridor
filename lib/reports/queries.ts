import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ReportCategory, ReportStatus } from '@/lib/supabase/database.types';

/**
 * Reading complaints.
 *
 * The same query serves the operator's queue and the admin's — RLS decides
 * which rows come back, so scoping is not repeated in TypeScript. The one
 * difference is what each may see about the trip, and that difference is a
 * policy on `departure_vehicles`, not a branch here.
 */

export type ReportRow = {
  id: string;
  category: ReportCategory;
  note: string;
  status: ReportStatus;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  bookingId: string;
  operatorId: string;
  operatorName: string;
  reporterName: string | null;
  reporterPhone: string | null;
  serviceDate: string | null;
  departureTime: string | null;
  /** Who was driving, for the people entitled to know. Never a passenger. */
  assignments: { vehicle: string | null; driver: string | null }[];
};

type Raw = {
  id: string;
  category: ReportCategory;
  note: string;
  status: ReportStatus;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  booking_id: string;
  operator_id: string;
  operator: { name: string } | null;
  reporter: { full_name: string | null; phone: string | null } | null;
  booking: {
    departure: {
      id: string;
      service_date: string;
      departure_time: string;
    } | null;
  } | null;
};

/**
 * The reporter is named by its constraint, not by its table.
 *
 * `reports` has two foreign keys into `profiles` — `reporter_id` and
 * `resolved_by` — so a bare `profiles(...)` embed is ambiguous and PostgREST
 * refuses the whole query: "more than one relationship was found". That comes
 * back as an error rather than rows, and a caller doing `data ?? []` turns it
 * into an empty list that reads exactly like "no complaints". It did, until
 * somebody opened the page.
 */
const SELECT = `
  id, category, note, status, resolution, resolved_at, created_at,
  booking_id, operator_id,
  operator:operators(name),
  reporter:profiles!reports_reporter_id_fkey(full_name, phone),
  booking:bookings(departure:departures(id, service_date, departure_time))
`;

/**
 * @param operatorId Scope to one operator's own complaints. Omitted for the
 *   admin view, where RLS already returns everything.
 */
export async function listReports(operatorId?: string): Promise<ReportRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('reports')
    .select(SELECT)
    // Open ones first, then newest. Somebody is waiting on every open row.
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(200);

  if (operatorId) query = query.eq('operator_id', operatorId);

  const { data } = await query;
  const rows = (data ?? []) as unknown as Raw[];
  if (rows.length === 0) return [];

  // Who drove, looked up once for the whole page rather than per row.
  const departureIds = [
    ...new Set(rows.map((row) => row.booking?.departure?.id).filter(Boolean)),
  ] as string[];

  const { data: vehicles } = await supabase
    .from('departure_vehicles')
    .select('departure_id, vehicle:vehicles(label), driver:profiles(full_name)')
    .in('departure_id', departureIds.length > 0 ? departureIds : ['00000000-0000-0000-0000-000000000000']);

  const byDeparture = new Map<string, { vehicle: string | null; driver: string | null }[]>();
  for (const row of (vehicles ?? []) as unknown as {
    departure_id: string;
    vehicle: { label: string } | null;
    driver: { full_name: string } | null;
  }[]) {
    const list = byDeparture.get(row.departure_id) ?? [];
    list.push({ vehicle: row.vehicle?.label ?? null, driver: row.driver?.full_name ?? null });
    byDeparture.set(row.departure_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    note: row.note,
    status: row.status,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    bookingId: row.booking_id,
    operatorId: row.operator_id,
    operatorName: row.operator?.name ?? 'Unknown operator',
    reporterName: row.reporter?.full_name ?? null,
    reporterPhone: row.reporter?.phone ?? null,
    serviceDate: row.booking?.departure?.service_date ?? null,
    departureTime: row.booking?.departure?.departure_time ?? null,
    assignments: byDeparture.get(row.booking?.departure?.id ?? '') ?? [],
  }));
}

/** The reports a passenger has filed on one booking. */
export async function reportsForBooking(bookingId: string): Promise<ReportRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('reports')
    .select(SELECT)
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false });

  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    category: row.category,
    note: row.note,
    status: row.status,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    bookingId: row.booking_id,
    operatorId: row.operator_id,
    operatorName: row.operator?.name ?? 'Unknown operator',
    reporterName: row.reporter?.full_name ?? null,
    reporterPhone: row.reporter?.phone ?? null,
    serviceDate: row.booking?.departure?.service_date ?? null,
    departureTime: row.booking?.departure?.departure_time ?? null,
    assignments: [],
  }));
}
