# Session 03 — Express Foundation & Shared Infrastructure
**Duration:** 2 hours  
**Files:** `src/shared/middleware/`, `src/shared/events/`, `src/shared/utils/AppError.js`

---

## Learning Goals
- Understand the Express middleware pipeline deeply
- Implement JWT authentication and role-based authorisation as middleware
- Use Zod for schema validation with structured error responses
- Build the internal event bus and understand why its interface mirrors Kafka
- Handle errors centrally with a typed AppError class

---

## Prerequisites
- Session 01 and 02 complete
- Server running with MongoDB connected

---

## Step 1 — Express Middleware in Depth

A middleware is just a function with this signature:
```javascript
(req, res, next) => { ... }
```

An error-handling middleware has this signature (4 arguments):
```javascript
(err, req, res, next) => { ... }
```

### How the pipeline works

```javascript
app.use(middlewareA);   // runs first
app.use(middlewareB);   // runs second
app.use(middlewareC);   // runs third

// Route handlers are also middleware:
app.get('/path', handlerA, handlerB);   // handlerA → handlerB
```

**`next()` is the key:**
```javascript
const middlewareA = (req, res, next) => {
  console.log('A: before');
  next();                      // pass control to next middleware
  console.log('A: after');    // runs AFTER downstream finishes
};

const middlewareB = (req, res, next) => {
  res.json({ ok: true });     // sends response — call chain ends here
};
```

**Calling `next(error)` with an argument:**
```javascript
const middleware = (req, res, next) => {
  try {
    doSomething();
  } catch (err) {
    next(err);   // skips all normal middleware, jumps to error handler
  }
};
```

### Our full request lifecycle

```
POST /api/v1/users/register

app.use(cors())               → adds CORS headers
app.use(morgan('dev'))        → logs "POST /api/v1/users/register"
app.use(express.json())       → parses body, req.body = { name, email, password }
app.use('/api/v1/users', ...) → matches prefix, delegates to userRoutes
  router.post('/register', validate(schema), register)
    validate(registerSchema)  → Zod validates req.body
      if invalid → res.status(400).json(...)   ← request ends here
      if valid   → next()
    register(req, res, next)  → calls userService.register()
      if error   → next(err)  ← jumps to error middleware
      if success → res.status(201).json(...)   ← request ends here
app.use(errorMiddleware)      → only reached if next(err) was called
```

---

## Step 2 — Environment Configuration (`env.js`)

```javascript
// src/shared/config/env.js
import 'dotenv/config';    // reads .env file, adds to process.env

export default {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce',
  JWT_SECRET: process.env.JWT_SECRET || 'changeme',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
};
```

**Rules for environment config:**
1. Always have a fallback for local dev (`|| 'default'`)
2. Never commit `.env` — commit `.env.example`
3. Validate early — if `JWT_SECRET` is 'changeme' in production, fail loudly

**Practical tip — `.env.example`:**
```bash
# Always keep this up to date when you add new env vars
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/ecommerce
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=15m
```

---

## Step 3 — Zod Validation Middleware

### Why Zod?
- Type-safe (works with TypeScript)
- Composable — build complex schemas from simple ones
- `safeParse` never throws — always returns `{ success, data, error }`
- Flat error format: `flatten().fieldErrors` gives you `{ fieldName: ['message'] }`

### The validate middleware

```javascript
// src/shared/middleware/validate.middleware.js
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  
  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: result.error.flatten().fieldErrors,
    });
  }
  
  req.body = result.data;   // replace req.body with sanitised, parsed data
  next();
};
```

**`req.body = result.data` is important:** Zod strips unknown fields and coerces types. After validation, `req.body` is guaranteed to match the schema exactly.

### Zod schema examples

```javascript
import { z } from 'zod';

// User registration
const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
});

// Partial update (all fields optional)
const updateProductSchema = createProductSchema.partial();

// Nested object
const checkoutSchema = z.object({
  shippingAddress: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    country: z.string().min(1),
    zip: z.string().min(1),
  }),
});

// Array with constraints
const imagesSchema = z.array(
  z.object({ url: z.string().url(), alt: z.string().optional() })
).optional();
```

### Usage in routes

```javascript
router.post('/register',
  validate(registerSchema),    // middleware 1 — validate
  register                     // middleware 2 — controller (only runs if valid)
);
```

---

## Step 4 — JWT Authentication Middleware

### What is a JWT?

A JWT has three Base64URL-encoded parts separated by dots:
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NjVmMWIyYyIsImVtYWlsIjoiYWxpY2VAZXhhbXBsZS5jb20ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

- **Header** (red): algorithm + type
- **Payload** (blue): claims — `sub`, `email`, `role`, `exp`
- **Signature** (green): HMAC of header+payload using JWT_SECRET

**Important:** JWT is NOT encrypted — the payload is just Base64 encoded. Anyone can decode it. The signature only proves it hasn't been tampered with. Never put passwords or sensitive data in the payload.

### Signing a JWT (in user.service.js)

```javascript
const token = jwt.sign(
  {
    sub: user._id.toString(),   // subject — who this token represents
    email: user.email,
    role: user.role,
  },
  env.JWT_SECRET,               // secret used to create signature
  { expiresIn: env.JWT_EXPIRES_IN }  // '15m' → expires in 15 minutes
);
```

### Verifying a JWT (in auth.middleware.js)

```javascript
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  // Check Bearer token format
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  const token = authHeader.split(' ')[1];  // "Bearer <token>" → "<token>"
  
  try {
    req.user = jwt.verify(token, env.JWT_SECRET);
    // req.user = { sub: '665f...', email: 'alice@...', role: 'customer', iat: ..., exp: ... }
    next();
  } catch {
    // jwt.verify throws if: signature invalid, token expired, malformed
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};
```

### Role-based authorisation

```javascript
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  next();
};

// Usage — chain after authenticate:
router.post('/products',
  authenticate,           // first: verify token → populate req.user
  authorize('admin'),     // then: check req.user.role
  validate(schema),
  create
);
```

**401 vs 403:**
- `401 Unauthorized` — you are not logged in (no token or invalid token)
- `403 Forbidden` — you are logged in but don't have permission

---

## Step 5 — AppError Class

```javascript
// src/shared/utils/AppError.js
class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
    this.name = 'AppError';
  }
}

export default AppError;
```

**Usage in services:**
```javascript
import AppError from '../../shared/utils/AppError.js';

const findById = async (id) => {
  const product = await Product.findById(id);
  if (!product) throw new AppError('Product not found', 404);
  return product;
};
```

**Why a custom error class?**
- Attach HTTP status code to the error
- Distinguish our errors from unexpected system errors
- Error middleware checks `err.status` — if present, it's an AppError; if missing, it's a 500

---

## Step 6 — Error Middleware

```javascript
// src/shared/middleware/error.middleware.js
const errorMiddleware = (err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    error: message,
    // Only include stack trace in development
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
```

**How errors reach this middleware:**

```javascript
// From a controller:
const create = async (req, res, next) => {
  try {
    const product = await productService.create(req.body);
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);   // hands error to errorMiddleware
  }
};

// From a service:
throw new AppError('Product not found', 404);
// → controller catches → next(err) → errorMiddleware
// → res.status(404).json({ success: false, error: 'Product not found' })
```

**Error types and responses:**

| Error source | `err.status` | HTTP response |
|---|---|---|
| `throw new AppError('Not found', 404)` | 404 | `{ success: false, error: 'Not found' }` |
| `throw new AppError('Conflict', 409)` | 409 | `{ success: false, error: 'Conflict' }` |
| Unexpected JS error | undefined | 500 `Internal Server Error` |
| Mongoose ValidationError | undefined | 500 (should be caught and wrapped) |

---

## Step 7 — Database Connection (`db.js`)

```javascript
// src/shared/config/db.js
import mongoose from 'mongoose';
import env from './env.js';

const connect = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(`MongoDB connected: ${env.MONGODB_URI}`);
};

const disconnect = async () => {
  await mongoose.disconnect();
};

export { connect, disconnect };
```

**Mongoose connection events you can hook into:**
```javascript
mongoose.connection.on('error', (err) => console.error('DB error:', err));
mongoose.connection.on('disconnected', () => console.warn('DB disconnected'));
```

**In tests:** `disconnect()` is called in `afterAll()` so the test process exits cleanly.

---

## Hands-On Exercises

### Exercise 1: Observe the middleware chain
Add temporary logging to `validate` middleware:
```javascript
const validate = (schema) => (req, res, next) => {
  console.log('[validate] Checking body:', req.body);
  const result = schema.safeParse(req.body);
  console.log('[validate] Result:', result.success ? 'PASS' : 'FAIL');
  // ... rest of middleware
};
```
Make a request, observe the log. Then remove the logs.

### Exercise 2: Test JWT manually
```bash
# Step 1: Register
curl -s -X POST http://localhost:3000/api/v1/users/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@test.com","password":"password123"}'

# Step 2: Login, capture token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@test.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

echo "Token: $TOKEN"

# Step 3: Use token
curl -s http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Step 4: Decode the JWT payload (it's just Base64)
echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

### Exercise 3: Trigger the error middleware
```bash
# Hit an endpoint with a bad MongoDB ObjectId format
curl -s http://localhost:3000/api/v1/products/not-a-valid-id | python3 -m json.tool
```
Observe the error. Now look at `product.service.js` — `findById` calls `Product.findById(id)`.
Mongoose throws a CastError for invalid ObjectId format. Add handling:
```javascript
// In product.service.js findById:
import mongoose from 'mongoose';
if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Invalid product ID', 400);
```

### Exercise 4: Publish and subscribe to a custom event
In `app.js` (temporarily), after `registerNotificationHandlers()`:
```javascript
import eventBus from './shared/events/eventBus.js';
eventBus.subscribe('TestEvent', (payload) => {
  console.log('[TEST] Received:', payload);
});
eventBus.publish('TestEvent', { message: 'hello from Session 3' });
```
Restart nodemon (`rs`). Observe the log. Then remove the code.

---

## Architecture Discussion

### Comparing with Spring Boot

| Concept | Spring Boot | Express |
|---|---|---|
| JWT validation | `JwtAuthenticationFilter extends OncePerRequestFilter` | `authenticate` middleware function |
| Role check | `@PreAuthorize("hasRole('ADMIN')")` | `authorize('admin')` middleware |
| Validation | `@Valid @RequestBody` + Bean Validation annotations | `validate(schema)` middleware + Zod |
| Error handling | `@ControllerAdvice @ExceptionHandler` | `(err, req, res, next)` middleware |
| Custom exceptions | `class ResourceNotFoundException extends RuntimeException` | `class AppError extends Error` |

**Key architectural difference:**
Spring uses AOP (Aspect-Oriented Programming) and annotations — cross-cutting concerns are applied declaratively.
Express uses middleware composition — cross-cutting concerns are applied imperatively by chaining functions.

Both achieve the same result. Spring Boot is safer for large teams (harder to accidentally skip a check). Express is more explicit and easier to reason about.

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| `next(err)` without catching | Unhandled promise rejection | Always wrap async controllers in try/catch |
| Check `req.user` before `authenticate` runs | `req.user` is undefined | Always put `authenticate` before `authorize` |
| Put error middleware before routes | It never catches errors | Always last `app.use()` |
| JWT secret in code | Security vulnerability | Always from environment variable |
| Return inside middleware but forget `return` before `res.send()` | Headers already sent error | Use `return res.status(401).json(...)` |

---

## Key Takeaways

1. Middleware is just a function `(req, res, next)` — nothing magic
2. Always call `next()` or send a response — never do both
3. Error middleware needs 4 arguments `(err, req, res, next)` — Express detects this
4. `validate(schema)` replaces `req.body` with the sanitised, type-safe version
5. JWT is encoded (not encrypted) — never put sensitive data in the payload
6. `authenticate` sets `req.user`; `authorize` reads `req.user.role`
7. Throw `AppError` in services — controllers catch and pass to `next(err)`
8. The event bus is a singleton — one instance shared across the entire process

---

## Quiz Questions

1. What is the difference between `next()` and `next(err)`?
2. How does Express identify an error-handling middleware vs a regular middleware?
3. What does `schema.safeParse()` return? How is it different from `schema.parse()`?
4. What is the difference between HTTP 401 and HTTP 403? Give an example of each.
5. Why should you never put sensitive data in a JWT payload?
6. What happens if two middlewares both call `res.json()` for the same request?
7. Why does `export default new EventBus()` create a singleton?
