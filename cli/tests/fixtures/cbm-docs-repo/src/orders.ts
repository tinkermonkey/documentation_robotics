import { OrderStore } from "./store.js";

/** Places and lists customer orders. */
export class OrderService {
  constructor(private readonly store: OrderStore) {}

  /** Place an order for a customer. */
  placeOrder(customerId: string, total: number): string {
    if (total <= 0) throw new Error("total must be positive");
    return this.store.insert({ customerId, total });
  }

  listOrders(customerId: string) {
    return this.store.byCustomer(customerId);
  }
}
