const { z } = require('zod');

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  price: z.number().positive(),
  sku: z.string().min(1),
  category: z.string().min(1),
  images: z.array(z.object({ url: z.string().url(), alt: z.string().optional() })).optional(),
});

const updateProductSchema = createProductSchema.partial();

module.exports = { createProductSchema, updateProductSchema };
