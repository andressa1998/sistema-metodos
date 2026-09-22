'use strict';

const express = require('express');

const {
    iniciarLoginInterativo,
    obterStatusInterativo,
    obterFrame,
    clicar,
    rolar,
    digitar,
    tecla,
    fecharLoginInterativo
} = require('../services/soc-portal-login-interativo');

const router = express.Router();

function tokenReq(req) {
    return String(req.query?.token || req.body?.token || '');
}

function erroHttp(res, error) {
    const codigo = error?.code || 'ERRO_LOGIN_INTERATIVO_SOC';

    const status =
        codigo === 'SESSAO_INTERATIVA_INVALIDA'
            ? 404
            : 500;

    return res.status(status).json({
        success: false,
        code: codigo,
        error: error?.message || String(error)
    });
}

router.post('/portal-remoto/login-interativo/iniciar', async (req, res) => {
    try {
        return res.json(await iniciarLoginInterativo());
    } catch (error) {
        return erroHttp(res, error);
    }
});

router.get('/portal-remoto/login-interativo/status', async (req, res) => {
    try {
        return res.json(await obterStatusInterativo(tokenReq(req)));
    } catch (error) {
        return erroHttp(res, error);
    }
});

router.get('/portal-remoto/login-interativo/frame', async (req, res) => {
    try {
        const buffer = await obterFrame(tokenReq(req));

        res.set('Cache-Control', 'no-store, max-age=0');
        res.type('image/jpeg');

        return res.send(buffer);

    } catch (error) {
        return erroHttp(res, error);
    }
});

router.post('/portal-remoto/login-interativo/click', async (req, res) => {
    try {
        return res.json(await clicar(tokenReq(req), req.body || {}));
    } catch (error) {
        return erroHttp(res, error);
    }
});

router.post('/portal-remoto/login-interativo/scroll', async (req, res) => {
    try {
        return res.json(await rolar(tokenReq(req), req.body || {}));
    } catch (error) {
        return erroHttp(res, error);
    }
});

router.post('/portal-remoto/login-interativo/type', async (req, res) => {
    try {
        return res.json(await digitar(tokenReq(req), req.body || {}));
    } catch (error) {
        return erroHttp(res, error);
    }
});

router.post('/portal-remoto/login-interativo/key', async (req, res) => {
    try {
        return res.json(await tecla(tokenReq(req), req.body || {}));
    } catch (error) {
        return erroHttp(res, error);
    }
});

router.post('/portal-remoto/login-interativo/fechar', async (req, res) => {
    try {
        return res.json(await fecharLoginInterativo(tokenReq(req)));
    } catch (error) {
        return erroHttp(res, error);
    }
});

module.exports = router;
