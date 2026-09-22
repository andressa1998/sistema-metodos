'use strict';

const crypto = require('crypto');

const {
    salvarSessaoSocPortal,
    limparSessaoSocPortal,
    statusSessaoSocPortal
} = require('./soc-portal-session-store');

function env(name, fallback = '') {
    const value = process.env[name];
    return value === undefined || value === null || value === ''
        ? fallback
        : String(value).trim();
}

function criarErro(codigo, mensagem, detalhes = null) {
    const erro = new Error(mensagem);
    erro.code = codigo;
    erro.detalhes = detalhes;
    return erro;
}

function resumoUrl(url) {
    try {
        const parsed = new URL(url);

        return {
            host: parsed.hostname,
            path: parsed.pathname
        };
    } catch (_) {
        return {
            host: '',
            path: ''
        };
    }
}

async function locatorVisivel(locator) {
    try {
        return await locator.first().isVisible({ timeout: 800 });
    } catch (_) {
        return false;
    }
}

/*
 * Mesma heurística usada no navegador remoto (VNC): a tela de login
 * tem o campo #usu. Assim que o login é concluído, a SPA troca de
 * tela e esse campo some do DOM (a URL não muda, é tudo client-side
 * routing).
 */
async function estaAutenticadoSoc(page) {
    try {
        const campoLogin = page.locator('#usu');
        const existe = await campoLogin.count();

        if (existe > 0 && await locatorVisivel(campoLogin)) {
            return false;
        }
    } catch (_) {}

    return true;
}

let sessaoAtual = null;

async function fecharInterno() {
    const atual = sessaoAtual;
    sessaoAtual = null;

    if (!atual) return;

    try {
        if (atual.context) await atual.context.close();
    } catch (_) {}

    try {
        if (atual.browser) await atual.browser.close();
    } catch (_) {}
}

function validarToken(token) {
    return Boolean(sessaoAtual && token && sessaoAtual.token === token);
}

async function preencherLoginAutomatico(page) {
    const usuario = env('SOC_PORTAL_USERNAME');
    const senha = env('SOC_PORTAL_PASSWORD');
    const id = env('SOC_PORTAL_ID');

    if (!usuario && !senha && !id) return;

    try {
        if (usuario) await page.fill('#usu', usuario, { timeout: 3000 });
        if (id) await page.fill('#empsoc', id, { timeout: 3000 });
        if (senha) await page.fill('#senha', senha, { timeout: 3000 });
    } catch (error) {
        console.warn('⚠️ [SOC login interativo] Não foi possível pré-preencher o login:', error.message);
    }
}

async function abrirSoc(page) {
    const loginUrl = env('SOC_PORTAL_URL', 'https://sistema.soc.com.br/WebSoc/');

    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    await page.waitForTimeout(900);

    if (await estaAutenticadoSoc(page)) {
        return;
    }

    await preencherLoginAutomatico(page);
}

async function salvarAutenticacaoAtual() {
    if (!sessaoAtual?.context || !sessaoAtual?.page) {
        return false;
    }

    const { context, page } = sessaoAtual;

    if (!await estaAutenticadoSoc(page)) {
        return false;
    }

    const storageState = await context.storageState();

    salvarSessaoSocPortal(
        storageState,
        {
            origem: 'login_interativo_soc',
            titulo: await page.title().catch(() => ''),
            url: page.url()
        }
    );

    sessaoAtual.autenticada = true;
    sessaoAtual.etapa = 'AUTENTICADO';

    return true;
}

async function iniciarLoginInterativo() {
    await fecharInterno();

    let playwright;

    try {
        playwright = require('playwright');
    } catch (_) {
        throw criarErro('PLAYWRIGHT_NAO_INSTALADO', 'Playwright não está instalado.');
    }

    limparSessaoSocPortal();

    const browser = await playwright.chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const context = await browser.newContext({
        locale: 'pt-BR',
        viewport: { width: 1365, height: 768 },
        ignoreHTTPSErrors: false
    });

    const page = await context.newPage();

    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(90000);

    const token = crypto.randomBytes(24).toString('hex');

    sessaoAtual = {
        token,
        browser,
        context,
        page,
        criadaEm: Date.now(),
        autenticada: false,
        ultimoErro: null,
        etapa: 'ABRINDO_SOC'
    };

    try {
        await abrirSoc(page);

        if (await estaAutenticadoSoc(page)) {
            await salvarAutenticacaoAtual();
        } else {
            sessaoAtual.etapa = 'AGUARDANDO_USUARIO';
        }
    } catch (error) {
        sessaoAtual.ultimoErro = error?.message || String(error);
        sessaoAtual.etapa = 'ERRO';
    }

    return {
        success: true,
        token,
        status: await obterStatusInterativo(token)
    };
}

async function obterStatusInterativo(token) {
    if (!validarToken(token)) {
        throw criarErro('SESSAO_INTERATIVA_INVALIDA', 'Sessão interativa não encontrada ou expirada.');
    }

    const { page } = sessaoAtual;

    if (!sessaoAtual.autenticada) {
        await salvarAutenticacaoAtual();
    }

    const url = page?.url?.() || '';

    return {
        success: true,
        autenticada: Boolean(sessaoAtual.autenticada),
        etapa: sessaoAtual.etapa,
        ultimoErro: sessaoAtual.ultimoErro,
        pagina: {
            ...resumoUrl(url),
            titulo: await page.title().catch(() => '')
        },
        sessaoRobo: statusSessaoSocPortal()
    };
}

async function obterFrame(token) {
    if (!validarToken(token)) {
        throw criarErro('SESSAO_INTERATIVA_INVALIDA', 'Sessão interativa inválida.');
    }

    return await sessaoAtual.page.screenshot({ type: 'jpeg', quality: 72 });
}

async function clicar(token, payload = {}) {
    if (!validarToken(token)) {
        throw criarErro('SESSAO_INTERATIVA_INVALIDA', 'Sessão interativa inválida.');
    }

    const page = sessaoAtual.page;

    const viewport = page.viewportSize() || { width: 1365, height: 768 };

    const displayWidth = Number(payload.displayWidth) || viewport.width;
    const displayHeight = Number(payload.displayHeight) || viewport.height;

    const x = Math.max(0, Math.min(
        viewport.width,
        (Number(payload.x) || 0) * viewport.width / displayWidth
    ));

    const y = Math.max(0, Math.min(
        viewport.height,
        (Number(payload.y) || 0) * viewport.height / displayHeight
    ));

    await page.mouse.click(x, y);

    await page.waitForTimeout(250);

    return obterStatusInterativo(token);
}

async function rolar(token, payload = {}) {
    if (!validarToken(token)) {
        throw criarErro('SESSAO_INTERATIVA_INVALIDA', 'Sessão interativa inválida.');
    }

    await sessaoAtual.page.mouse.wheel(
        Number(payload.deltaX) || 0,
        Number(payload.deltaY) || 0
    );

    return { success: true };
}

async function digitar(token, payload = {}) {
    if (!validarToken(token)) {
        throw criarErro('SESSAO_INTERATIVA_INVALIDA', 'Sessão interativa inválida.');
    }

    const texto = String(payload.text || '');

    if (texto.length > 1000) {
        throw criarErro('TEXTO_MUITO_LONGO', 'Texto excede o limite permitido.');
    }

    await sessaoAtual.page.keyboard.type(texto, { delay: 25 });

    return { success: true };
}

async function tecla(token, payload = {}) {
    if (!validarToken(token)) {
        throw criarErro('SESSAO_INTERATIVA_INVALIDA', 'Sessão interativa inválida.');
    }

    const permitidas = new Set([
        'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'
    ]);

    const key = String(payload.key || '');

    if (!permitidas.has(key)) {
        throw criarErro('TECLA_NAO_PERMITIDA', 'Tecla não permitida.');
    }

    await sessaoAtual.page.keyboard.press(key);

    return { success: true };
}

async function fecharLoginInterativo(token) {
    if (token && !validarToken(token)) {
        throw criarErro('SESSAO_INTERATIVA_INVALIDA', 'Sessão interativa inválida.');
    }

    await fecharInterno();

    return { success: true };
}

module.exports = {
    iniciarLoginInterativo,
    obterStatusInterativo,
    obterFrame,
    clicar,
    rolar,
    digitar,
    tecla,
    fecharLoginInterativo
};
