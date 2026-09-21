'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const {
    salvarSessaoSocPortal,
    statusSessaoSocPortal
} = require('./soc-portal-session-store');

/*
 * Portas/telas diferentes das usadas pelo navegador remoto do eSocial
 * (esocial-navegador-remoto.js) para os dois poderem rodar ao mesmo tempo
 * no mesmo processo sem colidir.
 */
const DISPLAY = ':98';
const VNC_PORT = 5901;
const CDP_PORT = 9223;

let sessaoAtual = null;
let infra = {
    xvfb: null,
    fluxbox: null,
    x11vnc: null
};

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

function processoVivo(proc) {
    return Boolean(
        proc &&
        proc.pid &&
        proc.exitCode === null &&
        !proc.killed
    );
}

function matarProcesso(proc) {
    if (!proc || !proc.pid) return;

    try {
        proc.kill('SIGTERM');
    } catch (_) {}

    setTimeout(() => {
        try {
            if (proc.exitCode === null) {
                proc.kill('SIGKILL');
            }
        } catch (_) {}
    }, 2500).unref();
}

function spawnLogado(nome, comando, args, opcoes = {}) {
    console.log(
        `🖥️ [SOC remoto] Iniciando ${nome}:`,
        comando,
        args.join(' ')
    );

    const proc = spawn(
        comando,
        args,
        {
            stdio: ['ignore', 'pipe', 'pipe'],
            ...opcoes
        }
    );

    proc.stdout?.on('data', chunk => {
        const texto = chunk.toString('utf8').trim();
        if (texto) console.log(`🖥️ [${nome}]`, texto.slice(0, 1200));
    });

    proc.stderr?.on('data', chunk => {
        const texto = chunk.toString('utf8').trim();
        if (texto) console.log(`🖥️ [${nome}]`, texto.slice(0, 1200));
    });

    proc.on('exit', (code, signal) => {
        console.log(`🖥️ [SOC remoto] ${nome} encerrou.`, { code, signal });
    });

    return proc;
}

function aguardar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function comTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => {
                reject(criarErro('TIMEOUT', `Tempo esgotado esperando: ${label}.`));
            }, ms);
        })
    ]);
}

async function aguardarPorta(host, porta, timeoutMs = 15000) {
    const inicio = Date.now();

    while (Date.now() - inicio < timeoutMs) {
        const ok = await new Promise(resolve => {
            const socket = net.createConnection({ host, port: porta });

            const finalizar = value => {
                try { socket.destroy(); } catch (_) {}
                resolve(value);
            };

            socket.setTimeout(800);
            socket.once('connect', () => finalizar(true));
            socket.once('timeout', () => finalizar(false));
            socket.once('error', () => finalizar(false));
        });

        if (ok) return true;

        await aguardar(300);
    }

    return false;
}

async function aguardarCdp(timeoutMs = 20000) {
    const inicio = Date.now();

    while (Date.now() - inicio < timeoutMs) {
        const ok = await new Promise(resolve => {
            const req = http.get(
                `http://127.0.0.1:${CDP_PORT}/json/version`,
                response => {
                    let body = '';
                    response.on('data', chunk => { body += chunk.toString('utf8'); });
                    response.on('end', () => {
                        try {
                            const data = JSON.parse(body);
                            resolve(Boolean(data.webSocketDebuggerUrl));
                        } catch (_) {
                            resolve(false);
                        }
                    });
                }
            );

            req.setTimeout(2500, () => { req.destroy(); resolve(false); });
            req.on('error', () => resolve(false));
        });

        if (ok) return true;

        await aguardar(500);
    }

    return false;
}

function garantirBinario(nome) {
    const teste = spawnSync('sh', ['-lc', `command -v ${nome}`], { encoding: 'utf8' });

    if (teste.status !== 0) {
        throw criarErro(
            'BINARIO_NAO_ENCONTRADO',
            `O binário "${nome}" não está instalado. Use o Dockerfile da V10.`
        );
    }

    return teste.stdout.trim();
}

async function garantirInfraGrafica() {
    console.log('🖥️ [SOC remoto] garantirInfraGrafica: checando binários...');

    garantirBinario('Xvfb');
    garantirBinario('x11vnc');
    garantirBinario('fluxbox');

    console.log('🖥️ [SOC remoto] garantirInfraGrafica: binários OK.', {
        xvfbVivo: processoVivo(infra.xvfb),
        fluxboxVivo: processoVivo(infra.fluxbox),
        x11vncVivo: processoVivo(infra.x11vnc)
    });

    if (!processoVivo(infra.xvfb)) {
        infra.xvfb = spawnLogado(
            'Xvfb',
            'Xvfb',
            [DISPLAY, '-screen', '0', '1600x1000x24', '-ac', '-nolisten', 'tcp'],
            { env: { ...process.env, DISPLAY } }
        );

        await aguardar(800);
        console.log('🖥️ [SOC remoto] Xvfb iniciado.');
    }

    if (!processoVivo(infra.fluxbox)) {
        infra.fluxbox = spawnLogado(
            'fluxbox',
            'fluxbox',
            [],
            { env: { ...process.env, DISPLAY } }
        );

        await aguardar(500);
        console.log('🖥️ [SOC remoto] fluxbox iniciado.');
    }

    if (!processoVivo(infra.x11vnc)) {
        infra.x11vnc = spawnLogado(
            'x11vnc',
            'x11vnc',
            [
                '-display', DISPLAY,
                '-localhost',
                '-forever',
                '-shared',
                '-nopw',
                '-rfbport', String(VNC_PORT),
                '-noxdamage',
                '-repeat',
                '-quiet'
            ],
            { env: { ...process.env, DISPLAY } }
        );

        const vncPronto = await aguardarPorta('127.0.0.1', VNC_PORT, 12000);

        if (!vncPronto) {
            throw criarErro(
                'VNC_NAO_INICIOU',
                'O servidor VNC não iniciou na porta interna esperada.'
            );
        }

        console.log('🖥️ [SOC remoto] x11vnc iniciado e respondendo na porta.', { vncPort: VNC_PORT });
    }
}

async function obterPaginaAtual() {
    if (!sessaoAtual?.cdpBrowser) return null;

    const contexts = sessaoAtual.cdpBrowser.contexts();

    for (const context of contexts) {
        const pages = context.pages();
        if (pages.length) return pages[pages.length - 1];
    }

    return null;
}

/*
 * Detecta se o portal do SOC está autenticado.
 *
 * Heurística: a tela de login tem os campos #usu / #senha / #empsoc.
 * Assim que o login é concluído, a SPA troca de tela e esses campos
 * somem do DOM (a URL não muda, é tudo client-side routing).
 */
let ultimoLogAutenticacaoSoc = 0;

async function estaAutenticadoSoc() {
    const page = await obterPaginaAtual();

    const logar = Date.now() - ultimoLogAutenticacaoSoc > 10000;

    if (logar) ultimoLogAutenticacaoSoc = Date.now();

    if (!page) {
        if (logar) console.log('🔎 [SOC remoto] estaAutenticadoSoc: nenhuma página encontrada.');
        return false;
    }

    let urlAtual = '';
    let tituloAtual = '';

    try {
        urlAtual = page.url();
        tituloAtual = await page.title().catch(() => '');
    } catch (_) {}

    let aindaNaLogin = 0;
    let visivel = false;

    try {
        const campoLogin = page.locator('#usu');
        aindaNaLogin = await campoLogin.count();

        if (aindaNaLogin > 0) {
            visivel = await campoLogin.first().isVisible({ timeout: 500 }).catch(() => false);
        }
    } catch (_) {}

    if (logar) {
        console.log('🔎 [SOC remoto] estaAutenticadoSoc:', {
            url: urlAtual,
            titulo: tituloAtual,
            campoLoginEncontrado: aindaNaLogin,
            campoLoginVisivel: visivel
        });
    }

    if (aindaNaLogin > 0 && visivel) {
        return false;
    }

    // Se não achou o campo de login (ou ele não está visível), considera
    // autenticado por exclusão (saiu da tela de login).
    return true;
}

async function preencherLoginAutomatico() {
    const page = await obterPaginaAtual();
    if (!page) return;

    const usuario = env('SOC_PORTAL_USERNAME');
    const senha = env('SOC_PORTAL_PASSWORD');
    const id = env('SOC_PORTAL_ID');

    if (!usuario && !senha && !id) return;

    try {
        if (usuario) await page.fill('#usu', usuario, { timeout: 3000 });
        if (id) await page.fill('#empsoc', id, { timeout: 3000 });
        if (senha) await page.fill('#senha', senha, { timeout: 3000 });

        console.log('🖥️ [SOC remoto] Login pré-preenchido. Aguardando o usuário resolver o captcha e confirmar.');
    } catch (error) {
        console.warn('⚠️ [SOC remoto] Não foi possível pré-preencher o login:', error.message);
    }
}

async function salvarSessaoAtual() {
    if (!sessaoAtual?.cdpBrowser) {
        throw criarErro('NAVEGADOR_NAO_INICIADO', 'O navegador remoto não está ativo.');
    }

    const autenticado = await estaAutenticadoSoc();

    if (!autenticado) {
        throw criarErro(
            'SOC_AINDA_NAO_AUTENTICADO',
            'O portal do SOC ainda não está autenticado. Conclua o login no navegador remoto.'
        );
    }

    const contexts = sessaoAtual.cdpBrowser.contexts();

    if (!contexts.length) {
        throw criarErro('CONTEXTO_CDP_NAO_ENCONTRADO', 'Não foi encontrado um contexto do navegador remoto.');
    }

    const context = contexts[0];
    const storageState = await context.storageState();
    const page = await obterPaginaAtual();

    salvarSessaoSocPortal(
        storageState,
        {
            origem: 'navegador_remoto_soc',
            titulo: page ? await page.title().catch(() => '') : '',
            url: page?.url?.() || ''
        }
    );

    sessaoAtual.autenticada = true;

    console.log('✅ [SOC remoto] Sessão autenticada salva para uso do robô.');

    return true;
}

async function encerrarNavegadorAtual({ manterSessao = true } = {}) {
    const atual = sessaoAtual;
    sessaoAtual = null;

    if (!atual) return;

    if (manterSessao && atual.cdpBrowser) {
        try {
            sessaoAtual = atual;
            await salvarSessaoAtual();
        } catch (_) {}
        sessaoAtual = null;
    }

    try {
        if (atual.cdpBrowser) await atual.cdpBrowser.close();
    } catch (_) {}

    matarProcesso(atual.chrome);

    try {
        fs.rmSync(atual.baseDir, { recursive: true, force: true });
    } catch (_) {}
}

/*
 * Subir Xvfb + fluxbox + x11vnc + Chromium leva perto de 1 minuto,
 * o que estoura o timeout do proxy do Render (~30s) se a gente
 * esperar tudo terminar antes de responder o POST /iniciar.
 *
 * Por isso o fluxo é: responde o token na hora, e continua montando
 * o navegador em segundo plano. O frontend fica consultando /status
 * (a cada 1.2s) até `pronta` virar true.
 */
async function prepararNavegadorEmSegundoPlano(token) {
    console.log('🖥️ [SOC remoto] prepararNavegadorEmSegundoPlano: iniciando...', { token: token.slice(0, 8) });

    try {
        await garantirInfraGrafica();

        const { chromium } = require('playwright');

        const chromiumPath = chromium.executablePath();

        if (!chromiumPath || !fs.existsSync(chromiumPath)) {
            throw criarErro(
                'CHROMIUM_NAO_ENCONTRADO',
                'O Chromium do Playwright não foi encontrado dentro do container Docker.'
            );
        }

        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soc-portal-remote-'));
        const homeDir = path.join(baseDir, 'home');
        const profileDir = path.join(baseDir, 'profile');

        fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 });
        fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });

        const loginUrl = env('SOC_PORTAL_URL', 'https://sistema.soc.com.br/WebSoc/');

        const args = [
            `--user-data-dir=${profileDir}`,
            `--remote-debugging-port=${CDP_PORT}`,
            '--remote-debugging-address=127.0.0.1',
            '--remote-allow-origins=*',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-session-crashed-bubble',
            '--password-store=basic',
            '--window-size=1500,900',
            '--start-maximized',
            loginUrl
        ];

        const chrome = spawnLogado(
            'Chromium remoto SOC',
            chromiumPath,
            args,
            { env: { ...process.env, DISPLAY, HOME: homeDir } }
        );

        console.log('🖥️ [SOC remoto] Aguardando porta CDP...');

        const cdpPronto = await aguardarCdp(60000);

        if (!cdpPronto) {
            matarProcesso(chrome);
            throw criarErro('CHROMIUM_CDP_NAO_INICIOU', 'O Chromium remoto abriu, mas a porta CDP não ficou disponível.');
        }

        console.log('🖥️ [SOC remoto] Porta CDP respondendo.');

        // A sessão pode ter sido cancelada enquanto isso rodava em segundo plano.
        if (!sessaoAtual || sessaoAtual.token !== token) {
            matarProcesso(chrome);
            return;
        }

        sessaoAtual.baseDir = baseDir;
        sessaoAtual.homeDir = homeDir;
        sessaoAtual.profileDir = profileDir;
        sessaoAtual.chrome = chrome;

        // A partir daqui o X11/VNC já tem o Chromium visível na tela - a
        // pessoa já pode ver e usar o navegador remoto mesmo que o Playwright
        // (CDP) ainda não tenha conectado. Não trava a tela nisso.
        sessaoAtual.telaPronta = true;

        console.log('🖥️ [SOC remoto] Tela pronta (VNC pode conectar).', { display: DISPLAY, vncPort: VNC_PORT });

        console.log('🖥️ [SOC remoto] Conectando via CDP (Playwright)...');

        const cdpBrowser = await comTimeout(
            chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`),
            15000,
            'connectOverCDP'
        );

        if (!sessaoAtual || sessaoAtual.token !== token) {
            try { await cdpBrowser.close(); } catch (_) {}
            return;
        }

        sessaoAtual.cdpBrowser = cdpBrowser;
        sessaoAtual.pronta = true;

        console.log('🖥️ [SOC remoto] Navegador remoto pronto (CDP conectado).', { display: DISPLAY, vncPort: VNC_PORT, cdpPort: CDP_PORT });

        // Dá um tempo para a página carregar antes de tentar pré-preencher.
        await aguardar(2500);
        await preencherLoginAutomatico();

    } catch (error) {
        console.error('❌ [SOC remoto] Falha ao preparar o navegador remoto:', error.message);

        if (sessaoAtual && sessaoAtual.token === token) {
            sessaoAtual.telaPronta = true;
            sessaoAtual.pronta = true;
            sessaoAtual.erro = error.message || String(error);
        }
    }
}

async function iniciarNavegadorRemoto() {
    if (sessaoAtual) {
        await encerrarNavegadorAtual({ manterSessao: false });
    }

    const token = crypto.randomBytes(32).toString('hex');

    sessaoAtual = {
        token,
        criadaEm: Date.now(),
        telaPronta: false,
        pronta: false,
        erro: null,
        autenticada: false
    };

    prepararNavegadorEmSegundoPlano(token);

    return {
        success: true,
        token,
        status: await statusNavegadorRemoto(token)
    };
}

function validarTokenNavegadorRemoto(token) {
    return Boolean(sessaoAtual && token && sessaoAtual.token === String(token));
}

async function statusNavegadorRemoto(token) {
    if (!validarTokenNavegadorRemoto(token)) {
        throw criarErro('SESSAO_REMOTA_INVALIDA', 'A sessão do navegador remoto não existe ou expirou.');
    }

    if (!sessaoAtual.pronta) {
        return {
            success: true,
            pronta: false,
            telaPronta: Boolean(sessaoAtual.telaPronta),
            erro: sessaoAtual.erro || null,
            autenticada: false,
            criadaEm: sessaoAtual.criadaEm,
            pagina: { host: '', path: '', titulo: 'Abrindo navegador remoto no servidor...' },
            sessaoRobo: statusSessaoSocPortal()
        };
    }

    if (sessaoAtual.erro) {
        return {
            success: true,
            pronta: true,
            erro: sessaoAtual.erro,
            autenticada: false,
            criadaEm: sessaoAtual.criadaEm,
            pagina: { host: '', path: '', titulo: 'Falha ao abrir o navegador remoto' },
            sessaoRobo: statusSessaoSocPortal()
        };
    }

    let autenticada = Boolean(sessaoAtual.autenticada);

    if (!autenticada) {
        autenticada = await estaAutenticadoSoc();

        if (autenticada) {
            await salvarSessaoAtual();
        }
    }

    const page = await obterPaginaAtual();

    return {
        success: true,
        pronta: true,
        erro: null,
        autenticada,
        criadaEm: sessaoAtual.criadaEm,
        pagina: {
            ...(page ? resumoUrl(page.url()) : { host: '', path: '' }),
            titulo: page ? await page.title().catch(() => '') : ''
        },
        sessaoRobo: statusSessaoSocPortal()
    };
}

async function finalizarNavegadorRemoto(token) {
    if (!validarTokenNavegadorRemoto(token)) {
        throw criarErro('SESSAO_REMOTA_INVALIDA', 'A sessão do navegador remoto não existe ou expirou.');
    }

    await salvarSessaoAtual();
    await encerrarNavegadorAtual({ manterSessao: false });

    return {
        success: true,
        sessaoRobo: statusSessaoSocPortal()
    };
}

async function cancelarNavegadorRemoto(token) {
    if (token && !validarTokenNavegadorRemoto(token)) {
        throw criarErro('SESSAO_REMOTA_INVALIDA', 'A sessão do navegador remoto não existe ou expirou.');
    }

    await encerrarNavegadorAtual({ manterSessao: false });

    return { success: true };
}

module.exports = {
    VNC_PORT,
    iniciarNavegadorRemoto,
    statusNavegadorRemoto,
    finalizarNavegadorRemoto,
    cancelarNavegadorRemoto,
    validarTokenNavegadorRemoto
};
