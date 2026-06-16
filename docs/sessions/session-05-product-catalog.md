# Session 05 — Product Catalog Module
**Duration:** 2 hours  
**Files:** `src/modules/product/`

---

## Learning Goals
- Implement full CRUD with soft delete
- Build search (full-text), filtering (price range, category), and pagination
- Understand MongoDB text indexes and compound indexes
- Apply role-based access control (admin-only write operations)

---

## Prerequisites
- Sessions 01–04 complete
- Admin user created (update role via Mongo Express)

---

## Step 1 — Product Model (`product.model.js`)

```javascript
const productSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    price:       { type: Number, required: true, min: 0 },
    sku:         { type: String, required: true, unique: true, trim: true },
    category:    { type: String, required: true, trim: true },
    images:      [{ url: String, alt: String }],    // embedded array
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Text index for full-text search on name and description
productSchema.index({ name: 'text', description: 'text' });

// Single-field indexes for filtering
productSchema.index({ category: 1 });
productSchema.index({ price: 1 });
```

### Why `min: 0` on price?
Mongoose schema-level validation. Prevents negative prices at the ORM layer. Combined with Zod's `z.number().positive()` at the HTTP layer — two layers of protection.

### Why embedded images array?
Images always load with the product. There are at most a few per product. Both conditions for embedding are met. If images were in a separate collection, every product list request would need a JOIN (populate in Mongoose) for no benefit.

### SKU (Stock Keeping Unit)
Unique business identifier for a product variant. Used by inventory to match products. `unique: true` creates a unique index in MongoDB.

---

## Step 2 — Zod Validation Schemas (`product.schema.js`)

```javascript
const createProductSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().optional(),
  price:       z.number().positive(),
  sku:         z.string().min(1),
  category:    z.string().min(1),
  images:      z.array(z.object({
    url: z.string().url(),
    alt: z.string().optional(),
  })).optional(),
});

// .partial() makes all fields optional — used for PATCH-style updates
const updateProductSchema = createProductSchema.partial();
```

**`z.number().positive()` vs Mongoose `min: 0`:**
- Zod `positive()` means > 0 (strictly positive, no zero)
- Mongoose `min: 0` means ≥ 0 (zero allowed)
- Decide based on business rules — for price, `positive()` is correct (can't have $0 product)

---

## Step 3 — Product Service (`product.service.js`)

### Create
```javascript
const create = async (data) => {
  const product = await Product.create(data);
  
  eventBus.publish(EVENTS.PRODUCT_CREATED, {
    productId: product._id.toString(),
    name:      product.name,
    price:     product.price,
  });
  
  return product;
};
```

### List with Search, Filter & Pagination
```javascript
const findAll = async ({ page = 1, limit = 20, category, search, minPrice, maxPrice } = {}) => {
  const filter = { isActive: true };           // always exclude soft-deleted
  
  if (category) filter.category = category;
  
  if (search) filter.$text = { $search: search };   // requires text index
  
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = Number(minPrice);
    if (maxPrice !== undefined) filter.price.$lte = Number(maxPrice);
  }
  
  const skip = (Number(page) - 1) * Number(limit);
  
  // Run count and data query in parallel — faster than sequential
  const [products, total] = await Promise.all([
    Product.find(filter).skip(skip).limit(Number(limit)).lean(),
    Product.countDocuments(filter),
  ]);
  
  return {
    products,
    total,
    page:       Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
};
```

### Build Filter Object Step by Step
```javascript
// Request: GET /products?search=keyboard&minPrice=50&maxPrice=300&category=Electronics&page=2&limit=10

// filter builds up to:
{
  isActive: true,
  category: 'Electronics',
  $text: { $search: 'keyboard' },
  price: { $gte: 50, $lte: 300 }
}

// Query:
Product.find(filter).skip(10).limit(10).lean()
// Returns products 11-20 matching all filters
```

### Update
```javascript
const update = async (id, data) => {
  const product = await Product.findByIdAndUpdate(id, data, {
    new: true,           // return updated document, not the old one
    runValidators: true  // run schema validation on update fields
  });
  if (!product) throw new AppError('Product not found', 404);
  
  // Publish PriceUpdated only if price changed
  if (data.price !== undefined) {
    eventBus.publish(EVENTS.PRICE_UPDATED, { productId: id, newPrice: data.price });
  }
  
  return product;
};
```

### Soft Delete
```javascript
const remove = async (id) => {
  const product = await Product.findByIdAndUpdate(
    id,
    { isActive: false },   // never delete, just deactivate
    { new: true }
  );
  if (!product) throw new AppError('Product not found', 404);
  return product;
};
```

**Why soft delete?**
- Order history references products — hard delete breaks order data integrity
- Allows recovery if deleted by mistake
- Audit trail — you can see what existed
- `isActive: false` products are invisible to customers but queryable by admins

---

## Step 4 — MongoDB Text Search Deep Dive

```javascript
// Text index defined on schema:
productSchema.index({ name: 'text', description: 'text' });

// Query using text index:
Product.find({ $text: { $search: 'mechanical keyboard' } })
```

**How text search works:**
- MongoDB tokenises and stems the indexed fields
- `'mechanical keyboard'` → searches for documents containing 'mechanical' OR 'keyboard'
- Wrap in quotes for exact phrase: `{ $search: '"mechanical keyboard"' }`
- Prefix with `-` to exclude: `{ $search: 'keyboard -wireless' }`

**Limitations of MongoDB text search:**
- Only one text index per collection
- No fuzzy matching (typos won't match)
- English stemming by default ('keyboards' matches 'keyboard')
- For production search, use Elasticsearch or MongoDB Atlas Search

---

## Step 5 — Routes with Role-Based Access

```javascript
router.get('/',    list);                                                // public
router.get('/:id', getOne);                                              // public
router.post('/',   authenticate, authorize('admin'), validate(schema), create);   // admin
router.put('/:id', authenticate, authorize('admin'), validate(schema), update);   // admin
router.delete('/:id', authenticate, authorize('admin'), remove);          // admin
```

**Middleware chain for POST /products:**
```
authenticate      → verify JWT → set req.user
    │ (if no/invalid token → 401)
    ▼
authorize('admin') → check req.user.role === 'admin'
    │ (if not admin → 403)
    ▼
validate(schema)  → check request body
    │ (if invalid → 400)
    ▼
create            → call productService.create()
```

---

## Hands-On Exercise

### Step 1: Promote a user to admin
Open Mongo Express (http://localhost:8081) → ecommerce → users.
Edit a user document and change `role` from `"customer"` to `"admin"`. Save.

Then login as that user to get a fresh token (the role is in the JWT payload, so you need a new token):
```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@test.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
```

### Step 2: Create products
```bash
# Product 1
curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Mechanical Keyboard","description":"TKL layout Cherry MX switches","price":129.99,"sku":"KB-001","category":"Electronics"}' \
  | python3 -m json.tool

# Product 2
curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Wireless Mouse","description":"Ergonomic 2.4GHz wireless mouse","price":49.99,"sku":"MS-001","category":"Electronics"}' \
  | python3 -m json.tool

# Product 3
curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"USB-C Hub","description":"7-in-1 USB-C docking station","price":79.99,"sku":"HUB-001","category":"Electronics"}' \
  | python3 -m json.tool

# Product 4
curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Office Chair","description":"Ergonomic mesh back lumbar support","price":299.99,"sku":"CHR-001","category":"Furniture"}' \
  | python3 -m json.tool
```

### Step 3: List and filter
```bash
# All products
curl -s "http://localhost:3000/api/v1/products" | python3 -m json.tool

# Text search
curl -s "http://localhost:3000/api/v1/products?search=keyboard" | python3 -m json.tool

# Filter by category
curl -s "http://localhost:3000/api/v1/products?category=Electronics" | python3 -m json.tool

# Price range
curl -s "http://localhost:3000/api/v1/products?minPrice=50&maxPrice=150" | python3 -m json.tool

# Pagination
curl -s "http://localhost:3000/api/v1/products?page=1&limit=2" | python3 -m json.tool
```

### Step 4: Update a product
```bash
PRODUCT_ID="paste-product-id-here"
curl -s -X PUT "http://localhost:3000/api/v1/products/$PRODUCT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"price":119.99}' \
  | python3 -m json.tool
```
Observe `[EventBus] → PriceUpdated` in the console.

### Step 5: Soft delete a product
```bash
curl -s -X DELETE "http://localhost:3000/api/v1/products/$PRODUCT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Verify it's gone from list
curl -s "http://localhost:3000/api/v1/products" | python3 -m json.tool

# But still exists in DB — check Mongo Express: isActive: false
```

### Step 6: Verify indexes in mongosh
```bash
docker exec -it ecommerce-mongodb mongosh ecommerce
```
```javascript
db.products.getIndexes()
// Shows: _id index, sku unique, name+description text, category, price indexes

db.products.explain("executionStats").find({ category: "Electronics" })
// IXSCAN on category index — fast

db.products.explain("executionStats").find({ $text: { $search: "keyboard" } })
// TEXT stage — uses text index
```

---

## Architecture Discussion

### Soft Delete vs Hard Delete

**Phase 1 (Spring Boot):** Uses `@SQLDelete` annotation to override DELETE with an UPDATE:
```java
@SQLDelete(sql = "UPDATE products SET is_active = false WHERE id = ?")
@Where(clause = "is_active = true")
```

**Phase 3 (Mongoose):** Manually set `isActive: false` + always add `{ isActive: true }` to queries.

The concept is identical. Spring Boot's annotation is more elegant — you can't forget the filter. Mongoose requires discipline — you must remember `isActive: true` in every query.

**Production improvement:** Create a Mongoose plugin that auto-adds `{ isActive: true }`:
```javascript
schema.pre('find', function() { this.where({ isActive: true }); });
```

### Pagination: skip/limit vs cursor-based

**Skip/limit (our approach):**
```javascript
Product.find(filter).skip(page * limit).limit(limit)
```
- Simple to implement
- Works for any page jump (`?page=50`)
- Problem: slow on large datasets — MongoDB must skip N documents

**Cursor-based (better for large datasets):**
```javascript
Product.find({ _id: { $gt: lastId }, ...filter }).limit(limit)
```
- Always fast — uses `_id` index
- Only supports "next page" (no random access)
- Used by social feeds, infinite scroll

For an e-commerce catalog (< 100k products), skip/limit is fine.

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| Hard delete products | Breaks order history foreign references | Always soft delete (`isActive: false`) |
| Forget `{ isActive: true }` in queries | Shows deleted products to users | Add to every query filter |
| `Number(page)` missing | `skip(NaN)` — Mongoose error | Always cast query strings to numbers |
| `Promise.all()` not used for count | Sequential queries waste time | Always `Promise.all([find(), count()])` |
| Text search without text index | Full collection scan | Define `index({ name: 'text' })` |
| `runValidators: false` on findByIdAndUpdate | Schema validation skipped | Always `{ runValidators: true }` |

---

## Key Takeaways

1. `isActive: false` soft-delete preserves referential integrity for orders
2. Build the filter object dynamically — only add keys when the query param exists
3. `Promise.all([find(), countDocuments()])` — always parallelise count and data queries
4. Text index required for `$text` search — creates token-based index on specified fields
5. `updateProductSchema = createProductSchema.partial()` — reuse schema, don't repeat yourself
6. `authorize('admin')` must come after `authenticate` — it reads `req.user` which auth sets
7. `new: true` on findByIdAndUpdate — returns the updated document, not the old one

---

## Quiz Questions

1. What is a soft delete? Why is it preferred over hard delete in an e-commerce system?
2. Why do we cast `page` and `limit` to `Number()` in the service?
3. What does `$text: { $search: 'keyboard' }` require to work? What happens without it?
4. Why do we use `Promise.all()` for the count and data queries?
5. What does `z.partial()` do? Why is it useful for update endpoints?
6. Why must `authorize('admin')` be placed after `authenticate` in the middleware chain?
7. What is the difference between `findByIdAndUpdate` with and without `{ new: true }`?
