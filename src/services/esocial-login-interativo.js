'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

const {
    salvarSessaoEsocial,
    limparSessaoEsocial,
    statusSessaoEsocial
} = require('./esocial-session-store');

function env(name, fallback = '') {
    const value = process.env[name];
    return value === undefined || value === null || value === ''
        ? fallback
        : String(value).trim();
}

function envNumber(name, fallback) {
    const value = Number(env(name, ''));
    return Number.isFinite(value) && value > 0 ? value : fallback;
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

function executarBridgePython(payload, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        const pythonBin = env('ESOCIAL_PYTHON_BIN', 'python3');

        const scriptPath = env(
            'ESOCIAL_CERT_BRIDGE_PATH',
            path.join(
                __dirname,
                '..',
                'python',
                'esocial_cert_bridge.py'
            )
        );

        const raizProjeto =
            path.resolve(
                __dirname,
                '..',
                '..'
            );

        const pacotesPython =
            path.join(
                raizProjeto,
                '.python-packages'
            );

        const pythonPathAtual =
            process.env.PYTHONPATH || '';

        const pythonPath =
            [
                pacotesPython,
                pythonPathAtual
            ]
                .filter(Boolean)
                .join(path.delimiter);

        const filho = spawn(
            pythonBin,
            [scriptPath],
            {
                cwd: raizProjeto,
                env: {
                    ...process.env,
                    PYTHONPATH: pythonPath
                },
                stdio: ['pipe', 'pipe', 'pipe']
            }
        );

        let stdout = '';
        let stderr = '';
        let terminou = false;

        const timer = setTimeout(
            () => {
                if (terminou) return;

                terminou = true;

                try {
                    filho.kill('SIGKILL');
                } catch (_) {}

                reject(
                    criarErro(
                        'TIMEOUT_BRIDGE_PYTHON',
                        'O bridge Python excedeu o tempo limite.'
                    )
                );
            },
            timeoutMs
        );

        filho.stdout.on(
            'data',
            chunk => {
                stdout += chunk.toString('utf8');
            }
        );

        filho.stderr.on(
            'data',
            chunk => {
                stderr += chunk.toString('utf8');
            }
        );

        filho.on(
            'error',
            error => {
                if (terminou) return;

                terminou = true;
                clearTimeout(timer);

                reject(
                    criarErro(
                        'PYTHON_NAO_INICIADO',
                        `Não foi possível iniciar o Python: ${error.message}`
                    )
                );
            }
        );

        filho.on(
            'close',
            code => {
                if (terminou) return;

                terminou = true;
                clearTimeout(timer);

                let parsed = null;

                try {
                    parsed = JSON.parse(stdout.trim());
                } catch (_) {}

                if (!parsed) {
                    return reject(
                        criarErro(
                            'BRIDGE_RESPOSTA_INVALIDA',
                            'O bridge Python retornou uma resposta inválida.',
                            {
                                code,
                                stderr: stderr
                                    .replace(/\s+/g, ' ')
                                    .trim()
                                    .slice(0, 600)
                            }
                        )
                    );
                }

                resolve(parsed);
            }
        );

        try {
            filho.stdin.end(
                JSON.stringify(payload)
            );
        } catch (error) {
            clearTimeout(timer);

            try {
                filho.kill('SIGKILL');
            } catch (_) {}

            reject(error);
        }
    });
}

async function locatorVisivel(locator) {
    try {
        return await locator.first().isVisible({
            timeout: 800
        });
    } catch (_) {
        return false;
    }
}

async function estaAutenticado(page) {
    const sinais = [
        page.getByText(/Trocar Perfil\/Módulo/i),
        page.getByText(/Trocar Perfil/i),
        page.getByText(/Titular do Certificado/i),
        page.getByRole(
            'button',
            { name: /SAIR/i }
        )
    ];

    for (const sinal of sinais) {
        if (await locatorVisivel(sinal)) {
            return true;
        }
    }

    return false;
}

let sessaoAtual = null;

async function fecharInterno() {
    const atual = sessaoAtual;
    sessaoAtual = null;

    if (!atual) return;

    try {
        if (atual.context) {
            await atual.context.close();
        }
    } catch (_) {}

    try {
        if (atual.browser) {
            await atual.browser.close();
        }
    } catch (_) {}
}

function validarToken(token) {
    return Boolean(
        sessaoAtual &&
        token &&
        sessaoAtual.token === token
    );
}

async function instalarCapturaSubmit(page) {
    await page.addInitScript(() => {
        window.__WT_ESOCIAL_CERT_SUBMIT__ = null;

        document.addEventListener(
            'submit',
            event => {
                try {
                    const submitter = event.submitter;

                    const ehCertificado =
                        submitter &&
                        (
                            submitter.id === 'login-certificate' ||
                            submitter.value === 'login-certificate'
                        );

                    if (!ehCertificado) {
                        return;
                    }

                    // A pessoa realizou a interação no gov.br.
                    // Bloqueamos somente a navegação que abriria a janela nativa
                    // do certificado; não resolvemos captcha nem 2FA.
                    event.preventDefault();

                    const form = event.target;
                    const fd = new FormData(form);

                    if (submitter.name) {
                        fd.append(
                            submitter.name,
                            submitter.value || ''
                        );
                    }

                    const params = new URLSearchParams();
                    const nomesCampos = [];

                    for (const [nome, valor] of fd.entries()) {
                        nomesCampos.push(String(nome));

                        params.append(
                            String(nome),
                            typeof valor === 'string'
                                ? valor
                                : ''
                        );
                    }

                    window.__WT_ESOCIAL_CERT_SUBMIT__ = {
                        url:
                            submitter.formAction ||
                            form.action ||
                            '',
                        method:
                            (
                                submitter.formMethod ||
                                form.method ||
                                'post'
                            ).toUpperCase(),
                        body: params.toString(),
                        fieldNames:
                            Array.from(
                                new Set(nomesCampos)
                            ),
                        createdAt:
                            Date.now()
                    };
                } catch (_) {}
            },
            true
        );
    });
}

async function abrirGovBr(page) {
    const loginUrl = env(
        'ESOCIAL_RELATORIOS_LOGIN_URL',
        'https://login.esocial.gov.br/login.aspx'
    );

    await page.goto(
        loginUrl,
        {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        }
    );

    await page.waitForTimeout(900);

    if (await estaAutenticado(page)) {
        return;
    }

    const candidatos = [
        page.getByRole(
            'button',
            { name: /Entrar com gov\.br/i }
        ),
        page.getByRole(
            'link',
            { name: /Entrar com gov\.br/i }
        ),
        page.getByText(
            /Entrar com gov\.br/i
        )
    ];

    for (const item of candidatos) {
        try {
            const primeiro = item.first();

            if (
                await primeiro.isVisible({
                    timeout: 1200
                })
            ) {
                await primeiro.click({
                    timeout: 10000
                });

                await page.waitForTimeout(1200);
                return;
            }
        } catch (_) {}
    }
}

async function iniciarLoginInterativo() {
    await fecharInterno();

    let playwright;

    try {
        playwright = require('playwright');
    } catch (_) {
        throw criarErro(
            'PLAYWRIGHT_NAO_INSTALADO',
            'Playwright não está instalado.'
        );
    }

    limparSessaoEsocial();

    const browser =
        await playwright.chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

    const context =
        await browser.newContext({
            locale: 'pt-BR',
            viewport: {
                width: 1365,
                height: 768
            },
            ignoreHTTPSErrors: false
        });

    const page =
        await context.newPage();

    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(90000);

    await instalarCapturaSubmit(page);

    const token =
        crypto
            .randomBytes(24)
            .toString('hex');

    sessaoAtual = {
        token,
        browser,
        context,
        page,
        criadaEm: Date.now(),
        processandoCertificado: false,
        autenticada: false,
        ultimoErro: null,
        etapa: 'ABRINDO_GOVBR'
    };

    try {
        await abrirGovBr(page);

        if (await estaAutenticado(page)) {
            await salvarAutenticacaoAtual();
        } else {
            sessaoAtual.etapa =
                'AGUARDANDO_USUARIO';
        }
    } catch (error) {
        sessaoAtual.ultimoErro =
            error?.message ||
            String(error);

        sessaoAtual.etapa = 'ERRO';
    }

    return {
        success: true,
        token,
        status:
            await obterStatusInterativo(token)
    };
}

async function obterSubmitPendente(page) {
    try {
        return await page.evaluate(
            () =>
                window.__WT_ESOCIAL_CERT_SUBMIT__ ||
                null
        );
    } catch (_) {
        return null;
    }
}

async function limparSubmitPendente(page) {
    try {
        await page.evaluate(
            () => {
                window.__WT_ESOCIAL_CERT_SUBMIT__ = null;
            }
        );
    } catch (_) {}
}

async function salvarAutenticacaoAtual() {
    if (
        !sessaoAtual ||
        !sessaoAtual.context ||
        !sessaoAtual.page
    ) {
        return false;
    }

    const {
        context,
        page
    } = sessaoAtual;

    if (!await estaAutenticado(page)) {
        return false;
    }

    const storageState =
        await context.storageState();

    salvarSessaoEsocial(
        storageState,
        {
            origem: 'login_interativo',
            titulo:
                await page.title().catch(() => ''),
            url: page.url()
        }
    );

    sessaoAtual.autenticada = true;
    sessaoAtual.etapa = 'AUTENTICADO';

    return true;
}

async function processarSubmitCertificadoSePronto() {
    if (
        !sessaoAtual ||
        sessaoAtual.processandoCertificado ||
        sessaoAtual.autenticada
    ) {
        return;
    }

    const {
        context,
        page
    } = sessaoAtual;

    const submit =
        await obterSubmitPendente(page);

    if (!submit?.url || !submit?.body) {
        await salvarAutenticacaoAtual();
        return;
    }

    sessaoAtual.processandoCertificado = true;
    sessaoAtual.etapa = 'PROCESSANDO_CERTIFICADO';

    try {
        const destino = new URL(submit.url);

        if (
            destino.protocol !== 'https:' ||
            destino.hostname !==
                'certificado.sso.acesso.gov.br'
        ) {
            throw criarErro(
                'DESTINO_CERTIFICADO_INVALIDO',
                'O formulário apontou para um destino inesperado.'
            );
        }

        const cookies =
            await context.cookies();

        const userAgent =
            await page
                .evaluate(() => navigator.userAgent)
                .catch(() => '');

        console.log(
            '👤 [eSocial] Usuário concluiu a etapa interativa; executando mTLS.',
            {
                method: submit.method,
                host: destino.hostname,
                path: destino.pathname,
                campos: submit.fieldNames || []
            }
        );

        const resultado =
            await executarBridgePython(
                {
                    url: submit.url,
                    method:
                        submit.method ||
                        'POST',
                    body: submit.body,
                    referer: page.url(),
                    userAgent,
                    cookies,
                    timeoutSeconds: 25
                },
                envNumber(
                    'ESOCIAL_CERT_BRIDGE_TIMEOUT_MS',
                    45000
                )
            );

        if (!resultado?.ok) {
            throw criarErro(
                resultado?.code ||
                    'FALHA_CERTIFICADO',
                resultado?.error ||
                    'Não foi possível concluir a autenticação do certificado.',
                resultado?.details ||
                    null
            );
        }

        const status =
            Number(resultado.status);

        const location =
            String(
                resultado.location ||
                ''
            );

        if (
            status < 300 ||
            status >= 400 ||
            !location
        ) {
            throw criarErro(
                'CERTIFICADO_SEM_REDIRECT',
                `O certificado retornou HTTP ${status} sem redirecionamento válido.`
            );
        }

        const cookiesRecebidos =
            Array.isArray(resultado.cookies)
                ? resultado.cookies
                : [];

        const cookiesPlaywright =
            cookiesRecebidos
                .filter(
                    item =>
                        item?.name &&
                        item?.domain
                )
                .map(
                    item => {
                        const cookie = {
                            name:
                                String(item.name),
                            value:
                                String(
                                    item.value ||
                                    ''
                                ),
                            domain:
                                String(
                                    item.domain
                                ),
                            path:
                                String(
                                    item.path ||
                                    '/'
                                ),
                            secure:
                                Boolean(
                                    item.secure
                                ),
                            httpOnly:
                                Boolean(
                                    item.httpOnly
                                )
                        };

                        const expires =
                            Number(item.expires);

                        if (
                            Number.isFinite(
                                expires
                            ) &&
                            expires > 0
                        ) {
                            cookie.expires =
                                expires;
                        }

                        return cookie;
                    }
                );

        if (cookiesPlaywright.length) {
            await context.addCookies(
                cookiesPlaywright
            );
        }

        await limparSubmitPendente(page);

        console.log(
            '👤 [eSocial] mTLS interativo concluído.',
            {
                status,
                location:
                    resumoUrl(location),
                cookies:
                    cookiesPlaywright.length
            }
        );

        await page.goto(
            location,
            {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            }
        );

        const inicio = Date.now();

        while (
            Date.now() - inicio <
            30000
        ) {
            if (
                await salvarAutenticacaoAtual()
            ) {
                console.log(
                    '✅ [eSocial] Sessão interativa autenticada e armazenada em memória.'
                );

                return;
            }

            await page.waitForTimeout(
                700
            );
        }

        sessaoAtual.etapa =
            'AGUARDANDO_USUARIO';

    } catch (error) {
        sessaoAtual.ultimoErro =
            error?.message ||
            String(error);

        sessaoAtual.etapa =
            'ERRO_CERTIFICADO';

        await limparSubmitPendente(page);

    } finally {
        sessaoAtual.processandoCertificado =
            false;
    }
}

async function obterStatusInterativo(token) {
    if (!validarToken(token)) {
        throw criarErro(
            'SESSAO_INTERATIVA_INVALIDA',
            'Sessão interativa não encontrada ou expirada.'
        );
    }

    await processarSubmitCertificadoSePronto();

    const { page } = sessaoAtual;

    if (!sessaoAtual.autenticada) {
        await salvarAutenticacaoAtual();
    }

    const url = page?.url?.() || '';

    return {
        success: true,
        autenticada:
            Boolean(
                sessaoAtual.autenticada
            ),
        etapa: sessaoAtual.etapa,
        processandoCertificado:
            Boolean(
                sessaoAtual
                    .processandoCertificado
            ),
        ultimoErro:
            sessaoAtual.ultimoErro,
        pagina: {
            ...resumoUrl(url),
            titulo:
                await page
                    .title()
                    .catch(() => '')
        },
        sessaoRobo:
            statusSessaoEsocial()
    };
}

async function obterFrame(token) {
    if (!validarToken(token)) {
        throw criarErro(
            'SESSAO_INTERATIVA_INVALIDA',
            'Sessão interativa inválida.'
        );
    }

    await processarSubmitCertificadoSePronto();

    return await sessaoAtual.page.screenshot({
        type: 'jpeg',
        quality: 72
    });
}

async function clicar(token, payload = {}) {
    if (!validarToken(token)) {
        throw criarErro(
            'SESSAO_INTERATIVA_INVALIDA',
            'Sessão interativa inválida.'
        );
    }

    const page = sessaoAtual.page;

    const viewport =
        page.viewportSize() ||
        {
            width: 1365,
            height: 768
        };

    const displayWidth =
        Number(payload.displayWidth) ||
        viewport.width;

    const displayHeight =
        Number(payload.displayHeight) ||
        viewport.height;

    const x =
        Math.max(
            0,
            Math.min(
                viewport.width,
                (
                    Number(payload.x) || 0
                ) *
                    viewport.width /
                    displayWidth
            )
        );

    const y =
        Math.max(
            0,
            Math.min(
                viewport.height,
                (
                    Number(payload.y) || 0
                ) *
                    viewport.height /
                    displayHeight
            )
        );

    await page.mouse.click(x, y);

    await page.waitForTimeout(250);

    await processarSubmitCertificadoSePronto();

    return obterStatusInterativo(token);
}

async function rolar(token, payload = {}) {
    if (!validarToken(token)) {
        throw criarErro(
            'SESSAO_INTERATIVA_INVALIDA',
            'Sessão interativa inválida.'
        );
    }

    await sessaoAtual.page.mouse.wheel(
        Number(payload.deltaX) || 0,
        Number(payload.deltaY) || 0
    );

    return {
        success: true
    };
}

async function digitar(token, payload = {}) {
    if (!validarToken(token)) {
        throw criarErro(
            'SESSAO_INTERATIVA_INVALIDA',
            'Sessão interativa inválida.'
        );
    }

    const texto =
        String(payload.text || '');

    if (texto.length > 1000) {
        throw criarErro(
            'TEXTO_MUITO_LONGO',
            'Texto excede o limite permitido.'
        );
    }

    await sessaoAtual.page.keyboard.type(
        texto,
        { delay: 25 }
    );

    return {
        success: true
    };
}

async function tecla(token, payload = {}) {
    if (!validarToken(token)) {
        throw criarErro(
            'SESSAO_INTERATIVA_INVALIDA',
            'Sessão interativa inválida.'
        );
    }

    const permitidas =
        new Set([
            'Enter',
            'Tab',
            'Escape',
            'Backspace',
            'Delete',
            'ArrowUp',
            'ArrowDown',
            'ArrowLeft',
            'ArrowRight',
            'Space'
        ]);

    const key =
        String(payload.key || '');

    if (!permitidas.has(key)) {
        throw criarErro(
            'TECLA_NAO_PERMITIDA',
            'Tecla não permitida.'
        );
    }

    await sessaoAtual.page.keyboard.press(
        key
    );

    return {
        success: true
    };
}

async function fecharLoginInterativo(token) {
    if (
        token &&
        !validarToken(token)
    ) {
        throw criarErro(
            'SESSAO_INTERATIVA_INVALIDA',
            'Sessão interativa inválida.'
        );
    }

    await fecharInterno();

    return {
        success: true
    };
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
