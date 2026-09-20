import { notFound } from 'next/navigation';

import { VoucherForm } from './voucher-form';
import { setVoucherActive } from '@/lib/promotions/actions';
import { requireOperatorRole } from '@/lib/auth/session';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { IconTicket } from '@/components/icons';
import { operatorVouchers } from '@/lib/operator/queries';
import { formatCents } from '@/lib/money';
import { formatInstant, formatRelative } from '@/lib/time';
import { describeVoucher, voucherState, windowLabel } from '@/lib/promotions/vouchers';

/**
 * Codes an operator hands out, and how far each has got.
 *
 * A code is six characters because it gets read down a phone line and typed
 * into a phone at a bus stop — digits and letters, without the I, L, O and U
 * that get misheard for one another. It is scoped to this business, so it does
 * not matter that a rival has issued the same six.
 */
export default async function PromotionsPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const { membership } = await requireOperatorRole(operatorId);

  // Vouchers come off a seat fare. An in-city business sells a flat-priced
  // zone ride through a different flow, and has no tab pointing here.
  if (membership.operator?.type === 'incity') notFound();

  const vouchers = await operatorVouchers(operatorId);
  const now = new Date();
  const live = vouchers.filter((voucher) => voucherState(voucher, voucher.uses, now) === 'live');
  const givenAway = vouchers.reduce((sum, voucher) => sum + voucher.givenAwayCents, 0);

  return (
    <>
      <PageHeader
        title="Promotions"
        description="Six-character codes that take money off a fare. Give one out however you reach passengers — a Kijiji ad, a WhatsApp group, a card in the van."
      />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          <Card className="h-fit p-5">
            <h2 className="font-semibold text-ink-900">New code</h2>
            <p className="mt-1 mb-4 text-sm text-ink-600">
              Corridor picks the characters. You pick what it is worth and how long it lasts.
            </p>
            <VoucherForm operatorId={operatorId} />
          </Card>

          {vouchers.length > 0 ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold tracking-wide text-ink-500 uppercase">
                So far
              </h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-600">Codes live now</dt>
                  <dd className="numeric font-medium text-ink-900">{live.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-600">Given away</dt>
                  <dd className="numeric font-medium text-ink-900">{formatCents(givenAway)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-ink-500">
                A discount is taken off what the passenger hands the driver, so it comes out of
                the fare rather than off a Corridor invoice.
              </p>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader
            title="Your codes"
            description="A code stops working on its own when it expires. Withdraw one early if it gets out."
          />

          {vouchers.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<IconTicket />} title="No codes yet">
                Generate one and give it to the passengers you want back. Nothing changes for
                anyone who does not have it.
              </EmptyState>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Worth</Th>
                  <Th>Used</Th>
                  <Th>Expires</Th>
                  <Th>State</Th>
                  <Th className="text-right">Change</Th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((voucher) => {
                  const state = voucherState(voucher, voucher.uses, now);
                  return (
                    <Tr key={voucher.id}>
                      <Td className="numeric text-base font-semibold tracking-[0.15em] text-ink-900">
                        {voucher.code}
                      </Td>
                      <Td>
                        <span className="font-medium text-ink-900">
                          {describeVoucher(voucher.kind, voucher.value, formatCents)}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-500">
                          {windowLabel(voucher.validity)} from when you made it
                        </span>
                      </Td>
                      <Td>
                        <span className="numeric text-ink-900">
                          {voucher.uses}/{voucher.max_uses}
                        </span>
                        {voucher.givenAwayCents > 0 ? (
                          <span className="numeric mt-0.5 block text-xs text-ink-500">
                            {formatCents(voucher.givenAwayCents)} off
                          </span>
                        ) : null}
                      </Td>
                      <Td className="numeric whitespace-nowrap text-ink-600">
                        {formatInstant(voucher.expires_at)}
                        <span className="block text-xs text-ink-500">
                          {formatRelative(voucher.expires_at, now)}
                        </span>
                      </Td>
                      <Td>
                        {state === 'live' ? (
                          <Badge tone="good">Live</Badge>
                        ) : state === 'withdrawn' ? (
                          <Badge tone="neutral">Withdrawn</Badge>
                        ) : state === 'expired' ? (
                          <Badge tone="neutral">Expired</Badge>
                        ) : (
                          <Badge tone="warn">Used up</Badge>
                        )}
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          {state === 'expired' ? (
                            <span className="text-xs text-ink-400">—</span>
                          ) : (
                            <form action={setVoucherActive}>
                              <input type="hidden" name="operator_id" value={operatorId} />
                              <input type="hidden" name="voucher_id" value={voucher.id} />
                              <input
                                type="hidden"
                                name="active"
                                value={voucher.is_active ? 'off' : 'on'}
                              />
                              <Button type="submit" size="sm" tone="secondary">
                                {voucher.is_active ? 'Withdraw' : 'Put back'}
                              </Button>
                            </form>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}

          <div className="border-t border-ink-150 p-5">
            <Alert tone="info">
              A passenger types the code when they request a seat, and it comes off the total they
              pay the driver. Bookings made before you withdraw a code keep the discount they were
              quoted.
            </Alert>
          </div>
        </Card>
      </div>
    </>
  );
}
