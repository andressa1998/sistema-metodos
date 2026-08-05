// ============================================================
// ROTA PARA PROCESSAR PLANILHA E-SOCIAL
// ============================================================

const express = require('express');
const router = express.Router();
const { getProcessadorReal } = require('../modules/processadorReal');
const { auth } = require('../middleware/auth');

// Processar planilha e enviar em lote
router.post('/processar-planilha', auth, async (req, res) => {
    try {
        const { funcionarios, tipo_evento, ambiente } = req.body;

        if (!funcionarios || !Array.isArray(funcionarios) || funcionarios.length === 0) {
            return res.status(400).json({ error: 'Nenhum funcionário para processar' });
        }

        if (!tipo_evento) {
            return res.status(400).json({ error: 'Tipo de evento não especificado' });
        }

        const processador = getProcessadorReal();
        if (!processador) {
            return res.status(500).json({ error: 'Processador não inicializado' });
        }

        const resultados = await processador.processarPlanilha(
            funcionarios,
            tipo_evento,
            ambiente || 'homologacao'
        );

        res.json({
            success: true,
            total: funcionarios.length,
            sucessos: resultados.filter(r => r.success).length,
            erros: resultados.filter(r => !r.success).length,
            resultados: resultados
        });

    } catch (error) {
        console.error('❌ Erro ao processar planilha:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;