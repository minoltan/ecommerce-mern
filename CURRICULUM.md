# MERN E-Commerce Platform — 20-Hour Lecture Curriculum

A hands-on course building a production-grade e-commerce platform from scratch using the MERN stack.
Each session builds directly on the previous one. By the end, students have a full-stack application
and understand when and how to migrate a modular monolith to microservices.

---

## Session 1 — Introduction & Project Setup (2 hours)

### Learning Goals
- Understand the MERN stack and why each piece exists
- Set up a professional Node.js project (not just `npm init`)
- Understand modular monolith architecture and why we choose it over microservices as a starting point

### Topics
1. **MERN Stack Overview**
   - MongoDB: document database vs relational (comparison with MySQL from Phase 1)
   - Express.js: minimal HTTP framework — what it does and what it doesn't
   - React: component-based UI (covered in Sessions 12–13)
   - Node.js: event-loop model, non-blocking I/O

2. **Architecture Decision: Modular Monolith**
   - What is a bounded context? (DDD refresher)
   - Monolith vs microservices vs modular monolith
   - The strangler-fig pattern: monolith → selective extraction
   - Our rule: **no cross-module DB model imports**

3. **Project Setup**
   - `package.json` walkthrough: dependencies vs devDependencies
   - `nodemon` for hot reload
   - `dotenv` for environment config
   - Folder structure: `modules/` + `shared/`

4. **Docker Setup**
   - `docker compose up -d` to start MongoDB + Mongo Express
   - Verify with Mongo Express at http://localhost:8081

### Hands-On Exercise
```bash
git clone <repo>
cd ecommerce-mern/server
cp .env.example .env
npm install
npm run dev
# Hit http://localhost:3000/health
```
Trace the request through `app.js` to the health handler. Identify each middleware in the pipeline.

### Architecture Discussion
Compare with Spring Boot (Phase 1):
- `app.js` ≈ `@SpringBootApplication` + filter chain
- `express.json()` ≈ Jackson `@RequestBody`
- `errorMiddleware` ≈ `@ControllerAdvice`

---

## Session 2 — MongoDB & Mongoose Deep Dive (2 hours)

### Learning Goals
- Understand the document model and when it beats relational
- Write Mongoose schemas with validation, indexes, and lifecycle hooks
- Know when to embed vs reference documents

### Topics
1. **Document Model Fundamentals**
   - Collections = tables, documents = rows (but flexible)
   - BSON types: ObjectId, Date, Mixed, nested objects, arrays
   - No JOINs: embed or reference + application-side join

2. **Mongoose Schema & Model**
   - `Schema` definition: types, required, default, enum
   - `mongoose.model()` — compile-time contract
   - Instance methods (`.comparePassword()`)
   - Static methods, virtuals

3. **Pre/Post Hooks**
   - `pre('save')` for password hashing
   - Why `isModified()` matters for performance

4. **Indexing**
   - Single-field, compound, text indexes
   - `unique: true` at schema vs database level
   - `explain()` to verify index usage

5. **Embed vs Reference**
   - Cart items → embed (accessed always together, bounded size)
   - Order → User → reference (user profile can change)
   - Rule: embed when "always loaded together" and "bounded growth"

### Hands-On Exercise
Open `mongosh` or Mongo Express. Run:
```js
use ecommerce
db.users.find().pretty()
db.users.explain("executionStats").find({ email: "test@test.com" })
```
Observe index usage. Drop the index and re-run. Discuss the scan count difference.

### Architecture Discussion
User schema: MySQL (Phase 1) uses a `users` table with foreign keys.
MongoDB embeds nothing for User — it's a root aggregate.
Cart embeds line items — explain why that's correct here.

---

## Session 3 — Express Foundation & Shared Infrastructure (2 hours)

### Learning Goals
- Understand Express middleware as a pipeline
- Implement JWT authentication and Zod validation as reusable middleware
- Build the internal event bus and understand why its interface mirrors Kafka

### Topics
1. **Express Middleware Pipeline**
   - `app.use()` vs `router.use()` — scope and ordering
   - The `(req, res, next)` contract
   - Error-handling middleware: the 4-argument signature `(err, req, res, next)`

2. **Environment Configuration (`env.js`)**
   - Fail-fast: validate required vars at startup, not at request time
   - `process.env` vs `.env` — never commit `.env`

3. **Zod Validation Middleware**
   - `schema.safeParse()` — never throws, always returns `{ success, data, error }`
   - `result.error.flatten()` for structured field errors
   - Why Zod over Joi or express-validator: TypeScript-friendliness, composable

4. **JWT Authentication Middleware**
   - JWT structure: header.payload.signature (base64url, not encryption)
   - `jwt.verify()` — throws on tampered or expired tokens
   - `req.user` pattern: attach decoded payload for downstream handlers

5. **EventEmitter as Domain Event Bus**
   - Node.js `EventEmitter` — synchronous, in-process
   - Our wrapper: `publish(event, payload)` / `subscribe(event, handler)`
   - Why this interface mirrors Kafka: `topic` → `event name`, `consumer group` → handler
   - Error isolation in subscribers: catch errors so one handler can't kill others

6. **AppError class**
   - Typed errors with HTTP status
   - Centralised error middleware reads `err.status`

### Hands-On Exercise
Add a new middleware that logs `X-Request-ID` header to every request. Mount it globally in `app.js`.
Observe how middleware ordering affects what the next handler sees.

### Architecture Discussion
Compare `authenticate` middleware with Spring Security's `OncePerRequestFilter`.
Both intercept the request before the controller, attach principal to the request context.

---

## Session 4 — User & Auth Module (2 hours)

### Learning Goals
- Implement full registration and login with JWT
- Understand bcrypt rounds and why password hashing is irreversible
- Publish domain events from a service layer

### Topics
1. **User Schema Walkthrough**
   - `select: false` on password — never returned by default
   - `pre('save')` hook for hashing
   - `role` enum: `customer` | `admin`

2. **Registration Flow**
   - Duplicate email check → 409 Conflict
   - `User.create()` triggers `pre('save')` → bcrypt hash
   - Publish `UserRegistered` event
   - Return only safe fields (no password)

3. **Login Flow**
   - `findOne({ email }).select('+password')` — explicitly request hidden field
   - `bcrypt.compare()` — timing-safe comparison
   - `jwt.sign()` — payload: `sub` (userId), `email`, `role`
   - Publish `UserLoggedIn` event

4. **Protected Routes**
   - `authenticate` middleware extracts `req.user`
   - `authorize('admin')` checks `req.user.role`
   - `GET /me` → `userService.getProfile(req.user.sub)`

5. **Event Consumption**
   - `notification.events.js` subscribes to `UserRegistered` → sends welcome email
   - Show the event log in the console after registration

### Hands-On Exercise
```bash
# Register
POST /api/v1/users/register
{ "name": "Alice", "email": "alice@test.com", "password": "password123" }

# Login
POST /api/v1/users/login
{ "email": "alice@test.com", "password": "password123" }

# Use the token
GET /api/v1/users/me
Authorization: Bearer <token>
```
Observe the `[EventBus] → UserRegistered` and `[Notification]` log lines.

### Architecture Discussion
Spring Security (Phase 1) uses `UsernamePasswordAuthenticationFilter` + `JwtAuthFilter`.
Here a single 20-line middleware does the same job. When does the Spring approach win?
(Answer: when you need role hierarchies, method-level security, session management.)

---

## Session 5 — Product Catalog Module (2 hours)

### Learning Goals
- Implement CRUD with MongoDB operators
- Build search + filter + pagination
- Understand text indexes and their limitations

### Topics
1. **Product Schema**
   - Embedded `images` array: when embedding is correct
   - Text index on `name` + `description`
   - Compound index on `category` + `price`

2. **CRUD Operations**
   - `Product.create()` — validates against schema
   - `findByIdAndUpdate()` with `{ new: true, runValidators: true }`
   - Soft delete: `isActive: false` instead of physical delete

3. **Search & Filter**
   - `$text: { $search: term }` — full-text search
   - `$gte` / `$lte` for price range
   - Combining filters in a single `find()` call

4. **Pagination**
   - `skip()` / `limit()` pattern
   - `Promise.all([find(), countDocuments()])` — parallel queries
   - Response shape: `{ products, total, page, totalPages }`

5. **Admin-Only Routes**
   - `authenticate` + `authorize('admin')` middleware chain
   - How to create an admin user for testing

### Hands-On Exercise
1. Create 5 products via Postman (need an admin token — update role in Mongo Express)
2. Test: `GET /api/v1/products?search=laptop&minPrice=500&page=1&limit=3`
3. Check `explain()` in mongosh — verify the text index is used

### Architecture Discussion
Compare with Spring Data JPA `Specification` + `Pageable`.
MongoDB: filter object built in code. JPA: Criteria API or method name conventions.
Both achieve the same result — different ergonomics.

---

## Session 6 — Cart Module (1.5 hours)

### Learning Goals
- Understand the price snapshot pattern
- See embedded documents in action
- Trigger the checkout saga via the event bus

### Topics
1. **Cart Schema**
   - One cart per user (`unique: true` on `userId`)
   - Embedded `cartItemSchema`: `productId` + **price snapshot** + `name` + `quantity`
   - Virtual `totalAmount` computed from items

2. **Price Snapshot Pattern**
   - Why we copy the price at add-to-cart time
   - What happens if product price changes while item is in cart
   - Tradeoff: stale prices vs consistency

3. **Add/Update/Remove Operations**
   - Upsert-style: find or create cart
   - Merge quantity if product already in cart, refresh price snapshot
   - `quantity: 0` as "remove" in update endpoint

4. **Checkout**
   - Validate cart is not empty
   - Calculate `totalAmount` from snapshots
   - Publish `CartCheckedOut` with full payload
   - Clear cart items (saga takes over from here)

### Hands-On Exercise
1. Add 2 products to cart
2. Update quantity of one
3. `POST /api/v1/cart/checkout` with a shipping address
4. Watch the event chain: `CartCheckedOut → OrderPlaced → StockReserved → PaymentAuthorised`

### Architecture Discussion
Phase 1 uses Redis for cart (TTL-based session cart).
Here we use MongoDB (persistent cart). Discuss trade-offs:
- Redis: fast, auto-expiry, no persistence across crashes
- MongoDB: persistent, queryable, but no TTL without `expireAfterSeconds` index

---

## Session 7 — Order Module & Saga Pattern (2 hours)

### Learning Goals
- Implement an order state machine
- Understand choreography-based saga (vs orchestration)
- Handle compensating transactions

### Topics
1. **Order Schema & State Machine**
   - Status enum: `PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED`
   - Failure paths: `PAYMENT_FAILED`, `CANCELLED`
   - Index on `userId + createdAt` for list queries

2. **Order Service**
   - `createFromCart`: receives `CartCheckedOut` payload, saves order, publishes `OrderPlaced`
   - `transition(orderId, newStatus)`: idempotent status update
   - `cancel`: only allowed from `PENDING` or `CONFIRMED`

3. **Choreography-Based Saga**
   - No central coordinator — each service reacts to events
   - `order.events.js`: subscribes to `CART_CHECKED_OUT`, `STOCK_RESERVED`, `PAYMENT_AUTHORISED`, `PAYMENT_FAILED`
   - Compare: orchestration would have a saga orchestrator calling each step

4. **Compensating Transactions**
   - `PaymentFailed` → order transitions to `PAYMENT_FAILED`, inventory releases stock
   - `OrderCancelled` → inventory releases reserved stock
   - These are the "undo" operations of the saga

5. **Error Handling in Event Handlers**
   - EventBus wraps each handler in try/catch
   - A failing notification doesn't break the order flow

### Hands-On Exercise
1. Checkout, observe the full saga in console logs
2. Force a payment failure (change mock to always fail in `payment.service.js`)
3. Check order status in Mongo Express — should be `PAYMENT_FAILED`
4. Check inventory — `reserved` should be back to 0

### Architecture Discussion
Spring State Machine (Phase 1) uses an explicit state machine bean.
Here we implement transitions manually. When does Spring State Machine win?
(Complex guard conditions, entry/exit actions, history states, persistence.)

---

## Session 8 — Payment & Inventory Modules (1.5 hours)

### Learning Goals
- Implement the idempotency key pattern
- Understand stock reservation vs commit
- Wire the full saga chain

### Topics
1. **Idempotency Keys**
   - Problem: network timeout → retry → double charge
   - Solution: client supplies unique key; server deduplicates
   - `Payment.findOne({ idempotencyKey })` before creating
   - Key format: `order-{orderId}` — stable, deterministic

2. **Mock Payment Gateway**
   - Simulates real gateway: async result, 80% success
   - In production: replace with Stripe/PayPal webhook handler
   - Publishes `PaymentAuthorised` or `PaymentFailed`

3. **Refund Flow**
   - Only `AUTHORISED` payments are refundable
   - Publishes `RefundIssued` — order could transition to a `REFUNDING` state

4. **Inventory Reservation Pattern**
   - `reserve`: increments `reserved` field — stock is "held" but not deducted
   - `release`: decrements `reserved` — stock returned to available pool
   - `commit`: decrements both `quantity` and `reserved` — final deduction on payment success
   - `available = quantity - reserved` — this is what customers see

5. **Low Stock Alert**
   - Fired during reservation when available drops below `lowStockThreshold`
   - Notification module logs it (could email the admin team)

### Hands-On Exercise
1. Set inventory for a product: `PUT /api/v1/inventory/:productId` `{ "quantity": 5 }`
2. Place an order for 4 units — observe `reserved: 4`
3. Cancel the order — observe `reserved: 0`

---

## Session 9 — Notification Module & End-to-End Wiring (1 hour)

### Learning Goals
- Understand the pure-consumer pattern
- Trace the complete event chain from checkout to notification
- See how to add a new event subscriber without touching existing code

### Topics
1. **Notification Module as Pure Consumer**
   - No REST endpoints that trigger business logic
   - Only one query endpoint: `GET /notifications` (read your own)
   - All creation is event-driven

2. **Event Handler Registration**
   - `registerHandlers()` called once at startup in `app.js`
   - Adding a new handler = adding `eventBus.subscribe(...)` in the events file
   - Open/Closed Principle: extend without modifying existing handlers

3. **Template-Based Notifications**
   - `template` field: `welcome`, `order-confirmation`, `payment-success`, etc.
   - `payload` field: Mixed type for template variables
   - In production: Handlebars/Mustache templates + SendGrid

4. **Complete Event Chain Walkthrough**
   - Trace: `CartCheckedOut → OrderPlaced → StockReserved → PaymentAuthorised → notifications`
   - Show every `[EventBus]` log line and what triggered it
   - Show the Notification documents in Mongo Express

### Hands-On Exercise
Add a new event handler: when `ORDER_CANCELLED`, create a notification to the user.
Steps: open `notification.events.js`, add `eventBus.subscribe(EVENTS.ORDER_CANCELLED, ...)`.
No other files need to change.

---

## Session 10 — Testing (1.5 hours)

### Learning Goals
- Write unit tests for service logic
- Write integration tests for HTTP endpoints
- Use `mongodb-memory-server` for isolated test databases

### Topics
1. **Jest Setup**
   - `jest.config.js`: `testEnvironment: 'node'`, `testMatch`
   - `--runInBand`: run tests serially (important for shared DB state)
   - `--forceExit`: clean up after async operations

2. **mongodb-memory-server**
   - Spins up an in-memory MongoDB — no external dependency
   - `beforeAll`: start server + connect Mongoose
   - `afterAll`: disconnect + stop server
   - `beforeEach`: clear collections for test isolation

3. **Unit Testing Services**
   - `userService.register` — test happy path and duplicate email (409)
   - `userService.login` — test valid credentials and wrong password (401)
   - Assert on error `status` property, not just message

4. **Integration Testing with Supertest**
   - Import `app` (not started — `require.main === module` guard)
   - `request(app).post('/api/v1/users/register').send({...})`
   - Assert HTTP status, response body shape

5. **Testing Event Publishing**
   - Spy on `eventBus.publish` with `jest.spyOn`
   - Assert events were published with correct payloads

### Hands-On Exercise
```bash
cd server
npm test
```
1. Read `user.service.test.js` — understand each test case
2. Add a test: `register` should publish `UserRegistered` event with correct userId and email
3. Run `npm run test:coverage` and read the coverage report

---

## Session 11 — Docker & Containerisation (0.5 hours)

### Learning Goals
- Containerise the Express app
- Run the full stack with one command

### Topics
1. **Dockerfile Walkthrough**
   - Multi-stage build: `base` → `dev` / `prod`
   - `npm ci --omit=dev` in production stage (no devDependencies)
   - Volume mounting for hot-reload in dev

2. **docker-compose.yml**
   - Services: `mongodb`, `mongo-express`, `server`
   - `depends_on` — start order (not readiness!)
   - Named volumes: data persists across container restarts
   - Environment variable injection

3. **Common Commands**
   ```bash
   docker compose up -d          # start all
   docker compose logs -f server # tail server logs
   docker compose down -v        # stop + delete volumes
   ```

### Hands-On Exercise
`docker compose up --build` — verify health endpoint, register a user, check Mongo Express.

---

## Sessions 12 & 13 — React Frontend (2.5 hours)

### Learning Goals
- Scaffold a React + Vite project
- Connect to the Express API with Axios
- Implement auth flow, product listing, cart, and order history

### Topics

**Session 12 — Auth & Product Listing (1.5h)**
1. Vite + React setup: `npm create vite@latest client -- --template react`
2. Folder structure: `pages/`, `components/`, `services/` (API layer), `context/`
3. Axios instance with base URL + JWT interceptor
4. `AuthContext`: login, logout, token persistence in `localStorage`
5. Register/Login pages with form validation
6. Product listing page: fetch, display, search bar

**Session 13 — Cart, Checkout & Orders (1h)**
1. `CartContext`: add, remove, update, checkout
2. Cart sidebar/page component
3. Checkout form: shipping address → `POST /cart/checkout`
4. Order confirmation page
5. Order history page: list + detail
6. React Router: protected routes (redirect if not logged in)

### Hands-On Exercise
Complete the full flow in the browser:
1. Register → auto-login
2. Browse products → add to cart
3. Checkout with shipping address
4. View order in order history

---

## Session 14 — Microservices Migration (2 hours)

### Learning Goals
- Know when and why to extract a module to a separate service
- Understand what changes and what stays the same
- Replace the EventEmitter with a real message broker

### Topics
1. **When to Split**
   - Independent deployability (different release cadences)
   - Independent scalability (product reads vs payment processing)
   - Organisational boundaries (different teams)
   - Rule of thumb: don't split before you feel the pain

2. **Extracting the User Service**
   - Copy `modules/user/` to a new repo `user-service/`
   - Add `express` server and MongoDB connection
   - Expose same REST endpoints on a different port
   - Update `docker-compose.yml` to run both servers

3. **API Gateway Pattern**
   - Single entry point: routes `/api/v1/users/*` to user-service, rest to main server
   - Simple implementation: Express proxy with `http-proxy-middleware`
   - Production: NGINX, Kong, AWS API Gateway

4. **Replacing EventEmitter with a Message Broker**
   - Problem: EventEmitter is in-process — doesn't work across services
   - Solution: Kafka (like Phase 1) or RabbitMQ or Redis Pub/Sub
   - Change only `eventBus.js`: same publish/subscribe interface, different transport
   - Show the one-file change

5. **Data Consistency Challenges**
   - Each service now owns its own MongoDB database
   - Cross-service queries become API calls or event-driven reads
   - Eventual consistency: the read model may lag
   - Saga still works — events just travel over Kafka instead of EventEmitter

6. **Comparison with Phase 1 (Spring Boot)**
   | Concern | MERN Microservices | Spring Boot Microservices |
   |---|---|---|
   | Service comm | HTTP + Kafka | HTTP + Kafka |
   | Discovery | Hardcoded URLs / K8s DNS | Eureka / K8s |
   | Gateway | Express proxy / NGINX | Spring Cloud Gateway |
   | Auth | JWT (stateless) | Spring Security + JWT |
   | Config | `.env` files | Spring Cloud Config |

### Hands-On Exercise
1. Extract User service to port 3001
2. Update `app.js` in main server to proxy `/api/v1/users` to `http://localhost:3001`
3. Verify `POST /api/v1/users/register` still works through the proxy

---

## Course Summary

| Session | Topic | Hours |
|---|---|---|
| 1 | Introduction & Setup | 2.0 |
| 2 | MongoDB & Mongoose | 2.0 |
| 3 | Express Foundation & Shared Infrastructure | 2.0 |
| 4 | User & Auth Module | 2.0 |
| 5 | Product Catalog Module | 2.0 |
| 6 | Cart Module | 1.5 |
| 7 | Order Module & Saga Pattern | 2.0 |
| 8 | Payment & Inventory Modules | 1.5 |
| 9 | Notification & Event Wiring | 1.0 |
| 10 | Testing | 1.5 |
| 11 | Docker | 0.5 |
| 12–13 | React Frontend | 2.5 |
| 14 | Microservices Migration | 2.0 |
| **Total** | | **24.0** |

> The curriculum is slightly over 20 hours to allow flexibility — skip Session 11 (Docker) or
> compress Sessions 12–13 if time is tight. Sessions 1–10 cover the complete backend.

---

## Prerequisites for Students

- JavaScript fundamentals (ES6+: arrow functions, destructuring, async/await, modules)
- Basic understanding of REST APIs and HTTP methods
- Some experience with any SQL database (helps with the comparison discussions)
- Node.js installed (v20+)
- VS Code + REST Client or Postman

## What Students Will Have Built

By the end of the course, students have:
- A fully working e-commerce API with 7 domain modules
- Domain event-driven communication (the foundation of microservices)
- JWT authentication and role-based access
- A React frontend connected to the API
- Unit and integration tests
- Docker-based local development setup
- A clear understanding of how to migrate to microservices
