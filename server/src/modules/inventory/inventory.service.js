const Inventory = require('./inventory.model');
const eventBus = require('../../shared/events/eventBus');
const EVENTS = require('../../shared/events/events');
const AppError = require('../../shared/utils/AppError');

const reserve = async (items) => {
  for (const item of items) {
    const inv = await Inventory.findOne({ productId: item.productId });
    if (!inv) throw new AppError(`No inventory for product ${item.productId}`, 404);

    const available = inv.quantity - inv.reserved;
    if (available < item.quantity) {
      throw new AppError(`Insufficient stock for product ${item.productId}`, 400);
    }

    inv.reserved += item.quantity;
    await inv.save();

    if (inv.quantity - inv.reserved <= inv.lowStockThreshold) {
      eventBus.publish(EVENTS.LOW_STOCK_ALERT, {
        productId: item.productId,
        available: inv.quantity - inv.reserved,
      });
    }
  }
};

const release = async (items) => {
  for (const item of items) {
    await Inventory.findOneAndUpdate(
      { productId: item.productId },
      { $inc: { reserved: -item.quantity } }
    );
  }
  eventBus.publish(EVENTS.STOCK_RELEASED, { items });
};

const commit = async (items) => {
  for (const item of items) {
    await Inventory.findOneAndUpdate(
      { productId: item.productId },
      { $inc: { quantity: -item.quantity, reserved: -item.quantity } }
    );
  }
};

const getByProduct = async (productId) => {
  const inv = await Inventory.findOne({ productId }).lean();
  if (!inv) throw new AppError('Inventory record not found', 404);
  return inv;
};

const upsert = async (productId, { quantity, lowStockThreshold }) => {
  return Inventory.findOneAndUpdate(
    { productId },
    { $set: { ...(quantity !== undefined && { quantity }), ...(lowStockThreshold !== undefined && { lowStockThreshold }) } },
    { upsert: true, new: true }
  );
};

module.exports = { reserve, release, commit, getByProduct, upsert };
