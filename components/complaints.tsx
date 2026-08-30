import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { IconWarning } from '@/components/icons';
import { ResolveForm } from '@/components/resolve-form';
import { formatRelative, formatServiceDate, formatTime } from '@/lib/time';
import type { ReportRow } from '@/lib/reports/queries';

/**
 * One complaints list, rendered for both the operator and the platform admin.
 *
 * They see the same rows through different policies — an operator sees its
 * own, an admin sees all — so the difference belongs in RLS and not in two
 * near-identical components that drift apart.
 */

const categoryLabel: Record<ReportRow['category'], string> = {
  driving: 'Driving',
  lateness: 'Lateness',
  vehicle: 'Vehicle',
  conduct: 'Conduct',
  overcharged: 'Overcharged',
  safety: 'Safety',
  other: 'Other',
};

export function ComplaintList({
  reports,
  showOperator = false,
  canResolve = true,
}: {
  reports: ReportRow[];
  /** The admin view spans operators, so it names which one each is about. */
  showOperator?: boolean;
  canResolve?: boolean;
}) {
  const open = reports.filter((report) => report.status === 'open');
  const closed = reports.filter((report) => report.status !== 'open');

  return (
    <>
      <Card>
        <CardHeader
          title="Open"
          description={
            open.length > 0
              ? `${open.length} waiting on someone.`
              : 'Nothing open. New reports land here.'
          }
        />

        {open.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<IconWarning />} title="Nothing open">
              When a passenger reports a trip, it appears here and Corridor is told at the same
              time.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-ink-200">
            {open.map((report) => (
              <li key={report.id} className="px-5 py-4">
                <Detail report={report} showOperator={showOperator} />
                {canResolve ? (
                  <div className="mt-3">
                    <ResolveForm reportId={report.id} operatorId={report.operatorId} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {closed.length > 0 ? (
        <div className="mt-6">
          <Card>
            <CardHeader title="Closed" />
            <ul className="divide-y divide-ink-200">
              {closed.map((report) => (
                <li key={report.id} className="px-5 py-4">
                  <Detail report={report} showOperator={showOperator} />
                  {report.resolution ? (
                    <p className="mt-2 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
                      <span className="text-ink-500">Closed with:</span> {report.resolution}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function Detail({ report, showOperator }: { report: ReportRow; showOperator: boolean }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={report.status === 'open' ? 'bad' : 'neutral'}>
          {categoryLabel[report.category]}
        </Badge>
        {showOperator ? (
          <span className="font-medium text-ink-900">{report.operatorName}</span>
        ) : null}
        <span className="text-xs text-ink-500">reported {formatRelative(report.createdAt)}</span>
      </div>

      <p className="text-ink-900">{report.note}</p>

      <p className="text-ink-600">
        <span className="text-ink-500">From</span> {report.reporterName ?? 'a passenger'}
        {report.reporterPhone ? (
          <>
            {' · '}
            <a href={`tel:${report.reporterPhone}`} className="numeric text-brand-600">
              {report.reporterPhone}
            </a>
          </>
        ) : null}
      </p>

      {report.serviceDate && report.departureTime ? (
        <p className="text-ink-600">
          <span className="text-ink-500">Trip</span> {formatServiceDate(report.serviceDate)}{' '}
          {formatTime(report.departureTime)}
          {report.assignments.length > 0 ? (
            <>
              {' · '}
              <span className="text-ink-500">driven by</span>{' '}
              {report.assignments
                .map((a) => [a.driver ?? 'unassigned', a.vehicle].filter(Boolean).join(' in '))
                .join(', ')}
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
