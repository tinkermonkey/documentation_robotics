# 2. Store orders in SQLite

Date: 2024-02-01

## Status

Superseded by [3. Store orders in PostgreSQL](0003-store-orders-in-postgresql.md)

## Context

Orders need to be persisted between restarts. The service runs on one host.

## Decision

We will store orders in an embedded SQLite database owned by `OrderStore`.

## Consequences

No separate database server is needed, but the service cannot scale out.
