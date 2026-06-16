# Session 01 — Introduction & Project Setup
**Duration:** 2 hours  
**Branch:** `main`

---

## Learning Goals
- Understand what each letter in MERN does and why we chose it
- Understand modular monolith vs microservices — when each wins
- Set up the development environment and run the server
- Trace a request through the full Express middleware pipeline

---

## Prerequisites
- Node.js 20+ installed
- Docker installed and running
- VS Code or any editor
- Basic JavaScript (ES6: arrow functions, destructuring, async/await)

---

## Step 1 — What is the MERN Stack?

MERN stands for four technologies that together form a complete web application:

| Letter | Technology | Role |
|---|---|---|
| **M** | MongoDB | Database — stores data as JSON-like documents |
| **E** | Express.js | HTTP framework — routes requests, runs middleware |
| **R** | React | UI library — component-based frontend |
| **N** | Node.js | Runtime — runs JavaScript on the server |

### Why Node.js instead of Java?
Java (Spring Boot) uses **thread-per-request** model:
- Each incoming request gets its own thread from a pool
- Threads block while waiting for DB, network, file I/O
- High concurrency → many threads → high memory

Node.js uses **event-loop + non-blocking I/O**:
- Single thread handles all requests
- Never blocks — hands off I/O to OS, moves to next request
- Result arrives → callback fires → response sent
- Lower memory, higher concurrency for I/O-heavy workloads

```
Spring Boot (thread-per-request):          Node.js (event-loop):
┌─────────┐                                ┌─────────────────┐
│Request 1│──▶ Thread 1 (blocking)         │                 │
│Request 2│──▶ Thread 2 (blocking)         │   Event Loop    │──▶ OS (non-blocking I/O)
│Request 3│──▶ Thread 3 (blocking)         │  (single thread)│◀── callbacks
└─────────┘                                └─────────────────┘
```

**When Spring Boot wins:** CPU-heavy computation, complex transaction management, large team with strict type safety.  
**When Node.js wins:** High concurrency APIs, real-time apps, rapid prototyping, microservices glue code.

---

## Step 2 — Architecture Decision: Why Modular Monolith?

Three options on the spectrum:

```
Big Ball of Mud ──────── Modular Monolith ──────── Microservices
(spaghetti imports)       (our choice)            (7 separate services)
```

### Big Ball of Mud
- Any file imports any other file
- Fast to start, impossible to scale team-wise
- A change in User breaks Cart — no boundaries

### Microservices (Phase 1 — Spring Boot)
- 7 separate deployable services
- Independent scaling, independent deployment
- Cost: network latency, distributed tracing, service discovery, eventual consistency

### Modular Monolith (Phase 3 — this project)
- Single deployed process
- But hard boundaries between modules — **no cross-module model imports**
- Modules communicate only via event bus
- Cheap to operate, easy to debug, clean path to microservices extraction

**The Golden Rule enforced in this codebase:**
```
✅ order.service.js → eventBus.publish('OrderPlaced', payload)
✅ inventory.events.js → eventBus.subscribe('OrderPlaced', handler)

❌ order.service.js → require('../inventory/inventory.model')   // NEVER
```

---

## Step 3 — Project Structure Walkthrough

```
ecommerce-mern/
├── server/
│   ├── src/
│   │   ├── app.js                     ← Express app entry point
│   │   ├── modules/                   ← One folder per bounded context
│   │   │   ├── user/
│   │   │   │   ├── user.model.js      ← Mongoose schema + model
│   │   │   │   ├── user.schema.js     ← Zod validation schemas
│   │   │   │   ├── user.service.js    ← Business logic
│   │   │   │   ├── user.controller.js ← HTTP handlers (thin)
│   │   │   │   ├── user.routes.js     ← Express router + Swagger docs
│   │   │   │   └── __tests__/
│   │   │   ├── product/
│   │   │   ├── cart/
│   │   │   ├── order/
│   │   │   │   └── order.events.js    ← Domain event subscriptions
│   │   │   ├── payment/
│   │   │   ├── inventory/
│   │   │   └── notification/
│   │   └── shared/
│   │       ├── config/
│   │       │   ├── env.js             ← Centralised env config
│   │       │   ├── db.js              ← Mongoose connection
│   │       │   └── swagger.js         ← OpenAPI spec generation
│   │       ├── events/
│   │       │   ├── eventBus.js        ← Singleton EventEmitter
│   │       │   └── events.js          ← Event name constants
│   │       ├── middleware/
│   │       │   ├── auth.middleware.js  ← JWT authenticate + authorize
│   │       │   ├── validate.middleware.js ← Zod validation
│   │       │   └── error.middleware.js    ← Centralised error handler
│   │       └── utils/
│   │           └── AppError.js        ← Typed HTTP error class
│   ├── package.json
│   └── .env.example
├── docker-compose.yml
├── CURRICULUM.md
└── docs/
    └── sessions/                      ← You are here
```

**7 Bounded Contexts — same domains as Phase 1:**

| Module | Responsibility | Events Published |
|---|---|---|
| user | Identity, JWT | UserRegistered, UserLoggedIn |
| product | Catalog, pricing | ProductCreated, PriceUpdated |
| cart | Session cart, price snapshot | CartCheckedOut |
| order | Lifecycle, state machine | OrderPlaced, OrderCancelled |
| payment | Processing, refunds | PaymentAuthorised, PaymentFailed |
| inventory | Stock, reservations | StockReserved, StockReleased |
| notification | Email/SMS consumer | _(none — pure consumer)_ |

---

## Step 4 — Understanding `package.json`

```json
{
  "scripts": {
    "start": "node src/app.js",        // production
    "dev": "nodemon src/app.js",       // development — restarts on file change
    "test": "jest --runInBand --forceExit"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",     // password hashing — pure JS, no native compile
    "cors": "^2.8.5",         // Cross-Origin Resource Sharing headers
    "dotenv": "^16.4.5",      // loads .env into process.env
    "express": "^4.19.2",     // HTTP framework
    "jsonwebtoken": "^9.0.2", // JWT sign + verify
    "mongoose": "^8.4.0",     // MongoDB ODM
    "morgan": "^1.10.0",      // HTTP request logger
    "zod": "^3.23.8"          // schema validation
  },
  "devDependencies": {
    "jest": "^29.7.0",                  // test runner
    "mongodb-memory-server": "^10.0.0", // in-memory MongoDB for tests
    "nodemon": "^3.1.3",                // file watcher
    "supertest": "^7.0.0"              // HTTP integration testing
  }
}
```

**Key distinction:**
- `dependencies` — shipped to production, installed in Docker image
- `devDependencies` — only on developer machines and CI (`npm ci --omit=dev` in production)

---

## Step 5 — Understanding `app.js` Line by Line

```javascript
const app = express();           // create Express application

app.use(cors());                 // 1. Add CORS headers to every response
app.use(morgan('dev'));           // 2. Log: GET /health 200 3ms
app.use(express.json());         // 3. Parse JSON body → req.body
```

**Middleware pipeline — request flows top to bottom:**
```
Incoming Request
      │
      ▼
  cors()           → adds Access-Control-Allow-Origin header
      │
      ▼
  morgan('dev')    → logs the request to console
      │
      ▼
  express.json()   → parses JSON body, populates req.body
      │
      ▼
  route handler    → matches method + path, calls controller
      │
      ▼
  errorMiddleware  → catches any error thrown upstream, formats response
```

**Why `errorMiddleware` is last:**
Express identifies error handlers by their 4-argument signature `(err, req, res, next)`.
It must be the last `app.use()` call so it catches errors from all routes above it.

**The `require.main === module` guard:**
```javascript
if (require.main === module) {
  start();   // only runs when: node src/app.js
}
module.exports = app;  // used by tests: const request = require('supertest')(app)
```
This is critical for testing — importing `app` in tests does NOT start the server or connect to DB.

**Event handler registration:**
```javascript
const start = async () => {
  registerOrderHandlers();       // must happen before DB connect
  registerInventoryHandlers();
  registerPaymentHandlers();
  registerNotificationHandlers();

  await connect();               // connect to MongoDB
  app.listen(env.PORT, ...);    // start accepting requests
};
```

---

## Step 6 — Understanding `env.js`

```javascript
require('dotenv').config();   // loads .env file into process.env

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce',
  JWT_SECRET: process.env.JWT_SECRET || 'changeme',
  // ...
};
```

**Why centralise env config?**
- One place to change if you swap `dotenv` for AWS Secrets Manager
- Never scatter `process.env.X` across the codebase
- Provides sensible defaults for local dev
- `parseInt` ensures PORT is always a number, not a string

---

## Step 7 — Understanding `eventBus.js`

```javascript
class EventBus extends EventEmitter {
  publish(event, payload) {
    console.log(`[EventBus] → ${event}`, JSON.stringify(payload));
    this.emit(event, payload);          // synchronous, in-process
  }

  subscribe(event, handler) {
    this.on(event, async (payload) => {
      try {
        await handler(payload);
      } catch (err) {
        console.error(`[EventBus] Handler error for ${event}:`, err.message);
      }
    });
  }
}

module.exports = new EventBus();        // SINGLETON
```

**Why it mirrors Kafka:**

| Kafka | EventBus |
|---|---|
| `producer.send('UserRegistered', data)` | `eventBus.publish('UserRegistered', data)` |
| `consumer.subscribe('UserRegistered', fn)` | `eventBus.subscribe('UserRegistered', fn)` |
| Consumer group error isolation | `try/catch` in subscribe wrapper |
| Topic names as strings | Constants in `events.js` |

**Singleton pattern:** `module.exports = new EventBus()` — every `require('./eventBus')` returns the **exact same object** because Node.js caches modules. This is how events published in `user.service.js` are received in `notification.events.js`.

---

## Step 8 — Set Up & Run the Server

### Start MongoDB (Docker)
```bash
# First time — fix Docker socket permissions
sudo groupadd docker
sudo usermod -aG docker $USER
sudo chown root:docker /var/run/docker.sock
newgrp docker

# Start MongoDB and Mongo Express
cd ~/ecommerce-mern
docker compose up -d mongodb mongo-express
```

### Start the Node server
```bash
cd server
cp .env.example .env
npm install
npm run dev
```

**Expected output:**
```
[nodemon] starting `node src/app.js`
MongoDB connected: mongodb://localhost:27017/ecommerce
Server running on port 3000 [development]
```

### Verify everything is up
```bash
curl http://localhost:3000/health
# {"status":"ok","env":"development"}
```

Open **http://localhost:8081** — Mongo Express DB browser  
Open **http://localhost:3000/api-docs** — Swagger UI

---

## Hands-On Exercise

### Exercise 1: Trace the middleware pipeline
Send a bad request and read the response:
```bash
curl -s -X POST http://localhost:3000/api/v1/users/register \
  -H "Content-Type: application/json" \
  -d '{"name":"a","email":"bad","password":"short"}' | python3 -m json.tool
```
Expected:
```json
{
  "success": false,
  "error": "Validation failed",
  "details": {
    "name": ["String must contain at least 2 character(s)"],
    "email": ["Invalid email"],
    "password": ["String must contain at least 8 character(s)"]
  }
}
```
**Question:** Which middleware caught this? Look at `app.js` and trace the path.  
**Answer:** `validate(registerSchema)` in `user.routes.js` — Zod schema rejected the body before the controller even ran.

### Exercise 2: Hit a protected route without a token
```bash
curl -s http://localhost:3000/api/v1/orders
```
Expected: `{"success":false,"error":"Unauthorized"}`  
**Question:** Which middleware returned this?  
**Answer:** `authenticate` in `auth.middleware.js` — no `Authorization: Bearer` header.

### Exercise 3: Add a custom middleware
Open `server/src/app.js` and add this BEFORE the route declarations:
```javascript
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path} at ${new Date().toISOString()}`);
  next();   // MUST call next() or the request hangs
});
```
Now make any request — observe the log line. Then remove it (was just for learning).

---

## Architecture Discussion

### Comparing with Spring Boot (Phase 1)

| Concept | Spring Boot | Express |
|---|---|---|
| Entry point | `@SpringBootApplication` | `const app = express()` |
| Filter chain | `SecurityFilterChain` | `app.use(middleware)` |
| JSON parsing | Jackson `@RequestBody` | `express.json()` |
| Error handling | `@ControllerAdvice` | `(err,req,res,next) =>` middleware |
| Config | `application.properties` | `.env` + `env.js` |
| DI container | Spring IoC | CommonJS module singletons |

**Key insight:** Express has no magic. It's just JavaScript. What Spring Boot auto-configures in hundreds of lines, Express lets you wire manually in 20 lines. This is a tradeoff — Spring Boot is more opinionated and safer for large teams; Express is more flexible and faster to prototype.

---

## Common Mistakes

| Mistake | What happens | Fix |
|---|---|---|
| Forget `next()` in middleware | Request hangs forever, no response | Always call `next()` or `res.send()` |
| Put `errorMiddleware` before routes | Errors not caught | Always last `app.use()` |
| Use `process.env.X` directly | Scattered, hard to test | Always import from `env.js` |
| Export a new EventBus per file | Events don't cross modules | `module.exports = new EventBus()` singleton |
| Start server in test file | Port conflict, slow tests | `require.main === module` guard |

---

## Key Takeaways

1. Node.js is single-threaded + event-loop — not better than Java, different tradeoffs
2. Modular monolith enforces boundaries without distributed systems complexity
3. Express middleware pipeline = ordered list of `(req, res, next)` functions
4. `eventBus.js` is a singleton — same instance everywhere in the process
5. Never import across module boundaries — communicate via events only
6. The `require.main === module` guard makes `app.js` testable without starting a real server

---

## Quiz Questions

1. What does `next()` do in an Express middleware? What happens if you forget to call it?
2. Why is `errorMiddleware` placed after all routes in `app.js`?
3. Why does `module.exports = new EventBus()` ensure a singleton?
4. What is the difference between `dependencies` and `devDependencies`?
5. Why does the server crash if MongoDB is not running? Where exactly does this happen in the code?
6. What is the difference between a modular monolith and microservices? Name one advantage of each.
