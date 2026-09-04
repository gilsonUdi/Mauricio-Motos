export type OrderStatus = "ORCAMENTO" | "PEDIDO" | "VENDA_REALIZADA" | "CANCELADO";

export type OrderItem = {
  id: string;
  name: string;
  type: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type WorkOrder = {
  id: string;
  number: string;
  customer: string;
  phone?: string;
  plate?: string;
  model?: string;
  mileage?: number;
  mechanic?: string;
  budgetDate?: string;
  saleDate?: string;
  total: number;
  status: OrderStatus;
  paymentMethod?: string;
  notes?: string;
  items: OrderItem[];
};

export type DashboardData = {
  connected: boolean;
  orders: WorkOrder[];
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
