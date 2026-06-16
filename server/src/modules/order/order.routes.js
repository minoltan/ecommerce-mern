const { Router } = require('express');
const { list, getOne, cancel } = require('./order.controller');
const { authenticate } = require('../../shared/middleware/auth.middleware');

const router = Router();

router.use(authenticate);

router.get('/', list);
router.get('/:id', getOne);
router.delete('/:id', cancel);

module.exports = router;
