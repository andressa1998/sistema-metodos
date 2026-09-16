'use strict';

let sessao = null;

function salvarSessaoEsocial(storageState, meta = {}) {
    if (!storageState || !Array.isArray(storageState.cookies)) {
        throw new Error('storageState inválido.');
    }

    sessao = {
        storageState,
        criadaEm: Date.now(),
        meta: {
            origem: meta.origem || 'login_interativo',
            titulo: meta.titulo || '',
            url: meta.url || ''
        }
    };

    return {
        ativa: true,
        criadaEm: sessao.criadaEm
    };
}

function obterSessaoEsocial() {
    if (!sessao) return null;

    const limiteMs =
        Number(process.env.ESOCIAL_SESSAO_INTERATIVA_MAX_MS) ||
        (6 * 60 * 60 * 1000);

    if (
        Number.isFinite(limiteMs) &&
        limiteMs > 0 &&
        Date.now() - sessao.criadaEm > limiteMs
    ) {
        sessao = null;
        return null;
    }

    return sessao;
}

function obterStorageStateEsocial() {
    return obterSessaoEsocial()?.storageState || null;
}

function limparSessaoEsocial() {
    sessao = null;
}

function statusSessaoEsocial() {
    const atual = obterSessaoEsocial();

    if (!atual) {
        return {
            ativa: false,
            criadaEm: null
        };
    }

    return {
        ativa: true,
        criadaEm: atual.criadaEm,
        meta: atual.meta
    };
}

module.exports = {
    salvarSessaoEsocial,
    obterSessaoEsocial,
    obterStorageStateEsocial,
    limparSessaoEsocial,
    statusSessaoEsocial
};
