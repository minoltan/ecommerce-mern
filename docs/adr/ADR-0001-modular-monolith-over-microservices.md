# ADR-0001: Modular Monolith over Microservices (Phase 3 / MERN)

**Status:** Accepted
**Date:** 2026-06-16
**Bounded contexts affected:** All

---

## Context

`ecommerce-mern` is the Phase 3 implementation of the same e-commerce domain already built as
Java/Spring Boot microservices (Phase 1, `ecommerce-platform`) and AWS serverless (Phase 2).
The same seven bounded contexts apply: User/Auth, Product Catalog, Cart, Order, Payment,
Inventory, Notification.

Phase 1 already answered "microservices vs. monolith" for the Java implementation
(`ecommerce-platform/docs/adr/ADR-0006-microservices-vs-monolith.md`) by choosing microservices,
explicitly to build distributed-systems experience. Phase 3 has a different goal: it doubles as
the backing project for a 20-hour MERN curriculum (`CURRICULUM.md`), where the teaching arc is
*monolith first, understand the seams, then discuss extraction* — Session 1 introduces the
modular monolith as a deliberate alternative to starting with microservices, and Session 14
revisits microservices migration only after the seams are felt firsthand.

A structural decision was needed up front: how should the seven bounded contexts be deployed
and how should they communicate, given this teaching goal and a single-developer/single-student
operational budget (no Kubernetes, no Kafka cluster to run locally for a 20-hour course).

## Decision

**Modular monolith** — one Express process, one MongoDB connection, one module per bounded
context under `server/src/modules/`, communicating exclusively through an internal event bus
(`server/src/shared/events/eventBus.js`) built on Node's `EventEmitter`.

Enforced rules:
- No cross-module model imports — a module may not `require()` another module's Mongoose model.
- All cross-context state changes flow through `eventBus.publish` / `eventBus.subscribe`, using
  the same event names and payload shapes that Phase 1 uses on Kafka (`UserRegistered`,
  `OrderPlaced`, `StockReserved`, etc.) — see `server/src/shared/events/events.js`.
- The event bus's `publish`/`subscribe` interface is intentionally Kafka-shaped so that
  extracting a module later is a transport swap (`EventEmitter` → Kafka producer/consumer),
  not a rewrite of business logic.

## Consequences

### Positive

- **Minimal operational footprint.** One `npm run dev` and one MongoDB container is enough to
  run the whole system — appropriate for a course where setup time competes with learning time.
- **DDD boundaries enforced by convention + code review**, not by deployment, which is enough
  to teach the *concept* of bounded contexts before paying for physical enforcement.
- **Strangler-fig path stays open.** Because inter-module calls already go through
  `eventBus.publish`/`subscribe` instead of direct function calls, any module can be extracted
  into its own service later by swapping the bus implementation — the module's internal
  service/controller code is untouched. This is the concrete mechanism Session 14 teaches.
- **Single source of truth in development.** No distributed tracing, no cross-service
  correlation IDs needed to debug a request locally — everything is one stack trace.
- **Direct contrast with Phase 1.** Building the same domain twice — once microservices-first,
  once monolith-first — makes the operational cost difference (Docker Compose with 3 containers
  vs. Phase 1's Kafka + 7 MySQL schemas + k8s) concrete instead of theoretical.

### Negative

- **No physical fault isolation.** An unhandled exception or memory leak in one module can take
  down the whole process; in Phase 1, a crashing Payment service does not take Catalog with it.
- **No independent scaling or deployment.** Inventory and Cart cannot be scaled or redeployed
  independently — the entire app scales as one unit.
- **Event bus is not durable.** `EventEmitter` holds events only in process memory. A crash
  mid-saga drops in-flight events with no retry, no replay, no consumer offset — unlike Kafka in
  Phase 1. This is a known, accepted gap for a learning project (tracked in
  `docs/hld/checkout-saga-flow.md` Known Gaps) and would block production use as-is.
- **Module boundary violations fail at code-review time, not build/deploy time.** Nothing stops
  a future contributor from importing another module's Mongoose model directly; Phase 1's
  separate repositories/schemas make that mistake impossible rather than merely discouraged.
- **Single MongoDB connection pool** is shared by all seven modules; a connection-hogging query
  in one module affects every other module's latency.

## Alternatives Rejected

### Microservices (Node.js per bounded context)

Each context as its own Express app, own MongoDB instance, communicating over Kafka or HTTP —
the direct MERN equivalent of the Phase 1 decision.

Rejected for Phase 3 because:
- Duplicates the distributed-systems learning outcome Phase 1 already delivers; Phase 3's
  purpose is specifically to teach the *monolith-to-microservices* migration story, which
  requires starting from a monolith.
- Operational cost (multiple processes, multiple DBs, message broker) is disproportionate to a
  20-hour curriculum's available setup time.

### Unstructured Monolith

Single Express app with no module boundaries — flat `routes/`, `models/`, `controllers/`
folders, direct cross-domain model imports and function calls.

Rejected because:
- Does not enforce or demonstrate DDD bounded contexts at all.
- Makes the eventual extraction story (Session 14) a rewrite instead of a transport swap, since
  there would be no existing seam (`eventBus`) to cut along.

If this were a production system rather than a learning project, the recommendation would still
be the modular monolith chosen here — extract to services only when a specific, evidenced
scaling or team-ownership need justifies the operational cost, per the note in Phase 1's
ADR-0006.
