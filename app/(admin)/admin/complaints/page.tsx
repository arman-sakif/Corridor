import { ComplaintList } from '@/components/complaints';
import { listReports } from '@/lib/reports/queries';
import { PageHeader } from '@/components/ui';

/**
 * Every complaint on the platform.
 *
 * The operator sees its own and is expected to fix it; this is the view that
 * shows a pattern across operators — three safety reports about one business
 * is a vetting decision, not a customer-service one.
 */
export default async function AdminComplaintsPage() {
  const reports = await listReports();

  return (
    <>
      <PageHeader
        title="Complaints"
        description="Trips passengers have reported. The operator is told at the same time you are, and either of you can close one."
      />
      <ComplaintList reports={reports} showOperator />
    </>
  );
}
