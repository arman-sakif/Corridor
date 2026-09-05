import Link from 'next/link';
import { notFound } from 'next/navigation';

import { FareGrid } from './fare-grid';
import { Alert, Card, CardHeader, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { one, rows } from '@/lib/supabase/rows';
import { formatCents } from '@/lib/money';
import { formatInstant } from '@/lib/time';
import { segmentBaseCents } from '@/lib/booking/fares';

export default async function RouteFaresPage({
  params,
}: {
  params: Promise<{ operatorId: string; routeId: string }>;
}) {
  const { operatorId, routeId } = await params;
  const supabase = await createClient();

  const route = one(
    await supabase
      .from('routes')
      .select(
        'id, name, pricing_mode, operator_id, route_stops(seq, stop:stops(label, city:cities(name)))',
      )
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .maybeSingle(),
    'the route',
  );

  if (!route) notFound();

  const [fareResult, changeResult] = await Promise.all([
    supabase.from('fares').select('from_seq, to_seq, price_cents').eq('route_id', routeId),
    supabase
      .from('fare_changes')
      .select('from_seq, to_seq, old_price_cents, new_price_cents, reason, created_at')
      .eq('route_id', routeId)
      .order('created_at', { ascending: false })
      .limit(15),
  ]);

  const stops = [...(route.route_stops ?? [])]
    .sort((a, b) => a.seq - b.seq)
    .map((rs) => ({
      seq: rs.seq,
      label: rs.stop?.label ?? 'Stop',
      city: rs.stop?.city?.name ?? '',
    }));

  const fareRows = rows(fareResult, 'the fares');
  const changes = rows(changeResult, 'the price history');
  const additive = route.pricing_mode === 'additive';

  return (
    <>
      <PageHeader
        title={route.name}
        description={
          additive
            ? 'You price each hop. A longer trip costs the hops it covers, added together.'
            : 'You price each pair of stops on its own. A through trip is whatever you say it is.'
        }
        action={
          <Link
            href={`/operator/${operatorId}/routes`}
            className="text-sm font-medium text-ink-600 hover:text-ink-900"
          >
            ← All routes
          </Link>
        }
      />

      {stops.length < 2 ? (
        <Alert tone="warn">This route needs at least two stops before it can be priced.</Alert>
      ) : (
        <>
          <div className="mb-6">
            <Alert tone="info">
              {additive ? (
                <>
                  Set a price for each hop below. A passenger going from{' '}
                  <strong>{stops[0]?.city || stops[0]?.label}</strong> to{' '}
                  <strong>{stops.at(-1)?.city || stops.at(-1)?.label}</strong> pays every hop in
                  between, added up.
                </>
              ) : (
                <>
                  Set a price for each pair below. The price from{' '}
                  <strong>{stops[0]?.city || stops[0]?.label}</strong> to{' '}
                  <strong>{stops.at(-1)?.city || stops.at(-1)?.label}</strong> is whatever you type
                  there — it does not have to match the hops added together.
                </>
              )}{' '}
              These fares are for this direction only. The trip back is its own route.
            </Alert>
          </div>

          <FareGrid routeId={routeId} stops={stops} fares={fareRows} additive={additive} />

          {additive ? (
            <Card className="mt-6">
              <CardHeader
                title="What passengers will pay"
                description="Worked out from the hops above."
              />
              <Table>
                <thead>
                  <tr>
                    <Th>From</Th>
                    <Th>To</Th>
                    <Th className="text-right">Fare</Th>
                  </tr>
                </thead>
                <tbody>
                  {stops.flatMap((from) =>
                    stops
                      .filter((to) => to.seq > from.seq + 1)
                      .map((to) => {
                        const cents = segmentBaseCents('additive', fareRows, from.seq, to.seq);
                        return (
                          <tr key={`${from.seq}-${to.seq}`}>
                            <Td>{from.city || from.label}</Td>
                            <Td>{to.city || to.label}</Td>
                            <Td className="numeric text-right">
                              {cents === null ? (
                                <span className="text-ink-400">not for sale yet</span>
                              ) : (
                                formatCents(cents)
                              )}
                            </Td>
                          </tr>
                        );
                      }),
                  )}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Price history"
          description="Every change is kept, with the reason you gave."
        />
        {changes.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-500">No price changes recorded yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Segment</Th>
                <Th>Was</Th>
                <Th>Now</Th>
                <Th>Reason</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change, index) => (
                <tr key={index}>
                  <Td className="numeric whitespace-nowrap">
                    {stops.find((s) => s.seq === change.from_seq)?.city ?? change.from_seq} →{' '}
                    {stops.find((s) => s.seq === change.to_seq)?.city ?? change.to_seq}
                  </Td>
                  <Td className="numeric">
                    {change.old_price_cents === null ? '—' : formatCents(change.old_price_cents)}
                  </Td>
                  <Td className="numeric">{formatCents(change.new_price_cents)}</Td>
                  <Td>{change.reason}</Td>
                  <Td className="whitespace-nowrap text-ink-600">
                    {formatInstant(change.created_at)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
