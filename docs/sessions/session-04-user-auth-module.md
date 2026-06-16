# Session 04 — User & Auth Module
**Duration:** 2 hours  
**Files:** `src/modules/user/`

---

## Learning Goals
- Implement full registration and login with JWT
- Understand bcrypt — what it does, why 12 rounds, why it's irreversible
- Publish domain events from the service layer
- Trace a registration → login → protected route flow end-to-end

---

## Prerequisites
- Sessions 01–03 complete
- Server running, Swagger UI at http://localhost:3000/api-docs

---

## Step 1 — Module Structure

Every module follows the same 5-file pattern:

```
user/
├── user.model.js       ← Mongoose schema (data shape + DB behaviour)
├── user.schema.js      ← Zod schemas (HTTP input validation)
├── user.service.js     ← Business logic (the brain)
├── user.controller.js  ← HTTP handlers (thin — just calls service)
└── user.routes.js      ← Express router + Swagger annotations
```

**The layered architecture:**
```
HTTP Request
    │
    ▼
user.routes.js      → middleware chain + route definition
    │
    ▼
user.controller.js  → parse req, call service, format res
    │
    ▼
user.service.js     → business rules, DB calls, event publishing
    │
    ▼
user.model.js       → Mongoose → MongoDB
```

**Rule:** Controllers never contain business logic. Services never know about `req` or `res`.

---

## Step 2 — User Model (`user.model.js`)

```javascript
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role:     { type: String, enum: ['customer', 'admin'], default: 'customer' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Pre-save hook: hash password before storing
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Instance method: safe password comparison
userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
```

### bcrypt deep dive

**Why can't we store passwords in plain text?**
If the database is breached, every user's password is exposed — and they likely reuse passwords on other sites.

**Why can't we use MD5/SHA256?**
These are fast — attackers can compute billions of hashes per second (rainbow table attacks).

**Why bcrypt?**
- Deliberately slow — 12 rounds means 2^12 = 4,096 iterations (~250ms per hash)
- Has a salt — prevents rainbow tables
- Adaptive — increase rounds as hardware gets faster
- Irreversible — you can only verify, never decrypt

```javascript
// Registration (one-way):
const hash = await bcrypt.hash('password123', 12);
// → "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

// Login verification (timing-safe comparison):
const isMatch = await bcrypt.compare('password123', hash);  // true
const isMatch = await bcrypt.compare('wrongpass',   hash);  // false
```

**The `12` cost factor:** 10 = too fast (attackers benefit), 14 = too slow (200ms+, hurts UX). 12 is the industry standard.

---

## Step 3 — Zod Validation Schemas (`user.schema.js`)

```javascript
const { z } = require('zod');

const registerSchema = z.object({
  name:     z.string().min(2).max(100),
  email:    z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});
```

**Zod vs Mongoose validation:**

| | Zod (user.schema.js) | Mongoose (user.model.js) |
|---|---|---|
| Purpose | Validate HTTP input | Validate DB writes |
| When | Before controller runs | Before .save() |
| Error format | Flat field errors for API response | Mongoose ValidationError |
| Use for | Required fields, email format, password length | DB-level constraints |

Both layers exist because:
- Zod gives friendly HTTP 400 errors to API consumers
- Mongoose is the last line of defence before DB writes

---

## Step 4 — User Service (`user.service.js`)

### Registration

```javascript
const register = async ({ name, email, password }) => {
  // 1. Check for duplicate email
  const exists = await User.findOne({ email });
  if (exists) throw new AppError('Email already registered', 409);

  // 2. Create user (pre-save hook hashes password automatically)
  const user = await User.create({ name, email, password });

  // 3. Publish domain event
  eventBus.publish(EVENTS.USER_REGISTERED, {
    userId: user._id.toString(),
    email:  user.email,
    name:   user.name,
  });

  // 4. Return only safe fields (never return the full user document)
  return { id: user._id, name: user.name, email: user.email };
};
```

**Data flow:**
```
register({ name, email, password })
  │
  ├── User.findOne({ email })         → check duplicate
  │
  ├── User.create({ name, email, password })
  │       └── pre('save') hook        → bcrypt.hash(password, 12)
  │
  ├── eventBus.publish('UserRegistered', {...})
  │       └── notification.events.js subscribes → sends welcome email
  │
  └── return { id, name, email }      → no password, no internal fields
```

### Login

```javascript
const login = async ({ email, password }) => {
  // Must select('+password') because password has select: false
  const user = await User.findOne({ email }).select('+password');
  
  // Same error for wrong email OR wrong password — don't leak which one
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Invalid credentials', 401);
  }

  // Sign JWT with minimal payload
  const token = jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );

  eventBus.publish(EVENTS.USER_LOGGED_IN, { userId: user._id.toString() });

  return {
    token,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  };
};
```

**Security details:**
- Same 401 error for wrong email AND wrong password — prevents user enumeration
- `.select('+password')` — only time we load password hash from DB
- `user._id.toString()` — ObjectId must be converted to string for JWT payload

---

## Step 5 — Controller (`user.controller.js`)

```javascript
const register = async (req, res, next) => {
  try {
    const user = await userService.register(req.body);
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);   // pass to error middleware
  }
};
```

**Controllers should be thin:** No business logic here. Just:
1. Extract data from `req`
2. Call service
3. Format `res`
4. Pass errors to `next(err)`

---

## Step 6 — Routes (`user.routes.js`)

```javascript
const router = Router();

router.post('/register', validate(registerSchema), register);
router.post('/login',    validate(loginSchema),    login);
router.get('/me',        authenticate,             getMe);
```

**Middleware chain per route:**
```
POST /register:  validate(registerSchema) → register
POST /login:     validate(loginSchema)    → login
GET  /me:        authenticate             → getMe
```

Routes are mounted in `app.js` at `/api/v1/users`:
```
POST /api/v1/users/register
POST /api/v1/users/login
GET  /api/v1/users/me
```

---

## Hands-On Exercise — Complete Auth Flow

### Step 1: Register a user
```bash
curl -s -X POST http://localhost:3000/api/v1/users/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@test.com","password":"password123"}' \
  | python3 -m json.tool
```
Expected:
```json
{
  "success": true,
  "data": {
    "id": "665f1b2c...",
    "name": "Alice",
    "email": "alice@test.com"
  }
}
```
**Observe the server console:**
```
[EventBus] → UserRegistered {"userId":"665f...","email":"alice@test.com","name":"Alice"}
[Notification] Sending EMAIL to user 665f... — template: welcome
```

### Step 2: Try duplicate email
```bash
curl -s -X POST http://localhost:3000/api/v1/users/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice2","email":"alice@test.com","password":"password123"}' \
  | python3 -m json.tool
```
Expected: `{"success":false,"error":"Email already registered"}` with HTTP 409.

### Step 3: Login
```bash
curl -s -X POST http://localhost:3000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@test.com","password":"password123"}' \
  | python3 -m json.tool
```
Copy the `token` from the response.

### Step 4: Decode the JWT (without a library)
```bash
TOKEN="paste-your-token-here"
echo $TOKEN | cut -d. -f2 | base64 --decode 2>/dev/null | python3 -m json.tool
```
You'll see:
```json
{
  "sub": "665f1b2c...",
  "email": "alice@test.com",
  "role": "customer",
  "iat": 1718000000,
  "exp": 1718000900
}
```
`iat` = issued at, `exp` = expires at (Unix timestamps). `exp - iat = 900 seconds = 15 minutes`.

### Step 5: Access protected endpoint
```bash
curl -s http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

### Step 6: Use an expired/invalid token
```bash
curl -s http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer invalid.token.here" \
  | python3 -m json.tool
```
Expected: `{"success":false,"error":"Invalid or expired token"}`

### Step 7: Check the DB via Mongo Express
Open http://localhost:8081 → ecommerce → users collection.
Verify:
- `password` is stored as a bcrypt hash `$2b$12$...`
- `role` is `"customer"`
- `createdAt` and `updatedAt` exist

---

## Architecture Discussion

### Spring Security vs Express JWT Middleware

**Spring Boot (Phase 1):**
```java
@Component
public class JwtAuthFilter extends OncePerRequestFilter {
  @Override
  protected void doFilterInternal(HttpServletRequest request, ...) {
    String token = extractToken(request);
    if (token != null && jwtUtil.validateToken(token)) {
      UsernamePasswordAuthenticationToken auth = ...;
      SecurityContextHolder.getContext().setAuthentication(auth);
    }
    filterChain.doFilter(request, response);
  }
}
```

**Express (Phase 3):**
```javascript
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  req.user = jwt.verify(token, env.JWT_SECRET);
  next();
};
```

**Same concept, different verbosity.** Spring Boot has boilerplate for integration with the SecurityContext. Express is explicit and minimal.

**Domain event:** Both Phase 1 and Phase 3 publish `UserRegistered` after registration. The difference:
- Phase 1: Kafka producer sends to a real topic, consumed by Notification service (different process)
- Phase 3: EventEmitter publishes in-process, consumed by notification.events.js handler (same process)

The event payload is identical — this is the architectural consistency that makes microservices extraction straightforward.

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| Return full user doc including password | Security breach | Always return only `{ id, name, email }` |
| Same error for "email not found" vs "wrong password" — different messages | User enumeration attack | Always: `'Invalid credentials'` for both |
| Forget `.select('+password')` on login | `user.password` is `undefined`, `comparePassword` fails | Always add `.select('+password')` on login query |
| `user._id` in JWT payload (ObjectId) | JWT payload has an object, not a string | Always `.toString()`: `user._id.toString()` |
| Hardcode JWT_SECRET | Secret in source code = security breach | Always from `env.JWT_SECRET` |
| bcrypt cost factor too low (6-8) | Easily brute-forced | Use 12 in production |

---

## Key Takeaways

1. Registration: validate → check duplicate → create (auto-hash) → publish event → return safe fields
2. Login: find user + select password → compare hash → sign JWT → publish event
3. bcrypt is irreversible — you can only verify, never decrypt
4. Same 401 error for wrong email and wrong password — never reveal which one
5. JWT payload is encoded (not encrypted) — only safe data goes in
6. `select: false` on password — must use `.select('+password')` explicitly on login
7. Controllers are thin — all logic lives in services
8. Events published from service, consumed by notification module automatically

---

## Quiz Questions

1. Why does the register service throw a 409 (not 400) for duplicate email?
2. What does `select: false` on the password field do? When do you need to override it?
3. Why must we use the same error message for wrong email and wrong password?
4. What is the bcrypt cost factor and why is 12 the recommended value?
5. Why convert `user._id.toString()` before putting it in the JWT payload?
6. What happens in the notification module when `UserRegistered` is published? Trace the full path.
7. Why is the controller kept thin (no business logic)? What is the benefit?
