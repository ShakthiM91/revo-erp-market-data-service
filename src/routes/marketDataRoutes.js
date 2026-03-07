const express = require('express');
const { getPrice, getHistory, refresh, getSymbols } = require('../controllers/marketDataController');
const { requireInternalToken } = require('../middleware/requireInternalOrAuth');

const router = express.Router();

router.get('/symbols', getSymbols);
router.get('/price/:ticker', getPrice);
router.get('/history/:ticker', getHistory);
router.post('/refresh', requireInternalToken, refresh);

module.exports = router;
