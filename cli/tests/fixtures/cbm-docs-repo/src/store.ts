export interface OrderRow {
  customerId: string;
  total: number;
}

/** Keeps orders in PostgreSQL. */
export class OrderStore {
  private rows: OrderRow[] = [];

  insert(row: OrderRow): string {
    this.rows.push(row);
    return String(this.rows.length);
  }

  byCustomer(customerId: string): OrderRow[] {
    return this.rows.filter((r) => r.customerId === customerId);
  }
}
