import { ComplaintList } from '@/components/complaints';
import { listReports } from '@/lib/reports/queries';
import { requireOperatorRole } from '@/lib/auth/session';
import { PageHeader } from '@/components/ui';

/**
 * What passengers have said went wrong on this operator's trips.
 *
 * Corridor sees these too, and was told at the same moment — said plainly in
 * the description rather than left to be discovered, because an operator who
 * thinks a complaint is private will answer it differently.
 */
export default async function OperatorComplaintsPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  await requireOperatorRole(operatorId);

  const reports = await listReports(operatorId);

  return (
    <>
      <PageHeader
        title="Complaints"
        description="Trips your passengers have reported. Corridor sees these as well. Close one with a note and the passenger is told what you did."
      />
      <ComplaintList reports={reports} />
    </>
  );
}
