// src/routes/certificados.js
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.json({ success: true, certificados: [] });
});

router.post('/', (req, res) => {
    res.json({ success: true, message: 'Certificado criado' });
});

module.exports = router;