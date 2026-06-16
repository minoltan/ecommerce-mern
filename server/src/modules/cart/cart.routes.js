const { Router } = require('express');
const { getCart, addItem, updateQuantity, removeItem, checkout } = require('./cart.controller');
const { authenticate } = require('../../shared/middleware/auth.middleware');
const { validate } = require('../../shared/middleware/validate.middleware');
const { addItemSchema, updateQuantitySchema, checkoutSchema } = require('./cart.schema');

const router = Router();

router.use(authenticate);

router.get('/', getCart);
router.post('/items', validate(addItemSchema), addItem);
router.put('/items/:productId', validate(updateQuantitySchema), updateQuantity);
router.delete('/items/:productId', removeItem);
router.post('/checkout', validate(checkoutSchema), checkout);

module.exports = router;
