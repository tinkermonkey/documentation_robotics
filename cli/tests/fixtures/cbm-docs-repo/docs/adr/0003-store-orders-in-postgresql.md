# 3. Store orders in PostgreSQL

Date: 2024-06-15

Deciders: Ana Lima, Ben Okafor

## Status

Accepted

Supersedes [2. Store orders in SQLite](0002-store-orders-in-sqlite.md)

## Context

The service now runs on several hosts behind a load balancer, so an embedded database no longer works.

## Decision

We will store orders in a managed PostgreSQL database, accessed only through `OrderStore`.

## Consequences

Every host shares one source of truth. The team must operate a database server and run migrations.
