export type OrderStatus = "ORCAMENTO" | "PEDIDO" | "VENDA_REALIZADA" | "CANCELADO";

export type OrderItem = {
  id: string;
  productId?: string;
  name: string;
  type: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type WorkOrder = {
  id: string;
  number: string;
  sourceOrderId?: string;
  revisionNumber?: number;
  customerId?: string;
  customer: string;
  phone?: string;
  plate?: string;
  model?: string;
  mileage?: number;
  mechanic?: string;
  mechanicId?: string;
  budgetDate?: string;
  validUntil?: string;
  saleDate?: string;
  total: number;
  discount?: number;
  status: OrderStatus;
  paymentMethod?: string;
  approvedAt?: string;
  approvedByCustomer?: string;
  approvalMethod?: string;
  approvalNotes?: string;
  lastSharedAt?: string;
  shareCount?: number;
  notes?: string;
  items: OrderItem[];
};

export type DashboardData = {
  connected: boolean;
  orders: WorkOrder[];
};

export type SaleFinancialConfig = {
  entryAmount: number;
  installmentCount: number;
  firstDueDate: string;
  paymentMethodId: string;
  financialAccountId: string;
};

export type BudgetApprovalConfig = {
  approvedByCustomer: string;
  approvalMethod: string;
  approvalNotes?: string;
};

export type CustomerLookup = {
  id: string;
  name: string;
  phone?: string;
  document?: string;
};

export type VehicleLookup = {
  id: string;
  customerId?: string;
  plate: string;
  model?: string;
  mileage?: number;
};

export type ProductLookup = {
  id: string;
  name: string;
  type?: string;
  salePrice: number;
};

export type MechanicLookup = {
  id: string;
  name: string;
};

export type OrderLookups = {
  customers: CustomerLookup[];
  vehicles: VehicleLookup[];
  products: ProductLookup[];
  mechanics: MechanicLookup[];
};
