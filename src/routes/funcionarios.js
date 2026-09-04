// src/routes/funcionarios.js
const express = require('express');
const router = express.Router();

// Rota placeholder
router.get('/', (req, res) => {
    res.json({ success: true, message: 'Funcionários - Em desenvolvimento' });
});

module.exports = router;