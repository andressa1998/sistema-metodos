'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const {
    salvarSessaoEsocial,
    statusSessaoEsocial
} = require('./esocial-session-store');

const DISPLAY = ':99';
const VNC_PORT = 5900;
const CDP_PORT = 9222;

let sessaoAtual = null;
let infra = {
    xvfb: null,
    fluxbox: null,
    x11vnc: null
};

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
        `🖥️ [eSocial remoto] Iniciando ${nome}:`,
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
        const texto = chunk
            .toString('utf8')
            .trim();

        if (texto) {
            console.log(
                `🖥️ [${nome}]`,
                texto.slice(0, 1200)
            );
        }
    });

    proc.stderr?.on('data', chunk => {
        const texto = chunk
            .toString('utf8')
            .trim();

        if (texto) {
            console.log(
                `🖥️ [${nome}]`,
                texto.slice(0, 1200)
            );
        }
    });

    proc.on('exit', (code, signal) => {
        console.log(
            `🖥️ [eSocial remoto] ${nome} encerrou.`,
            {
                code,
                signal
            }
        );
    });

    return proc;
}

function aguardar(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

async function aguardarPorta(host, porta, timeoutMs = 15000) {
    const inicio = Date.now();

    while (Date.now() - inicio < timeoutMs) {
        const ok = await new Promise(resolve => {
            const socket = net.createConnection({
                host,
                port: porta
            });

            const finalizar = value => {
                try {
                    socket.destroy();
                } catch (_) {}

                resolve(value);
            };

            socket.setTimeout(800);

            socket.once('connect', () => {
                finalizar(true);
            });

            socket.once('timeout', () => {
                finalizar(false);
            });

            socket.once('error', () => {
                finalizar(false);
            });
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

                    response.on('data', chunk => {
                        body += chunk.toString('utf8');
                    });

                    response.on('end', () => {
                        try {
                            const data = JSON.parse(body);
                            resolve(
                                Boolean(
                                    data.webSocketDebuggerUrl
                                )
                            );
                        } catch (_) {
                            resolve(false);
                        }
                    });
                }
            );

            req.setTimeout(1000, () => {
                req.destroy();
                resolve(false);
            });

            req.on('error', () => {
                resolve(false);
            });
        });

        if (ok) return true;

        await aguardar(350);
    }

    return false;
}

function garantirBinario(nome) {
    const teste = spawnSync(
        'sh',
        ['-lc', `command -v ${nome}`],
        {
            encoding: 'utf8'
        }
    );

    if (teste.status !== 0) {
        throw criarErro(
            'BINARIO_NAO_ENCONTRADO',
            `O binário "${nome}" não está instalado. Use o Dockerfile da V10.`
        );
    }

    return teste.stdout.trim();
}

async function garantirInfraGrafica() {
    garantirBinario('Xvfb');
    garantirBinario('x11vnc');
    garantirBinario('fluxbox');

    if (!processoVivo(infra.xvfb)) {
        infra.xvfb = spawnLogado(
            'Xvfb',
            'Xvfb',
            [
                DISPLAY,
                '-screen',
                '0',
                '1600x1000x24',
                '-ac',
                '-nolisten',
                'tcp'
            ],
            {
                env: {
                    ...process.env,
                    DISPLAY
                }
            }
        );

        const displayPronto =
            await aguardarPorta(
                '127.0.0.1',
                6000 + 99,
                500
            ).catch(() => false);

        // Xvfb with -nolisten tcp will not expose port 6099.
        // Give the X server a short startup window instead.
        await aguardar(
            displayPronto ? 200 : 800
        );
    }

    if (!processoVivo(infra.fluxbox)) {
        infra.fluxbox = spawnLogado(
            'fluxbox',
            'fluxbox',
            [],
            {
                env: {
                    ...process.env,
                    DISPLAY
                }
            }
        );

        await aguardar(500);
    }

    if (!processoVivo(infra.x11vnc)) {
        infra.x11vnc = spawnLogado(
            'x11vnc',
            'x11vnc',
            [
                '-display',
                DISPLAY,
                '-localhost',
                '-forever',
                '-shared',
                '-nopw',
                '-rfbport',
                String(VNC_PORT),
                '-noxdamage',
                '-repeat',
                '-quiet'
            ],
            {
                env: {
                    ...process.env,
                    DISPLAY
                }
            }
        );

        const vncPronto =
            await aguardarPorta(
                '127.0.0.1',
                VNC_PORT,
                12000
            );

        if (!vncPronto) {
            throw criarErro(
                'VNC_NAO_INICIOU',
                'O servidor VNC não iniciou na porta interna esperada.'
            );
        }
    }
}

function normalizarBase64Cert(valor) {
    return String(valor || '')
        .replace(
            /^data:.*?;base64,/i,
            ''
        )
        .replace(/\s+/g, '');
}

function executarComErro(comando, args, opcoes = {}) {
    const retorno = spawnSync(
        comando,
        args,
        {
            encoding: 'utf8',
            ...opcoes
        }
    );

    if (retorno.status !== 0) {
        throw criarErro(
            'COMANDO_SISTEMA_FALHOU',
            `Falha ao executar ${comando}.`,
            {
                status: retorno.status,
                stderr:
                    String(
                        retorno.stderr || ''
                    )
                        .trim()
                        .slice(0, 1000)
            }
        );
    }

    return retorno;
}

function prepararCertificadoNss(homeDir) {
    garantirBinario('certutil');
    garantirBinario('pk12util');

    const certBase64 =
        normalizarBase64Cert(
            process.env.ESOCIAL_CERT_BASE64
        );

    const senha =
        String(
            process.env.ESOCIAL_CERT_PASSWORD ||
            ''
        );

    if (!certBase64) {
        throw criarErro(
            'CERTIFICADO_NAO_CONFIGURADO',
            'ESOCIAL_CERT_BASE64 não está configurado no servidor.'
        );
    }

    if (!senha) {
        throw criarErro(
            'SENHA_CERTIFICADO_NAO_CONFIGURADA',
            'ESOCIAL_CERT_PASSWORD não está configurado no servidor.'
        );
    }

    const pkiDir =
        path.join(
            homeDir,
            '.pki'
        );

    const nssDir =
        path.join(
            pkiDir,
            'nssdb'
        );

    fs.mkdirSync(
        nssDir,
        {
            recursive: true,
            mode: 0o700
        }
    );

    const pfxPath =
        path.join(
            homeDir,
            'esocial-client.p12'
        );

    try {
        fs.writeFileSync(
            pfxPath,
            Buffer.from(
                certBase64,
                'base64'
            ),
            {
                mode: 0o600
            }
        );

        executarComErro(
            'certutil',
            [
                '-N',
                '-d',
                `sql:${nssDir}`,
                '--empty-password'
            ],
            {
                env: {
                    ...process.env,
                    HOME: homeDir
                }
            }
        );

        executarComErro(
            'pk12util',
            [
                '-i',
                pfxPath,
                '-d',
                `sql:${nssDir}`,
                '-W',
                senha
            ],
            {
                env: {
                    ...process.env,
                    HOME: homeDir
                }
            }
        );

        const lista =
            executarComErro(
                'certutil',
                [
                    '-L',
                    '-d',
                    `sql:${nssDir}`
                ],
                {
                    env: {
                        ...process.env,
                        HOME: homeDir
                    }
                }
            );

        const linhas =
            String(lista.stdout || '')
                .split(/\r?\n/)
                .map(item => item.trim())
                .filter(Boolean)
                .filter(
                    item =>
                        !item.startsWith(
                            'Certificate Nickname'
                        ) &&
                        !item.startsWith(
                            'SSL,S/MIME'
                        ) &&
                        !item.startsWith('-----')
                );

        console.log(
            '🔐 [eSocial remoto] Certificado A1 importado no NSS.',
            {
                certificadosVisiveis:
                    linhas.length
            }
        );

    } finally {
        try {
            fs.unlinkSync(pfxPath);
        } catch (_) {}
    }
}

async function obterPaginaAtual() {
    if (!sessaoAtual?.cdpBrowser) {
        return null;
    }

    const contexts =
        sessaoAtual.cdpBrowser.contexts();

    for (const context of contexts) {
        const pages =
            context.pages();

        if (pages.length) {
            return pages[
                pages.length - 1
            ];
        }
    }

    return null;
}

async function estaAutenticadoEsocial() {
    const page =
        await obterPaginaAtual();

    if (!page) {
        return false;
    }

    const url = page.url();

    // Primeiro: sinais visuais conhecidos do portal autenticado.
    const sinais = [
        page.getByText(
            /Trocar Perfil\/Módulo/i
        ),
        page.getByText(
            /Trocar Perfil/i
        ),
        page.getByText(
            /Titular do Certificado/i
        ),
        page.getByRole(
            'button',
            {
                name: /SAIR/i
            }
        )
    ];

    for (const sinal of sinais) {
        try {
            if (
                await sinal
                    .first()
                    .isVisible({
                        timeout: 500
                    })
            ) {
                return true;
            }
        } catch (_) {}
    }

    // Segundo: se saiu dos hosts de autenticação e voltou para o domínio eSocial,
    // trate como candidato e valide a ausência da tela de login.
    try {
        const parsed =
            new URL(url);

        if (
            parsed.hostname ===
                'login.esocial.gov.br' &&
            !/login\.aspx$/i.test(
                parsed.pathname
            )
        ) {
            return true;
        }
    } catch (_) {}

    return false;
}

async function salvarSessaoAtual() {
    if (!sessaoAtual?.cdpBrowser) {
        throw criarErro(
            'NAVEGADOR_NAO_INICIADO',
            'O navegador remoto não está ativo.'
        );
    }

    const autenticado =
        await estaAutenticadoEsocial();

    if (!autenticado) {
        throw criarErro(
            'ESOCIAL_AINDA_NAO_AUTENTICADO',
            'O eSocial ainda não está autenticado. Conclua o login no navegador remoto.'
        );
    }

    const contexts =
        sessaoAtual.cdpBrowser.contexts();

    if (!contexts.length) {
        throw criarErro(
            'CONTEXTO_CDP_NAO_ENCONTRADO',
            'Não foi encontrado um contexto do navegador remoto.'
        );
    }

    const context =
        contexts[0];

    const storageState =
        await context.storageState();

    const page =
        await obterPaginaAtual();

    salvarSessaoEsocial(
        storageState,
        {
            origem:
                'navegador_remoto_v10',
            titulo:
                page
                    ? await page
                        .title()
                        .catch(() => '')
                    : '',
            url:
                page?.url?.() || ''
        }
    );

    sessaoAtual.autenticada =
        true;

    console.log(
        '✅ [eSocial remoto] Sessão autenticada salva para uso do robô.'
    );

    return true;
}

async function encerrarNavegadorAtual({
    manterSessao = true
} = {}) {
    const atual = sessaoAtual;
    sessaoAtual = null;

    if (!atual) return;

    if (
        manterSessao &&
        atual.cdpBrowser
    ) {
        try {
            await salvarSessaoAtual();
        } catch (_) {}
    }

    try {
        if (atual.cdpBrowser) {
            await atual.cdpBrowser.close();
        }
    } catch (_) {}

    matarProcesso(
        atual.chrome
    );

    try {
        fs.rmSync(
            atual.baseDir,
            {
                recursive: true,
                force: true
            }
        );
    } catch (_) {}
}

async function iniciarNavegadorRemoto() {
    if (sessaoAtual) {
        await encerrarNavegadorAtual({
            manterSessao: false
        });
    }

    await garantirInfraGrafica();

    const {
        chromium
    } = require('playwright');

    const chromiumPath =
        chromium.executablePath();

    if (
        !chromiumPath ||
        !fs.existsSync(
            chromiumPath
        )
    ) {
        throw criarErro(
            'CHROMIUM_NAO_ENCONTRADO',
            'O Chromium do Playwright não foi encontrado dentro do container Docker.'
        );
    }

    const token =
        crypto
            .randomBytes(32)
            .toString('hex');

    const baseDir =
        fs.mkdtempSync(
            path.join(
                os.tmpdir(),
                'esocial-remote-'
            )
        );

    const homeDir =
        path.join(
            baseDir,
            'home'
        );

    const profileDir =
        path.join(
            baseDir,
            'profile'
        );

    fs.mkdirSync(
        homeDir,
        {
            recursive: true,
            mode: 0o700
        }
    );

    fs.mkdirSync(
        profileDir,
        {
            recursive: true,
            mode: 0o700
        }
    );

    prepararCertificadoNss(
        homeDir
    );

    const loginUrl =
        process.env
            .ESOCIAL_RELATORIOS_LOGIN_URL ||
        'https://login.esocial.gov.br/login.aspx';

    const args = [
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${CDP_PORT}`,
        '--remote-debugging-address=127.0.0.1',
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

    const chrome =
        spawnLogado(
            'Chromium remoto',
            chromiumPath,
            args,
            {
                env: {
                    ...process.env,
                    DISPLAY,
                    HOME: homeDir
                }
            }
        );

    const cdpPronto =
        await aguardarCdp(
            25000
        );

    if (!cdpPronto) {
        matarProcesso(chrome);

        throw criarErro(
            'CHROMIUM_CDP_NAO_INICIOU',
            'O Chromium remoto abriu, mas a porta CDP não ficou disponível.'
        );
    }

    const cdpBrowser =
        await chromium
            .connectOverCDP(
                `http://127.0.0.1:${CDP_PORT}`
            );

    sessaoAtual = {
        token,
        criadaEm:
            Date.now(),
        baseDir,
        homeDir,
        profileDir,
        chrome,
        cdpBrowser,
        autenticada:
            false
    };

    console.log(
        '🖥️ [eSocial remoto] Navegador remoto pronto.',
        {
            display: DISPLAY,
            vncPort: VNC_PORT,
            cdpPort: CDP_PORT
        }
    );

    return {
        success: true,
        token,
        status:
            await statusNavegadorRemoto(
                token
            )
    };
}

function validarTokenNavegadorRemoto(token) {
    return Boolean(
        sessaoAtual &&
        token &&
        sessaoAtual.token ===
            String(token)
    );
}

async function statusNavegadorRemoto(token) {
    if (
        !validarTokenNavegadorRemoto(
            token
        )
    ) {
        throw criarErro(
            'SESSAO_REMOTA_INVALIDA',
            'A sessão do navegador remoto não existe ou expirou.'
        );
    }

    let autenticada =
        Boolean(
            sessaoAtual.autenticada
        );

    if (!autenticada) {
        autenticada =
            await estaAutenticadoEsocial();

        if (autenticada) {
            await salvarSessaoAtual();
        }
    }

    const page =
        await obterPaginaAtual();

    return {
        success: true,
        autenticada,
        criadaEm:
            sessaoAtual.criadaEm,
        pagina: {
            ...(page
                ? resumoUrl(
                    page.url()
                )
                : {
                    host: '',
                    path: ''
                }),
            titulo:
                page
                    ? await page
                        .title()
                        .catch(() => '')
                    : ''
        },
        sessaoRobo:
            statusSessaoEsocial()
    };
}

async function finalizarNavegadorRemoto(token) {
    if (
        !validarTokenNavegadorRemoto(
            token
        )
    ) {
        throw criarErro(
            'SESSAO_REMOTA_INVALIDA',
            'A sessão do navegador remoto não existe ou expirou.'
        );
    }

    await salvarSessaoAtual();

    await encerrarNavegadorAtual({
        manterSessao: false
    });

    return {
        success: true,
        sessaoRobo:
            statusSessaoEsocial()
    };
}

async function cancelarNavegadorRemoto(token) {
    if (
        token &&
        !validarTokenNavegadorRemoto(
            token
        )
    ) {
        throw criarErro(
            'SESSAO_REMOTA_INVALIDA',
            'A sessão do navegador remoto não existe ou expirou.'
        );
    }

    await encerrarNavegadorAtual({
        manterSessao: false
    });

    return {
        success: true
    };
}

module.exports = {
    VNC_PORT,
    iniciarNavegadorRemoto,
    statusNavegadorRemoto,
    finalizarNavegadorRemoto,
    cancelarNavegadorRemoto,
    validarTokenNavegadorRemoto
};
