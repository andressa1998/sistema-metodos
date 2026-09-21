'use strict';

let sessao = null;

function salvarSessaoSocPortal(storageState, meta = {}) {
    if (!storageState || !Array.isArray(storageState.cookies)) {
        throw new Error('storageState inválido.');
    }

    sessao = {
        storageState,
        criadaEm: Date.now(),
        meta: {
            origem: meta.origem || 'navegador_remoto_soc',
            titulo: meta.titulo || '',
            url: meta.url || ''
        }
    };

    return {
        ativa: true,
        criadaEm: sessao.criadaEm
    };
}

function obterSessaoSocPortal() {
    if (!sessao) return null;

    const limiteMs =
        Number(process.env.SOC_PORTAL_SESSAO_MAX_MS) ||
        (2 * 60 * 60 * 1000);

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

function obterStorageStateSocPortal() {
    return obterSessaoSocPortal()?.storageState || null;
}

function limparSessaoSocPortal() {
    sessao = null;
}

function statusSessaoSocPortal() {
    const atual = obterSessaoSocPortal();

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
    salvarSessaoSocPortal,
    obterSessaoSocPortal,
    obterStorageStateSocPortal,
    limparSessaoSocPortal,
    statusSessaoSocPortal
};
