const eventBus = require('../../shared/events/eventBus');
const EVENTS = require('../../shared/events/events');
const orderService = require('./order.service');

const registerHandlers = () => {
  eventBus.subscribe(EVENTS.CART_CHECKED_OUT, async (payload) => {
    await orderService.createFromCart(payload);
  });

  eventBus.subscribe(EVENTS.STOCK_RESERVED, async ({ orderId }) => {
    await orderService.transition(orderId, 'CONFIRMED');
  });

  eventBus.subscribe(EVENTS.PAYMENT_AUTHORISED, async ({ orderId }) => {
    await orderService.transition(orderId, 'PROCESSING');
  });

  eventBus.subscribe(EVENTS.PAYMENT_FAILED, async ({ orderId }) => {
    await orderService.transition(orderId, 'PAYMENT_FAILED');
  });

  eventBus.subscribe(EVENTS.ORDER_CANCELLED, async ({ orderId }) => {
    await orderService.transition(orderId, 'CANCELLED').catch(() => {});
  });
};

module.exports = { registerHandlers };
