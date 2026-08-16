import { useState } from 'react';
import { BookOpen, Plus, Search, ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  useBooksQuery, useBookLoansQuery, useReportLibraryQuery,
  useReturnBookMutation, type BookRow,
} from '@/features/api/endpoints';
import { useCreateBookMutation } from '@/features/api/mutations';
import { IssueBookDialog } from './IssueBookDialog';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/lib/api';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { Badge, Button, Card, Input, PageHeader, Pagination, StatusBadge, Table, Tabs, type Column } from '@/components/ui';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { formatCompactCurrency, formatDate } from '@/lib/utils';

export default function LibraryPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'catalogue' | 'loans'>('catalogue');
  const [open, setOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const { data: report } = useReportLibraryQuery();
  const [createBook] = useCreateBookMutation();

  const fields: Field[] = [
    { name: 'title', label: 'Title', required: true, placeholder: 'The Jungle Book' },
    { name: 'author', label: 'Author', required: true, placeholder: 'Rudyard Kipling', half: true },
    { name: 'isbn', label: 'ISBN', half: true, placeholder: '978-0141325293' },
    { name: 'publisher', label: 'Publisher', half: true },
    { name: 'language', label: 'Language', defaultValue: 'English', half: true },
    { name: 'publishYear', label: 'Year', type: 'number', min: 1400, max: 2100, half: true },
    { name: 'price', label: 'Price (₹)', type: 'number', min: 0, half: true },
    { name: 'rackLocation', label: 'Shelf location', placeholder: 'R3-S2', half: true,
      hint: 'Where the copies are physically kept' },
    { name: 'copyCount', label: 'Number of copies', type: 'number', required: true, min: 1, max: 100,
      defaultValue: 3, half: true,
      hint: 'Accession numbers are generated automatically' },
  ];

  return (
    <>
      <PageHeader
        title="Library"
        description="Catalogue, circulation and overdue tracking."
        actions={
          can('library:create') && (
            <>
              <Button size="sm" variant="outline" onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Add book
              </Button>
              <Button size="sm" onClick={() => setIssueOpen(true)} leftIcon={<BookOpen className="h-3.5 w-3.5" />}>
                Issue book
              </Button>
            </>
          )
        }
      />

      <StatGrid>
        <StatCard stat={{ key: 'titles', label: 'Titles', value: report?.titles ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'copies', label: 'Total copies', value: report?.totalCopies ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'available', label: 'Available', value: report?.availableCopies ?? 0, format: 'number' }} />
        <StatCard stat={{ key: 'fines', label: 'Fines outstanding', value: report?.outstandingFines ?? 0, format: 'currency' }} accent={report && report.outstandingFines > 0 ? 'warning' : undefined} />
      </StatGrid>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'catalogue', label: 'Catalogue' }, { value: 'loans', label: 'Issued & overdue' }]}
        className="my-5"
      />

      {tab === 'catalogue' ? <Catalogue onAdd={() => setOpen(true)} canAdd={can('library:create')} /> : <Loans canManage={can('library:update')} />}

      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        title="Add book to catalogue"
        description="Physical copies are created with sequential accession numbers."
        fields={fields}
        size="lg"
        submitLabel="Add book"
        successMessage="Book catalogued"
        onSubmit={async (values) => {
          const { copyCount, ...rest } = values;
          const count = Number(copyCount ?? 1);
          // The API takes explicit accession numbers; generate them from the
          // title so they stay readable on the shelf.
          const prefix = String(rest['title'] ?? 'BK').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
          const stamp = Date.now().toString().slice(-6);
          await createBook({
            ...rest,
            copies: Array.from({ length: count }, (_, i) => `${prefix}${stamp}${String(i + 1).padStart(2, '0')}`),
          }).unwrap();
        }}
      />

      <IssueBookDialog open={issueOpen} onClose={() => setIssueOpen(false)} />
    </>
  );
}

function Catalogue({ onAdd, canAdd }: { onAdd: () => void; canAdd: boolean }) {
  const helpers = useListState();
  const { data, isFetching } = useBooksQuery({ ...helpers.params, limit: 25 });

  const columns: Array<Column<BookRow>> = [
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.title}</p>
          <p className="truncate text-xs text-ink-subtle">{row.author}</p>
        </div>
      ),
    },
    { key: 'category', header: 'Category', hideOnMobile: true, render: (row) => (row.category ? <Badge tone="neutral">{row.category.name}</Badge> : <span className="text-ink-subtle">—</span>) },
    { key: 'rack', header: 'Shelf', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{row.rackLocation ?? '—'}</span> },
    {
      key: 'copies',
      header: 'Availability',
      align: 'right',
      render: (row) => (
        <span className={row.availableCopies === 0 ? 'nums text-danger' : 'nums text-ink'}>
          {row.availableCopies}/{row.totalCopies}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <div className="border-b border-hairline p-4">
        <Input
          type="search"
          placeholder="Search by title, author or ISBN…"
          value={helpers.searchDraft}
          onChange={(e) => helpers.setSearchDraft(e.target.value)}
          onBlur={() => helpers.commitSearch(helpers.searchDraft)}
          leftIcon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
          wrapperClassName="max-w-md"
        />
      </div>
      <Table columns={columns} rows={data?.items ?? []} keyOf={(r) => r.id} loading={isFetching && !data}
        emptyTitle="No books catalogued"
        emptyDescription="Add your first title to start lending."
        emptyAction={canAdd ? <Button size="sm" onClick={onAdd} leftIcon={<Plus className="h-3.5 w-3.5" />}>Add book</Button> : undefined} />
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit} onChange={helpers.setPage} />}
    </Card>
  );
}

function Loans({ canManage }: { canManage: boolean }) {
  const helpers = useListState();
  const { data, isFetching } = useBookLoansQuery({ ...helpers.params, limit: 25 });
  const [returnBook, { isLoading: returning }] = useReturnBookMutation();

  type Row = Record<string, unknown>;

  async function onReturn(loanId: string) {
    try {
      const result = await returnBook({ loanId, condition: 'GOOD' }).unwrap();
      const fine = Number(result['fine'] ?? 0);
      toast.success('Book returned', {
        description: fine > 0 ? `Overdue fine of ${formatCompactCurrency(fine)} recorded.` : undefined,
      });
    } catch (err) {
      toast.error('Could not record the return', { description: errorMessage(err) });
    }
  }

  const columns: Array<Column<Row>> = [
    {
      key: 'book',
      header: 'Book',
      render: (row) => {
        const copy = row['bookCopy'] as { accessionNo: string; book: { title: string; author: string } };
        return (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{copy.book.title}</p>
            <p className="truncate text-xs text-ink-subtle">{copy.accessionNo}</p>
          </div>
        );
      },
    },
    {
      key: 'member',
      header: 'Issued to',
      render: (row) => {
        const student = row['student'] as { firstName: string; lastName: string; admissionNo: string } | null;
        const employee = row['employee'] as { firstName: string; lastName: string } | null;
        const who = student ? `${student.firstName} ${student.lastName}` : employee ? `${employee.firstName} ${employee.lastName}` : '—';
        return <span className="text-ink">{who}</span>;
      },
    },
    { key: 'due', header: 'Due', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{formatDate(String(row['dueDate']), 'short')}</span> },
    { key: 'fine', header: 'Fine', align: 'right', hideOnMobile: true, render: (row) => { const fine = Number(row['fineAmount'] ?? 0); return fine > 0 ? <span className="nums text-danger">{formatCompactCurrency(fine)}</span> : <span className="text-ink-subtle">—</span>; } },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={String(row['status'])} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        const status = String(row['status']);
        if (!canManage || status === 'RETURNED' || status === 'LOST') return null;
        return (
          <Button size="xs" variant="outline" loading={returning}
            onClick={() => void onReturn(String(row['id']))}
            leftIcon={<ArrowLeftRight className="h-3 w-3" />}>
            Return
          </Button>
        );
      },
    },
  ];

  return (
    <Card>
      <Table columns={columns} rows={data?.items ?? []} keyOf={(r) => String(r['id'])} loading={isFetching && !data}
        emptyTitle="No loans on record" emptyDescription="Books issued to students and staff appear here." />
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit} onChange={helpers.setPage} />}
    </Card>
  );
}
