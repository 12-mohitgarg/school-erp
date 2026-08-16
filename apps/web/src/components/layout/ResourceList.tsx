import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Card, Input, PageHeader, Pagination, Table, type Column } from '@/components/ui';
import { useListState } from '@/lib/useListState';
import type { Paged } from '@/lib/api';

/**
 * The list-page shape most modules share: header, search + filters, a table,
 * and pagination wired to the URL. Pages supply columns and filters; everything
 * else is identical, so it lives here once.
 */
export function ResourceList<T>({
  title,
  description,
  actions,
  columns,
  query,
  keyOf,
  onRowClick,
  filters,
  searchPlaceholder = 'Search…',
  emptyTitle,
  emptyDescription,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  columns: Array<Column<T>>;
  /** Result of an RTK Query list hook. */
  query: { data?: Paged<T>; isFetching: boolean };
  keyOf: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  /** Extra filter controls, rendered beside the search box. */
  filters?: (helpers: ReturnType<typeof useListState>) => ReactNode;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Content rendered above the table, e.g. a stat row. */
  children?: ReactNode;
}) {
  const helpers = useListState();
  const { data, isFetching } = query;

  return (
    <>
      <PageHeader
        title={title}
        description={data ? `${data.meta.total} total${description ? ` · ${description}` : ''}` : description}
        actions={actions}
      />

      {children}

      <Card className={children ? 'mt-4' : undefined}>
        <div className="flex flex-wrap items-end gap-3 border-b border-hairline p-3 sm:p-4">
          <form
            // Grows to fill, but may shrink to the container on a phone rather
            // than forcing the card wider than the screen.
            className="min-w-full flex-1 sm:min-w-[220px]"
            onSubmit={(e) => {
              e.preventDefault();
              helpers.commitSearch(helpers.searchDraft);
            }}
          >
            <Input
              type="search"
              placeholder={searchPlaceholder}
              value={helpers.searchDraft}
              onChange={(e) => helpers.setSearchDraft(e.target.value)}
              onBlur={() => helpers.commitSearch(helpers.searchDraft)}
              leftIcon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
              wrapperClassName="mb-0"
            />
          </form>
          {filters?.(helpers)}
        </div>

        <Table
          columns={columns}
          rows={data?.items ?? []}
          keyOf={keyOf}
          loading={isFetching && !data}
          onRowClick={onRowClick}
          emptyTitle={emptyTitle ?? 'Nothing here yet'}
          emptyDescription={emptyDescription}
        />

        {data && (
          <Pagination
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            total={data.meta.total}
            limit={data.meta.limit}
            onChange={helpers.setPage}
          />
        )}
      </Card>
    </>
  );
}

/** Read the URL-backed list params inside a page that renders its own layout. */
export { useListState };
