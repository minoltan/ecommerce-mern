const { Router } = require('express');
const { register, login, getMe } = require('./user.controller');
const { authenticate } = require('../../shared/middleware/auth.middleware');
const { validate } = require('../../shared/middleware/validate.middleware');
const { registerSchema, loginSchema } = require('./user.schema');

const router = Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.get('/me', authenticate, getMe);

module.exports = router;
