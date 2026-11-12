# 4. Order totals must be positive

Date: 2024-07-01

## Status

Proposed

## Context

Zero and negative totals have reached the ledger and broken reconciliation.

## Decision

`OrderService.placeOrder` rejects any order whose total is not positive.

## Consequences

Refunds must be modelled as their own transactions, not as negative orders.
