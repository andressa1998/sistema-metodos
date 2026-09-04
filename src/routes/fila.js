// src/routes/fila.js
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.json({ success: true, fila: [] });
});

module.exports = router;