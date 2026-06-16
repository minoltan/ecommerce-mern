const { Router } = require('express');
const { getByProduct, upsert } = require('./inventory.controller');
const { authenticate, authorize } = require('../../shared/middleware/auth.middleware');

const router = Router();

router.get('/:productId', getByProduct);
router.put('/:productId', authenticate, authorize('admin'), upsert);

module.exports = router;
