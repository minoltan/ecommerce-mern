const eventBus = require('../../shared/events/eventBus');
const EVENTS = require('../../shared/events/events');
const paymentService = require('./payment.service');

const registerHandlers = () => {
  eventBus.subscribe(EVENTS.STOCK_RESERVED, async ({ orderId, userId, totalAmount }) => {
    await paymentService.initiate({
      orderId,
      userId,
      amount: totalAmount,
      idempotencyKey: `order-${orderId}`,
    });
  });
};

module.exports = { registerHandlers };
