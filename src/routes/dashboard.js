// src/routes/dashboard.js
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.json({ success: true, dados: {} });
});

module.exports = router;