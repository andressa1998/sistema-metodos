'use strict';

// ============================================================
// Robô de Relatórios Gerenciais do eSocial
// ============================================================
// Objetivo:
// - reutilizar o certificado A1 já configurado em ESOCIAL_CERT_BASE64;
// - manter uma única sessão autenticada;
// - trocar o perfil para cada CNPJ representado;
// - solicitar/baixar o relatório "Relação de trabalhadores - eSocial";
// - devolver o arquivo ao backend, que importa na base local.
//
// IMPORTANTE:
// O portal do eSocial é uma interface web externa e pode mudar.
// Por isso este serviço usa seletores por texto/label e, quando não
// reconhece a tela, retorna diagnóstico seguro (URL/título/ações) sem
// registrar certificado, senha ou conteúdo completo da página.
// ============================================================

const fs = require('fs');

function env(name, fallback = '') {
    const value = process.env[name];
    return value === undefined || value === null || value === ''
        ? fallback
        : String(value).trim();
}

function envBoolean(name, fallback = false) {
    const value = env(name, '');
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'sim', 'on'].includes(value.toLowerCase());
}

function envNumber(name, fallback) {
    const value = Number(env(name, ''));
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function somenteDigitos(value) {
    return String(value || '').replace(/\D+/g, '');
}

function obterPfxBuffer() {
    const bruto = env('ESOCIAL_CERT_BASE64');
    if (!bruto) {
        throw new Error(
            'ESOCIAL_CERT_BASE64 não configurado no Render.'
        );
    }

    const limpo = bruto
        .replace(/^data:.*?;base64,/i, '')
        .replace(/\s+/g, '');

    const buffer = Buffer.from(limpo, 'base64');

    if (!buffer.length) {
        throw new Error('ESOCIAL_CERT_BASE64 não pôde ser decodificado.');
    }

    return buffer;
}

function obterOrigensCertificado() {
    const configuradas = env('ESOCIAL_CLIENT_CERT_ORIGINS');

    const lista = configuradas
        ? configuradas.split(',').map(item => item.trim()).filter(Boolean)
        : [
            'https://login.esocial.gov.br',
            'https://sso.acesso.gov.br',
            'https://acesso.gov.br'
        ];

    return Array.from(new Set(lista.map(item => item.replace(/\/$/, ''))));
}

function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

async function locatorVisivel(locator) {
    try {
        return await locator.first().isVisible({ timeout: 1200 });
    } catch (_) {
        return false;
    }
}

async function clicarPorTexto(page, padroes, timeout = 2500) {
    const regexes = (Array.isArray(padroes) ? padroes : [padroes])
        .map(item => item instanceof RegExp ? item : new RegExp(String(item), 'i'));

    for (const regex of regexes) {
        const candidatos = [
            page.getByRole('button', { name: regex }),
            page.getByRole('link', { name: regex }),
            page.getByText(regex, { exact: false })
        ];

        for (const locator of candidatos) {
            try {
                const primeiro = locator.first();
                if (await primeiro.isVisible({ timeout })) {
                    await primeiro.click({ timeout: 10000 });
                    return true;
                }
            } catch (_) {
                // tenta o próximo candidato
            }
        }
    }

    return false;
}

async function preencherPrimeiroCampo(page, seletores, valor) {
    for (const seletor of seletores) {
        try {
            const locator = typeof seletor === 'string'
                ? page.locator(seletor)
                : seletor;

            const primeiro = locator.first();
            if (await primeiro.isVisible({ timeout: 1500 })) {
                await primeiro.fill(String(valor));
                return true;
            }
        } catch (_) {
            // segue
        }
    }
    return false;
}

async function selecionarOpcaoContendo(page, regex) {
    const selects = page.locator('select');
    const quantidade = await selects.count();

    for (let i = 0; i < quantidade; i++) {
        const select = selects.nth(i);
        try {
            if (!await select.isVisible({ timeout: 500 })) continue;

            const opcoes = await select.locator('option').evaluateAll(items =>
                items.map(item => ({
                    value: item.value,
                    text: (item.textContent || '').trim()
                }))
            );

            const encontrada = opcoes.find(item => regex.test(item.text));
            if (encontrada) {
                await select.selectOption(encontrada.value);
                return true;
            }
        } catch (_) {
            // segue
        }
    }

    return false;
}

async function obterDiagnosticoSeguro(page, etapa, erro = null) {
    let titulo = '';
    let url = '';
    let acoes = [];

    try { titulo = await page.title(); } catch (_) {}
    try { url = page.url(); } catch (_) {}

    try {
        acoes = await page
            .locator('button:visible, a:visible')
            .evaluateAll(items =>
                items
                    .map(item => (item.innerText || item.textContent || '').replace(/\s+/g, ' ').trim())
                    .filter(Boolean)
                    .slice(0, 30)
            );
    } catch (_) {}

    return {
        etapa,
        titulo,
        url,
        acoesVisiveis: acoes,
        erro: erro ? String(erro.message || erro) : null
    };
}

function criarErroRobo(codigo, mensagem, diagnostico = null) {
    const erro = new Error(mensagem);
    erro.code = codigo;
    erro.diagnostico = diagnostico;
    return erro;
}

class EsocialRelatoriosRobo {
    constructor({ onEtapa } = {}) {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.onEtapa = typeof onEtapa === 'function' ? onEtapa : async () => {};
        this.headless = envBoolean('ESOCIAL_RELATORIOS_HEADLESS', true);
        this.loginUrl = env('ESOCIAL_RELATORIOS_LOGIN_URL', 'https://login.esocial.gov.br/login.aspx');
        this.timeoutNavegacao = envNumber('ESOCIAL_RELATORIOS_NAV_TIMEOUT_MS', 90000);
        this.timeoutRelatorio = envNumber('ESOCIAL_RELATORIOS_TIMEOUT_RELATORIO_MS', 15 * 60 * 1000);
    }

    async etapa(nome, detalhes = {}) {
        await this.onEtapa(nome, detalhes);
    }

    async iniciar() {
        await this.etapa('INICIANDO_NAVEGADOR');

        let playwright;
        try {
            playwright = require('playwright');
        } catch (error) {
            throw criarErroRobo(
                'PLAYWRIGHT_NAO_INSTALADO',
                'Playwright não está instalado. Atualize o package.json e faça novo deploy.',
                null
            );
        }

        const pfx = obterPfxBuffer();
        const passphrase = env('ESOCIAL_CERT_PASSWORD');
        if (!passphrase) {
            throw new Error('ESOCIAL_CERT_PASSWORD não configurado no Render.');
        }

        const clientCertificates = obterOrigensCertificado().map(origin => ({
            origin,
            pfx,
            passphrase
        }));

        try {
            this.browser = await playwright.chromium.launch({
                headless: this.headless,
                args: [
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            });
        } catch (error) {
            const mensagem = String(error?.message || error);
            if (/executable.*doesn.t exist|browser.*not found|install/i.test(mensagem)) {
                throw criarErroRobo(
                    'CHROMIUM_NAO_INSTALADO',
                    'Chromium do Playwright não está instalado no Render. Configure o Build Command para executar "npx playwright install chromium" após o npm install.',
                    null
                );
            }
            throw error;
        }

        this.context = await this.browser.newContext({
            acceptDownloads: true,
            ignoreHTTPSErrors: false,
            locale: 'pt-BR',
            clientCertificates
        });

        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(15000);
        this.page.setDefaultNavigationTimeout(this.timeoutNavegacao);

        await this.etapa('NAVEGADOR_PRONTO');
    }

    async fechar() {
        try {
            if (this.context) await this.context.close();
        } catch (_) {}
        try {
            if (this.browser) await this.browser.close();
        } catch (_) {}
        this.context = null;
        this.browser = null;
        this.page = null;
    }

async autenticar() {
    if (!this.page) {
        throw new Error('Navegador não iniciado.');
    }

    const page = this.page;

    await this.etapa('ABRINDO_LOGIN', {
        url: this.loginUrl
    });

    console.log(
        '🔐 [eSocial] Abrindo:',
        this.loginUrl
    );

    await page.goto(
        this.loginUrl,
        {
            waitUntil: 'domcontentloaded',
            timeout: this.timeoutNavegacao
        }
    );

    await page.waitForTimeout(1500);

    console.log(
        '🔐 [eSocial] URL após abrir eSocial:',
        page.url()
    );

    if (await this.estaAutenticado()) {
        await this.etapa('AUTENTICADO');
        return true;
    }

    // =========================================================
    // 1. ABRIR GOV.BR
    // =========================================================

    if (!/sso\.acesso\.gov\.br/i.test(page.url())) {

        await this.etapa('ABRINDO_GOVBR');

        const clicouGovBr =
            await clicarPorTexto(
                page,
                [
                    /Entrar com gov\.br/i,
                    /gov\.br/i
                ],
                4000
            );

        console.log(
            '🔐 [eSocial] Clique "Entrar com gov.br":',
            clicouGovBr
        );

        await page.waitForTimeout(2500);
    }

    console.log(
        '🔐 [eSocial] URL antes do certificado:',
        page.url()
    );

    if (await this.estaAutenticado()) {
        await this.etapa('AUTENTICADO');
        return true;
    }

    // =========================================================
    // 2. AGUARDAR A TELA DO GOV.BR SER MONTADA
    // =========================================================

    await this.etapa(
        'AGUARDANDO_TELA_GOVBR'
    );

    try {

        await page.waitForFunction(
            () => {

                const normalizar = (texto) =>
                    String(texto || '')
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();

                const elementos =
                    Array.from(
                        document.querySelectorAll(
                            'a, button, [role="link"], [role="button"]'
                        )
                    );

                return elementos.some(
                    elemento => {

                        const texto =
                            normalizar(
                                elemento.innerText ||
                                elemento.textContent ||
                                ''
                            );

                        return (
                            texto.includes(
                                'seu certificado digital'
                            ) &&
                            !texto.includes(
                                'nuvem'
                            )
                        );
                    }
                );
            },
            null,
            {
                timeout: 15000
            }
        );

    } catch (_) {

        console.warn(
            '⚠️ [eSocial] A opção do certificado não apareceu durante a espera inicial.'
        );
    }

    await page.waitForTimeout(800);

    // =========================================================
    // 3. LOCALIZAR O ELEMENTO CLICÁVEL REAL
    // =========================================================

    await this.etapa(
        'LOCALIZANDO_CERTIFICADO_DIGITAL'
    );

    const elementos =
        page.locator(
            'a, button, [role="link"], [role="button"]'
        );

    const quantidade =
        await elementos.count();

    console.log(
        '🔐 [eSocial] Elementos clicáveis encontrados:',
        quantidade
    );

    let linkCertificado =
        null;

    let textoCertificado =
        '';

    for (
        let i = 0;
        i < quantidade;
        i++
    ) {

        const elemento =
            elementos.nth(i);

        try {

            if (
                !await elemento.isVisible({
                    timeout: 500
                })
            ) {
                continue;
            }

            const texto =
                normalizarTexto(
                    await elemento
                        .innerText()
                        .catch(() => '')
                );

            if (
                texto.includes(
                    'seu certificado digital'
                ) &&
                !texto.includes(
                    'nuvem'
                )
            ) {

                linkCertificado =
                    elemento;

                textoCertificado =
                    texto;

                console.log(
                    '✅ [eSocial] Opção de certificado localizada:',
                    texto
                );

                break;
            }

        } catch (_) {}
    }

    // =========================================================
    // 4. DIAGNÓSTICO EXTRA CASO NÃO ENCONTRE
    // =========================================================

    if (!linkCertificado) {

        let textosPagina =
            '';

        try {

            textosPagina =
                await page
                    .locator('body')
                    .innerText({
                        timeout: 3000
                    });

        } catch (_) {}

        console.log(
            '🔐 [eSocial] Texto parcial da página:',
            String(textosPagina)
                .replace(/\s+/g, ' ')
                .slice(0, 1500)
        );

        const diagnostico =
            await obterDiagnosticoSeguro(
                page,
                'LOCALIZAR_CERTIFICADO'
            );

        throw criarErroRobo(
            'LINK_CERTIFICADO_NAO_ENCONTRADO',
            'A opção "Seu certificado digital" não foi localizada entre os elementos clicáveis do gov.br.',
            diagnostico
        );
    }

    // =========================================================
    // 5. DESCOBRIR HREF
    // =========================================================

    let hrefCertificado =
        null;

    try {

        hrefCertificado =
            await linkCertificado
                .getAttribute('href');

    } catch (_) {}

    console.log(
        '🔐 [eSocial] Texto certificado:',
        textoCertificado
    );

    console.log(
        '🔐 [eSocial] HREF certificado:',
        hrefCertificado ||
        '(sem href)'
    );

    await this.etapa(
        'ABRINDO_CERTIFICADO_DIGITAL',
        {
            href:
                hrefCertificado ||
                null
        }
    );

    const urlAntes =
        page.url();

// =========================================================
// 6. ABRIR DIRETAMENTE O ENDPOINT DO CERTIFICADO
// =========================================================

try {

    const urlGovBr =
        new URL(page.url());

    const clientId =
        urlGovBr.searchParams.get(
            'client_id'
        );

    const authorizationId =
        urlGovBr.searchParams.get(
            'authorization_id'
        );

    if (
        !clientId ||
        !authorizationId
    ) {

        throw new Error(
            'client_id ou authorization_id não encontrados na URL do gov.br.'
        );
    }

    const destinoCertificado =
        new URL(
            'https://certificado.sso.acesso.gov.br/login'
        );

    destinoCertificado.searchParams.set(
        'client_id',
        clientId
    );

    destinoCertificado.searchParams.set(
        'authorization_id',
        authorizationId
    );

    console.log(
        '🔐 [eSocial] Abrindo endpoint do certificado:',
        destinoCertificado.href
    );

    await this.etapa(
        'ABRINDO_ENDPOINT_CERTIFICADO',
        {
            host:
                destinoCertificado.host
        }
    );

    await page.goto(
        destinoCertificado.href,
        {
            waitUntil:
                'domcontentloaded',
            timeout:
                30000
        }
    );

    console.log(
        '🔐 [eSocial] URL após endpoint do certificado:',
        page.url()
    );

    console.log(
        '🔐 [eSocial] Título após endpoint:',
        await page
            .title()
            .catch(
                () => ''
            )
    );

} catch (error) {

    const mensagem =
        error?.message ||
        String(error);

    console.error(
        '❌ [eSocial] Falha acessando endpoint do certificado:',
        mensagem
    );

    const diagnostico =
        await obterDiagnosticoSeguro(
            page,
            'ABRIR_ENDPOINT_CERTIFICADO',
            error
        );

    if (
        /ERR_BAD_SSL_CLIENT_AUTH_CERT/i
            .test(mensagem)
    ) {

        throw criarErroRobo(
            'CERTIFICADO_REJEITADO',
            'O gov.br rejeitou o certificado A1 apresentado pelo Render.',
            diagnostico
        );
    }

    if (
        /ERR_SSL_CLIENT_AUTH/i
            .test(mensagem)
    ) {

        throw criarErroRobo(
            'ERRO_SSL_CERTIFICADO',
            'O gov.br solicitou o certificado digital, mas a autenticação TLS falhou.',
            diagnostico
        );
    }

    throw criarErroRobo(
        'FALHA_ENDPOINT_CERTIFICADO',
        'Não foi possível acessar o endpoint de autenticação por certificado: ' +
            mensagem,
        diagnostico
    );
}

await page.waitForTimeout(
    1500
);

console.log(
    '🔐 [eSocial] URL final após certificado:',
    page.url()
);

    // =========================================================
    // 9. AGUARDAR AUTENTICAÇÃO
    // =========================================================

    await this.etapa(
        'AGUARDANDO_AUTENTICACAO_CERTIFICADO'
    );

    const inicio =
        Date.now();

    while (
        Date.now() - inicio <
        30000
    ) {

        if (
            await this.estaAutenticado()
        ) {

            console.log(
                '✅ [eSocial] Login confirmado.'
            );

            await this.etapa(
                'AUTENTICADO'
            );

            return true;
        }

        const texto =
            normalizarTexto(
                await page
                    .locator('body')
                    .innerText()
                    .catch(
                        () => ''
                    )
            );

        if (
            texto.includes('captcha') ||
            texto.includes(
                'verificacao em duas etapas'
            ) ||
            texto.includes(
                'codigo de verificacao'
            )
        ) {

            throw criarErroRobo(
                'INTERVENCAO_LOGIN_NECESSARIA',
                'O gov.br solicitou uma etapa adicional de autenticação que não pode ser automatizada com segurança.',
                await obterDiagnosticoSeguro(
                    page,
                    'AUTENTICACAO'
                )
            );
        }

        await page.waitForTimeout(
            1000
        );
    }

    const diagnostico =
        await obterDiagnosticoSeguro(
            page,
            'AUTENTICACAO'
        );

    throw criarErroRobo(
        'LOGIN_NAO_CONFIRMADO',
        'A opção de certificado digital foi acionada, mas o login no eSocial não foi confirmado.',
        diagnostico
    );
}

    async estaAutenticado() {
        if (!this.page) return false;
        const page = this.page;
        const url = page.url();

        if (/login\.esocial\.gov\.br\/.*login/i.test(url)) {
            // ainda pode ter sessão e a página conter o menu, então segue para texto
        }

        const sinais = [
            page.getByText(/Trocar Perfil\/Módulo/i),
            page.getByText(/Trocar Perfil/i),
            page.getByText(/Titular do Certificado/i),
            page.getByRole('button', { name: /SAIR/i })
        ];

        for (const sinal of sinais) {
            if (await locatorVisivel(sinal)) return true;
        }

        return false;
    }

    async trocarPerfilParaCnpj(cnpj) {
        const page = this.page;
        const cnpjLimpo = somenteDigitos(cnpj);

        if (cnpjLimpo.length !== 14) {
            throw criarErroRobo('CNPJ_INVALIDO', `CNPJ inválido: ${cnpj}`);
        }

        await this.etapa('TROCANDO_PERFIL', { cnpj: cnpjLimpo });

        const abriuTroca = await clicarPorTexto(page, [
            /Trocar Perfil\/Módulo/i,
            /Trocar Perfil/i
        ], 2500);

        if (!abriuTroca) {
            const diag = await obterDiagnosticoSeguro(page, 'ABRIR_TROCA_PERFIL');
            throw criarErroRobo(
                'LAYOUT_TROCA_PERFIL_NAO_RECONHECIDO',
                'Não encontrei a opção "Trocar Perfil/Módulo" no portal.',
                diag
            );
        }

        await page.waitForTimeout(800);

        let perfilSelecionado = await selecionarOpcaoContendo(
            page,
            /Procurador de Pessoa Jur[ií]dica\s*-?\s*CNPJ/i
        );

        if (!perfilSelecionado) {
            perfilSelecionado = await clicarPorTexto(page, [
                /Procurador de Pessoa Jurídica\s*-?\s*CNPJ/i,
                /Procurador de Pessoa Juridica\s*-?\s*CNPJ/i
            ], 1500);
        }

        if (!perfilSelecionado) {
            const diag = await obterDiagnosticoSeguro(page, 'SELECIONAR_PERFIL');
            throw criarErroRobo(
                'PERFIL_PROCURADOR_NAO_ENCONTRADO',
                'O perfil "Procurador de Pessoa Jurídica - CNPJ" não apareceu para o certificado.',
                diag
            );
        }

        const preencheu = await preencherPrimeiroCampo(
            page,
            [
                page.getByLabel(/CNPJ representado/i),
                page.getByLabel(/Informe o CNPJ/i),
                page.getByPlaceholder(/CNPJ/i),
                'input[name*="cnpj" i]',
                'input[id*="cnpj" i]',
                'input[type="text"]'
            ],
            cnpjLimpo
        );

        if (!preencheu) {
            const diag = await obterDiagnosticoSeguro(page, 'PREENCHER_CNPJ');
            throw criarErroRobo(
                'CAMPO_CNPJ_NAO_ENCONTRADO',
                'Não encontrei o campo para informar o CNPJ representado.',
                diag
            );
        }

        const continuou = await clicarPorTexto(page, [
            /^Continuar$/i,
            /^Verificar$/i,
            /Acessar/i
        ], 2500);

        if (!continuou) {
            const diag = await obterDiagnosticoSeguro(page, 'CONFIRMAR_PERFIL');
            throw criarErroRobo(
                'BOTAO_CONTINUAR_NAO_ENCONTRADO',
                'Não encontrei o botão para confirmar o CNPJ representado.',
                diag
            );
        }

        await page.waitForTimeout(1200);

        const corpo = normalizarTexto(
            await page.locator('body').innerText().catch(() => '')
        );

        if (
            corpo.includes('nao possui procuracao') ||
            corpo.includes('não possui procuração') ||
            corpo.includes('procuracao nao encontrada') ||
            corpo.includes('procuração não encontrada') ||
            corpo.includes('sem permissao') ||
            corpo.includes('sem permissão')
        ) {
            const diag = await obterDiagnosticoSeguro(page, 'VALIDAR_PROCURACAO');
            throw criarErroRobo(
                'PROCURACAO_NAO_ENCONTRADA',
                'O eSocial informou que o certificado não possui procuração/permissão para este CNPJ.',
                diag
            );
        }

        // Em algumas versões a tela pede também o módulo após o perfil.
        await clicarPorTexto(page, [
            /^Geral$/i,
            /Geral Pessoa Jurídica/i,
            /Módulo Geral/i
        ], 1000);

        await page.waitForTimeout(800);
        await this.etapa('PERFIL_ATIVO', { cnpj: cnpjLimpo });
        return true;
    }

    async abrirRelatoriosGerenciais() {
        const page = this.page;
        await this.etapa('ABRINDO_RELATORIOS_GERENCIAIS');

        const clicou = await clicarPorTexto(page, [
            /Relatórios Gerenciais/i,
            /Relatorios Gerenciais/i
        ], 3500);

        if (!clicou) {
            const diag = await obterDiagnosticoSeguro(page, 'ABRIR_RELATORIOS_GERENCIAIS');
            throw criarErroRobo(
                'MENU_RELATORIOS_NAO_ENCONTRADO',
                'Não encontrei o menu "Relatórios Gerenciais" no eSocial.',
                diag
            );
        }

        await page.waitForTimeout(1000);
        return true;
    }

    async tentarBaixarDisponivel() {
        const page = this.page;

        const linhas = page.locator('tr');
        const quantidade = await linhas.count();

        for (let i = 0; i < quantidade; i++) {
            const linha = linhas.nth(i);
            const texto = normalizarTexto(await linha.innerText().catch(() => ''));

            if (!texto.includes('relacao de trabalhadores')) continue;

            const downloadBtn = linha.getByRole('link', { name: /Baixar|Download/i })
                .or(linha.getByRole('button', { name: /Baixar|Download/i }));

            if (await locatorVisivel(downloadBtn)) {
                const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
                await downloadBtn.first().click();
                const download = await downloadPromise;
                const caminho = await download.path();
                if (!caminho) throw new Error('Download concluído sem caminho temporário.');

                return {
                    nomeArquivo: download.suggestedFilename() || 'relacao-trabalhadores.xlsx',
                    buffer: fs.readFileSync(caminho)
                };
            }
        }

        // Fallback: qualquer botão/link de download visível quando a página
        // já está claramente no relatório de trabalhadores.
        const corpo = normalizarTexto(await page.locator('body').innerText().catch(() => ''));
        if (corpo.includes('relacao de trabalhadores')) {
            const geral = page.getByRole('link', { name: /Baixar|Download/i })
                .or(page.getByRole('button', { name: /Baixar|Download/i }));

            if (await locatorVisivel(geral)) {
                const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
                await geral.first().click();
                const download = await downloadPromise;
                const caminho = await download.path();
                if (!caminho) throw new Error('Download concluído sem caminho temporário.');
                return {
                    nomeArquivo: download.suggestedFilename() || 'relacao-trabalhadores.xlsx',
                    buffer: fs.readFileSync(caminho)
                };
            }
        }

        return null;
    }

    async solicitarRelacaoTrabalhadores() {
        const page = this.page;
        await this.etapa('SOLICITANDO_RELATORIO');

        // Se já houver relatório disponível, não gera outro pedido.
        const disponivel = await this.tentarBaixarDisponivel();
        if (disponivel) return disponivel;

        // Selecionar o relatório por select ou por texto.
        let selecionou = await selecionarOpcaoContendo(
            page,
            /Rela[cç][aã]o de trabalhadores\s*-?\s*eSocial/i
        );

        if (!selecionou) {
            selecionou = await clicarPorTexto(page, [
                /Relação de trabalhadores\s*-?\s*eSocial/i,
                /Relação de trabalhadores/i
            ], 2500);
        }

        if (!selecionou) {
            const diag = await obterDiagnosticoSeguro(page, 'SELECIONAR_RELATORIO');
            throw criarErroRobo(
                'RELATORIO_TRABALHADORES_NAO_ENCONTRADO',
                'Não encontrei o relatório "Relação de trabalhadores - eSocial".',
                diag
            );
        }

        await page.waitForTimeout(500);

        // Preferir XLSX, depois CSV.
        await selecionarOpcaoContendo(page, /XLSX|Excel|XLS/i);
        await clicarPorTexto(page, [/XLSX/i, /Excel/i], 600);

        const solicitou = await clicarPorTexto(page, [
            /Solicitar Relatório/i,
            /^Solicitar$/i,
            /^Gerar$/i,
            /Gerar Relatório/i
        ], 2500);

        if (!solicitou) {
            // Pode ter navegado para uma página em que o pedido já existe.
            const existente = await this.tentarBaixarDisponivel();
            if (existente) return existente;

            const diag = await obterDiagnosticoSeguro(page, 'SOLICITAR_RELATORIO');
            throw criarErroRobo(
                'BOTAO_SOLICITAR_RELATORIO_NAO_ENCONTRADO',
                'Não encontrei o botão para solicitar o relatório de trabalhadores.',
                diag
            );
        }

        await page.waitForTimeout(1000);
        return null;
    }

    async aguardarRelatorioDisponivel() {
        const page = this.page;
        const inicio = Date.now();

        await this.etapa('AGUARDANDO_RELATORIO');

        while (Date.now() - inicio < this.timeoutRelatorio) {
            const arquivo = await this.tentarBaixarDisponivel();
            if (arquivo) return arquivo;

            await page.waitForTimeout(12000);

            try {
                await page.reload({ waitUntil: 'domcontentloaded', timeout: this.timeoutNavegacao });
            } catch (_) {
                // Alguns relatórios usam navegação SPA; recarregar não é obrigatório.
            }

            await page.waitForTimeout(800);
        }

        const diag = await obterDiagnosticoSeguro(page, 'AGUARDAR_RELATORIO');
        throw criarErroRobo(
            'TIMEOUT_RELATORIO',
            `O relatório não ficou disponível dentro de ${Math.round(this.timeoutRelatorio / 60000)} minuto(s).`,
            diag
        );
    }

    async baixarRelacaoTrabalhadores(cnpj) {
        await this.trocarPerfilParaCnpj(cnpj);
        await this.abrirRelatoriosGerenciais();

        const imediato = await this.solicitarRelacaoTrabalhadores();
        if (imediato) {
            await this.etapa('RELATORIO_BAIXADO', { cnpj: somenteDigitos(cnpj), arquivo: imediato.nomeArquivo });
            return imediato;
        }

        const arquivo = await this.aguardarRelatorioDisponivel();
        await this.etapa('RELATORIO_BAIXADO', { cnpj: somenteDigitos(cnpj), arquivo: arquivo.nomeArquivo });
        return arquivo;
    }

    async diagnosticarAcesso(cnpj = '') {
        await this.autenticar();

        if (cnpj) {
            await this.trocarPerfilParaCnpj(cnpj);
        }

        return {
            success: true,
            autenticado: true,
            cnpjTestado: cnpj ? somenteDigitos(cnpj) : null,
            diagnostico: await obterDiagnosticoSeguro(this.page, 'DIAGNOSTICO_OK')
        };
    }
}

module.exports = {
    EsocialRelatoriosRobo,
    obterOrigensCertificado
};