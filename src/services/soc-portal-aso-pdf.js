'use strict';

// Robô SOC código 611: empresa -> colaborador -> ASO -> ZIP -> PDF -> assinatura.
const fs = require('fs');
const AdmZip = require('adm-zip');
const { obterStorageStateSocPortal } = require('./soc-portal-session-store');
const { extrairAssinaturaDigitalDoPdf } = require('./aso-assinatura-extrator');

function erro(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
}

function scopes(page) {
    return [page, ...page.frames().filter(f => f !== page.mainFrame())];
}

async function visivel(page, factories, timeout = 15000) {
    const limite = Date.now() + timeout;
    while (Date.now() < limite) {
        for (const scope of scopes(page)) {
            for (const factory of factories) {
                const locator = factory(scope);
                const total = await locator.count().catch(() => 0);
                for (let i = 0; i < total; i += 1) {
                    const item = locator.nth(i);
                    if (await item.isVisible().catch(() => false)) return item;
                }
            }
        }
        await page.waitForTimeout(250);
    }
    return null;
}

async function abrirSessao() {
    const storageState = obterStorageStateSocPortal();
    if (!storageState) throw erro('SOC_SEM_SESSAO', 'Conecte e salve a sessão do SOC antes de buscar o ASO.');
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState, acceptDownloads: true });
    const page = await context.newPage();
    return { browser, page };
}

async function selecionarEmpresa(page, holding, unidade) {
    await page.goto(process.env.SOC_PORTAL_URL || 'https://sistema.soc.com.br/WebSoc/', {
        waitUntil: 'domcontentloaded', timeout: 45000
    });
    const campo = await visivel(page, [
        s => s.locator('input[placeholder*="Buscar empresa" i]'),
        s => s.locator('input[placeholder*="empresa" i]')
    ]);
    if (!campo) throw erro('SOC_EMPRESA_CAMPO', 'Campo "Buscar empresa" não encontrado.');
    await campo.fill(String(holding || unidade || '').trim());
    await page.waitForTimeout(1200);
    const alvo = await visivel(page, [
        s => s.getByText(unidade || holding, { exact: false }),
        s => s.locator('a, tr, li').filter({ hasText: holding })
    ], 8000);
    if (!alvo) throw erro('SOC_EMPRESA_NAO_ENCONTRADA', `Empresa da holding "${holding}" não encontrada.`);
    await alvo.click();
    await page.waitForTimeout(1200);
}

async function abrir611(page) {
    const menu = await visivel(page, [
        s => s.locator('[aria-label*="menu" i], .fa-bars, .glyphicon-menu-hamburger'),
        s => s.locator('button:has(i.fa-bars), a:has(i.fa-bars)')
    ]);
    if (!menu) throw erro('SOC_MENU_NAO_ENCONTRADO', 'Menu lateral não encontrado.');
    await menu.click();
    const busca = await visivel(page, [
        s => s.locator('input[placeholder*="pesquis" i]'),
        s => s.locator('input[type="search"]'),
        s => s.locator('input[type="text"]:visible').first()
    ]);
    if (!busca) throw erro('SOC_MENU_BUSCA', 'Pesquisa do menu não encontrada.');
    await busca.fill('611');
    await busca.press('Enter');
    await page.waitForTimeout(800);
    const socged = await visivel(page, [s => s.getByText('SOCGED', { exact: false })], 5000);
    if (socged) await socged.click();
    await page.waitForTimeout(1200);
}

async function pesquisar(page, nome) {
    const radio = await visivel(page, [
        s => s.getByLabel('Nome', { exact: true }),
        s => s.locator('input[type="radio"][value*="nome" i]')
    ], 5000);
    if (radio) await radio.check().catch(() => radio.click());
    const campo = await visivel(page, [
        s => s.locator('input[name*="busca" i], input[id*="busca" i]'),
        s => s.locator('input[type="text"]:visible').first()
    ]);
    if (!campo) throw erro('SOC_COLABORADOR_CAMPO', 'Campo de busca do colaborador não encontrado.');
    await campo.fill(nome);
    const lupa = await visivel(page, [
        s => s.locator('[title*="pesquis" i], .fa-search, .glyphicon-search')
    ], 3000);
    if (lupa) await lupa.click(); else await campo.press('Enter');
    await page.waitForTimeout(1400);
}

async function baixarAso(page) {
    let linha = null;
    for (const scope of scopes(page)) {
        const candidatas = scope.locator('tr').filter({ hasText: 'Atestado de Saúde Ocupacional - ASO' });
        if (await candidatas.count().catch(() => 0)) { linha = candidatas.first(); break; }
    }
    if (!linha) throw erro('SOC_ASO_NAO_ENCONTRADO', 'ASO não encontrado para o colaborador.');
    await linha.locator('a, button, img, input[type="image"]').last().click();
    const titulo = await visivel(page, [s => s.getByText('Download de Arquivos', { exact: false })], 10000);
    if (!titulo) throw erro('SOC_DOWNLOAD_POPUP', 'A janela de download do ASO não abriu.');
    const arquivo = await visivel(page, [
        s => s.locator('a[href*="download" i]').first(),
        s => s.locator('tr').filter({ hasText: '.pdf' }).first().locator('a, img').first()
    ], 8000);
    if (!arquivo) throw erro('SOC_DOWNLOAD_LINK', 'Nenhum PDF foi listado para download.');
    const espera = page.waitForEvent('download', { timeout: 30000 });
    await arquivo.click();
    const download = await espera;
    const caminho = await download.path();
    if (!caminho) throw erro('SOC_DOWNLOAD_VAZIO', 'O download do SOC não gerou arquivo.');
    return fs.readFileSync(caminho);
}

function extrairPdf(buffer) {
    if (buffer.subarray(0, 4).toString() === '%PDF') return buffer;
    const entrada = new AdmZip(buffer).getEntries()
        .find(item => !item.isDirectory && /\.pdf$/i.test(item.entryName));
    if (!entrada) throw erro('SOC_ZIP_SEM_PDF', 'O ZIP baixado não contém PDF.');
    return entrada.getData();
}

async function obterMedicoViaPdfAso({ holding, unidade, nomeColaborador, ufCrm } = {}) {
    if (!holding && !unidade) throw erro('SOC_EMPRESA_NAO_INFORMADA', 'Holding/unidade não informada.');
    if (!nomeColaborador) throw erro('SOC_COLABORADOR_NAO_INFORMADO', 'Nome do colaborador não informado.');
    let sessao;
    try {
        sessao = await abrirSessao();
        await selecionarEmpresa(sessao.page, holding, unidade);
        await abrir611(sessao.page);
        await pesquisar(sessao.page, nomeColaborador);
        const assinatura = await extrairAssinaturaDigitalDoPdf(extrairPdf(await baixarAso(sessao.page)));
        if (!assinatura) throw erro('SOC_ASSINATURA_NAO_ENCONTRADA', 'Nome e CRM não encontrados na assinatura do ASO.');
        return { ...assinatura, uf: String(ufCrm || '').trim().toUpperCase() };
    } finally {
        try { await sessao?.browser?.close(); } catch (_) {}
    }
}

module.exports = { obterMedicoViaPdfAso };
