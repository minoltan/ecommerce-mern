const { randomUUID } = require('crypto');
const Payment = require('./payment.model');
const eventBus = require('../../shared/events/eventBus');
const EVENTS = require('../../shared/events/events');
const AppError = require('../../shared/utils/AppError');

const initiate = async ({ orderId, userId, items, amount, idempotencyKey }) => {
  const existing = await Payment.findOne({ idempotencyKey });
  if (existing) return existing;

  const payment = await Payment.create({
    orderId,
    userId,
    amount,
    idempotencyKey: idempotencyKey || randomUUID(),
    status: 'PENDING',
  });

  // Mock payment gateway — 80 % success rate
  const success = Math.random() > 0.2;

  if (success) {
    payment.status = 'AUTHORISED';
    payment.providerRef = `mock-${randomUUID()}`;
    await payment.save();

    eventBus.publish(EVENTS.PAYMENT_AUTHORISED, {
      paymentId: payment._id.toString(),
      orderId,
      userId,
      amount,
    });
  } else {
    payment.status = 'FAILED';
    await payment.save();

    eventBus.publish(EVENTS.PAYMENT_FAILED, {
      paymentId: payment._id.toString(),
      orderId,
      userId,
      items,
    });
  }

  return payment;
};

const refund = async (paymentId, userId) => {
  const payment = await Payment.findOne({ _id: paymentId, userId });
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.status !== 'AUTHORISED') throw new AppError('Payment is not refundable', 400);

  payment.status = 'REFUNDED';
  await payment.save();

  eventBus.publish(EVENTS.REFUND_ISSUED, {
    paymentId: payment._id.toString(),
    orderId: payment.orderId.toString(),
    userId,
    amount: payment.amount,
  });

  return payment;
};

module.exports = { initiate, refund };
