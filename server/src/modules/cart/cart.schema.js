import { z } from 'zod';

const addItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});

const updateQuantitySchema = z.object({
  quantity: z.number().int().min(0),
});

const checkoutSchema = z.object({
  shippingAddress: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    country: z.string().min(1),
    zip: z.string().min(1),
  }),
});

export { addItemSchema, updateQuantitySchema, checkoutSchema };
