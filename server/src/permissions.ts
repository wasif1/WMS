export interface PermDef { key: string; label: string; module: string; sensitive?: boolean }

export const PERMISSIONS: PermDef[] = [
  { key: 'dashboard.view', label: 'View dashboard & KPIs', module: 'Dashboard' },
  { key: 'products.view', label: 'View products & product pages', module: 'Products' },
  { key: 'products.create', label: 'Add new products', module: 'Products' },
  { key: 'products.edit', label: 'Edit products', module: 'Products' },
  { key: 'locations.view', label: 'View locations', module: 'Locations' },
  { key: 'locations.manage', label: 'Add / edit locations', module: 'Locations' },
  { key: 'inbound.view', label: 'View inbound orders', module: 'Inbound' },
  { key: 'inbound.create', label: 'Create / import packing lists', module: 'Inbound' },
  { key: 'inbound.approve', label: 'Approve inbound orders', module: 'Inbound', sensitive: true },
  { key: 'transfers.view', label: 'View transfer orders', module: 'Transfers' },
  { key: 'transfers.create', label: 'Create & submit transfer orders', module: 'Transfers' },
  { key: 'transfers.receive', label: 'Receive transfers', module: 'Transfers' },
  { key: 'reserves.view', label: 'View reserve orders', module: 'Reserved' },
  { key: 'reserves.create', label: 'Create reserve orders', module: 'Reserved' },
  { key: 'reserves.convert', label: 'Cancel / convert reserves to outbound', module: 'Reserved' },
  { key: 'outbound.view', label: 'View outbound orders', module: 'Outbound' },
  { key: 'outbound.create', label: 'Create & edit outbound orders', module: 'Outbound' },
  { key: 'outbound.confirm', label: 'Confirm outbound orders', module: 'Outbound', sensitive: true },
  { key: 'adjustments.view', label: 'View inventory adjustments', module: 'Adjustments' },
  { key: 'adjustments.create', label: 'Make inventory adjustments', module: 'Adjustments', sensitive: true },
  { key: 'audits.view', label: 'View inventory audits', module: 'Audits' },
  { key: 'audits.create', label: 'Start inventory audits', module: 'Audits' },
  { key: 'audits.count', label: 'Enter physical counts & submit audits for approval', module: 'Audits' },
  { key: 'reports.inventory', label: 'Inventory reports', module: 'Reports' },
  { key: 'reports.orders', label: 'Order reports', module: 'Reports' },
  { key: 'clients.view', label: 'View clients (anonymised aliases)', module: 'Clients' },
  { key: 'clients.manage', label: 'Add / edit clients', module: 'Clients' },
  { key: 'clients.reveal', label: 'See REAL client names & details', module: 'Clients', sensitive: true },
  { key: 'approvals.manage', label: 'OWNER: approve / reject products, locations, adjustments & audits', module: 'Approvals', sensitive: true },
  { key: 'logs.view', label: 'View activity log', module: 'Administration', sensitive: true },
]

export const ALL_KEYS = PERMISSIONS.map((p) => p.key)
export const isValidPermission = (k: string) => ALL_KEYS.includes(k)
