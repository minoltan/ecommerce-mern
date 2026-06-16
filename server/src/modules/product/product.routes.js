const { Router } = require('express');
const { create, list, getOne, update, remove } = require('./product.controller');
const { authenticate, authorize } = require('../../shared/middleware/auth.middleware');
const { validate } = require('../../shared/middleware/validate.middleware');
const { createProductSchema, updateProductSchema } = require('./product.schema');

const router = Router();

router.get('/', list);
router.get('/:id', getOne);
router.post('/', authenticate, authorize('admin'), validate(createProductSchema), create);
router.put('/:id', authenticate, authorize('admin'), validate(updateProductSchema), update);
router.delete('/:id', authenticate, authorize('admin'), remove);

module.exports = router;
