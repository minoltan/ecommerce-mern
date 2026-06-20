const eventBus = require('../../shared/events/eventBus');
const EVENTS = require('../../shared/events/events');
const paymentService = require('./payment.service');

const registerHandlers = () => {
  eventBus.subscribe(EVENTS.STOCK_RESERVED, async ({ orderId, userId, items, totalAmount }) => {
    await paymentService.initiate({
      orderId,
      userId,
      items,
      amount: totalAmount,
      idempotencyKey: `order-${orderId}`,
    });
  });
};

module.exports = { registerHandlers };
