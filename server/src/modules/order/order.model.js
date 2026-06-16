const mongoose = require('mongoose');

const ORDER_STATES = [
  'PENDING',
  'CONFIRMED',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [orderItemSchema],
    totalAmount: { type: Number, required: true },
    status: { type: String, enum: ORDER_STATES, default: 'PENDING' },
    shippingAddress: {
      street: String,
      city: String,
      state: String,
      country: String,
      zip: String,
    },
    paymentId: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
module.exports.ORDER_STATES = ORDER_STATES;
