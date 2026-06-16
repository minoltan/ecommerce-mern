const eventBus = require('../../shared/events/eventBus');
const EVENTS = require('../../shared/events/events');
const notificationService = require('./notification.service');

const registerHandlers = () => {
  eventBus.subscribe(EVENTS.USER_REGISTERED, async ({ userId, email, name }) => {
    await notificationService.create({ userId, type: 'EMAIL', template: 'welcome', payload: { email, name } });
  });

  eventBus.subscribe(EVENTS.ORDER_PLACED, async ({ userId, orderId, totalAmount }) => {
    await notificationService.create({
      userId,
      type: 'EMAIL',
      template: 'order-confirmation',
      payload: { orderId, totalAmount },
    });
  });

  eventBus.subscribe(EVENTS.PAYMENT_AUTHORISED, async ({ userId, orderId, amount }) => {
    await notificationService.create({
      userId,
      type: 'EMAIL',
      template: 'payment-success',
      payload: { orderId, amount },
    });
  });

  eventBus.subscribe(EVENTS.PAYMENT_FAILED, async ({ userId, orderId }) => {
    await notificationService.create({
      userId,
      type: 'EMAIL',
      template: 'payment-failed',
      payload: { orderId },
    });
  });

  eventBus.subscribe(EVENTS.LOW_STOCK_ALERT, async ({ productId, available }) => {
    console.log(`[Notification] Low stock alert — product ${productId}, ${available} units remaining`);
  });
};

module.exports = { registerHandlers };
