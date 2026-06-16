# Session 02 — MongoDB & Mongoose Deep Dive
**Duration:** 2 hours  
**Files:** `src/modules/user/user.model.js`, `src/modules/product/product.model.js`

---

## Learning Goals
- Understand the document model and how it differs from relational databases
- Write Mongoose schemas with validation, indexes, and lifecycle hooks
- Know when to embed documents vs when to reference them
- Run queries in mongosh and read execution plans

---

## Prerequisites
- Session 01 complete — server and MongoDB running
- Mongo Express accessible at http://localhost:8081

---

## Step 1 — Document Model vs Relational Model

### Relational (MySQL — Phase 1)
```sql
-- Two separate tables, linked by foreign key
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100),
  email VARCHAR(255) UNIQUE
);

CREATE TABLE orders (
  id INT PRIMARY KEY,
  user_id INT REFERENCES users(id),
  total DECIMAL(10,2)
);

-- JOIN required to get user + orders
SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id;
```

### Document (MongoDB)
```js
// Single document — no JOIN needed
{
  "_id": ObjectId("665f1b2c3d4e5f6789012345"),
  "name": "Alice",
  "email": "alice@example.com",
  "createdAt": ISODate("2024-06-10T09:00:00Z")
}

// Orders are a separate collection but reference userId
{
  "_id": ObjectId("..."),
  "userId": ObjectId("665f1b2c3d4e5f6789012345"),
  "items": [                    // embedded array — no join needed for items
    { "name": "Keyboard", "price": 129.99, "quantity": 1 }
  ],
  "totalAmount": 129.99
}
```

**Core difference:** MongoDB stores related data **together** (embed) or **separately** (reference). The choice depends on access patterns — not normalisation rules.

---

## Step 2 — BSON Types You'll Use Every Day

```js
// ObjectId — 12-byte unique identifier, auto-generated
_id: ObjectId("665f1b2c3d4e5f6789012345")

// String
name: "Alice"

// Number (no int/float distinction in JS)
price: 129.99
quantity: 2

// Boolean
isActive: true

// Date
createdAt: ISODate("2024-06-10T09:00:00.000Z")

// Array
images: ["img1.jpg", "img2.jpg"]

// Embedded document (sub-document)
shippingAddress: { street: "123 Main St", city: "NY" }

// Mixed — any type (avoid where possible, prefer specific types)
payload: { anything: "goes" }
```

---

## Step 3 — Mongoose Schema & Model

Mongoose adds structure on top of MongoDB's flexible documents.

```javascript
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name:  { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },
    role:  { type: String, enum: ['customer', 'admin'], default: 'customer' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }   // auto-adds createdAt + updatedAt
);

module.exports = mongoose.model('User', userSchema);
// collection name: 'users' (auto-pluralised + lowercased)
```

**Schema options explained:**

| Option | What it does |
|---|---|
| `required: true` | Mongoose throws ValidationError if missing |
| `unique: true` | Creates a unique index in MongoDB |
| `trim: true` | Strips leading/trailing whitespace before save |
| `lowercase: true` | Converts to lowercase before save |
| `select: false` | Field NOT returned by default in queries |
| `enum: [...]` | Only allows listed values |
| `default: value` | Used if field not provided |
| `{ timestamps: true }` | Auto-manages `createdAt` and `updatedAt` |

---

## Step 4 — Pre-Save Hook (Password Hashing)

```javascript
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();  // only hash when changed
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
```

**How it works:**
1. You call `user.save()` or `User.create()`
2. Before writing to MongoDB, Mongoose calls all `pre('save')` hooks
3. `this` refers to the document being saved
4. `this.isModified('password')` — returns `true` only if `password` field changed
5. `bcrypt.hash(password, 12)` — 12 = cost factor (2^12 = 4096 iterations, ~250ms)
6. After hashing, `next()` continues to the actual save

**Why `isModified` matters:**
```javascript
const user = await User.findById(id);
user.name = 'New Name';
await user.save();
// Without isModified check: password gets re-hashed even though it didn't change!
// With isModified check: password is skipped ✅
```

---

## Step 5 — Instance Methods

```javascript
userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Usage in user.service.js:
const user = await User.findOne({ email }).select('+password');
const isMatch = await user.comparePassword('password123');  // true/false
```

**Why `select('+password')`?**
The schema has `password: { select: false }`. This means password is never returned by default. When you need it (login), you explicitly request it with `+password`.

```javascript
// Without select('+password'):
const user = await User.findOne({ email: 'alice@test.com' });
console.log(user.password); // undefined ← protected

// With select('+password'):
const user = await User.findOne({ email: 'alice@test.com' }).select('+password');
console.log(user.password); // $2b$12$... ← bcrypt hash
```

---

## Step 6 — Indexes

Indexes speed up queries at the cost of write overhead and storage.

```javascript
// Text index — enables full-text search
productSchema.index({ name: 'text', description: 'text' });

// Compound index — speeds up category + price range queries
productSchema.index({ category: 1 });
productSchema.index({ price: 1 });

// Unique index — created by unique: true in schema
email: { type: String, unique: true }
```

**Types of indexes:**

| Type | Syntax | Use case |
|---|---|---|
| Single field | `{ field: 1 }` | Sorting or filtering by one field |
| Compound | `{ field1: 1, field2: -1 }` | Queries filtering on multiple fields |
| Text | `{ field: 'text' }` | Full-text search (`$text`) |
| Unique | `{ unique: true }` | Enforce uniqueness (email, SKU) |

**1 = ascending, -1 = descending**

---

## Step 7 — Embed vs Reference

The most important design decision in MongoDB schema design:

### Embed when:
- Data is always accessed together
- Child data is bounded in size (won't grow unboundedly)
- Data belongs to one parent only

**Example: Cart items embedded in Cart**
```javascript
const cartSchema = new mongoose.Schema({
  userId: ObjectId,
  items: [                // embedded — loaded every time we load the cart
    {
      productId: ObjectId,
      name: String,       // snapshot — copied at add-to-cart time
      price: Number,      // snapshot
      quantity: Number,
    }
  ]
});
```
Items are always loaded with the cart. Max items per cart is bounded. ✅ Embed.

### Reference when:
- Data is accessed independently
- Data is shared across many parents
- Data can grow unboundedly

**Example: Orders reference User (not embedded)**
```javascript
const orderSchema = new mongoose.Schema({
  userId: { type: ObjectId, ref: 'User' },  // reference
  items: [...],
});
// Access user separately if needed:
const user = await User.findById(order.userId);
```
A user can have hundreds of orders — you don't want all orders embedded in the user document. ✅ Reference.

### Decision table

| Scenario | Choice | Reason |
|---|---|---|
| Cart items | Embed | Always loaded together, bounded |
| Order items | Embed | Snapshot — never changes after order placed |
| Order → User | Reference | User has many orders, data changes independently |
| Product images | Embed | Few images, always shown with product |
| Notifications | Separate collection | Can be queried independently, unbounded growth |

---

## Step 8 — CRUD Operations with Mongoose

```javascript
// CREATE
const user = await User.create({ name, email, password });
// Equivalent: new User({...}) + user.save()

// READ — find one
const user = await User.findOne({ email: 'alice@test.com' });
const user = await User.findById('665f1b2c...');

// READ — find many with filter + sort + skip + limit
const products = await Product.find({ isActive: true, category: 'Electronics' })
  .sort({ price: 1 })       // ascending price
  .skip(20)                  // skip first 20 (pagination)
  .limit(10)                 // return max 10
  .lean();                   // return plain JS object, not Mongoose document (faster)

// UPDATE — find + update in one query
const product = await Product.findByIdAndUpdate(
  id,
  { $set: { price: 99.99 } },
  { new: true, runValidators: true }  // new: return updated doc; runValidators: validate
);

// DELETE — soft delete (set isActive false)
await Product.findByIdAndUpdate(id, { isActive: false });

// DELETE — hard delete (actually removes)
await Product.findByIdAndDelete(id);

// COUNT
const total = await Product.countDocuments({ isActive: true });

// PARALLEL queries
const [products, total] = await Promise.all([
  Product.find(filter).skip(skip).limit(limit),
  Product.countDocuments(filter),
]);
```

---

## Step 9 — MongoDB Query Operators

```javascript
// Comparison
{ price: { $gte: 50, $lte: 200 } }   // price between 50 and 200
{ status: { $in: ['PENDING', 'CONFIRMED'] } }  // status is one of
{ status: { $ne: 'CANCELLED' } }      // status is not

// Logical
{ $and: [{ price: { $gte: 50 } }, { isActive: true }] }
{ $or: [{ category: 'Electronics' }, { category: 'Gaming' }] }

// Text search (requires text index)
{ $text: { $search: 'mechanical keyboard' } }

// Array
{ 'items.productId': productId }       // match inside array of subdocuments

// Update operators
{ $set: { status: 'CONFIRMED' } }      // set specific field
{ $inc: { reserved: 2 } }             // increment by value
{ $push: { items: newItem } }         // add to array
{ $pull: { items: { productId: id } } } // remove from array
```

---

## Hands-On Exercise — Live mongosh Session

Open a new terminal and run:

```bash
docker exec -it ecommerce-mongodb mongosh
```

Inside mongosh:

```javascript
// Switch to our database
use ecommerce

// Register a user first (via API), then inspect it:
db.users.find().pretty()

// Find specific user
db.users.findOne({ email: "alice@test.com" })

// Check that password is stored as bcrypt hash
db.users.findOne({ email: "alice@test.com" }, { password: 1 })
// { _id: ..., password: "$2b$12$..." }

// Count users
db.users.countDocuments()

// Check indexes on the users collection
db.users.getIndexes()
// Should show: _id index + email unique index

// Explain a query — check if index is used
db.users.explain("executionStats").findOne({ email: "alice@test.com" })
// Look for: "stage": "IXSCAN" (index scan — fast)
// Bad: "stage": "COLLSCAN" (collection scan — scans every document)

// Drop the email index and re-run explain
db.users.dropIndex("email_1")
db.users.explain("executionStats").findOne({ email: "alice@test.com" })
// Now stage is "COLLSCAN" — much slower at scale

// Re-create the index
db.users.createIndex({ email: 1 }, { unique: true })
```

---

## Architecture Discussion

### MySQL (Phase 1) vs MongoDB Schema Design

**User table in MySQL:**
```sql
CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer','admin') DEFAULT 'customer',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**User document in MongoDB:**
```javascript
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true },
  password: { type: String, select: false },
  role: { type: String, enum: ['customer','admin'], default: 'customer' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
```

**What's the same:** required fields, unique constraint on email, role enum, timestamps.  
**What's different:**
- MongoDB has no `INT` vs `BIGINT` — ObjectId handles identity
- MongoDB has no `VARCHAR(255)` — strings have no length limit by default
- `timestamps: true` replaces manual `DEFAULT CURRENT_TIMESTAMP`
- `select: false` on password has no SQL equivalent — handled at ORM level

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| Embed unbounded arrays | Document can grow to 16MB limit | Use a reference + separate collection |
| No index on frequently queried field | Full collection scan on every request | Add `index()` to schema |
| Forget `.lean()` on read-heavy queries | Mongoose documents carry overhead | Use `.lean()` when you don't need save/methods |
| `findByIdAndUpdate` without `{ new: true }` | Returns old document before update | Always pass `{ new: true }` |
| `findByIdAndUpdate` without `runValidators` | Skips schema validation on update | Always pass `{ runValidators: true }` |
| Not using `isModified()` in pre-save hook | Bcrypt re-hashes password unnecessarily | Always check `this.isModified('password')` |

---

## Key Takeaways

1. MongoDB stores documents — no JOINs, but you choose embed vs reference per access pattern
2. Mongoose adds schema validation, lifecycle hooks, and methods on top of raw MongoDB
3. `pre('save')` hooks run before every `.save()` — use `isModified()` to conditionally run
4. `select: false` hides sensitive fields by default — use `.select('+password')` when you need them
5. Text indexes enable full-text search — compound indexes speed up multi-field filters
6. `.lean()` returns plain JS objects — faster for read-only operations
7. Always use `{ new: true, runValidators: true }` with `findByIdAndUpdate`

---

## Quiz Questions

1. What is the difference between embedding and referencing in MongoDB? Give one example of when you'd choose each.
2. Why does the User schema have `select: false` on the password field? How do you retrieve it when needed?
3. What is `this.isModified('password')` checking, and why does it matter in the pre-save hook?
4. What is a text index? How do you use it in a query?
5. What does `.lean()` do, and when should you use it vs not use it?
6. What is the `{ timestamps: true }` schema option and what fields does it create?
