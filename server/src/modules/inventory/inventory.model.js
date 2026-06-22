import mongoose from 'mongoose';

const inventorySchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      unique: true,
    },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 10 },
  },
  { timestamps: true }
);

inventorySchema.virtual('available').get(function () {
  return this.quantity - this.reserved;
});

export default mongoose.model('Inventory', inventorySchema);
