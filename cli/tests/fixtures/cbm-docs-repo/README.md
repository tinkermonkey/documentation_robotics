# Order service

A small service that places and lists customer orders. It is a test fixture for DR's use of
codebase-memory-mcp's documentation graph (ADR and Section nodes).

## Placing orders

`OrderService.placeOrder` validates the total and hands the order to `OrderStore`.
Totals must be positive. See [the service](src/orders.ts).

## Storage

`OrderStore` keeps every order in PostgreSQL (see [store.ts](src/store.ts)); ADR 3 explains why.
