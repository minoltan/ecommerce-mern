import Product from './product.model.js';
import eventBus from '../../shared/events/eventBus.js';
import EVENTS from '../../shared/events/events.js';
import AppError from '../../shared/utils/AppError.js';

const create = async (data) => {
  const product = await Product.create(data);
  eventBus.publish(EVENTS.PRODUCT_CREATED, {
    productId: product._id.toString(),
    name: product.name,
    price: product.price,
  });
  return product;
};

const findAll = async ({ page = 1, limit = 20, category, search, minPrice, maxPrice } = {}) => {
  const filter = { isActive: true };
  if (category) filter.category = category;
  if (search) filter.$text = { $search: search };
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = Number(minPrice);
    if (maxPrice !== undefined) filter.price.$lte = Number(maxPrice);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [products, total] = await Promise.all([
    Product.find(filter).skip(skip).limit(Number(limit)).lean(),
    Product.countDocuments(filter),
  ]);

  return { products, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) };
};

const findById = async (id) => {
  const product = await Product.findById(id).lean();
  if (!product) throw new AppError('Product not found', 404);
  return product;
};

const update = async (id, data) => {
  const product = await Product.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!product) throw new AppError('Product not found', 404);

  if (data.price !== undefined) {
    eventBus.publish(EVENTS.PRICE_UPDATED, { productId: id, newPrice: data.price });
  }

  return product;
};

const remove = async (id) => {
  const product = await Product.findByIdAndUpdate(id, { isActive: false }, { new: true });
  if (!product) throw new AppError('Product not found', 404);
  return product;
};

export { create, findAll, findById, update, remove };
