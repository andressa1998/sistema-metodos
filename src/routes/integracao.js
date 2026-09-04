// src/routes/integracao.js
const express = require('express');
const router = express.Router();

router.post('/sync', async (req, res) => {
    try {
        // Simular sincronização
        res.json({
            success: true,
            message: 'Sincronização realizada com sucesso',
            criados: 0,
            atualizados: 0
        });
    } catch (error) {
        console.error('Erro na sincronização:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro na sincronização'
        });
    }
});

module.exports = router;