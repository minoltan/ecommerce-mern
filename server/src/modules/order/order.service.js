import Order from './order.model.js';
import eventBus from '../../shared/events/eventBus.js';
import EVENTS from '../../shared/events/events.js';
import AppError from '../../shared/utils/AppError.js';

const createFromCart = async ({ userId, items, totalAmount, shippingAddress }) => {
  const order = await Order.create({ userId, items, totalAmount, shippingAddress, status: 'PENDING' });

  eventBus.publish(EVENTS.ORDER_PLACED, {
    orderId: order._id.toString(),
    userId,
    items,
    totalAmount,
  });

  return order;
};

const transition = async (orderId, newStatus) => {
  const order = await Order.findByIdAndUpdate(orderId, { status: newStatus }, { new: true });
  if (!order) throw new AppError('Order not found', 404);
  return order;
};

const getByUser = async (userId, { page = 1, limit = 20 } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    Order.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    Order.countDocuments({ userId }),
  ]);
  return { orders, total, page: Number(page) };
};

const getById = async (orderId, userId) => {
  const order = await Order.findOne({ _id: orderId, userId }).lean();
  if (!order) throw new AppError('Order not found', 404);
  return order;
};

const cancel = async (orderId, userId) => {
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw new AppError('Order not found', 404);
  if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
    throw new AppError(`Order cannot be cancelled in status: ${order.status}`, 400);
  }

  order.status = 'CANCELLED';
  await order.save();

  eventBus.publish(EVENTS.ORDER_CANCELLED, {
    orderId,
    userId,
    items: order.items,
  });

  return order;
};

export { createFromCart, transition, getByUser, getById, cancel };
