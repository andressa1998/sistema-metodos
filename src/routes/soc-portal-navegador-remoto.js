'use strict';

const express = require('express');

const {
    iniciarNavegadorRemoto,
    statusNavegadorRemoto,
    finalizarNavegadorRemoto,
    cancelarNavegadorRemoto
} = require('../services/soc-portal-navegador-remoto');

const router = express.Router();

function tokenReq(req) {
    return String(req.query?.token || req.body?.token || '');
}

function responderErro(res, error) {
    const code = error?.code || 'ERRO_NAVEGADOR_REMOTO_SOC';

    const status =
        code === 'SESSAO_REMOTA_INVALIDA'
            ? 404
            : (code === 'SOC_AINDA_NAO_AUTENTICADO' ? 409 : 500);

    console.error('❌ [SOC remoto]', code, error?.message || error);

    return res.status(status).json({
        success: false,
        code,
        error: error?.message || String(error)
    });
}

router.post('/portal-remoto/navegador-remoto/iniciar', async (req, res) => {
    try {
        return res.json(await iniciarNavegadorRemoto());
    } catch (error) {
        return responderErro(res, error);
    }
});

router.get('/portal-remoto/navegador-remoto/status', async (req, res) => {
    try {
        return res.json(await statusNavegadorRemoto(tokenReq(req)));
    } catch (error) {
        return responderErro(res, error);
    }
});

router.post('/portal-remoto/navegador-remoto/finalizar', async (req, res) => {
    try {
        return res.json(await finalizarNavegadorRemoto(tokenReq(req)));
    } catch (error) {
        return responderErro(res, error);
    }
});

router.post('/portal-remoto/navegador-remoto/cancelar', async (req, res) => {
    try {
        return res.json(await cancelarNavegadorRemoto(tokenReq(req)));
    } catch (error) {
        return responderErro(res, error);
    }
});

module.exports = router;
