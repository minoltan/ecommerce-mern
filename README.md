# E-Commerce Platform — MERN Stack

A full-stack e-commerce platform built with the **MERN stack** (MongoDB, Express, React, Node.js),
designed as a **modular monolith** with a clear migration path to microservices.

This project is the Phase 3 counterpart to the Java/Spring Boot microservices (Phase 1) and AWS
Serverless (Phase 2) implementations of the same domain.

---

## Architecture Overview

Seven bounded contexts from DDD, each owning its data and communicating exclusively via domain events:

| Module | Responsibility | Domain Events Published |
|---|---|---|
| **User / Auth** | Identity, JWT issuance | `UserRegistered`, `UserLoggedIn` |
| **Product Catalog** | Listings, pricing | `ProductCreated`, `PriceUpdated` |
| **Cart** | Session cart, price snapshot | `CartCheckedOut` |
| **Order** | Lifecycle, state machine | `OrderPlaced`, `OrderCancelled` |
| **Payment** | Processing, refunds | `PaymentAuthorised`, `PaymentFailed`, `RefundIssued` |
| **Inventory** | Stock, reservations | `StockReserved`, `StockReleased`, `LowStockAlert` |
| **Notification** | Email/SMS (consumer only) | _(none — pure consumer)_ |

Events flow through an internal `EventEmitter` with a Kafka-compatible publish/subscribe interface.
When migrating to microservices, only the transport layer changes — not the business logic.

### Event Flow (checkout saga)

```
POST /api/v1/cart/checkout
  └── CartCheckedOut
        └── [Order] createOrder → OrderPlaced
              └── [Inventory] reserve stock → StockReserved
                    └── [Payment] initiate → PaymentAuthorised | PaymentFailed
                          ├── PaymentAuthorised → [Order] PROCESSING, [Notification] payment-success
                          └── PaymentFailed    → [Order] PAYMENT_FAILED, [Inventory] release stock
```

---

## Quick Start

### Option 1 — Docker (recommended)

```bash
git clone <repo-url>
cd ecommerce-mern
docker compose up -d
```

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| Health | http://localhost:3000/health |
| Mongo Express (DB UI) | http://localhost:8081 |

### Option 2 — Local dev

**Prerequisites:** Node.js 20+, MongoDB 7+ running locally

```bash
cd server
cp .env.example .env      # edit MONGODB_URI if needed
npm install
npm run dev               # starts with nodemon on port 3000
```

---

## API Reference

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/users/register` | — | Register a new user |
| POST | `/api/v1/users/login` | — | Login, returns JWT |
| GET | `/api/v1/users/me` | JWT | Get own profile |

### Products
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/products` | — | List products (search, filter, paginate) |
| GET | `/api/v1/products/:id` | — | Get single product |
| POST | `/api/v1/products` | Admin JWT | Create product |
| PUT | `/api/v1/products/:id` | Admin JWT | Update product |
| DELETE | `/api/v1/products/:id` | Admin JWT | Soft-delete product |

Query params for `GET /products`: `?search=<text>&category=<cat>&minPrice=<n>&maxPrice=<n>&page=<n>&limit=<n>`

### Cart
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/cart` | JWT | View cart |
| POST | `/api/v1/cart/items` | JWT | Add item |
| PUT | `/api/v1/cart/items/:productId` | JWT | Update quantity (0 = remove) |
| DELETE | `/api/v1/cart/items/:productId` | JWT | Remove item |
| POST | `/api/v1/cart/checkout` | JWT | Checkout → triggers saga |

### Orders
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/orders` | JWT | List my orders |
| GET | `/api/v1/orders/:id` | JWT | Get order detail |
| DELETE | `/api/v1/orders/:id` | JWT | Cancel order (PENDING/CONFIRMED only) |

### Payments
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/payments/:id/refund` | JWT | Refund an authorised payment |

### Inventory
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/inventory/:productId` | — | Get stock level |
| PUT | `/api/v1/inventory/:productId` | Admin JWT | Set stock quantity |

### Notifications
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/notifications` | JWT | List my notifications |

---

## Project Structure

```
ecommerce-mern/
├── server/
│   ├── src/
│   │   ├── app.js                   # Express app + event handler registration
│   │   ├── modules/
│   │   │   ├── user/                # model, schema, service, controller, routes, tests
│   │   │   ├── product/
│   │   │   ├── cart/
│   │   │   ├── order/               # + order.events.js
│   │   │   ├── payment/             # + payment.events.js
│   │   │   ├── inventory/           # + inventory.events.js
│   │   │   └── notification/        # + notification.events.js
│   │   └── shared/
│   │       ├── config/              # env.js, db.js
│   │       ├── events/              # eventBus.js, events.js (constants)
│   │       ├── middleware/          # auth, validate, error
│   │       └── utils/               # AppError
│   ├── package.json
│   ├── .env.example
│   └── Dockerfile
├── client/                          # React app (coming in Phase 3b)
├── docs/
│   ├── hld/
│   ├── lld/
│   └── adr/
├── docker-compose.yml
└── CURRICULUM.md                    # 20-hour lecture plan
```

---

## Running Tests

```bash
cd server
npm test                  # run all tests once
npm run test:watch        # watch mode
npm run test:coverage     # with coverage report
```

Tests use `mongodb-memory-server` — no running MongoDB required.

---

## Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Architecture | Modular monolith | Module boundaries enforced before paying distributed-systems tax |
| Event bus | Node.js EventEmitter | Same publish/subscribe interface as Kafka; transport-swappable |
| ODM | Mongoose | Schema validation + lifecycle hooks out of the box |
| Validation | Zod | Type-safe schemas, clear error messages, composable |
| Auth | JWT (stateless) | Same pattern as Phase 1; no session store needed |
| Module rule | No cross-module model imports | Modules communicate via event bus only |
