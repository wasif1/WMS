export interface Me { id: number; name: string; email: string; role: 'super_admin' | 'admin' | 'user'; permissions: string[]; mustChangePassword: boolean; totpEnabled: boolean; mfaSetupRequired: boolean; active: boolean; locked?: boolean; lastLoginAt?: string }
export interface Location { id: number; name: string; address: string; active: boolean }
export interface Product { id: number; sku: string; name: string; description: string; color?: string; weight?: string; unitWeightKg: number; boxWeightKg: number; caseSize: number; uom: 'unit' | 'kg'; reorderLevel: number; active: boolean }
export interface Client { id: number; alias: string; name?: string; contact?: string; address?: string; revealed: boolean }
export interface Line { productId: number; cases: number; loose: number; qty: number; actualQty?: number; difference?: number }
export interface Actor { userId: number; name: string; at: string }
export interface StockRow { productId: number; locationId: number; onHand: number; reserved: number; available: number }
export interface PermDef { key: string; label: string; module: string; sensitive?: boolean }
