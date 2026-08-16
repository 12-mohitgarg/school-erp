/**
 * Admissions — the enquiry-to-enrolment funnel (PRD §5.2).
 *
 * The screen this replaces was a read-only table: "New enquiry" did nothing,
 * there was no way to move an application through the funnel, and marking one
 * ENROLLED changed a label without creating a student. So the funnel recorded
 * conversions that had not happened.
 *
 * What it does now:
 *   * Capture an enquiry.
 *   * Walk it along the stages, with the next action offered per stage rather
 *     than a generic status dropdown — the front office should not have to
 *     know the state machine.
 *   * Convert an approved applicant into a real student, with their class,
 *     section and guardian, in one step.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UserPlus, ArrowRight, Check, X, GraduationCap, Phone, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useAdmissionApplicationsQuery, useAdmissionFunnelQuery, useCreateApplicationMutation,
  useUpdateApplicationMutation, useEnrolApplicationMutation, useClassesQuery,
  type AdmissionApplication,
} from '@/features/api/endpoints';
import { ResourceList } from '@/components/layout/ResourceList';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { Alert, Button, Modal, Select, StatusBadge, type Column } from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { StatRowSkeleton } from '@/components/ui/Skeletons';
import { errorMessage } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

/**
 * The funnel, in order.
 *
 * `next` is the button the row offers. Encoding the progression here rather
 * than exposing a free status dropdown means an application cannot jump from
 * ENQUIRY straight to APPROVED without anyone verifying a document.
 */
const STAGES: Array<{
  value: string;
  label: string;
  next?: { status: string; label: string };
}> = [
  { value: 'ENQUIRY', label: 'Enquiry', next: { status: 'APPLIED', label: 'Mark applied' } },
  { value: 'APPLIED', label: 'Applied', next: { status: 'DOCUMENTS_PENDING', label: 'Request documents' } },
  { value: 'DOCUMENTS_PENDING', label: 'Documents pending', next: { status: 'VERIFIED', label: 'Mark verified' } },
  { value: 'VERIFIED', label: 'Verified', next: { status: 'APPROVED', label: 'Approve' } },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'ENROLLED', label: 'Enrolled' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
];

const STAGE_LABEL = new Map(STAGES.map((s) => [s.value, s.label]));

const ENQUIRY_FIELDS: Field[] = [
  { name: 'firstName', label: 'First name', required: true, half: true },
  { name: 'lastName', label: 'Last name', required: true, half: true },
  { name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true, half: true },
  {
    name: 'gender',
    label: 'Gender',
    type: 'select',
    required: true,
    half: true,
    options: [
      { value: 'MALE', label: 'Male' },
      { value: 'FEMALE', label: 'Female' },
      { value: 'OTHER', label: 'Other' },
      { value: 'UNDISCLOSED', label: 'Prefer not to say' },
    ],
  },
  { name: 'guardianName', label: 'Guardian name', required: true },
  { name: 'guardianPhone', label: 'Guardian phone', type: 'tel', required: true, half: true },
  { name: 'guardianEmail', label: 'Guardian email', type: 'email', half: true },
  { name: 'previousSchool', label: 'Previous school', half: true },
  {
    name: 'source',
    label: 'How did they hear of us?',
    type: 'select',
    half: true,
    options: [
      { value: '', label: 'Not recorded' },
      { value: 'WALK_IN', label: 'Walk-in' },
      { value: 'REFERRAL', label: 'Referral' },
      { value: 'WEBSITE', label: 'Website' },
      { value: 'ADVERTISEMENT', label: 'Advertisement' },
      { value: 'SOCIAL_MEDIA', label: 'Social media' },
      { value: 'OTHER', label: 'Other' },
    ],
  },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export default function AdmissionsPage() {
  const { can } = useAuth();
  const { params } = useListState();

  const query = useAdmissionApplicationsQuery({ ...params, limit: 25 });
  const funnel = useAdmissionFunnelQuery();

  const [createOpen, setCreateOpen] = useState(false);
  const [enrolling, setEnrolling] = useState<AdmissionApplication | null>(null);
  const [rejecting, setRejecting] = useState<AdmissionApplication | null>(null);

  const [createApplication] = useCreateApplicationMutation();
  const [updateApplication] = useUpdateApplicationMutation();

  const canWrite = can('student:update');
  const canEnrol = can('student:create');

  async function advance(row: AdmissionApplication, status: string, label: string) {
    try {
      await updateApplication({ id: row.id, body: { status } }).unwrap();
      toast.success(`${row.firstName} ${row.lastName} — ${label.toLowerCase()}`);
    } catch (err) {
      toast.error('Could not update the application', { description: errorMessage(err) });
    }
  }

  const columns: Array<Column<AdmissionApplication>> = [
    {
      key: 'applicant',
      header: 'Applicant',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">
            {row.firstName} {row.lastName}
          </p>
          <p className="truncate text-xs text-ink-subtle nums">{row.applicationNo}</p>
        </div>
      ),
    },
    {
      key: 'guardian',
      header: 'Guardian',
      hideOnMobile: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{row.guardianName}</p>
          <p className="flex items-center gap-1 truncate text-xs text-ink-subtle nums">
            <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
            {row.guardianPhone}
          </p>
        </div>
      ),
    },
    {
      key: 'dob',
      header: 'Date of birth',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-ink-muted">{formatDate(row.dateOfBirth, 'short')}</span>
      ),
    },
    {
      key: 'applied',
      header: 'Enquired',
      hideOnMobile: true,
      render: (row) => <span className="text-ink-muted">{formatDate(row.createdAt, 'short')}</span>,
    },
    {
      key: 'status',
      header: 'Stage',
      render: (row) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={row.status} />
          {row.enrolledStudentId && (
            <Link
              to={`/students/${row.enrolledStudentId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              View student
            </Link>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        const stage = STAGES.find((s) => s.value === row.status);
        const terminal = ['ENROLLED', 'REJECTED', 'WITHDRAWN'].includes(row.status);

        return (
          <div
            className="flex flex-wrap justify-end gap-1.5"
            // The row itself is not clickable here; stop the buttons from
            // bubbling into any future row handler.
            onClick={(e) => e.stopPropagation()}
          >
            {row.status === 'APPROVED' && canEnrol && (
              <Button
                size="xs"
                onClick={() => setEnrolling(row)}
                leftIcon={<GraduationCap className="h-3 w-3" />}
              >
                Enrol
              </Button>
            )}

            {stage?.next && canWrite && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => void advance(row, stage.next!.status, stage.next!.label)}
                rightIcon={<ArrowRight className="h-3 w-3" />}
              >
                {stage.next.label}
              </Button>
            )}

            {!terminal && canWrite && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setRejecting(row)}
                leftIcon={<X className="h-3 w-3" />}
              >
                Reject
              </Button>
            )}

            {row.status === 'REJECTED' && canWrite && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void advance(row, 'ENQUIRY', 'Reopened')}
                leftIcon={<RotateCcw className="h-3 w-3" />}
              >
                Reopen
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <ResourceList
        title="Admissions"
        description="Enquiry to enrolment"
        columns={columns}
        query={query}
        keyOf={(row) => row.id}
        searchPlaceholder="Search applicants…"
        emptyTitle="No applications yet"
        emptyDescription="Enquiries captured at the front office appear here and move through the funnel to enrolment."
        actions={
          canWrite && (
            <Button
              size="sm"
              leftIcon={<UserPlus className="h-3.5 w-3.5" />}
              onClick={() => setCreateOpen(true)}
            >
              New enquiry
            </Button>
          )
        }
        filters={(h) => (
          <Select
            aria-label="Filter by stage"
            value={h.params['status'] ?? ''}
            onChange={(e) => h.setParam('status', e.target.value || undefined)}
            options={[
              { value: '', label: 'All stages' },
              ...STAGES.map((s) => ({ value: s.value, label: s.label })),
            ]}
            wrapperClassName="mb-0 w-48"
          />
        )}
      >
        {funnel.isLoading ? <StatRowSkeleton count={4} /> : <FunnelStats funnel={funnel.data} />}
      </ResourceList>

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New admission enquiry"
        description="Capture the applicant and their guardian. The application number is allocated automatically."
        fields={ENQUIRY_FIELDS}
        submitLabel="Save enquiry"
        successMessage="Enquiry captured"
        size="lg"
        onSubmit={async (values) => {
          await createApplication(values).unwrap();
        }}
      />

      <EnrolDialog application={enrolling} onClose={() => setEnrolling(null)} />
      <RejectDialog application={rejecting} onClose={() => setRejecting(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function FunnelStats({ funnel }: { funnel: { stages: Record<string, number>; total: number; convertedThisYear: number } | undefined }) {
  if (!funnel) return null;

  const open =
    (funnel.stages['ENQUIRY'] ?? 0) +
    (funnel.stages['APPLIED'] ?? 0) +
    (funnel.stages['DOCUMENTS_PENDING'] ?? 0) +
    (funnel.stages['VERIFIED'] ?? 0);

  const awaitingEnrolment = funnel.stages['APPROVED'] ?? 0;
  const enrolled = funnel.stages['ENROLLED'] ?? 0;

  // Conversion measured against everything that has left the enquiry stage,
  // not against the total — counting today's fresh enquiries as failures makes
  // the number meaningless.
  const decided = enrolled + (funnel.stages['REJECTED'] ?? 0) + (funnel.stages['WITHDRAWN'] ?? 0);
  const conversion = decided === 0 ? 0 : Math.round((enrolled / decided) * 100);

  return (
    <div className="mb-4">
      <StatGrid>
        <StatCard
          index={0}
          accent="brand"
          stat={{ key: 'open', label: 'In progress', value: open, format: 'number', hint: 'Not yet decided' }}
        />
        <StatCard
          index={1}
          accent={awaitingEnrolment > 0 ? 'warning' : 'neutral'}
          stat={{
            key: 'approved',
            label: 'Approved',
            value: awaitingEnrolment,
            format: 'number',
            hint: awaitingEnrolment > 0 ? 'Waiting to be enrolled' : 'Nothing pending',
          }}
        />
        <StatCard
          index={2}
          accent="success"
          stat={{
            key: 'enrolled',
            label: 'Enrolled',
            value: enrolled,
            format: 'number',
            hint: `${funnel.convertedThisYear} this year`,
          }}
        />
        <StatCard
          index={3}
          stat={{
            key: 'conversion',
            label: 'Conversion',
            value: conversion,
            format: 'percent',
            hint: `${decided} decided of ${funnel.total}`,
          }}
        />
      </StatGrid>

      <StageBar stages={funnel.stages} />
    </div>
  );
}

/** Horizontal funnel bar — where applicants actually are, at a glance. */
function StageBar({ stages }: { stages: Record<string, number> }) {
  const tracked = ['ENQUIRY', 'APPLIED', 'DOCUMENTS_PENDING', 'VERIFIED', 'APPROVED', 'ENROLLED'];
  const total = tracked.reduce((sum, key) => sum + (stages[key] ?? 0), 0);

  if (total === 0) return null;

  const tones = [
    'bg-ink-subtle/30',
    'bg-info/50',
    'bg-warning/60',
    'bg-brand-400',
    'bg-brand-600',
    'bg-success',
  ];

  return (
    <div className="mt-3">
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-sunken">
        {tracked.map((key, i) => {
          const count = stages[key] ?? 0;
          if (count === 0) return null;
          return (
            <div
              key={key}
              className={cn('h-full', tones[i])}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${STAGE_LABEL.get(key)}: ${count}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {tracked.map((key, i) => {
          const count = stages[key] ?? 0;
          if (count === 0) return null;
          return (
            <span key={key} className="inline-flex items-center gap-1.5 text-2xs text-ink-muted">
              <span className={cn('h-2 w-2 rounded-full', tones[i])} aria-hidden="true" />
              {STAGE_LABEL.get(key)} <span className="font-medium text-ink nums">{count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Convert an approved application into an enrolled student.
 *
 * Asks only for what the application cannot supply — the class and section.
 * Everything else (name, date of birth, guardian) is carried across from the
 * enquiry, which is the whole point of having captured it.
 */
function EnrolDialog({
  application,
  onClose,
}: {
  application: AdmissionApplication | null;
  onClose: () => void;
}) {
  const { data: classes } = useClassesQuery(undefined, { skip: !application });
  const [enrol, { isLoading }] = useEnrolApplicationMutation();

  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [relation, setRelation] = useState('GUARDIAN');
  const [error, setError] = useState<string | null>(null);

  if (!application) return null;

  const selectedClass = classes?.find((c) => c.id === classId);
  const sections = selectedClass?.sections ?? [];

  async function submit() {
    setError(null);

    if (!classId || !sectionId) {
      setError('Choose the class and section this student joins.');
      return;
    }

    try {
      const result = await enrol({
        id: application!.id,
        body: { classId, sectionId, guardianRelation: relation },
      }).unwrap();

      toast.success(`${application!.firstName} enrolled`, {
        description: `Admission number ${result.student.admissionNo}`,
      });

      setClassId('');
      setSectionId('');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not enrol this applicant.'));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Enrol ${application.firstName} ${application.lastName}`}
      description="Creates the student record, enrols them into the chosen section and links their guardian."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={isLoading} leftIcon={<Check className="h-3.5 w-3.5" />}>
            Enrol student
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <dl className="mb-4 space-y-1.5 rounded-lg border border-hairline bg-surface-sunken/60 p-3 text-sm">
        <Row label="Application" value={application.applicationNo} mono />
        <Row label="Date of birth" value={formatDate(application.dateOfBirth, 'long')} />
        <Row label="Guardian" value={application.guardianName} />
        <Row label="Contact" value={application.guardianPhone} mono />
        {application.previousSchool && (
          <Row label="Previous school" value={application.previousSchool} />
        )}
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Class"
          required
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            // A section from the previous class would enrol them into the
            // wrong class entirely, so it is cleared with the parent.
            setSectionId('');
          }}
          placeholder="Select a class"
          options={(classes ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />

        <Select
          label="Section"
          required
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          placeholder={classId ? 'Select a section' : 'Choose a class first'}
          disabled={!classId}
          options={sections.map((s) => ({
            value: s.id,
            label: `${s.name} · ${s.enrolled}/${s.capacity} filled`,
          }))}
        />

        <Select
          label="Guardian relation"
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
          wrapperClassName="sm:col-span-2"
          options={[
            { value: 'FATHER', label: 'Father' },
            { value: 'MOTHER', label: 'Mother' },
            { value: 'GUARDIAN', label: 'Guardian' },
            { value: 'GRANDPARENT', label: 'Grandparent' },
            { value: 'OTHER', label: 'Other' },
          ]}
        />
      </div>
    </Modal>
  );
}

function RejectDialog({
  application,
  onClose,
}: {
  application: AdmissionApplication | null;
  onClose: () => void;
}) {
  const [update, { isLoading }] = useUpdateApplicationMutation();
  const [reason, setReason] = useState('');

  if (!application) return null;

  async function submit() {
    try {
      await update({
        id: application!.id,
        body: { status: 'REJECTED', ...(reason ? { rejectionReason: reason } : {}) },
      }).unwrap();
      toast.success('Application rejected');
      setReason('');
      onClose();
    } catch (err) {
      toast.error('Could not reject', { description: errorMessage(err) });
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reject ${application.firstName} ${application.lastName}?`}
      description="The application stays on record and can be reopened later."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={isLoading}>
            Reject
          </Button>
        </>
      }
    >
      <label className="block text-xs font-medium text-ink-muted" htmlFor="reject-reason">
        Reason
      </label>
      <textarea
        id="reject-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="No seats available in the applied class"
        className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-500"
      />
      <p className="mt-1.5 text-2xs text-ink-subtle">
        Recorded against the application for follow-up.
      </p>
    </Modal>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-ink-subtle">{label}</dt>
      <dd className={cn('truncate text-ink', mono && 'nums')}>{value}</dd>
    </div>
  );
}
