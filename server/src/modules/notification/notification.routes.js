const { Router } = require('express');
const { list } = require('./notification.controller');
const { authenticate } = require('../../shared/middleware/auth.middleware');

const router = Router();

router.use(authenticate);
router.get('/', list);

module.exports = router;
