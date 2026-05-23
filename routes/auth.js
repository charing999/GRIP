const { Router } = require('express');
const router = Router();
const sqliDetect  = require('../middleware/sqliDetect.middleware');
const rateLimit   = require('../middleware/rateLimit.middleware');
const authMiddle  = require('../middleware/auth.middleware');
const { register, login, logout } = require('../controllers/auth.controller');

router.post('/register', register);
router.post('/login', rateLimit, sqliDetect, login);
router.post('/logout', authMiddle, logout);

module.exports = router;
