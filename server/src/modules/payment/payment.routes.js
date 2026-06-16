const { Router } = require('express');
const { refund } = require('./payment.controller');
const { authenticate } = require('../../shared/middleware/auth.middleware');

const router = Router();

router.use(authenticate);

router.post('/:id/refund', refund);

module.exports = router;
