/**
 * Schools — the platform operator's control plane.
 *
 * The model the client asked for: one operator adds many schools, and each
 * school gets its own complete panel that its own staff run. That falls out of
 * the tenancy already in the system — a school *is* a tenant, and every query
 * in the product is already tenant-scoped — so this screen does three things
 * and nothing more:
 *
 *   1. Provision a school, with its first administrator, in one step.
 *   2. Show each school's real size, so the operator can see who is actually
 *      using the product rather than a list of names.
 *   3. Open a school's panel, which reissues the session against that school.
 *      From that moment the operator sees exactly what its staff see.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Plus, ExternalLink, Users, GraduationCap, Bus, Ban, Play,
  ShieldCheck, Copy, Check, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SchoolSummary } from '@erp/shared';
import {
  usePlatformOverviewQuery, useSchoolsQuery, useCreateSchoolMutation,
  useSetSchoolStatusMutation, useAddSchoolAdminMutation, useOpenSchoolMutation,
} from '@/features/api/endpoints';
import { FormModal, type Field } from '@/components/forms/FormModal';
import {
  Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select,
} from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { StatRowSkeleton, SkeletonRegion, Skeleton } from '@/components/ui/Skeletons';
import { useListState } from '@/lib/useListState';
import { errorMessage } from '@/lib/api';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { useAppDispatch } from '@/store';
import { credentialsUpdated } from '@/store/authSlice';
import { api } from '@/lib/api';
import { useRefreshUser } from '@/features/auth/useAuth';

const CREATE_FIELDS: Field[] = [
  { name: 'name', label: 'School name', required: true, placeholder: 'Delhi Public School, Rohini' },
  {
    name: 'code',
    label: 'Short code',
    required: true,
    half: true,
    placeholder: 'DPSR',
    hint: 'Prefixes admission and invoice numbers. Letters, numbers and hyphens.',
  },
  {
    name: 'subscriptionTier',
    label: 'Plan',
    type: 'select',
    half: true,
    defaultValue: 'STANDARD',
    options: [
      { value: 'STANDARD', label: 'Standard' },
      { value: 'PREMIUM', label: 'Premium' },
      { value: 'ENTERPRISE', label: 'Enterprise' },
    ],
  },
  { name: 'email', label: 'School email', type: 'email', half: true, placeholder: 'office@school.edu.in' },
  { name: 'phone', label: 'School phone', type: 'tel', half: true, placeholder: '+919876543210' },
  { name: 'addressLine1', label: 'Address' },
  { name: 'city', label: 'City', half: true },
  { name: 'state', label: 'State', half: true },
  {
    name: 'latitude',
    label: 'Campus latitude',
    type: 'number',
    half: true,
    step: 0.000001,
    min: -90,
    max: 90,
    hint: 'Sets the campus geofence, so arrival alerts work on day one.',
  },
  { name: 'longitude', label: 'Campus longitude', type: 'number', half: true, step: 0.000001, min: -180, max: 180 },
  {
    name: 'locationRetentionDays',
    label: 'GPS retention (days)',
    type: 'number',
    half: true,
    min: 1,
    max: 365,
    defaultValue: 30,
    hint: 'PRD §6.3 — location history is purged after this many days.',
  },
  { name: 'primaryColor', label: 'Brand colour', type: 'color', half: true, defaultValue: '#4F46E5' },

  { name: 'adminFirstName', label: 'Administrator first name', required: true, half: true },
  { name: 'adminLastName', label: 'Administrator last name', required: true, half: true },
  {
    name: 'adminEmail',
    label: 'Administrator email',
    type: 'email',
    required: true,
    hint: 'They sign in with this and receive a one-time password.',
  },
  { name: 'adminPhone', label: 'Administrator phone', type: 'tel', half: true },
];

export default function SchoolsPage() {
  const { params } = useListState();
  const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
  const [search, setSearch] = useState('');

  const overview = usePlatformOverviewQuery();
  const schools = useSchoolsQuery({
    ...params,
    limit: 50,
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<{
    name: string;
    email: string | null;
    password?: string;
  } | null>(null);

  const [createSchool] = useCreateSchoolMutation();

  async function submitCreate(values: Record<string, unknown>) {
    // The form is flat for usability; the API takes the administrator nested,
    // because they are created as one atomic provisioning step.
    const { adminFirstName, adminLastName, adminEmail, adminPhone, ...school } = values;

    const result = await createSchool({
      ...school,
      admin: {
        firstName: adminFirstName,
        lastName: adminLastName,
        email: adminEmail,
        ...(adminPhone ? { phone: adminPhone } : {}),
      },
    }).unwrap();

    setCreated({
      name: result.school.name,
      email: result.admin.email,
      ...(result.temporaryPassword ? { password: result.temporaryPassword } : {}),
    });
  }

  return (
    <>
      <PageHeader
        title="Schools"
        description="Every institution on the platform. Add a school and it gets its own panel, staff and data."
        aurora
        actions={
          <Button leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>
            Add school
          </Button>
        }
      />

      {overview.isLoading ? (
        <StatRowSkeleton count={5} />
      ) : (
        <StatGrid>
          <StatCard
            index={0}
            accent="brand"
            icon={<Building2 className="h-3.5 w-3.5" />}
            stat={{
              key: 'schools',
              label: 'Schools',
              value: overview.data?.schools ?? 0,
              format: 'number',
              hint: `${overview.data?.activeSchools ?? 0} active`,
            }}
          />
          <StatCard
            index={1}
            icon={<GraduationCap className="h-3.5 w-3.5" />}
            stat={{
              key: 'students',
              label: 'Students',
              value: overview.data?.students ?? 0,
              format: 'number',
              hint: 'Across all schools',
            }}
          />
          <StatCard
            index={2}
            icon={<Users className="h-3.5 w-3.5" />}
            stat={{ key: 'staff', label: 'Staff', value: overview.data?.staff ?? 0, format: 'number' }}
          />
          <StatCard
            index={3}
            icon={<Bus className="h-3.5 w-3.5" />}
            stat={{ key: 'fleet', label: 'Vehicles', value: overview.data?.vehicles ?? 0, format: 'number' }}
          />
          <StatCard
            index={4}
            accent={overview.data?.activeSos ? 'danger' : 'neutral'}
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            stat={{
              key: 'sos',
              label: 'Active SOS',
              value: overview.data?.activeSos ?? 0,
              format: 'number',
              hint: overview.data?.activeSos ? 'Needs attention now' : 'All clear',
            }}
          />
        </StatGrid>
      )}

      <Card className="mt-4">
        <div className="flex flex-wrap items-end gap-3 border-b border-hairline p-3 sm:p-4">
          <Input
            type="search"
            placeholder="Search by name, code or city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            wrapperClassName="mb-0 min-w-full flex-1 sm:min-w-[240px]"
          />
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            options={[
              { value: '', label: 'All schools' },
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
            ]}
            wrapperClassName="mb-0 w-44"
          />
        </div>

        {schools.isLoading ? (
          <SchoolGridSkeleton />
        ) : (schools.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
            title={search || status ? 'No schools match that' : 'No schools yet'}
            description={
              search || status
                ? 'Try a different search or clear the filter.'
                : 'Add your first school. It comes up with a campus, the current academic year, standard fee heads and an administrator who can sign in straight away.'
            }
            action={
              !search && !status ? (
                <Button leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>
                  Add school
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2 xl:grid-cols-3">
            {schools.data?.items.map((school, index) => (
              <SchoolCard key={school.id} school={school} index={index} />
            ))}
          </div>
        )}
      </Card>

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a school"
        description="Creates the school, its main campus, the current academic year, the standard fee heads and its first administrator."
        fields={CREATE_FIELDS}
        submitLabel="Create school"
        size="lg"
        successMessage="School created"
        onSubmit={submitCreate}
      />

      <CredentialsDialog created={created} onClose={() => setCreated(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function SchoolCard({ school, index }: { school: SchoolSummary; index: number }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const refreshUser = useRefreshUser();

  const [openSchool, { isLoading: opening }] = useOpenSchoolMutation();
  const [setStatus] = useSetSchoolStatusMutation();
  const [addAdmin] = useAddSchoolAdminMutation();

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  /**
   * Open this school's panel.
   *
   * The new token replaces the current one and the whole RTK cache is dropped
   * — without the reset, the previous school's students and invoices would
   * still be sitting in the cache and would render for a beat under the new
   * school's name, which is exactly the kind of cross-school bleed this
   * product cannot afford to show even briefly.
   */
  async function open() {
    try {
      const result = await openSchool(school.id).unwrap();
      dispatch(credentialsUpdated({ accessToken: result.tokens.accessToken }));
      dispatch(api.util.resetApiState());
      await refreshUser();

      toast.success(`Opened ${result.school.name}`, {
        description: 'You are now working inside this school.',
      });
      navigate('/');
    } catch (err) {
      toast.error('Could not open this school', { description: errorMessage(err) });
    }
  }

  async function toggleStatus(reason?: string) {
    try {
      await setStatus({
        id: school.id,
        active: !school.isActive,
        ...(reason ? { reason } : {}),
      }).unwrap();
      toast.success(school.isActive ? 'School suspended' : 'School reactivated');
    } catch (err) {
      toast.error('Could not update the school', { description: errorMessage(err) });
    }
  }

  return (
    <>
      <div
        style={{ animationDelay: `${index * 40}ms` }}
        className={cn(
          'flex flex-col rounded-xl border border-hairline bg-surface p-4 shadow-sm',
          'animate-slide-up [animation-fill-mode:backwards]',
          !school.isActive && 'opacity-75',
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: school.primaryColor }}
            aria-hidden="true"
          >
            {school.logoUrl ? (
              <img src={school.logoUrl} alt="" className="h-full w-full rounded-xl object-cover" />
            ) : (
              school.code.slice(0, 2).toUpperCase()
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{school.name}</p>
            <p className="truncate text-xs text-ink-subtle">
              {school.code}
              {school.city ? ` · ${school.city}` : ''}
            </p>
          </div>

          <Badge tone={school.isActive ? 'success' : 'danger'} dot>
            {school.isActive ? 'Active' : 'Suspended'}
          </Badge>
        </div>

        {!school.isActive && school.suspendedReason && (
          <p className="mt-2 rounded-lg bg-danger/5 px-2.5 py-1.5 text-2xs text-danger">
            {school.suspendedReason}
          </p>
        )}

        <dl className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-surface-sunken/60 p-2.5 text-center">
          <Metric label="Students" value={school.counts.students} />
          <Metric label="Staff" value={school.counts.staff} />
          <Metric label="Campuses" value={school.counts.branches} />
          <Metric label="Buses" value={school.counts.vehicles} />
        </dl>

        <div className="mt-3 min-w-0 flex-1 text-xs text-ink-muted">
          {school.admins.length > 0 ? (
            <p className="truncate">
              <span className="text-ink-subtle">Admin:</span> {school.admins[0]!.fullName}
              {school.admins[0]!.lastLoginAt
                ? ` · last in ${formatDate(school.admins[0]!.lastLoginAt, 'short')}`
                : ' · never signed in'}
            </p>
          ) : (
            <p className="text-warning">No administrator — this school cannot be accessed.</p>
          )}
          <p className="mt-0.5 truncate text-ink-subtle">
            {school.subscriptionTier} · GPS kept {school.locationRetentionDays} days · added{' '}
            {formatDate(school.createdAt, 'short')}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-hairline pt-3">
          <Button
            size="sm"
            loading={opening}
            disabled={!school.isActive}
            onClick={() => void open()}
            leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
          >
            Open panel
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdminOpen(true)}
            leftIcon={<UserPlus className="h-3.5 w-3.5" />}
          >
            Add admin
          </Button>

          <Button
            size="sm"
            variant={school.isActive ? 'ghost' : 'success'}
            onClick={() => (school.isActive ? setSuspendOpen(true) : void toggleStatus())}
            leftIcon={
              school.isActive ? <Ban className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />
            }
          >
            {school.isActive ? 'Suspend' : 'Reactivate'}
          </Button>
        </div>
      </div>

      <SuspendDialog
        open={suspendOpen}
        schoolName={school.name}
        onClose={() => setSuspendOpen(false)}
        onConfirm={(reason) => void toggleStatus(reason)}
      />

      <FormModal
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        title={`Add an administrator to ${school.name}`}
        description="They get a Super Admin account inside this school only, with a one-time password."
        submitLabel="Create administrator"
        successMessage="Administrator created"
        fields={[
          { name: 'firstName', label: 'First name', required: true, half: true },
          { name: 'lastName', label: 'Last name', required: true, half: true },
          { name: 'email', label: 'Email', type: 'email', required: true },
          { name: 'phone', label: 'Phone', type: 'tel', half: true },
        ]}
        onSubmit={async (values) => {
          const result = await addAdmin({ id: school.id, body: values }).unwrap();
          toast.info('One-time password', {
            description: result.temporaryPassword,
            duration: 30_000,
          });
        }}
      />
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="text-sm font-semibold text-ink nums">{formatNumber(value)}</dd>
      <dt className="text-2xs text-ink-subtle">{label}</dt>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Suspension asks for a reason, because it signs every user in that school out
 * immediately and the affected staff will ask why.
 */
function SuspendDialog({
  open,
  schoolName,
  onClose,
  onConfirm,
}: {
  open: boolean;
  schoolName: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Suspend ${schoolName}?`}
      description="Everyone in this school is signed out immediately and cannot sign back in until it is reactivated. No data is deleted."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm(reason);
              setReason('');
              onClose();
            }}
          >
            Suspend school
          </Button>
        </>
      }
    >
      <Input
        label="Reason"
        placeholder="Subscription lapsed"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Recorded against the school and shown to you here, not to its staff."
      />
    </Modal>
  );
}

/**
 * The generated password is shown exactly once — it is never stored in
 * readable form, so this dialog is the only chance to hand it over.
 */
function CredentialsDialog({
  created,
  onClose,
}: {
  created: { name: string; email: string | null; password?: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!created) return null;

  const block = `School: ${created.name}\nEmail: ${created.email ?? '—'}\nPassword: ${created.password ?? '(chosen by you)'}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${created.name} is ready`}
      description="Its administrator can sign in now and start setting up classes, staff and fees."
      size="sm"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <Alert tone="warning" title="Shown only once">
        The password is stored hashed, so it cannot be shown again. Copy it now.
      </Alert>

      <dl className="mt-4 space-y-2 rounded-lg border border-hairline bg-surface-sunken/60 p-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-subtle">Email</dt>
          <dd className="truncate font-medium text-ink">{created.email ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-subtle">Password</dt>
          <dd className="font-mono text-ink">{created.password ?? 'Chosen by you'}</dd>
        </div>
      </dl>

      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        leftIcon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        onClick={() => {
          void navigator.clipboard.writeText(block);
          setCopied(true);
          setTimeout(() => setCopied(false), 2_000);
        }}
      >
        {copied ? 'Copied' : 'Copy credentials'}
      </Button>
    </Modal>
  );
}

function SchoolGridSkeleton() {
  return (
    <SkeletonRegion
      label="Loading schools"
      className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="rounded-xl border border-hairline bg-surface p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>
          <Skeleton className="mt-3 h-14 w-full rounded-lg" />
          <Skeleton className="mt-3 h-3 w-4/5" />
          <div className="mt-3 flex gap-2 border-t border-hairline pt-3">
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

// Re-exported so the shell can reuse the same card metric styling if needed.
export { Metric as SchoolMetric };
