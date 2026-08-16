import { useState } from 'react';
import { Package, Plus, AlertTriangle } from 'lucide-react';
import { useInventoryItemsQuery, useAssetsQuery, useVendorsQuery } from '@/features/api/endpoints';
import { useCreateInventoryItemMutation, useCreateAssetMutation, useCreateVendorMutation } from '@/features/api/mutations';
import { useListState } from '@/lib/useListState';
import { useAuth } from '@/features/auth/useAuth';
import { FormModal, type Field } from '@/components/forms/FormModal';
import { Badge, Button, Card, PageHeader, Pagination, StatusBadge, Table, Tabs, type Column } from '@/components/ui';
import { cn, formatCompactCurrency, formatDate } from '@/lib/utils';

type Row = Record<string, unknown>;
type Dialog = 'item' | 'asset' | 'vendor' | null;

export default function InventoryPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'items' | 'assets'>('items');
  const [dialog, setDialog] = useState<Dialog>(null);
  const { data: vendors } = useVendorsQuery();

  const [createItem] = useCreateInventoryItemMutation();
  const [createAsset] = useCreateAssetMutation();
  const [createVendor] = useCreateVendorMutation();

  const CATEGORIES = ['STATIONERY', 'UNIFORM', 'LAB', 'SPORTS', 'FURNITURE', 'ELECTRONICS', 'CONSUMABLE'];

  const itemFields: Field[] = [
    { name: 'name', label: 'Item name', required: true, placeholder: 'A4 Notebook', half: true },
    { name: 'code', label: 'Code', required: true, placeholder: 'STA-001', half: true },
    { name: 'category', label: 'Category', type: 'select', required: true, half: true,
      options: CATEGORIES.map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() })) },
    { name: 'unit', label: 'Unit', defaultValue: 'PCS', half: true, placeholder: 'PCS / BOX / KG' },
    { name: 'currentStock', label: 'Opening stock', type: 'number', min: 0, defaultValue: 0, half: true },
    { name: 'reorderLevel', label: 'Reorder level', type: 'number', min: 0, defaultValue: 10, half: true,
      hint: 'A low-stock warning shows at or below this' },
    { name: 'unitCost', label: 'Unit cost (₹)', type: 'number', min: 0, half: true },
    { name: 'gstRate', label: 'GST rate (%)', type: 'number', min: 0, max: 28, defaultValue: 0, half: true },
    { name: 'vendorId', label: 'Preferred vendor', type: 'select',
      options: [{ value: '', label: 'None' }, ...(vendors ?? []).map((v) => ({ value: String(v['id']), label: String(v['name']) }))] },
    { name: 'storageLocation', label: 'Storage location', placeholder: 'Store room B' },
  ];

  const assetFields: Field[] = [
    { name: 'assetTag', label: 'Asset tag', required: true, placeholder: 'AST-0001', half: true },
    { name: 'name', label: 'Asset name', required: true, placeholder: 'Projector', half: true },
    { name: 'category', label: 'Category', required: true, placeholder: 'Electronics', half: true },
    { name: 'serialNumber', label: 'Serial number', half: true },
    { name: 'make', label: 'Make', half: true },
    { name: 'model', label: 'Model', half: true },
    { name: 'purchaseDate', label: 'Purchase date', type: 'date', half: true },
    { name: 'purchaseCost', label: 'Purchase cost (₹)', type: 'number', min: 0, half: true },
    { name: 'usefulLifeYears', label: 'Useful life (years)', type: 'number', min: 1, max: 50, half: true,
      hint: 'Drives straight-line depreciation' },
    { name: 'status', label: 'Status', type: 'select', half: true,
      options: ['IN_STORE', 'IN_USE', 'UNDER_REPAIR', 'DISPOSED'].map((v) => ({
        value: v, label: v.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      })) },
    { name: 'location', label: 'Location', placeholder: 'Room 204' },
  ];

  const vendorFields: Field[] = [
    { name: 'name', label: 'Vendor name', required: true, half: true },
    { name: 'code', label: 'Code', required: true, half: true },
    { name: 'phone', label: 'Phone', type: 'tel', required: true, half: true },
    { name: 'email', label: 'Email', type: 'email', half: true },
    { name: 'contactPerson', label: 'Contact person', half: true },
    { name: 'city', label: 'City', half: true },
    { name: 'gstin', label: 'GSTIN', half: true },
    { name: 'rating', label: 'Rating (1-5)', type: 'number', min: 1, max: 5, defaultValue: 3, half: true },
  ];

  return (
    <>
      <PageHeader
        title="Inventory & Assets"
        description="Stock levels, reorder alerts, asset register and vendors."
        actions={
          can('inventory:create') && (
            <>
              <Button size="sm" variant="outline" onClick={() => setDialog('vendor')}>Add vendor</Button>
              <Button size="sm" onClick={() => setDialog(tab === 'items' ? 'item' : 'asset')} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                {tab === 'items' ? 'Add item' : 'Add asset'}
              </Button>
            </>
          )
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'items', label: 'Stock items' }, { value: 'assets', label: 'Asset register' }]}
        className="mb-5"
      />

      {tab === 'items'
        ? <Items canAdd={can('inventory:create')} onAdd={() => setDialog('item')} />
        : <Assets canAdd={can('inventory:create')} onAdd={() => setDialog('asset')} />}

      <FormModal open={dialog === 'item'} onClose={() => setDialog(null)}
        title="Add inventory item" fields={itemFields} size="lg"
        submitLabel="Add item" successMessage="Item added"
        onSubmit={async (values) => { await createItem(values).unwrap(); }} />

      <FormModal open={dialog === 'asset'} onClose={() => setDialog(null)}
        title="Register asset" fields={assetFields} size="lg"
        submitLabel="Register asset" successMessage="Asset registered"
        onSubmit={async (values) => { await createAsset(values).unwrap(); }} />

      <FormModal open={dialog === 'vendor'} onClose={() => setDialog(null)}
        title="Add vendor" fields={vendorFields}
        submitLabel="Add vendor" successMessage="Vendor added"
        onSubmit={async (values) => { await createVendor(values).unwrap(); }} />
    </>
  );
}

function Items({ canAdd, onAdd }: { canAdd: boolean; onAdd: () => void }) {
  const helpers = useListState();
  const { data, isFetching } = useInventoryItemsQuery({ ...helpers.params, limit: 25 });

  const columns: Array<Column<Row>> = [
    {
      key: 'item',
      header: 'Item',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{String(row['name'])}</p>
          <p className="truncate text-xs text-ink-subtle">{String(row['code'])}</p>
        </div>
      ),
    },
    { key: 'category', header: 'Category', hideOnMobile: true, render: (row) => <Badge tone="neutral">{String(row['category'])}</Badge> },
    {
      key: 'stock',
      header: 'In stock',
      align: 'right',
      render: (row) => {
        const stock = Number(row['currentStock']);
        const reorder = Number(row['reorderLevel']);
        const low = stock <= reorder;
        return (
          <span className={cn('inline-flex items-center gap-1 nums', low ? 'font-semibold text-warning' : 'text-ink')}>
            {low && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
            {stock} {String(row['unit'])}
          </span>
        );
      },
    },
    { key: 'reorder', header: 'Reorder at', align: 'right', hideOnMobile: true, render: (row) => <span className="nums text-ink-muted">{String(row['reorderLevel'])}</span> },
    { key: 'cost', header: 'Unit cost', align: 'right', hideOnMobile: true, render: (row) => (row['unitCost'] ? <span className="nums text-ink-muted">{formatCompactCurrency(String(row['unitCost']))}</span> : <span className="text-ink-subtle">—</span>) },
    { key: 'vendor', header: 'Vendor', hideOnMobile: true, render: (row) => { const v = row['vendor'] as { name: string } | null; return <span className="text-ink-muted">{v?.name ?? '—'}</span>; } },
  ];

  return (
    <Card>
      <Table columns={columns} rows={data?.items ?? []} keyOf={(r) => String(r['id'])} loading={isFetching && !data}
        emptyTitle="No inventory items"
        emptyDescription="Track stationery, uniforms, lab consumables and more."
        emptyAction={canAdd ? <Button size="sm" onClick={onAdd} leftIcon={<Plus className="h-3.5 w-3.5" />}>Add item</Button> : undefined} />
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit} onChange={helpers.setPage} />}
    </Card>
  );
}

function Assets({ canAdd, onAdd }: { canAdd: boolean; onAdd: () => void }) {
  const helpers = useListState();
  const { data, isFetching } = useAssetsQuery({ ...helpers.params, limit: 25 });

  const columns: Array<Column<Row>> = [
    {
      key: 'asset',
      header: 'Asset',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{String(row['name'])}</p>
          <p className="truncate text-xs text-ink-subtle nums">{String(row['assetTag'])}</p>
        </div>
      ),
    },
    { key: 'category', header: 'Category', hideOnMobile: true, render: (row) => <Badge tone="neutral">{String(row['category'])}</Badge> },
    { key: 'purchased', header: 'Purchased', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{formatDate(row['purchaseDate'] as string | null, 'short')}</span> },
    { key: 'value', header: 'Book value', align: 'right', render: (row) => (row['currentBookValue'] ? <span className="nums text-ink">{formatCompactCurrency(String(row['currentBookValue']))}</span> : <span className="text-ink-subtle">—</span>) },
    { key: 'location', header: 'Location', hideOnMobile: true, render: (row) => <span className="text-ink-muted">{String(row['location'] ?? '—')}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={String(row['status'])} /> },
  ];

  return (
    <Card>
      <Table columns={columns} rows={data?.items ?? []} keyOf={(r) => String(r['id'])} loading={isFetching && !data}
        emptyTitle="No assets registered"
        emptyDescription="Register furniture, electronics and lab equipment here."
        emptyAction={canAdd ? <Button size="sm" onClick={onAdd} leftIcon={<Plus className="h-3.5 w-3.5" />}>Register asset</Button> : undefined} />
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} limit={data.meta.limit} onChange={helpers.setPage} />}
    </Card>
  );
}
