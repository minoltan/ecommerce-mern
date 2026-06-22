import Cart from './cart.model.js';
import Product from '../product/product.model.js';
import eventBus from '../../shared/events/eventBus.js';
import EVENTS from '../../shared/events/events.js';
import AppError from '../../shared/utils/AppError.js';

const getCart = async (userId) => {
  const cart = await Cart.findOne({ userId }).lean();
  return cart || { userId, items: [], totalAmount: 0 };
};

const addItem = async (userId, { productId, quantity }) => {
  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw new AppError('Product not found', 404);

  let cart = await Cart.findOne({ userId });
  if (!cart) cart = new Cart({ userId, items: [] });

  const existing = cart.items.find((i) => i.productId.toString() === productId);
  if (existing) {
    existing.quantity += quantity;
    existing.price = product.price;
  } else {
    cart.items.push({ productId, name: product.name, price: product.price, quantity });
  }

  await cart.save();
  return cart;
};

const updateQuantity = async (userId, productId, quantity) => {
  const cart = await Cart.findOne({ userId });
  if (!cart) throw new AppError('Cart not found', 404);

  const item = cart.items.find((i) => i.productId.toString() === productId);
  if (!item) throw new AppError('Item not in cart', 404);

  if (quantity === 0) {
    cart.items = cart.items.filter((i) => i.productId.toString() !== productId);
  } else {
    item.quantity = quantity;
  }

  await cart.save();
  return cart;
};

const removeItem = async (userId, productId) => {
  const cart = await Cart.findOne({ userId });
  if (!cart) throw new AppError('Cart not found', 404);

  cart.items = cart.items.filter((i) => i.productId.toString() !== productId);
  await cart.save();
  return cart;
};

const checkout = async (userId, { shippingAddress }) => {
  const cart = await Cart.findOne({ userId });
  if (!cart || cart.items.length === 0) throw new AppError('Cart is empty', 400);

  const totalAmount = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  eventBus.publish(EVENTS.CART_CHECKED_OUT, {
    userId,
    items: cart.items.map((i) => ({
      productId: i.productId.toString(),
      name: i.name,
      price: i.price,
      quantity: i.quantity,
    })),
    totalAmount,
    shippingAddress,
  });

  cart.items = [];
  await cart.save();

  return { message: 'Checkout initiated', totalAmount };
};

export { getCart, addItem, updateQuantity, removeItem, checkout };
