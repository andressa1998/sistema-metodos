'use strict';

/*
 * Baixa o PDF do ASO diretamente do portal do SOC (SOCGED), usando a
 * sessão autenticada salva pelo navegador remoto (soc-portal-session-store),
 * e extrai nome/CRM do médico a partir da assinatura digital no rodapé
 * do PDF (aso-assinatura-extrator.js), para usar como fallback quando o
 * ExportaDadosWs devolve um médico genérico/placeholder.
 *
 * NOTA: a navegação até a tela do SOCGED (busca por nome do arquivo,
 * abrir o popup "Download de Arquivos", disparar o download) foi
 * mapeada por observação manual da tela e ainda não foi validada
 * ponta a ponta contra uma sessão real — os seletores abaixo são o
 * melhor mapeamento possível a partir do que foi visto e podem
 * precisar de ajuste fino no primeiro teste ao vivo.
 */

const { obterStorageStateSocPortal } = require('./soc-portal-session-store');
const { extrairAssinaturaDigitalDoPdf } = require('./aso-assinatura-extrator');

function env(name, fallback = '') {
    const value = process.env[name];
    return value === undefined || value === null || value === ''
        ? fallback
        : String(value).trim();
}

function criarErro(code, message, details = null) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
}

async function abrirPaginaComSessao() {
    const storageState = obterStorageStateSocPortal();

    if (!storageState) {
        throw criarErro(
            'SOC_PORTAL_SEM_SESSAO',
            'Não há sessão autenticada do portal do SOC. Conecte o navegador remoto do SOC primeiro.'
        );
    }

    const { chromium } = require('playwright');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    return { browser, context, page };
}

/*
 * Navega até a tela de busca do SOCGED (módulo de documentos).
 * Tenta uma URL direta configurável primeiro; se não configurada,
 * tenta o caminho padrão observado (cadIFrame!execute.action).
 */
async function navegarAteSocged(page) {
    const urlDireta = env('SOC_PORTAL_SOCGED_URL');
    const urlBase = env('SOC_PORTAL_URL', 'https://sistema.soc.com.br/WebSoc/');

    const destino = urlDireta || (urlBase.replace(/\/$/, '') + '/cadIFrame!execute.action');

    await page.goto(destino, { waitUntil: 'networkidle', timeout: 30000 });
}

/*
 * Busca o documento no SOCGED pelo nome exato do arquivo (já conhecido
 * via ExportaDadosWs GED, campo NM_ARQUIVOS_GED) e abre o popup de
 * download, retornando o(s) link(s) "javascript:download(...)" achados.
 */
async function buscarLinksDownload(page, nomeArquivo) {
    // Seleciona o filtro de busca "Nome do Arquivo".
    try {
        await page.getByText('Nome do Arquivo', { exact: false }).first().click({ timeout: 5000 });
    } catch (_) {
        // Segue mesmo se não conseguir clicar no rótulo do radio; o campo de busca genérico pode bastar.
    }

    const campoBusca = page.locator('input[type="text"]').first();
    await campoBusca.fill(nomeArquivo, { timeout: 10000 });
    await campoBusca.press('Enter');

    await page.waitForTimeout(1500);

    // Abre o primeiro resultado da lista (linha da tabela de documentos).
    const linhaResultado = page.getByText(nomeArquivo, { exact: false }).first();
    await linhaResultado.click({ timeout: 10000 });

    // Aguarda o popup "Download de Arquivos".
    await page.getByText('Download de Arquivos', { exact: false }).waitFor({ timeout: 10000 });

    const links = await page.locator('a[href^="javascript:download("]').evaluateAll(
        elementos => elementos.map(el => ({
            texto: el.textContent.trim(),
            href: el.getAttribute('href')
        }))
    );

    return links;
}

async function baixarViaEventoDeDownload(page, linkTexto) {
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }),
        page.getByText(linkTexto, { exact: false }).first().click()
    ]);

    const streamPath = await download.path();

    if (!streamPath) {
        throw criarErro('SOC_PORTAL_DOWNLOAD_SEM_ARQUIVO', 'O download não gerou um arquivo local.');
    }

    const fs = require('fs');
    return fs.readFileSync(streamPath);
}

/*
 * Fluxo completo: dado o nome exato do arquivo do GED (já obtido via
 * ExportaDadosWs), baixa o PDF do SOCGED e extrai nome/CRM do médico
 * da assinatura digital.
 */
async function obterMedicoViaPdfAso({ nomeArquivoGed }) {
    if (!nomeArquivoGed) {
        throw criarErro('SOC_PORTAL_ARQUIVO_NAO_INFORMADO', 'Nome do arquivo do GED não informado.');
    }

    let sessao;

    try {
        sessao = await abrirPaginaComSessao();

        await navegarAteSocged(sessao.page);

        const links = await buscarLinksDownload(sessao.page, nomeArquivoGed);

        if (!links.length) {
            throw criarErro('SOC_PORTAL_ARQUIVO_NAO_ENCONTRADO', `Nenhum arquivo encontrado no SOCGED para "${nomeArquivoGed}".`);
        }

        const alvo = links.find(l => l.texto.includes(nomeArquivoGed)) || links[0];

        const bufferPdf = await baixarViaEventoDeDownload(sessao.page, alvo.texto);

        const assinatura = await extrairAssinaturaDigitalDoPdf(bufferPdf);

        if (!assinatura) {
            return null;
        }

        return {
            nome: assinatura.nome,
            crm: assinatura.crm
        };

    } finally {
        try {
            if (sessao?.browser) await sessao.browser.close();
        } catch (_) {}
    }
}

module.exports = {
    obterMedicoViaPdfAso
};
