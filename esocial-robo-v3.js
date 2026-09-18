// ============================================================
// esocial.js - Módulo e-Social com integração SOC
// Atualizado para trabalhar com backend hospedado no Render
// ============================================================

(() => {
    'use strict';

    window.ESOCIAL_FRONTEND_VERSION = 'CONECTOR_LOCAL_V5_20260917';
    console.log('eSocial frontend:', window.ESOCIAL_FRONTEND_VERSION);

    // ============================================================
    // CONFIGURAÇÃO
    // ============================================================

    // Backend principal hospedado no Render.
    // Pode ser sobrescrito antes de carregar este arquivo definindo:
    // window.ESOCIAL_API_BASE_URL = 'https://outro-endereco.onrender.com';
    const API_BASE_URL = String(
        window.ESOCIAL_API_BASE_URL ||
        'https://sistema-metodos.onrender.com'
    ).replace(/\/+$/, '');

    const REGISTROS_POR_PAGINA = 25;

    let eventosESocial = [];

/*
 * Guarda a lista antes da pesquisa rápida.
 *
 * Assim conseguimos pesquisar instantaneamente sem
 * consultar o servidor novamente a cada letra digitada.
 */
let eventosESocialBase = [];

// Cache amplo para montar o painel do colaborador (admissão, S-2220 e S-2240)
// mesmo quando a visualização atual estiver filtrada.
let eventosESocialHistorico = [];

let paginaAtualESocial = 1;

let eventosSelecionados = new Set();

let empresasSocCache = [];

let timerAcompanhamentoPreparacaoEsocial = null;
let fimAcompanhamentoPreparacaoEsocial = 0;

    // ============================================================
    // API
    // ============================================================

    function apiUrl(path) {
        return `${API_BASE_URL}${path}`;
    }

    async function obterTokenESocial() {
        try {
            if (
                typeof supabaseClient === 'undefined' ||
                !supabaseClient?.auth
            ) {
                return null;
            }

            const { data } =
                await supabaseClient.auth.getSession();

            return (
                data?.session?.access_token ||
                null
            );

        } catch (error) {
            console.warn(
                '⚠️ Não foi possível obter token:',
                error.message
            );

            return null;
        }
    }

    function criarHeaders(
        token,
        json = false
    ) {
        const headers = {};

        if (json) {
            headers['Content-Type'] =
                'application/json';
        }

        if (token) {
            headers.Authorization =
                `Bearer ${token}`;
        }

        return headers;
    }

    async function lerRespostaJson(
        response
    ) {
        const text =
            await response.text();

        let data = {};

        if (text) {
            try {
                data = JSON.parse(text);

            } catch (error) {
                console.error(
                    '❌ Resposta não JSON:',
                    text
                );

                throw new Error(
                    `Servidor retornou resposta inválida ` +
                    `(HTTP ${response.status}). ` +
                    `Confirme se o backend está disponível em ` +
                    `${API_BASE_URL}.`
                );
            }
        }

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                data.details?.message ||
                `Erro HTTP ${response.status}`
            );
        }

        return data;
    }

    async function requisicaoJson(
        path,
        options = {}
    ) {
        const url =
            apiUrl(path);

        try {
            const response =
                await fetch(
                    url,
                    options
                );

            return lerRespostaJson(response);

        } catch (error) {
            // Erros de rede/CORS chegam ao fetch como TypeError/Failed to fetch.
            if (
                error instanceof TypeError ||
                /failed to fetch|networkerror|load failed/i.test(
                    String(error?.message || '')
                )
            ) {
                throw new Error(
                    `Não foi possível conectar ao backend em ${API_BASE_URL}. ` +
                    `Verifique se o serviço do Render está online e se o CORS ` +
                    `do server.js permite a origem deste sistema.`
                );
            }

            throw error;
        }
    }

    // ============================================================
    // AUXILIARES
    // ============================================================

    function escaparHtml(valor) {
        const div =
            document.createElement('div');

        div.textContent =
            String(valor ?? '');

        return div.innerHTML;
    }

    function formatarCnpjFiltroEsocial(cnpj) {
        const clean =
            String(
                cnpj ||
                ''
            ).replace(
                /\D/g,
                ''
            );

        if (
            clean.length ===
                14
        ) {
            return clean.replace(
                /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
                '$1.$2.$3/$4-$5'
            );
        }

        return String(
            cnpj ||
            ''
        );
    }


    function formatarCpf(cpf) {
        if (!cpf) {
            return '—';
        }

        const clean =
            String(cpf).replace(
                /\D/g,
                ''
            );

        if (clean.length === 11) {
            return clean.replace(
                /(\d{3})(\d{3})(\d{3})(\d{2})/,
                '$1.$2.$3-$4'
            );
        }

        return String(cpf);
    }

    function formatarDataExibicao(
        data
    ) {
        if (!data) {
            return '—';
        }

        const texto =
            String(data).trim();

        /*
         * Já DD/MM/AAAA
         */
        if (
            /^\d{2}\/\d{2}\/\d{4}/
                .test(texto)
        ) {
            return texto.substring(
                0,
                10
            );
        }

        /*
         * YYYY-MM-DD
         */
        const iso =
            texto.match(
                /^(\d{4})-(\d{2})-(\d{2})/
            );

        if (iso) {
            return (
                `${iso[3]}/` +
                `${iso[2]}/` +
                `${iso[1]}`
            );
        }

        return texto;
    }

    function formatarDataSOC(
        dataIso
    ) {
        if (!dataIso) {
            return '';
        }

        const match =
            String(dataIso).match(
                /^(\d{4})-(\d{2})-(\d{2})$/
            );

        if (!match) {
            return dataIso;
        }

        return (
            `${match[3]}/` +
            `${match[2]}/` +
            `${match[1]}`
        );
    }

    function traduzirTipoAso(
        tipo
    ) {
        const tipos = {
            '1': 'Admissional',
            '2': 'Periódico',
            '3': 'Retorno ao Trabalho',
            '4': 'Mudança de Riscos Ocupacionais',
            '5': 'Demissional',
            '6': 'Monitoração Pontual'
        };

        return (
            tipos[String(tipo ?? '')] ||
            String(tipo || '—')
        );
    }

    function primeiroCampo(
        objeto,
        nomes,
        fallback = ''
    ) {
        if (
            !objeto ||
            typeof objeto !== 'object'
        ) {
            return fallback;
        }

        for (
            const nome
            of nomes
        ) {
            const valor =
                objeto[nome];

            if (
                valor !== undefined &&
                valor !== null &&
                valor !== ''
            ) {
                return valor;
            }
        }

        const mapa =
            new Map(
                Object.entries(objeto)
                    .map(
                        ([chave, valor]) => [
                            chave.toLowerCase(),
                            valor
                        ]
                    )
            );

        for (
            const nome
            of nomes
        ) {
            const valor =
                mapa.get(
                    String(nome)
                        .toLowerCase()
                );

            if (
                valor !== undefined &&
                valor !== null &&
                valor !== ''
            ) {
                return valor;
            }
        }

        return fallback;
    }

    function mostrarAlertaESocial(
        mensagem,
        tipo = 'info'
    ) {
        const area =
            document.getElementById(
                'alertAreaESocial'
            );

        if (!area) {
            console.log(
                `${tipo.toUpperCase()}: ` +
                mensagem
            );

            return;
        }

        area.innerHTML = `
            <div
                class="alert alert-${tipo}
                       alert-dismissible fade show"
                role="alert"
            >
                ${escaparHtml(mensagem)}

                <button
                    type="button"
                    class="btn-close"
                    data-bs-dismiss="alert"
                ></button>
            </div>
        `;
    }

    function mostrarStatusBuscaSoc(
        html
    ) {
        const statusEl =
            document.getElementById(
                'buscarSocStatus'
            );

        if (statusEl) {
            statusEl.innerHTML =
                html;
        }
    }

    // ============================================================
    // STATUS SOC
    // ============================================================

    async function verificarStatusSoc() {
        const badge =
            document.getElementById(
                'esocialStatusBadge'
            );

        if (!badge) {
            return;
        }

        badge.textContent =
            'Verificando...';

        badge.className =
            'badge bg-secondary ms-2';

        try {
            const data =
                await requisicaoJson(
                    '/api/soc/status-integracao'
                );

            if (
                data.connected &&
                data.authenticated
            ) {
                badge.textContent =
                    'SOC Conectado';

                badge.className =
                    'badge bg-success ms-2';

            } else if (
                data.connected
            ) {
                badge.textContent =
                    'SOC Parcial';

                badge.className =
                    'badge bg-warning text-dark ms-2';

            } else {
                badge.textContent =
                    'SOC Desconectado';

                badge.className =
                    'badge bg-danger ms-2';
            }

        } catch (error) {
            console.error(
                '❌ Erro status SOC:',
                error
            );

            badge.textContent =
                'SOC Desconectado';

            badge.className =
                'badge bg-danger ms-2';
        }
    }

    // ============================================================
    // EMPRESAS E HOLDINGS
    // ============================================================

    async function carregarEmpresasParaESocial() {
        try {
            if (
                typeof supabaseClient ===
                'undefined'
            ) {
                throw new Error(
                    'Supabase não disponível.'
                );
            }

            const {
                data,
                error
            } =
                await supabaseClient
                    .from('precos')
                    .select(
                        'id, unidade, holding, cnpj'
                    )
                    .order('unidade');

            if (error) {
                throw error;
            }

            empresasSocCache =
                Array.isArray(data)
                    ? data
                    : [];

            preencherHoldings();
            preencherEmpresas();

            console.log(
                `📋 ${empresasSocCache.length} ` +
                `empresas carregadas.`
            );

        } catch (error) {
            console.error(
                '❌ Erro ao carregar empresas:',
                error
            );

            empresasSocCache = [];
        }
    }

    function preencherHoldings() {
        const selectHolding =
            document.getElementById(
                'socHolding'
            );

        if (!selectHolding) {
            return;
        }

        const valorAtual =
            selectHolding.value;

        const holdings = [
            ...new Set(
                empresasSocCache
                    .map(
                        item =>
                            item.holding
                    )
                    .filter(Boolean)
            )
        ].sort(
            (a, b) =>
                String(a)
                    .localeCompare(
                        String(b),
                        'pt-BR'
                    )
        );

        selectHolding.innerHTML =
            '<option value="">' +
            'Todas as Holdings' +
            '</option>';

        for (
            const holding
            of holdings
        ) {
            const option =
                document.createElement(
                    'option'
                );

            option.value =
                holding;

            option.textContent =
                holding;

            selectHolding
                .appendChild(option);
        }

        if (
            holdings.includes(
                valorAtual
            )
        ) {
            selectHolding.value =
                valorAtual;
        }
    }

    function preencherEmpresas() {
        const selectEmpresa =
            document.getElementById(
                'socEmpresa'
            );

        const selectHolding =
            document.getElementById(
                'socHolding'
            );

        if (!selectEmpresa) {
            return;
        }

        const holding =
            selectHolding?.value ||
            '';

        const valorAtual =
            selectEmpresa.value;

        const empresas =
            empresasSocCache
                .filter(
                    item => {
                        return (
                            !holding ||
                            String(
                                item.holding ||
                                ''
                            ) ===
                            String(holding)
                        );
                    }
                );

        selectEmpresa.innerHTML =
            '<option value="">' +
            'Todas as empresas' +
            '</option>';

        for (
            const empresa
            of empresas
        ) {
            const option =
                document.createElement(
                    'option'
                );

            option.value =
                empresa.id;

            const cnpjFormatado =
                formatarCnpjFiltroEsocial(
                    empresa.cnpj ||
                    ''
                );

            option.textContent =
                (
                    empresa.unidade ||
                    `Empresa ${empresa.id}`
                ) +
                (
                    cnpjFormatado
                        ? ` — ${cnpjFormatado}`
                        : ''
                );

            selectEmpresa
                .appendChild(option);
        }

        if (
            empresas.some(
                item =>
                    String(item.id) ===
                    String(valorAtual)
            )
        ) {
            selectEmpresa.value =
                valorAtual;
        }
    }

    function localizarEmpresa(
        codigoEmpresa
    ) {
        const codigo =
            String(
                codigoEmpresa ?? ''
            ).trim();

        return (
            empresasSocCache.find(
                item =>
                    String(
                        item.id ?? ''
                    ).trim() === codigo
            ) ||
            null
        );
    }

    function empresasPermitidasPeloFiltro() {
        const holding =
            document.getElementById(
                'socHolding'
            )?.value ||
            '';

        const empresa =
            document.getElementById(
                'socEmpresa'
            )?.value ||
            '';

        return empresasSocCache
            .filter(
                item => {
                    if (
                        holding &&
                        String(
                            item.holding ||
                            ''
                        ) !==
                        String(holding)
                    ) {
                        return false;
                    }

                    if (
                        empresa &&
                        String(item.id) !==
                        String(empresa)
                    ) {
                        return false;
                    }

                    return true;
                }
            );
    }

    // ============================================================
    // NORMALIZAR RETORNO SOC
    // ============================================================

    function localizarArrayDados(
        valor
    ) {
        if (
            Array.isArray(valor)
        ) {
            return valor;
        }

        if (
            !valor ||
            typeof valor !== 'object'
        ) {
            return [];
        }

        const chaves = [
            'dados',
            'registros',
            'items',
            'itens',
            'resultado',
            'retorno',
            'rows'
        ];

        for (
            const chave
            of chaves
        ) {
            if (
                Array.isArray(
                    valor[chave]
                )
            ) {
                return valor[chave];
            }
        }

        return [valor];
    }

    function montarResumoAso(
        item
    ) {
        const linhas = [];

        const adicionar = (
            rotulo,
            valor
        ) => {
            if (
                valor !== undefined &&
                valor !== null &&
                String(valor)
                    .trim() !== ''
            ) {
                linhas.push(
                    `${rotulo}: ${valor}`
                );
            }
        };

        adicionar(
            'Trabalhador',
            primeiroCampo(
                item,
                ['NMTRAB']
            )
        );

        adicionar(
            'CPF',
            formatarCpf(
                primeiroCampo(
                    item,
                    ['CPFTRAB']
                )
            )
        );

        adicionar(
            'Matrícula',
            primeiroCampo(
                item,
                [
                    'MATRICULA',
                    'MATRICULARH'
                ]
            )
        );

        adicionar(
            'Data do ASO',
            primeiroCampo(
                item,
                [
                    'DTASO',
                    'DATAFICHA'
                ]
            )
        );

        adicionar(
            'Resultado ASO',
            primeiroCampo(
                item,
                [
                    'RESASO',
                    'RESASOSOC'
                ]
            )
        );

        adicionar(
            'Médico',
            primeiroCampo(
                item,
                [
                    'NMMEDFICHA',
                    'NMEMISSORASO'
                ]
            )
        );

        adicionar(
            'CRM',
            primeiroCampo(
                item,
                [
                    'NRCRMMEDFICHA',
                    'NRCRMEMISSORASO'
                ]
            )
        );

        adicionar(
            'UF CRM',
            primeiroCampo(
                item,
                [
                    'UFCRMMEDFICHA',
                    'UFCRMEMISSORASO'
                ]
            )
        );

        adicionar(
            'Exame',
            primeiroCampo(
                item,
                ['DESCRICAOEXAME']
            )
        );

        adicionar(
            'Data do exame',
            primeiroCampo(
                item,
                ['DTEXAME']
            )
        );

        adicionar(
            'Procedimento eSocial',
            primeiroCampo(
                item,
                ['PROCREALIZADO']
            )
        );

        adicionar(
            'Responsável',
            primeiroCampo(
                item,
                ['NOMERESPONSAVEL']
            )
        );

        adicionar(
            'CPF responsável',
            primeiroCampo(
                item,
                ['CPFRESPONSAVEL']
            )
        );

        return linhas.join('\n');
    }

    function normalizarRegistroS2220(
        item,
        indice
    ) {
        const codigoEmpresa =
            String(
                primeiroCampo(
                    item,
                    [
                        'CODIGOEMPRESA',
                        'codigoEmpresa',
                        'empresa'
                    ],
                    ''
                )
            ).trim();

        const empresa =
            localizarEmpresa(
                codigoEmpresa
            );

            const cnpjUnidade =
            normalizarCnpj(
                empresa.cnpj || ''
            );

        const tipoAso =
            primeiroCampo(
                item,
                [
                    'TPEXAMEOCUP',
                    'TPEXAME'
                ],
                ''
            );

        const descricaoExame =
            primeiroCampo(
                item,
                [
                    'DESCRICAOEXAME'
                ],
                ''
            );

        const tipoExame =
            descricaoExame
                ? (
                    `${traduzirTipoAso(
                        tipoAso
                    )} - ${descricaoExame}`
                )
                : traduzirTipoAso(
                    tipoAso
                );

        const idFicha =
            primeiroCampo(
                item,
                ['IDFICHA'],
                indice
            );

        const codigoFuncionario =
            primeiroCampo(
                item,
                [
                    'CODIGOFUNCIONARIO'
                ],
                ''
            );

        return {
            id:
                `soc-` +
                `${codigoEmpresa || 'principal'}-` +
                `${idFicha}-` +
                `${indice}`,

            holding:
                empresa?.holding ||
                'N/A',

            unidade:
                empresa?.unidade ||
                (
                    codigoEmpresa
                        ? `Empresa ${codigoEmpresa}`
                        : 'N/A'
                ),

            colaborador:
                primeiroCampo(
                    item,
                    [
                        'NMTRAB',
                        'NOMEFUNCIONARIO'
                    ],
                    'N/A'
                ),

            cpf:
                String(
                    primeiroCampo(
                        item,
                        [
                            'CPFTRAB',
                            'CPF'
                        ],
                        ''
                    )
                ).replace(
                    /\D/g,
                    ''
                ),

            data_exame:
                primeiroCampo(
                    item,
                    [
                        'DTEXAME',
                        'DTASO',
                        'DATAFICHA'
                    ],
                    ''
                ),

            tipo_exame:
                tipoExame,

            tipo_evento:
                'S-2220',

            status:
                'consultado',

            numero_recibo:
                '',

            aso:
                montarResumoAso(
                    item
                ),

            codigo_funcionario:
                String(
                    codigoFuncionario ||
                    ''
                ),

            codigo_empresa:
                codigoEmpresa,

            persistido:
                false,

            origem:
                'SOC',

            rawSoc:
                item
        };
    }

    function aplicarFiltroEmpresaNosDados(
        registros
    ) {
        const holdingSelecionada =
            document.getElementById(
                'socHolding'
            )?.value ||
            '';

        const empresaSelecionada =
            document.getElementById(
                'socEmpresa'
            )?.value ||
            '';

        if (
            !holdingSelecionada &&
            !empresaSelecionada
        ) {
            return registros;
        }

        const permitidas =
            empresasPermitidasPeloFiltro();

        const codigosPermitidos =
            new Set(
                permitidas.map(
                    item =>
                        String(
                            item.id ?? ''
                        ).trim()
                )
            );

        return registros.filter(
            item => {
                const codigo =
                    String(
                        primeiroCampo(
                            item,
                            [
                                'CODIGOEMPRESA',
                                'codigoEmpresa',
                                'empresa'
                            ],
                            ''
                        )
                    ).trim();

                return (
                    codigo &&
                    codigosPermitidos
                        .has(codigo)
                );
            }
        );
    }

    async function buscarDadosSoc() {

        const btn =
            document.getElementById(
                'btnConfirmarBuscaSoc'
            );

        const statusEl =
            document.getElementById(
                'buscarSocStatus'
            );

        const holding =
            document.getElementById(
                'socHolding'
            )?.value || '';

        const empresaId =
            document.getElementById(
                'socEmpresa'
            )?.value || '';

        const dataInicio =
            document.getElementById(
                'socDataInicio'
            )?.value || '';

        const dataFim =
            document.getElementById(
                'socDataFim'
            )?.value || '';


        if (!dataInicio || !dataFim) {

            if (statusEl) {

                statusEl.innerHTML =
                    '<div class="alert alert-warning">' +
                    'Informe a data inicial e a data final.' +
                    '</div>';
            }

            return;
        }


        if (dataInicio > dataFim) {

            if (statusEl) {

                statusEl.innerHTML =
                    '<div class="alert alert-warning">' +
                    'A data inicial não pode ser maior que a data final.' +
                    '</div>';
            }

            return;
        }


        if (btn) {

            btn.disabled = true;

            btn.innerHTML =
                '<i class="fas fa-spinner fa-spin me-1"></i>' +
                ' Buscando e preparando...';
        }


        if (statusEl) {

            statusEl.innerHTML =
                '<div class="alert alert-info">' +
                '<strong>Etapa 1 de 2:</strong> consultando dados no SOC...' +
                '</div>';
        }


        try {

            const token =
                await obterTokenESocial();


            // ====================================================
            // 1. BUSCAR SOC NO PERÍODO
            // ====================================================

            const response =
                await fetch(
                    apiUrl(
                        '/api/soc/buscar-dados-esocial'
                    ),
                    {
                        method:
                            'POST',
                        headers:
                            criarHeaders(
                                token,
                                true
                            ),
                        body:
                            JSON.stringify({
                                holding,
                                empresaId,
                                dataInicio,
                                dataFim,
                                salvar:
                                    true,
                                parametrosSoc: {
                                    s2220: {
                                        pDataIncAso:
                                            '3',
                                        tpExame:
                                            '1,2,3,4,5,6'
                                    }
                                }
                            })
                    }
                );


            const textoResposta =
                await response.text();


            let result = {};


            try {

                result =
                    textoResposta
                        ? JSON.parse(
                            textoResposta
                        )
                        : {};

            } catch (erroJson) {

                console.error(
                    'Resposta não JSON:',
                    textoResposta
                );

                throw new Error(
                    'O servidor retornou uma resposta inválida.'
                );
            }


            if (
                !response.ok ||
                result.success === false
            ) {

                throw new Error(
                    result.error ||
                    result.message ||
                    `Erro HTTP ${response.status}`
                );
            }


            const linhasRecebidas =
                Number(
                    result.s2220
                        ?.linhasRecebidas ||
                    0
                );


            const asosAgrupados =
                Number(
                    result.s2220
                        ?.asosAgrupados ||
                    0
                );


            const empresasConsultadas =
                result.s2220
                    ?.empresasSocConsultadas ||
                [];


            console.log(
                'RESULTADO BUSCA SOC:',
                result
            );


            if (
                linhasRecebidas === 0
            ) {

                let empresasTexto = '';


                if (
                    Array.isArray(
                        empresasConsultadas
                    ) &&
                    empresasConsultadas.length
                ) {

                    empresasTexto =
                        '<hr>' +
                        empresasConsultadas
                            .map(item => {
                                const qtd =
                                    item.linhasRecebidas ||
                                    0;

                                return (
                                    `${item.unidade} ` +
                                    `(SOC ${item.codigoSoc}) ` +
                                    `- ${qtd} linha(s)`
                                );
                            })
                            .join('<br>');
                }


                if (statusEl) {

                    statusEl.innerHTML =
                        '<div class="alert alert-warning">' +
                        '<strong>Consulta realizada, mas nenhum registro S-2220 foi encontrado.</strong>' +
                        '<br>' +
                        `Holding: ${holding || 'Todas'}` +
                        empresasTexto +
                        '</div>';
                }

                return;
            }


            // ====================================================
            // 2. PREPARAR E-SOCIAL COM CACHE + FILA AUTOMÁTICA
            //
            // ESTA ROTA NÃO FAZ NOVA CONSULTA BX.
            // ====================================================

            const eventoIds =
                Array.from(
                    new Set(
                        (
                            Array.isArray(
                                result.dados
                            )
                                ? result.dados
                                : []
                        )
                            .map(
                                item =>
                                    String(
                                        item?.id ||
                                        ''
                                    ).trim()
                            )
                            .filter(
                                Boolean
                            )
                    )
                );


            if (statusEl) {

                statusEl.innerHTML =
                    '<div class="alert alert-info">' +
                    '<strong>Etapa 2 de 2:</strong> preparando dados do eSocial...' +
                    '<br><small>O sistema está usando o histórico já disponível e colocando vínculos faltantes na fila automática.</small>' +
                    '</div>';
            }


            let preparacao = {
                success:
                    true,
                resumo: {
                    total:
                        eventoIds.length,
                    jaEmitidos:
                        0,
                    prontosEnvio:
                        0,
                    aguardandoMatricula:
                        eventoIds.length,
                    aguardandoVerificacao:
                        0,
                    s2240AguardandoDados:
                        0,
                    erros:
                        0
                }
            };


            if (
                eventoIds.length
            ) {

                const responsePreparacao =
                    await fetch(
                        apiUrl(
                            '/api/soc/preparar-periodo-esocial'
                        ),
                        {
                            method:
                                'POST',
                            headers:
                                criarHeaders(
                                    token,
                                    true
                                ),
                            body:
                                JSON.stringify({
                                    eventoIds,
                                    holding,
                                    empresaId,
                                    dataInicio,
                                    dataFim
                                })
                        }
                    );


                const textoPreparacao =
                    await responsePreparacao.text();


                try {

                    preparacao =
                        textoPreparacao
                            ? JSON.parse(
                                textoPreparacao
                            )
                            : preparacao;

                } catch (errorJson) {

                    console.warn(
                        '⚠️ Resposta de preparação não JSON:',
                        textoPreparacao
                    );
                }


                if (
                    !responsePreparacao.ok ||
                    preparacao.success === false
                ) {

                    console.warn(
                        '⚠️ Preparação do período retornou aviso:',
                        preparacao
                    );
                }
            }


            const resumo =
                preparacao.resumo ||
                {};


            if (
                typeof carregarEventosESocial ===
                'function'
            ) {

                await carregarEventosESocial();
            }


            const aguardando =
                Number(
                    resumo.aguardandoMatricula ||
                    0
                ) +
                Number(
                    resumo.aguardandoVerificacao ||
                    0
                );


            if (
                aguardando >
                0
            ) {

                iniciarAcompanhamentoPreparacaoEsocial(
                    eventoIds
                );
            }


            if (statusEl) {

                const blocoAguardando =
                    aguardando > 0
                        ? (
                            '<br><br>' +
                            '<strong>Preparação continuará em segundo plano.</strong>' +
                            '<br>Não é necessário clicar nas lupas. A tabela será atualizada automaticamente.'
                        )
                        : '';


                statusEl.innerHTML =
                    '<div class="alert alert-success">' +
                    '<strong>Período carregado e preparado.</strong>' +
                    '<br>' +
                    `${linhasRecebidas} linha(s) recebida(s) do SOC; ` +
                    `${asosAgrupados} ASO(s) agrupado(s).` +
                    '<hr class="my-2">' +
                    `<strong>${Number(resumo.jaEmitidos || 0)}</strong> já emitido(s) no eSocial.<br>` +
                    `<strong>${Number(resumo.prontosEnvio || 0)}</strong> pronto(s) para envio manual.<br>` +
                    `<strong>${Number(resumo.aguardandoMatricula || 0)}</strong> aguardando matrícula oficial.<br>` +
                    `<strong>${Number(resumo.aguardandoVerificacao || 0)}</strong> aguardando confirmação histórica.<br>` +
                    `<strong>${Number(resumo.s2240AguardandoDados || 0)}</strong> S-2240 aguardando dados/completude.` +
                    blocoAguardando +
                    '</div>';
            }


            setTimeout(() => {

                const modalElement =
                    document.getElementById(
                        'buscarDadosSocModal'
                    );


                if (
                    modalElement &&
                    window.bootstrap
                ) {

                    const modal =
                        bootstrap.Modal
                            .getInstance(
                                modalElement
                            );


                    if (modal) {
                        modal.hide();
                    }
                }

            }, 2600);


        } catch (error) {

            console.error(
                'Erro ao buscar/preparar dados eSocial:',
                error
            );


            if (statusEl) {

                statusEl.innerHTML =
                    '<div class="alert alert-danger">' +
                    '<strong>Erro ao consultar/preparar os dados.</strong>' +
                    '<br>' +
                    error.message +
                    '</div>';
            }

        } finally {

            if (btn) {

                btn.disabled = false;

                btn.innerHTML =
                    '<i class="fas fa-search me-1"></i>' +
                    ' Buscar e preparar';
            }
        }
    }


    async function verificarColaboradoresSemAso() {

        const btn =
            document.getElementById(
                'btnVerificarSemAso'
            );

        const statusEl =
            document.getElementById(
                'buscarSocStatus'
            );

        const holding =
            document.getElementById(
                'socHolding'
            )?.value || '';

        const empresaId =
            document.getElementById(
                'socEmpresa'
            )?.value || '';

        const dataInicio =
            document.getElementById(
                'socDataInicio'
            )?.value || '';

        const dataFim =
            document.getElementById(
                'socDataFim'
            )?.value || '';

        if (!dataInicio || !dataFim) {

            if (statusEl) {

                statusEl.innerHTML =
                    '<div class="alert alert-warning">' +
                    'Informe a data inicial e a data final.' +
                    '</div>';
            }

            return;
        }

        if (dataInicio > dataFim) {

            if (statusEl) {

                statusEl.innerHTML =
                    '<div class="alert alert-warning">' +
                    'A data inicial não pode ser maior que a data final.' +
                    '</div>';
            }

            return;
        }

        if (btn) {

            btn.disabled = true;

            btn.innerHTML =
                '<i class="fas fa-spinner fa-spin me-1"></i>' +
                ' Verificando...';
        }

        if (statusEl) {

            statusEl.innerHTML =
                '<div class="alert alert-info">' +
                'Comparando admitidos no período com quem tem ASO admissional no SOC...' +
                '</div>';
        }

        try {

            const token =
                await obterTokenESocial();

            const response =
                await fetch(
                    apiUrl(
                        '/api/soc/colaboradores-sem-aso'
                    ),
                    {
                        method: 'POST',
                        headers: criarHeaders(token, true),
                        body: JSON.stringify({
                            holding,
                            empresaId,
                            dataInicio,
                            dataFim
                        })
                    }
                );

            const textoResposta =
                await response.text();

            let result = {};

            try {

                result =
                    textoResposta
                        ? JSON.parse(textoResposta)
                        : {};

            } catch (erroJson) {

                throw new Error(
                    'O servidor retornou uma resposta inválida.'
                );
            }

            if (
                !response.ok ||
                result.success === false
            ) {

                throw new Error(
                    result.error ||
                    `Erro HTTP ${response.status}`
                );
            }

            const empresas =
                Array.isArray(result.empresas)
                    ? result.empresas
                    : [];

            const empresasComErro =
                empresas.filter(e => e.erro);

            const empresasComGente =
                empresas.filter(
                    e =>
                        Array.isArray(e.colaboradores) &&
                        e.colaboradores.length
                );

            if (!empresasComGente.length) {

                let avisoErros = '';

                if (empresasComErro.length) {

                    avisoErros =
                        '<hr class="my-2">' +
                        '<strong>Não foi possível checar:</strong><br>' +
                        empresasComErro
                            .map(
                                e =>
                                    `${escaparHtml(e.unidade)}: ${escaparHtml(e.erro?.message || 'erro desconhecido')}`
                            )
                            .join('<br>');
                }

                if (statusEl) {

                    statusEl.innerHTML =
                        '<div class="alert alert-success">' +
                        '<strong>Nenhum colaborador sem ASO admissional encontrado</strong> ' +
                        'entre os admitidos no período.' +
                        avisoErros +
                        '</div>';
                }

                return;
            }

            const linhasTabela =
                empresasComGente
                    .map(empresa =>
                        empresa.colaboradores
                            .map(
                                c => `
                                    <tr>
                                        <td>${escaparHtml(empresa.unidade)}</td>
                                        <td>${escaparHtml(c.nome)}</td>
                                        <td>${escaparHtml(c.cargo || '—')}</td>
                                        <td>${escaparHtml(c.nomeUnidade || '—')}</td>
                                        <td>${escaparHtml(c.dataAdmissao || '—')}</td>
                                    </tr>
                                `
                            )
                            .join('')
                    )
                    .join('');

            if (statusEl) {

                statusEl.innerHTML =
                    '<div class="alert alert-warning">' +
                    `<strong>${result.totalSemAso} colaborador(es)</strong> admitido(s) no período ` +
                    'sem ASO admissional registrado no SOC:' +
                    '</div>' +
                    '<div class="table-responsive">' +
                    '<table class="table table-sm table-bordered">' +
                    '<thead><tr>' +
                    '<th>Empresa</th><th>Colaborador</th><th>Cargo</th>' +
                    '<th>Unidade (SOC)</th><th>Admissão</th>' +
                    '</tr></thead>' +
                    `<tbody>${linhasTabela}</tbody>` +
                    '</table>' +
                    '</div>';
            }

        } catch (error) {

            console.error(
                '❌ Erro ao verificar colaboradores sem ASO:',
                error
            );

            if (statusEl) {

                statusEl.innerHTML =
                    '<div class="alert alert-danger">' +
                    '<strong>Erro ao verificar colaboradores sem ASO.</strong>' +
                    '<br>' +
                    error.message +
                    '</div>';
            }

        } finally {

            if (btn) {

                btn.disabled = false;

                btn.innerHTML =
                    '<i class="fas fa-user-slash me-1"></i>' +
                    ' Verificar sem ASO';
            }
        }
    }


    function pararAcompanhamentoPreparacaoEsocial() {

        if (
            timerAcompanhamentoPreparacaoEsocial
        ) {

            clearInterval(
                timerAcompanhamentoPreparacaoEsocial
            );

            timerAcompanhamentoPreparacaoEsocial =
                null;
        }


        fimAcompanhamentoPreparacaoEsocial =
            0;
    }


    function iniciarAcompanhamentoPreparacaoEsocial(
        eventoIds = []
    ) {

        pararAcompanhamentoPreparacaoEsocial();


        if (
            !Array.isArray(
                eventoIds
            ) ||
            !eventoIds.length
        ) {

            return;
        }


        // Atualiza somente a nossa API/local. Não consulta BX diretamente.
        fimAcompanhamentoPreparacaoEsocial =
            Date.now() +
            10 * 60 * 1000;


        timerAcompanhamentoPreparacaoEsocial =
            setInterval(
                async () => {

                    if (
                        Date.now() >=
                        fimAcompanhamentoPreparacaoEsocial
                    ) {

                        pararAcompanhamentoPreparacaoEsocial();
                        return;
                    }


                    if (
                        document.hidden
                    ) {

                        return;
                    }


                    try {

                        await carregarEventosESocial();

                    } catch (error) {

                        console.warn(
                            '⚠️ Não foi possível atualizar automaticamente a preparação eSocial:',
                            error?.message ||
                            error
                        );
                    }
                },
                30000
            );
    }

    // ============================================================
    // CARREGAR EVENTOS SALVOS
    // ============================================================

    async function carregarEventosESocial(
        filtros = {}
    ) {
        try {
            const token =
                await obterTokenESocial();

            const params =
                new URLSearchParams();

            if (
                filtros.status
            ) {
                params.append(
                    'status',
                    filtros.status
                );
            }

            if (
                filtros.dataInicio
            ) {
                params.append(
                    'dataInicio',
                    filtros.dataInicio
                );
            }

            if (
                filtros.dataFim
            ) {
                params.append(
                    'dataFim',
                    filtros.dataFim
                );
            }

            if (
                filtros.empresaId
            ) {
                params.append(
                    'empresaId',
                    filtros.empresaId
                );
            }

            const query =
                params.toString();

            const path =
                `/api/soc/eventos-salvos` +
                (
                    query
                        ? `?${query}`
                        : ''
                );

            const data =
                await requisicaoJson(
                    path,
                    {
                        headers:
                            criarHeaders(
                                token
                            )
                    }
                );

            let eventos =
                Array.isArray(
                    data.eventos
                )
                    ? data.eventos
                    : [];

            /*
             * Filtro por tipo de evento
             * aplicado no frontend.
             */
            if (
                filtros.tipoEvento
            ) {
                eventos =
                    eventos.filter(
                        item =>
                            item.tipo_evento ===
                            filtros.tipoEvento
                    );
            }

            const eventosMapeados =
                eventos.map(
                    item => ({
                        ...item,
                        persistido: true,
                        origem: item.origem || 'BANCO'
                    })
                );

            // Base da visualização atual. Este era o ponto que fazia a
            // pesquisa rápida falhar: eventosESocialBase não era alimentado.
            eventosESocialBase = eventosMapeados.map(item => ({ ...item }));

            // Mantém um histórico em memória para o resumo por colaborador.
            const porId = new Map(
                eventosESocialHistorico.map(item => [String(item.id), item])
            );
            eventosMapeados.forEach(item => {
                porId.set(String(item.id), { ...(porId.get(String(item.id)) || {}), ...item });
            });
            eventosESocialHistorico = Array.from(porId.values());

            atualizarOpcoesFiltrosOrganizacionaisESocial();

            eventosSelecionados.clear();
            paginaAtualESocial = 1;

            aplicarFiltrosLocaisESocial();

        } catch (error) {
            console.error(
                '❌ Erro ao carregar eventos:',
                error
            );

            mostrarAlertaESocial(
                'Erro ao carregar eventos: ' +
                error.message,
                'danger'
            );

            const tbody =
                document.getElementById(
                    'eventosBody'
                );

            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td
                            colspan="15"
                            class="text-center
                                   text-muted py-4"
                        >
                            <i class="fas
                                      fa-exclamation-triangle
                                      me-2"></i>

                            Erro ao carregar eventos
                        </td>
                    </tr>
                `;
            }
        }
    }

    // ============================================================
    // RESUMO REAL DO COLABORADOR NO E-SOCIAL
    // ============================================================

    function normalizarChaveVinculoESocial(evento) {
        const cpf =
            String(
                evento?.cpf ||
                ''
            ).replace(
                /\D/g,
                ''
            );

        const empregador =
            String(
                evento?.nr_insc_empregador ||
                evento?.nrInscEmpregador ||
                ''
            ).replace(
                /\D/g,
                ''
            );

        const cnpjUnidade =
            String(
                evento?.cnpj_unidade ||
                evento?.cnpjUnidade ||
                evento?.cnpj ||
                ''
            ).replace(
                /\D/g,
                ''
            );

        const codigoEmpresa =
            String(
                evento?.codigo_empresa ||
                evento?.codigoEmpresa ||
                ''
            ).trim();

        const unidade =
            String(
                evento?.unidade ||
                evento?.nome_unidade ||
                ''
            )
                .trim()
                .toLowerCase();

        const identidadeUnidade =
            cnpjUnidade.length ===
                14
                ? `CNPJ:${cnpjUnidade}`
                : codigoEmpresa
                    ? `EMP:${codigoEmpresa}`
                    : `UNIDADE:${unidade}`;

        return (
            `${empregador}|${identidadeUnidade}|${cpf}`
        );
    }

    function matriculaPareceOficialESocial(evento) {
        const matricula = String(evento?.matricula || '').trim();
        const matriculaSoc = String(evento?.matricula_soc || '').trim();
        const origem = String(evento?.matricula_origem || '').trim().toLowerCase();

        if (!matricula) return false;

        if (
            origem.includes('esocial') ||
            origem.includes('bx') ||
            origem.includes('cache') ||
            origem.includes('portal') ||
            origem.includes('relatorio')
        ) {
            return true;
        }

        return Boolean(matriculaSoc && matricula !== matriculaSoc);
    }

    function dataMaisRecenteESocial(valores) {
        const validas = valores
            .filter(Boolean)
            .map(valor => ({ valor, data: new Date(valor) }))
            .filter(item => !Number.isNaN(item.data.getTime()))
            .sort((a, b) => b.data - a.data);

        return validas[0]?.valor || '';
    }

    function resumoTipoEventoColaboradorESocial(registros, codigo) {
        const candidatos = registros.filter(
            item => String(item?.tipo_evento || '').trim().toUpperCase() === codigo
        );

        if (!candidatos.length) {
            return {
                estado: 'nao_verificado',
                texto: 'Não verificado',
                classe: 'secondary',
                icone: 'fa-question-circle',
                recibo: ''
            };
        }

        const confirmado = candidatos.find(item =>
            Boolean(String(item.numero_recibo || '').trim()) ||
            Boolean(String(item.numero_recibo_existente || '').trim()) ||
            item.existe_no_esocial === true ||
            item.emitido_esocial === true ||
            item.ja_emitido === true ||
            String(item.status || '').trim().toLowerCase() === 'sucesso'
        );

        if (confirmado) {
            const recibo =
                String(confirmado.numero_recibo || '').trim() ||
                String(confirmado.numero_recibo_existente || '').trim();

            return {
                estado: 'confirmado',
                texto: 'Confirmado',
                classe: 'success',
                icone: 'fa-check-circle',
                recibo
            };
        }

        const comErro = candidatos.find(item =>
            String(item.status || '').trim().toLowerCase() === 'erro' ||
            String(item.status_evento_soc || '').toLowerCase().includes('inconsist')
        );

        if (comErro) {
            return {
                estado: 'erro',
                texto: 'Erro',
                classe: 'danger',
                icone: 'fa-times-circle',
                recibo: ''
            };
        }

        const verificadoAusente = candidatos.some(item =>
            item.verificacao_esocial_completa === true &&
            item.existe_no_esocial === false
        );

        if (verificadoAusente) {
            return {
                estado: 'nao_localizado',
                texto: 'Não localizado',
                classe: 'warning',
                icone: 'fa-search-minus',
                recibo: ''
            };
        }

        const aguardando = candidatos.some(item =>
            String(item.status || '').trim().toLowerCase() === 'aguardando_verificacao'
        );

        if (aguardando) {
            return {
                estado: 'aguardando',
                texto: 'Aguardando consulta',
                classe: 'info',
                icone: 'fa-search',
                recibo: ''
            };
        }

        return {
            estado: 'pendente',
            texto: 'Pendente',
            classe: 'warning',
            icone: 'fa-clock',
            recibo: ''
        };
    }

    function obterResumoColaboradorESocial(evento) {
        const chave = normalizarChaveVinculoESocial(evento);
        const fonte = eventosESocialHistorico.length
            ? eventosESocialHistorico
            : eventosESocialBase;

        const relacionados = fonte.filter(
            item => normalizarChaveVinculoESocial(item) === chave
        );

        if (
            evento &&
            !relacionados.some(item => String(item?.id || '') === String(evento?.id || ''))
        ) {
            relacionados.push(evento);
        }

        const oficial = relacionados.find(item =>
            matriculaPareceOficialESocial(item) &&
            item.data_admissao_esocial
        ) || relacionados.find(matriculaPareceOficialESocial) || evento;

        const matriculaOficial = matriculaPareceOficialESocial(oficial)
            ? String(oficial.matricula || '').trim()
            : '';

        const dataAdmissaoEsocial = String(
            oficial?.data_admissao_esocial || ''
        ).trim();

        const matriculaOrigem = String(
            oficial?.matricula_origem || ''
        ).trim().toLowerCase();

        const statusVinculoInformado = relacionados
            .map(item => String(item?.vinculo_esocial_status || '').trim().toLowerCase())
            .filter(Boolean);

        let vinculoStatus = 'nao_verificado';

        if (
            matriculaOficial ||
            statusVinculoInformado.includes('vinculado')
        ) {
            vinculoStatus = 'vinculado';
        } else if (
            statusVinculoInformado.includes('nao_localizado') ||
            statusVinculoInformado.includes('nao_vinculado')
        ) {
            // "não localizado no BX" não significa "não vinculado".
            // O valor antigo "nao_vinculado" é tratado aqui apenas
            // para corrigir visualmente registros gravados pela versão
            // anterior.
            vinculoStatus = 'nao_localizado';
        }

        const ultimaVerificacao = dataMaisRecenteESocial(
            relacionados.flatMap(item => [
                item.vinculo_esocial_verificado_em,
                item.verificado_esocial_em,
                item.matricula_oficial_atualizada_em
            ])
        );

        const eventoComProcuracaoPendente = relacionados.find(
            item => item.procuracao_eletronica_pendente === true
        );

        const procuracaoPendente = Boolean(eventoComProcuracaoPendente);

        const procuracaoMensagem = eventoComProcuracaoPendente
            ? String(eventoComProcuracaoPendente.matricula_pendencia_erro || '').trim()
            : '';

        const precisaS2220 = relacionados.some(
            item => String(item?.tipo_evento || '').trim().toUpperCase() === 'S-2220'
        );

        const precisaS2240 = relacionados.some(
            item => String(item?.tipo_evento || '').trim().toUpperCase() === 'S-2240'
        );

        const s2220 = resumoTipoEventoColaboradorESocial(relacionados, 'S-2220');
        const s2240 = precisaS2240
            ? resumoTipoEventoColaboradorESocial(relacionados, 'S-2240')
            : {
                estado: 'nao_aplica',
                texto: 'Não se aplica',
                classe: 'light text-dark',
                icone: 'fa-minus-circle',
                recibo: ''
            };

        const tipoFoiVerificado = codigo => {
            const candidatos = relacionados.filter(
                item => String(item?.tipo_evento || '').trim().toUpperCase() === codigo
            );

            if (!candidatos.length) return true;

            return candidatos.some(item =>
                item.existe_no_esocial === true ||
                item.verificacao_esocial_completa === true ||
                item.emitido_esocial === true ||
                item.ja_emitido === true ||
                Boolean(String(item.numero_recibo || '').trim()) ||
                Boolean(String(item.numero_recibo_existente || '').trim())
            );
        };

        const eventosObrigatoriosVerificados =
            (!precisaS2220 || tipoFoiVerificado('S-2220')) &&
            (!precisaS2240 || tipoFoiVerificado('S-2240'));

        let proximaAcao = {
            texto: 'Atualizar base eSocial',
            classe: 'secondary',
            icone: 'fa-file-excel'
        };

        if (procuracaoPendente) {
            proximaAcao = {
                texto: 'Regularizar procuração eletrônica',
                classe: 'danger',
                icone: 'fa-file-signature'
            };
        } else if (vinculoStatus === 'nao_localizado') {
            proximaAcao = {
                texto: 'Atualizar base eSocial',
                classe: 'warning',
                icone: 'fa-file-excel'
            };
        } else if (vinculoStatus === 'vinculado' && !matriculaOficial) {
            proximaAcao = {
                texto: 'Atualizar base eSocial',
                classe: 'info',
                icone: 'fa-file-excel'
            };
        } else if (
            vinculoStatus === 'vinculado' &&
            matriculaOficial &&
            !eventosObrigatoriosVerificados
        ) {
            proximaAcao = {
                texto: 'Verificar eventos',
                classe: 'info',
                icone: 'fa-satellite-dish'
            };
        } else if (vinculoStatus === 'vinculado' && matriculaOficial) {
            if (precisaS2220 && s2220.estado === 'erro') {
                proximaAcao = {
                    texto: 'Corrigir S-2220',
                    classe: 'danger',
                    icone: 'fa-tools'
                };
            } else if (precisaS2220 && s2220.estado !== 'confirmado') {
                proximaAcao = {
                    texto: 'Emitir S-2220',
                    classe: 'primary',
                    icone: 'fa-heartbeat'
                };
            } else if (precisaS2240 && s2240.estado === 'erro') {
                proximaAcao = {
                    texto: 'Corrigir S-2240',
                    classe: 'danger',
                    icone: 'fa-tools'
                };
            } else if (precisaS2240 && s2240.estado !== 'confirmado') {
                const s2240Atual = relacionados.find(
                    item => String(item?.tipo_evento || '').trim().toUpperCase() === 'S-2240'
                );

                proximaAcao = s2240Atual?.s2240_pronto_para_emissao === false
                    ? {
                        texto: 'Completar S-2240',
                        classe: 'warning',
                        icone: 'fa-clipboard-check'
                    }
                    : {
                        texto: 'Emitir S-2240',
                        classe: 'primary',
                        icone: 'fa-shield-alt'
                    };
            } else {
                proximaAcao = {
                    texto: 'Tudo OK',
                    classe: 'success',
                    icone: 'fa-check-double'
                };
            }
        }

        return {
            matriculaOficial,
            matriculaOrigem,
            dataAdmissaoEsocial,
            ultimaVerificacao,
            procuracaoPendente,
            procuracaoMensagem,
            vinculoStatus,
            precisaS2220,
            precisaS2240,
            eventosObrigatoriosVerificados,
            s2220,
            s2240,
            proximaAcao
        };
    }

    function htmlBadgeResumoESocial(resumo) {
        return `
            <span class="badge bg-${resumo.classe} esocial-status-chip">
                <i class="fas ${resumo.icone} me-1"></i>${escaparHtml(resumo.texto)}
            </span>
            ${resumo.recibo
                ? `<div class="small text-muted mt-1"><code>${escaparHtml(resumo.recibo)}</code></div>`
                : ''}
        `;
    }

    // ============================================================
// RENDERIZAR TABELA
// ============================================================

function renderizarTabelaEventosESocial() {

    const tbody =
        document.getElementById(
            'eventosBody'
        );


    if (!tbody) {
        return;
    }


    const totalSpan =
        document.getElementById(
            'totalEventosTexto'
        );


    if (totalSpan) {

        totalSpan.textContent =
            `${eventosESocial.length} eventos`;
    }


    // ========================================================
    // SEM EVENTOS
    // ========================================================

    if (
        !eventosESocial.length
    ) {

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="15"
                    class="text-center text-muted py-4"
                >
                    <i class="fas fa-inbox me-2"></i>
                    Nenhum evento encontrado
                </td>
            </tr>
        `;


        atualizarPaginacaoESocial(
            0
        );


        return;
    }


    // ========================================================
    // TIPOS
    // ========================================================

    const tipoEventoMap = {

        'S-2220':
            'Monitoramento (S-2220)',

        'S-2240':
            'Condições Ambientais (S-2240)'
    };


    // ========================================================
    // AGRUPAR POR COLABORADOR (VÍNCULO)
    //
    // Uma linha por pessoa em vez de uma linha por evento —
    // evita repetir S-2220/S-2240 em linhas separadas da mesma
    // pessoa. Se a busca/filtro deixou só um dos dois eventos na
    // lista, tenta completar o outro a partir do histórico
    // completo, pra manter os botões de ação funcionando.
    // ========================================================

    const gruposPorColaborador =
        new Map();

    eventosESocial.forEach(
        evento => {

            const chave =
                normalizarChaveVinculoESocial(
                    evento
                );

            if (
                !gruposPorColaborador.has(
                    chave
                )
            ) {

                gruposPorColaborador.set(
                    chave,
                    {
                        chave,
                        eventoS2220: null,
                        eventoS2240: null
                    }
                );
            }

            const grupo =
                gruposPorColaborador.get(
                    chave
                );

            const tipo =
                String(
                    evento.tipo_evento ||
                    ''
                )
                    .trim()
                    .toUpperCase();

            if (
                tipo === 'S-2220' &&
                !grupo.eventoS2220
            ) {

                grupo.eventoS2220 =
                    evento;

            } else if (
                tipo === 'S-2240' &&
                !grupo.eventoS2240
            ) {

                grupo.eventoS2240 =
                    evento;
            }
        }
    );

    const fonteCompletaESocial =
        eventosESocialHistorico.length
            ? eventosESocialHistorico
            : eventosESocialBase;

    gruposPorColaborador.forEach(
        grupo => {

            if (
                grupo.eventoS2220 &&
                grupo.eventoS2240
            ) {

                return;
            }

            fonteCompletaESocial.forEach(
                evento => {

                    if (
                        normalizarChaveVinculoESocial(evento) !==
                        grupo.chave
                    ) {

                        return;
                    }

                    const tipo =
                        String(
                            evento.tipo_evento ||
                            ''
                        )
                            .trim()
                            .toUpperCase();

                    if (
                        tipo === 'S-2220' &&
                        !grupo.eventoS2220
                    ) {

                        grupo.eventoS2220 =
                            evento;

                    } else if (
                        tipo === 'S-2240' &&
                        !grupo.eventoS2240
                    ) {

                        grupo.eventoS2240 =
                            evento;
                    }
                }
            );
        }
    );

    const pessoasESocial =
        Array.from(
            gruposPorColaborador.values()
        );


    // ========================================================
    // PAGINAÇÃO
    // ========================================================

    const inicio =
        (
            paginaAtualESocial -
            1
        ) *
        REGISTROS_POR_PAGINA;


    const fim =
        Math.min(
            inicio +
            REGISTROS_POR_PAGINA,

            pessoasESocial.length
        );


    const pagina =
        pessoasESocial.slice(
            inicio,
            fim
        );


    let html =
        '';


    // ========================================================
    // EVENTOS
    // ========================================================

    pagina.forEach(
        grupo => {

            // ====================================================
            // EVENTO RELEVANTE DO GRUPO
            //
            // Uma linha por pessoa: os botões de ação (enviar,
            // verificar, cancelar etc.) agem sobre o evento que
            // ainda precisa de trabalho, seguindo a "próxima
            // ação" calculada pro vínculo inteiro.
            // ====================================================

            const eventoSemente =
                grupo.eventoS2220 ||
                grupo.eventoS2240;

            if (
                !eventoSemente
            ) {

                return;
            }

            const proximaAcaoSemente =
                obterResumoColaboradorESocial(
                    eventoSemente
                ).proximaAcao.texto ||
                '';

            let evento;

            if (
                proximaAcaoSemente.includes('S-2240') &&
                grupo.eventoS2240
            ) {

                evento =
                    grupo.eventoS2240;

            } else if (
                proximaAcaoSemente.includes('S-2220') &&
                grupo.eventoS2220
            ) {

                evento =
                    grupo.eventoS2220;

            } else {

                evento =
                    grupo.eventoS2220 ||
                    grupo.eventoS2240;
            }


            // ====================================================
            // STATUS REAL DO SOC
            // ====================================================

            const statusSoc =
                String(
                    evento.status_evento_soc ||
                    ''
                )
                    .trim()
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(
                        /[\u0300-\u036f]/g,
                        ''
                    );


            const temRecibo =
                Boolean(
                    String(
                        evento.numero_recibo ||
                        ''
                    ).trim()
                );


            let statusExibicao;


            // ====================================================
            // INCONSISTÊNCIA / ERRO
            // ====================================================

            if (
                statusSoc.includes(
                    'inconsist'
                ) ||
                statusSoc ===
                    'erro'
            ) {

                statusExibicao = {

                    classe:
                        'danger',

                    icone:
                        'fa-times-circle',

                    texto:
                        'Inconsistências'
                };


            // ====================================================
            // CONCLUÍDO
            // ====================================================

            } else if (
                statusSoc.includes(
                    'conclu'
                ) ||
                temRecibo
            ) {

                statusExibicao = {

                    classe:
                        'success',

                    icone:
                        'fa-check-circle',

                    texto:
                        'Concluído'
                };


            // ====================================================
            // ASSINADO
            // ====================================================

            } else if (
                statusSoc ===
                    'assinado'
            ) {

                statusExibicao = {

                    classe:
                        'primary',

                    icone:
                        'fa-signature',

                    texto:
                        'Assinado'
                };


            // ====================================================
            // PROCESSANDO
            // ====================================================

            } else if (
                statusSoc ===
                    'processando'
            ) {

                statusExibicao = {

                    classe:
                        'warning',

                    icone:
                        'fa-spinner',

                    texto:
                        'Processando'
                };


            // ====================================================
            // APTO PARA ENVIO
            // ====================================================

            } else if (
                statusSoc ===
                    'apto para envio'
            ) {

                statusExibicao = {

                    classe:
                        'info',

                    icone:
                        'fa-paper-plane',

                    texto:
                        'Apto para envio'
                };


            // ====================================================
            // CANCELADO / EXCLUÍDO
            // ====================================================

            } else if (
                statusSoc ===
                    'excluido'
            ) {

                statusExibicao = {

                    classe:
                        'secondary',

                    icone:
                        'fa-ban',

                    texto:
                        'Excluído'
                };


            // ====================================================
// STATUS INTERNO
// ====================================================

// ====================================================
// AGUARDANDO VERIFICAÇÃO NO E-SOCIAL
// ====================================================

} else if (
    evento.status ===
        'aguardando_verificacao'
) {

    statusExibicao = {

        classe:
            'info',

        icone:
            'fa-search',

        texto:
            'Aguardando verificação'
    };


// ====================================================
// CONCLUÍDO
// ====================================================

} else if (
    evento.status ===
        'sucesso'
) {

    statusExibicao = {

        classe:
            'success',

        icone:
            'fa-check-circle',

        texto:
            'Concluído'
    };


// ====================================================
// ERRO
// ====================================================

} else if (
    evento.status ===
        'erro'
) {

    statusExibicao = {

        classe:
            'danger',

        icone:
            'fa-times-circle',

        texto:
            'Erro'
    };


// ====================================================
// CANCELADO
// ====================================================

} else if (
    evento.status ===
        'cancelado'
) {

    statusExibicao = {

        classe:
            'secondary',

        icone:
            'fa-ban',

        texto:
            'Cancelado'
    };


// ====================================================
// PADRÃO
// ====================================================

} else {

    statusExibicao = {

        classe:
            'warning',

        icone:
            'fa-clock',

        texto:
            'Pendente'
    };
}


            // ====================================================
            // TIPO DO EVENTO
            // ====================================================

            const codigoTipoEvento =
    String(
        evento.tipo_evento ||
        ''
    )
        .trim()
        .toUpperCase();


const tipoEvento =
    tipoEventoMap[
        codigoTipoEvento
    ] ||
    evento.tipo_evento ||
    '—';


const resumoColaborador =
    obterResumoColaboradorESocial(evento);



            const persistido =
                evento.persistido !==
                false;


            const selecionado =
                eventosSelecionados.has(
                    String(
                        evento.id
                    )
                );


            // ====================================================
            // PODE ENVIAR?
            // ====================================================
            //
            // Não mostramos botão Enviar se:
            //
            // - já está concluído
            // - já possui recibo
            // - está com inconsistência
            //
            // ====================================================

           const podeEnviar =
    persistido &&

    // Backend decide S-2220 x S-2240 e se já tem tudo pronto
    // (matrícula, e pro S-2240 também responsável ambiental e
    // risco/GHE resolvidos) — ver pode_emitir no backend.
    evento.pode_emitir ===
        true &&

    // Não pode já estar emitido
    evento.emitido_esocial !==
        true &&

    evento.ja_emitido !==
        true &&

    // Continua exigindo pendência
    evento.status ===
        'pendente' &&

    !temRecibo &&

    !statusSoc.includes(
        'conclu'
    ) &&

    !statusSoc.includes(
        'inconsist'
    ) &&

    statusSoc !==
        'erro';


            // ====================================================
            // PODE CANCELAR?
            // ====================================================

            const podeCancelar =
                podeEnviar;


            // ====================================================
            // PODE VER XML?
            // ====================================================

            const podeVerXml =
                persistido &&
                (
                    evento.status ===
                        'sucesso' ||
                    temRecibo ||
                    statusSoc.includes(
                        'conclu'
                    )
                );


            // ====================================================
            // LINHA
            // ====================================================

            html += `
                <tr>

                    <td>

                        <input
                            type="checkbox"
                            class="selecionar-evento"
                            data-id="${escaparHtml(
                                evento.id
                            )}"
                            ${
                                selecionado
                                    ? 'checked'
                                    : ''
                            }
                            ${
                                persistido
                                    ? ''
                                    : 'disabled'
                            }
                        />

                    </td>


                    <td>

                        <span class="badge bg-primary">

                            ${escaparHtml(
                                evento.holding ||
                                'N/A'
                            )}

                        </span>

                    </td>


                    <td>

                        <strong>

                            ${escaparHtml(
                                evento.unidade ||
                                'N/A'
                            )}

                        </strong>

                    </td>


                    <td>

                        ${escaparHtml(
                            evento.colaborador ||
                            'N/A'
                        )}

                    </td>


                    <td>

                        ${escaparHtml(
                            formatarCpf(
                                evento.cpf
                            )
                        )}

                    </td>


                    <td class="esocial-vinculo-cell">
                        ${
                            resumoColaborador.procuracaoPendente
                                ? `
                                    <span class="badge bg-danger-subtle text-danger-emphasis border border-danger-subtle" title="${escaparHtml(resumoColaborador.procuracaoMensagem || '')}">
                                        <i class="fas fa-file-signature me-1"></i>Procuração eletrônica pendente
                                    </span>
                                `
                                : resumoColaborador.vinculoStatus === 'vinculado'
                                    ? `
                                        <span class="badge bg-success-subtle text-success-emphasis border border-success-subtle">
                                            <i class="fas fa-user-check me-1"></i>CPF vinculado
                                        </span>
                                    `
                                    : resumoColaborador.vinculoStatus === 'nao_localizado'
                                        ? `
                                            <span
                                                class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle"
                                                title="O vínculo não foi localizado na base local atual. Atualize o Relatório Gerencial antes de usar o BX."
                                            >
                                                <i class="fas fa-file-excel me-1"></i>Não localizado na base
                                            </span>
                                        `
                                        : `
                                            <span class="badge bg-secondary-subtle text-secondary-emphasis border">
                                                <i class="fas fa-database me-1"></i>Aguardando base eSocial
                                            </span>
                                        `
                        }
                        ${
                            resumoColaborador.matriculaOficial
                                ? `
                                    <div class="small fw-semibold mt-2">
                                        Matrícula: ${escaparHtml(resumoColaborador.matriculaOficial)}
                                    </div>
                                    ${
                                        resumoColaborador.dataAdmissaoEsocial
                                            ? `<div class="small text-muted">Admissão: ${escaparHtml(formatarDataExibicao(resumoColaborador.dataAdmissaoEsocial))}</div>`
                                            : ''
                                    }
                                    ${
                                        String(resumoColaborador.matriculaOrigem || '').includes('relatorio')
                                            ? `<div class="small text-success"><i class="fas fa-file-excel me-1"></i>Relatório Gerencial</div>`
                                            : ''
                                    }
                                `
                                : resumoColaborador.vinculoStatus === 'vinculado'
                                    ? `<div class="small text-muted mt-2">Matrícula ainda não importada</div>`
                                    : ''
                        }
                        <div class="esocial-last-check mt-2">
                            <i class="fas fa-history me-1"></i>
                            ${escaparHtml(
                                resumoColaborador.ultimaVerificacao
                                    ? formatarDataExibicao(resumoColaborador.ultimaVerificacao)
                                    : 'Ainda não verificado'
                            )}
                        </div>
                    </td>

                    <td>${
                        grupo.eventoS2220
                            ? htmlBadgeResumoESocial(resumoColaborador.s2220)
                            : '<span class="text-muted">—</span>'
                    }</td>

                    <td>${
                        grupo.eventoS2240
                            ? htmlBadgeResumoESocial(resumoColaborador.s2240)
                            : '<span class="text-muted">—</span>'
                    }</td>

                    <td>
                        <span class="badge bg-${resumoColaborador.proximaAcao.classe} esocial-next-action">
                            <i class="fas ${resumoColaborador.proximaAcao.icone} me-1"></i>
                            ${escaparHtml(resumoColaborador.proximaAcao.texto)}
                        </span>
                    </td>


                    <td>

                        ${escaparHtml(
                            formatarDataExibicao(
                                evento.data_exame
                            )
                        )}

                    </td>


                    <td>

                        <span class="badge bg-secondary">

                            ${escaparHtml(
                                evento.tipo_exame ||
                                'N/A'
                            )}

                        </span>

                    </td>


                    <td>

                        <span
                            class="badge bg-info text-dark"
                        >

                            ${escaparHtml(
                                tipoEvento
                            )}

                        </span>

                    </td>


                    <td>

                        <span
                            class="badge bg-${statusExibicao.classe}"
                        >

                            <i
                                class="fas ${statusExibicao.icone}"
                            ></i>

                            ${statusExibicao.texto}

                        </span>

                    </td>


                    <td>

                        ${
                            evento.numero_recibo
                                ? (
                                    `<code class="small">` +
                                    `${escaparHtml(
                                        evento.numero_recibo
                                    )}` +
                                    `</code>`
                                )
                                : '—'
                        }

                    </td>


                    <td class="text-center">

                        <div
                            class="btn-group btn-group-sm"
                        >

                            <!-- VER ASO -->

                            <button
                                class="
                                    btn
                                    btn-outline-primary
                                    btn-ver-aso
                                "
                                data-id="${escaparHtml(
                                    evento.id
                                )}"
                                title="Ver dados do ASO"
                            >

                                <i
                                    class="
                                        fas
                                        fa-file-medical
                                    "
                                ></i>

                            </button>


                            <!-- 1) VERIFICAR VÍNCULO CPF x EMPREGADOR -->

                            ${
    (codigoTipoEvento === 'S-2220' || codigoTipoEvento === 'S-2240') &&
    evento.emitido_esocial !== true &&
    evento.ja_emitido !== true &&
    resumoColaborador.vinculoStatus !== 'vinculado'
        ? `
            <button
                type="button"
                class="btn btn-outline-danger btn-verificar-vinculo-esocial"
                data-id="${escaparHtml(evento.id)}"
                title="Consultar vínculo e matrícula pelo Conector eSocial deste computador."
            >
                <i class="fas fa-desktop"></i>
            </button>
        `
        : ''
}

                            <!-- 2) BUSCAR MATRÍCULA OFICIAL -->

                            ${
    (codigoTipoEvento === 'S-2220' || codigoTipoEvento === 'S-2240') &&
    resumoColaborador.vinculoStatus === 'vinculado' &&
    !resumoColaborador.matriculaOficial &&
    evento.emitido_esocial !== true &&
    evento.ja_emitido !== true
        ? `
            <button
                type="button"
                class="btn btn-outline-info btn-buscar-matricula-esocial"
                data-id="${escaparHtml(evento.id)}"
                title="Buscar e gravar a matrícula oficial do vínculo"
            >
                <i class="fas fa-id-card"></i>
            </button>
        `
        : ''
}

                            <!-- 3) VERIFICAR S-2220 / S-2240 EXISTENTES -->

                            ${
    (codigoTipoEvento === 'S-2220' || codigoTipoEvento === 'S-2240') &&
    resumoColaborador.vinculoStatus === 'vinculado' &&
    Boolean(resumoColaborador.matriculaOficial) &&
    !resumoColaborador.eventosObrigatoriosVerificados &&
    evento.emitido_esocial !== true &&
    evento.ja_emitido !== true
        ? `
            <button
                type="button"
                class="btn btn-outline-warning btn-verificar-eventos-esocial"
                data-id="${escaparHtml(evento.id)}"
                title="Verificar no eSocial se os eventos obrigatórios desta pessoa já existem"
            >
                <i class="fas fa-satellite-dish"></i>
            </button>
        `
        : ''
}


                            <!-- ENVIAR -->

                            ${
                                podeEnviar
                                    ? `
                                        <button
                                            class="
                                                btn
                                                btn-outline-success
                                                btn-enviar-evento
                                            "
                                            data-id="${escaparHtml(
                                                evento.id
                                            )}"
                                            title="Enviar"
                                        >

                                            <i
                                                class="
                                                    fas
                                                    fa-play
                                                "
                                            ></i>

                                        </button>
                                    `
                                    : ''
                            }


                            <!-- VER XML -->

                            ${
                                podeVerXml
                                    ? `
                                        <button
                                            class="
                                                btn
                                                btn-outline-info
                                                btn-ver-xml
                                            "
                                            data-id="${escaparHtml(
                                                evento.id
                                            )}"
                                            title="Ver XML"
                                        >

                                            <i
                                                class="
                                                    fas
                                                    fa-code
                                                "
                                            ></i>

                                        </button>
                                    `
                                    : ''
                            }


                            <!-- CANCELAR -->

                            ${
                                podeCancelar
                                    ? `
                                        <button
                                            class="
                                                btn
                                                btn-outline-danger
                                                btn-cancelar-evento
                                            "
                                            data-id="${escaparHtml(
                                                evento.id
                                            )}"
                                            title="Cancelar"
                                        >

                                            <i
                                                class="
                                                    fas
                                                    fa-times
                                                "
                                            ></i>

                                        </button>
                                    `
                                    : ''
                            }

                        </div>

                    </td>

                </tr>
            `;
        }
    );


    // ========================================================
    // INSERIR HTML
    // ========================================================

    tbody.innerHTML =
        html;


    // ========================================================
    // CHECKBOXES
    // ========================================================

    document
        .querySelectorAll(
            '.selecionar-evento'
        )
        .forEach(
            cb => {

                cb.onchange =
                    handleSelecionarEvento;
            }
        );


    const selectAll =
        document.getElementById(
            'selecionarTodos'
        );


    if (
        selectAll
    ) {

        selectAll.onchange =
            handleSelecionarTodos;
    }


    // ========================================================
    // BOTÃO VER ASO
    // ========================================================

    document
        .querySelectorAll(
            '.btn-ver-aso'
        )
        .forEach(
            btn => {

                btn.onclick =
                    handleVerAso;
            }
        );


    // ========================================================
    // ETAPA 1 - VERIFICAR VÍNCULO CPF x EMPREGADOR
    // ========================================================

    document
        .querySelectorAll('.btn-verificar-vinculo-esocial')
        .forEach(btn => {
            btn.onclick = handleVerificarVinculoESocial;
        });


    // ========================================================
    // ETAPA 2 - BUSCAR MATRÍCULA OFICIAL
    // ========================================================

    document
        .querySelectorAll('.btn-buscar-matricula-esocial')
        .forEach(btn => {
            btn.onclick = handleBuscarMatriculaESocial;
        });


    // ========================================================
    // ETAPA 3 - VERIFICAR EVENTOS EXISTENTES
    // ========================================================

    document
        .querySelectorAll('.btn-verificar-eventos-esocial')
        .forEach(btn => {
            btn.onclick = handleVerificarStatusRealESocial;
        });


    // ========================================================
    // BOTÃO ENVIAR
    // ========================================================

    document
        .querySelectorAll(
            '.btn-enviar-evento'
        )
        .forEach(
            btn => {

                btn.onclick =
                    handleEnviarEvento;
            }
        );


    // ========================================================
    // BOTÃO VER XML
    // ========================================================

    document
        .querySelectorAll(
            '.btn-ver-xml'
        )
        .forEach(
            btn => {

                btn.onclick =
                    handleVerXml;
            }
        );


    // ========================================================
    // BOTÃO CANCELAR
    // ========================================================

    document
        .querySelectorAll(
            '.btn-cancelar-evento'
        )
        .forEach(
            btn => {

                btn.onclick =
                    handleCancelarEvento;
            }
        );


    // ========================================================
    // PAGINAÇÃO
    // ========================================================

    atualizarPaginacaoESocial(
        Math.ceil(
            pessoasESocial.length /
            REGISTROS_POR_PAGINA
        )
    );


    atualizarSelecaoTodos();
}

    function handleSelecionarEvento() {

    const id =
        String(
            this.dataset.id ||
            ''
        );


    const evento =
        encontrarEvento(
            id
        );


    // ========================================================
    // SEGURANÇA
    // ========================================================

    const permitido =
        evento &&
        evento.persistido !== false &&
        evento.pode_emitir === true &&
        evento.confirmado_nao_emitido === true &&
        evento.emitido_esocial !== true &&
        evento.ja_emitido !== true &&
        evento.aguardando_verificacao !== true &&
        evento.status !==
            'aguardando_verificacao' &&
        String(
            evento.tipo_evento ||
            ''
        )
            .trim()
            .toUpperCase() ===
            'S-2220';


    if (
        !permitido
    ) {

        this.checked =
            false;


        this.disabled =
            true;


        eventosSelecionados.delete(
            id
        );


        atualizarSelecaoTodos();


        return;
    }


    // ========================================================
    // SELEÇÃO NORMAL
    // ========================================================

    if (
        this.checked
    ) {

        eventosSelecionados.add(
            id
        );

    } else {

        eventosSelecionados.delete(
            id
        );
    }


    atualizarSelecaoTodos();
}

    function handleSelecionarTodos() {
        const checked =
            this.checked;

        document
            .querySelectorAll(
                '.selecionar-evento:not(:disabled)'
            )
            .forEach(
                cb => {
                    cb.checked =
                        checked;

                    const id =
                        String(
                            cb.dataset.id
                        );

                    if (checked) {
                        eventosSelecionados.add(
                            id
                        );

                    } else {
                        eventosSelecionados.delete(
                            id
                        );
                    }
                }
            );
    }

    function atualizarSelecaoTodos() {
        const todos =
            document.querySelectorAll(
                '.selecionar-evento:not(:disabled)'
            );

        const selecionados =
            document.querySelectorAll(
                '.selecionar-evento:not(:disabled):checked'
            );

        const checkAll =
            document.getElementById(
                'selecionarTodos'
            );

        if (checkAll) {
            checkAll.checked =
                todos.length > 0 &&
                selecionados.length ===
                todos.length;

            checkAll.disabled =
                todos.length === 0;
        }
    }

    // ============================================================
    // PAGINAÇÃO
    // ============================================================

    function atualizarPaginacaoESocial(
        totalPaginas
    ) {
        const container =
            document.getElementById(
                'paginacaoEventos'
            );

        const info =
            document.getElementById(
                'paginacaoInfoEventos'
            );

        if (!container) {
            return;
        }

        const prevBtn =
            document.getElementById(
                'prevPageEventos'
            );

        const nextBtn =
            document.getElementById(
                'nextPageEventos'
            );

        container
            .querySelectorAll(
                '.page-item:not(#prevPageEventos):not(#nextPageEventos)'
            )
            .forEach(
                el => el.remove()
            );

        if (
            paginaAtualESocial >
            Math.max(
                totalPaginas,
                1
            )
        ) {
            paginaAtualESocial =
                Math.max(
                    totalPaginas,
                    1
                );
        }

        if (prevBtn) {
            prevBtn.className =
                `page-item ${
                    paginaAtualESocial <= 1
                        ? 'disabled'
                        : ''
                }`;

            const link =
                prevBtn.querySelector(
                    'a'
                );

            if (link) {
                link.onclick =
                    event => {
                        event.preventDefault();

                        if (
                            paginaAtualESocial >
                            1
                        ) {
                            paginaAtualESocial--;

                            renderizarTabelaEventosESocial();
                        }
                    };
            }
        }

        if (nextBtn) {
            nextBtn.className =
                `page-item ${
                    paginaAtualESocial >=
                    totalPaginas
                        ? 'disabled'
                        : ''
                }`;

            const link =
                nextBtn.querySelector(
                    'a'
                );

            if (link) {
                link.onclick =
                    event => {
                        event.preventDefault();

                        if (
                            paginaAtualESocial <
                            totalPaginas
                        ) {
                            paginaAtualESocial++;

                            renderizarTabelaEventosESocial();
                        }
                    };
            }
        }

        if (
            totalPaginas > 1 &&
            nextBtn
        ) {
            let inicioPagina =
                Math.max(
                    1,
                    paginaAtualESocial - 4
                );

            let fimPagina =
                Math.min(
                    totalPaginas,
                    inicioPagina + 9
                );

            if (
                fimPagina -
                inicioPagina <
                9
            ) {
                inicioPagina =
                    Math.max(
                        1,
                        fimPagina - 9
                    );
            }

            for (
                let i = inicioPagina;
                i <= fimPagina;
                i++
            ) {
                const li =
                    document.createElement(
                        'li'
                    );

                li.className =
                    `page-item ${
                        i ===
                        paginaAtualESocial
                            ? 'active'
                            : ''
                    }`;

                li.innerHTML =
                    `<a class="page-link" href="#">` +
                    `${i}` +
                    `</a>`;

                li.querySelector(
                    'a'
                ).onclick =
                    event => {
                        event.preventDefault();

                        paginaAtualESocial =
                            i;

                        renderizarTabelaEventosESocial();
                    };

                if (
                    nextBtn &&
                    nextBtn.parentNode === container
                ) {
                    container.insertBefore(
                        li,
                        nextBtn
                    );
                } else {
                    container.appendChild(
                        li
                    );
                }
            }
        }

        if (info) {
            if (
                !eventosESocial.length
            ) {
                info.textContent =
                    '0 eventos';

            } else {
                const inicio =
                    (
                        paginaAtualESocial -
                        1
                    ) *
                    REGISTROS_POR_PAGINA +
                    1;

                const fim =
                    Math.min(
                        paginaAtualESocial *
                        REGISTROS_POR_PAGINA,

                        eventosESocial.length
                    );

                info.textContent =
                    `Mostrando ${inicio} a ` +
                    `${fim} de ` +
                    `${eventosESocial.length} ` +
                    `eventos`;
            }
        }
    }

    // ============================================================
    // ESTATÍSTICAS
    // ============================================================

    function atualizarEstatisticasESocial() {
        const total =
            eventosESocial.length;

        const pendentes =
            eventosESocial.filter(
                e =>
                    e.status ===
                    'pendente'
            ).length;

        const sucesso =
            eventosESocial.filter(
                e =>
                    e.status ===
                    'sucesso'
            ).length;

        const erro =
            eventosESocial.filter(
                e =>
                    e.status ===
                    'erro'
            ).length;

        const totalEl =
            document.getElementById(
                'totalEventos'
            );

        const sucessoEl =
            document.getElementById(
                'eventosSucesso'
            );

        const pendentesEl =
            document.getElementById(
                'eventosPendentes'
            );

        const erroEl =
            document.getElementById(
                'eventosErro'
            );

        if (totalEl) {
            totalEl.textContent =
                total;
        }

        if (sucessoEl) {
            sucessoEl.textContent =
                sucesso;
        }

        if (pendentesEl) {
            pendentesEl.textContent =
                pendentes;
        }

        if (erroEl) {
            erroEl.textContent =
                erro;
        }
    }

    // ============================================================
    // LOCALIZAR EVENTO
    // ============================================================

    function encontrarEvento(
        id
    ) {
        const alvo = String(id);
        const fontes = [
            eventosESocial,
            eventosESocialBase,
            eventosESocialHistorico
        ];

        for (const fonte of fontes) {
            const encontrado = (fonte || []).find(
                evento => String(evento?.id) === alvo
            );

            if (encontrado) return encontrado;
        }

        return null;
    }

    function handleVerAso() {
        verAso(
            String(
                this.dataset.id
            )
        );
    }

    function handleEnviarEvento() {
        enviarEventoIndividual(
            String(
                this.dataset.id
            )
        );
    }

    function handleVerXml() {
        verXmlEvento(
            String(
                this.dataset.id
            )
        );
    }

    function handleCancelarEvento() {
        cancelarEvento(
            String(
                this.dataset.id
            )
        );
    }

// ============================================================
// VER ASO - DETALHES COMPLETOS
// ============================================================

async function verAso(
    id
) {

    try {

        // ========================================================
        // LOCALIZAR EVENTO
        // ========================================================

        const evento =
            encontrarEvento(
                id
            );


        if (!evento) {

            mostrarAlertaESocial(
                'Evento não encontrado.',
                'warning'
            );

            return;
        }


        // ========================================================
        // CONTAINER DO MODAL
        // ========================================================

        const container =
            document.getElementById(
                'detalhesEventoConteudo'
            );


        if (!container) {

            console.error(
                '❌ detalhesEventoConteudo não encontrado.'
            );

            return;
        }


        // ========================================================
        // AUXILIARES
        // ========================================================

        function valor(
            ...opcoes
        ) {

            for (
                const item
                of opcoes
            ) {

                if (
                    item !== undefined &&
                    item !== null &&
                    String(item).trim() !== ''
                ) {

                    return item;
                }
            }


            return '';
        }


        function exibir(
            valorRecebido,
            fallback = 'Não informado'
        ) {

            const texto =
                String(
                    valorRecebido ?? ''
                ).trim();


            return escaparHtml(
                texto ||
                fallback
            );
        }


        function formatarData(
            data
        ) {

            const texto =
                String(
                    data || ''
                ).trim();


            if (!texto) {

                return 'Não informado';
            }


            const match =
                texto.match(
                    /^(\d{4})-(\d{2})-(\d{2})/
                );


            if (match) {

                return (
                    `${match[3]}/` +
                    `${match[2]}/` +
                    `${match[1]}`
                );
            }


            return texto;
        }


        function formatarCpf(
            cpf
        ) {

            const numeros =
                String(
                    cpf || ''
                )
                    .replace(
                        /\D/g,
                        ''
                    );


            if (
                numeros.length !==
                11
            ) {

                return numeros ||
                    'Não informado';
            }


            return (
                `${numeros.slice(0, 3)}.` +
                `${numeros.slice(3, 6)}.` +
                `${numeros.slice(6, 9)}-` +
                `${numeros.slice(9)}`
            );
        }


        function formatarCnpj(
            cnpj
        ) {

            const numeros =
                String(
                    cnpj || ''
                )
                    .replace(
                        /\D/g,
                        ''
                    );


            if (
                numeros.length !==
                14
            ) {

                return numeros ||
                    'Não informado';
            }


            return (
                `${numeros.slice(0, 2)}.` +
                `${numeros.slice(2, 5)}.` +
                `${numeros.slice(5, 8)}/` +
                `${numeros.slice(8, 12)}-` +
                `${numeros.slice(12)}`
            );
        }


        function interpretarBooleano(
            value
        ) {

            if (
                value === true ||
                value === 'true'
            ) {

                return true;
            }


            if (
                value === false ||
                value === 'false'
            ) {

                return false;
            }


            return null;
        }


        function badgeBooleano(
            value,
            textoSim = 'Sim',
            textoNao = 'Não',
            textoIndefinido = 'Não informado'
        ) {

            const booleano =
                interpretarBooleano(
                    value
                );


            if (
                booleano === true
            ) {

                return `
                    <span class="badge bg-success">
                        ${escaparHtml(textoSim)}
                    </span>
                `;
            }


            if (
                booleano === false
            ) {

                return `
                    <span class="badge bg-danger">
                        ${escaparHtml(textoNao)}
                    </span>
                `;
            }


            return `
                <span class="badge bg-secondary">
                    ${escaparHtml(textoIndefinido)}
                </span>
            `;
        }


        // ========================================================
        // CAMPOS PRINCIPAIS
        // ========================================================

        const tipoEvento =
            valor(
                evento.tipo_evento,
                evento.tipoEvento
            );


        const idFicha =
            valor(
                evento.id_ficha_soc,
                evento.idFicha
            );


        const colaborador =
            valor(
                evento.colaborador
            );


        const cpf =
            valor(
                evento.cpf
            );


        const unidade =
            valor(
                evento.unidade
            );


        const cnpj =
            valor(
                evento.cnpj_unidade,
                evento.cnpjUnidade
            );


        const cargo =
            valor(
                evento.cargo_colaborador,
                evento.cargoColaborador
            );


        const setor =
            valor(
                evento.setor_colaborador,
                evento.setorColaborador
            );


        const tipoExame =
            valor(
                evento.tipo_exame,
                evento.tipoExame
            );


        const dataAso =
            valor(
                evento.data_emissao_aso,
                evento.dataEmissaoAso,
                evento.data_exame,
                evento.dataExame
            );


        // ========================================================
        // APTIDÃO
        // ========================================================

        const aptidao =
            valor(
                evento.aptidao_aso,
                evento.aptidaoAso,
                evento.resultado_aso,
                evento.resultadoAso
            );


        const aptidaoLower =
            String(
                aptidao || ''
            )
                .trim()
                .toLowerCase();


        let badgeAptidao;


        if (
            aptidaoLower.includes(
                'inapto'
            )
        ) {

            badgeAptidao = `
                <span class="badge bg-danger">
                    ${exibir(aptidao)}
                </span>
            `;

        } else if (
            aptidaoLower.includes(
                'apto'
            )
        ) {

            badgeAptidao = `
                <span class="badge bg-success">
                    ${exibir(aptidao)}
                </span>
            `;

        } else {

            badgeAptidao = `
                <span class="badge bg-secondary">
                    ${exibir(aptidao)}
                </span>
            `;
        }


        // ========================================================
        // ASSINATURA DO DOCUMENTO ASO
        // ========================================================
        //
        // NÃO confundir com assinatura do evento eSocial.
        //
        // ========================================================

        const asoAssinado =
            valor(
                evento.aso_assinado,
                evento.asoAssinado
            );


        // ========================================================
        // STATUS DO EVENTO - RELATÓRIO 6603
        // ========================================================

        const statusEventoSoc =
            valor(
                evento.status_evento_soc,
                evento.statusEventoSoc
            );


        const eventoAssinado =
            (
                evento.evento_assinado !==
                undefined
            )
                ? evento.evento_assinado
                : evento.eventoAssinado;


        const numeroRecibo =
            valor(
                evento.numero_recibo,
                evento.numeroRecibo
            );


        const erroEsocial =
            valor(
                evento.erro_esocial,
                evento.erroEsocial
            );


        const codigoErroEsocial =
            valor(
                evento.codigo_erro_esocial,
                evento.codigoErroEsocial
            );


        const idArquivoEsocial =
            valor(
                evento.id_arquivo_esocial,
                evento.idArquivoEsocial
            );


        const dataGeracaoEvento =
            valor(
                evento.data_geracao_evento,
                evento.dataGeracaoEvento
            );


        // ========================================================
        // DEFINIR COR DO STATUS SOC
        // ========================================================

        const statusLower =
            String(
                statusEventoSoc || ''
            )
                .trim()
                .toLowerCase();


        let classeStatus =
            'bg-secondary';


        if (
            statusLower ===
            'assinado'
        ) {

            classeStatus =
                'bg-success';

        } else if (
            statusLower.includes(
                'conclu'
            )
        ) {

            classeStatus =
                'bg-success';

        } else if (
            statusLower.includes(
                'erro'
            ) ||
            statusLower.includes(
                'inconsist'
            )
        ) {

            classeStatus =
                'bg-danger';

        } else if (
            statusLower.includes(
                'pendente'
            ) ||
            statusLower.includes(
                'process'
            ) ||
            statusLower.includes(
                'apto'
            )
        ) {

            classeStatus =
                'bg-warning text-dark';
        }


        // ========================================================
        // RISCOS
        // ========================================================

        let riscos =
            valor(
                evento.riscos_aso,
                evento.riscosAso
            );


        if (
            typeof riscos ===
                'string' &&
            riscos.trim()
        ) {

            try {

                riscos =
                    JSON.parse(
                        riscos
                    );

            } catch (error) {

                riscos =
                    [];
            }
        }


        if (
            riscos &&
            typeof riscos === 'object' &&
            !Array.isArray(riscos)
        ) {

            riscos =
                [
                    riscos
                ];
        }


        if (
            !Array.isArray(
                riscos
            )
        ) {

            riscos =
                [];
        }


        let htmlRiscos =
            '';


        if (
            riscos.length ===
            0
        ) {

            htmlRiscos = `
                <div class="text-muted">
                    Nenhum risco informado.
                </div>
            `;

        } else {

            htmlRiscos =
                riscos
                    .map(
                        (
                            risco,
                            index
                        ) => {

                            if (
                                !risco ||
                                typeof risco !==
                                    'object'
                            ) {

                                return `
                                    <div class="border rounded p-2 mb-2">
                                        ${index + 1}.
                                        ${exibir(risco)}
                                    </div>
                                `;
                            }


                            const agente =
                                valor(

                                    risco.agente,

                                    risco.AGENTE,

                                    risco.tipo_risco,

                                    risco.TIPO_RISCO,

                                    risco.nome,

                                    risco.NOME
                                );


                            const descricao =
                                valor(

                                    risco.descricao_risco,

                                    risco.DESCRICAO_RISCO,

                                    risco.descricaoRisco,

                                    risco.descricao,

                                    risco.DESCRICAO,

                                    risco.risco,

                                    risco.RISCO
                                );


                            /*
                             * Se o SOC usar campos que ainda
                             * não conhecemos, mostramos os valores
                             * disponíveis em vez de esconder o risco.
                             */

                            const fallbackObjeto =
                                Object.entries(
                                    risco
                                )

                                    .filter(
                                        (
                                            [
                                                chave,
                                                valorCampo
                                            ]
                                        ) => {

                                            return (
                                                valorCampo !==
                                                    undefined &&
                                                valorCampo !==
                                                    null &&
                                                String(
                                                    valorCampo
                                                ).trim() !==
                                                    ''
                                            );
                                        }
                                    )

                                    .map(
                                        (
                                            [
                                                chave,
                                                valorCampo
                                            ]
                                        ) => {

                                            return (
                                                `${chave}: ` +
                                                `${valorCampo}`
                                            );
                                        }
                                    )

                                    .join(
                                        ' | '
                                    );


                            return `
                                <div
                                    class="border rounded p-2 mb-2 bg-light"
                                >
                                    <div class="fw-bold">
                                        Risco ${index + 1}
                                    </div>

                                    ${
                                        agente
                                            ? `
                                                <div>
                                                    <strong>
                                                        Agente:
                                                    </strong>

                                                    ${exibir(
                                                        agente
                                                    )}
                                                </div>
                                            `
                                            : ''
                                    }

                                    ${
                                        descricao
                                            ? `
                                                <div>
                                                    <strong>
                                                        Descrição:
                                                    </strong>

                                                    ${exibir(
                                                        descricao
                                                    )}
                                                </div>
                                            `
                                            : ''
                                    }

                                    ${
                                        !agente &&
                                        !descricao
                                            ? `
                                                <div>
                                                    ${exibir(
                                                        fallbackObjeto
                                                    )}
                                                </div>
                                            `
                                            : ''
                                    }
                                </div>
                            `;
                        }
                    )

                    .join(
                        ''
                    );
        }


        // ========================================================
        // MÉDICO
        // ========================================================

        const medico =
            valor(
                evento.medico_emitente,
                evento.medicoEmitente
            );


        const crm =
            valor(
                evento.medico_crm,
                evento.medicoCrm
            );


        const ufCrm =
            valor(
                evento.medico_uf_crm,
                evento.medicoUfCrm
            );


        let crmCompleto =
            crm;


        if (
            crm &&
            ufCrm
        ) {

            crmCompleto =
                `${crm}/${ufCrm}`;
        }


        // ========================================================
        // ASO ORIGINAL
        // ========================================================

        const conteudoAso =
            valor(
                evento.aso
            );


        // ========================================================
        // MONTAR HTML
        // ========================================================

        container.innerHTML = `

            <div class="container-fluid p-0">

                <!-- ============================================ -->
                <!-- CABEÇALHO -->
                <!-- ============================================ -->

                <div class="card mb-3">

                    <div class="card-body">

                        <div
                            class="
                                d-flex
                                justify-content-between
                                align-items-start
                                flex-wrap
                                gap-2
                            "
                        >

                            <div>

                                <h5 class="mb-1">
                                    ${exibir(
                                        colaborador,
                                        'Colaborador'
                                    )}
                                </h5>

                                <div class="text-muted">

                                    ${exibir(
                                        tipoEvento,
                                        'Evento não informado'
                                    )}

                                    ${
                                        idFicha
                                            ? `
                                                • Ficha SOC:
                                                ${exibir(
                                                    idFicha
                                                )}
                                            `
                                            : ''
                                    }

                                </div>

                            </div>


                            <span
                                class="badge bg-primary"
                                style="font-size:.85rem;"
                            >
                                ${exibir(
                                    tipoExame
                                )}
                            </span>

                        </div>

                    </div>

                </div>


                <!-- ============================================ -->
                <!-- DADOS DO ASO -->
                <!-- ============================================ -->

                <div class="card mb-3">

                    <div class="card-header fw-bold">
                        Dados do ASO
                    </div>

                    <div class="card-body">

                        <div class="row g-3">

                            <div class="col-md-6">

                                <small class="text-muted">
                                    Data do ASO
                                </small>

                                <div class="fw-semibold">
                                    ${exibir(
                                        formatarData(
                                            dataAso
                                        )
                                    )}
                                </div>

                            </div>


                            <div class="col-md-6">

                                <small class="text-muted">
                                    Aptidão
                                </small>

                                <div>
                                    ${badgeAptidao}
                                </div>

                            </div>


                            <div class="col-md-6">

                                <small class="text-muted">
                                    Documento ASO assinado
                                </small>

                                <div>

                                    ${badgeBooleano(
                                        asoAssinado,
                                        'Sim',
                                        'Não',
                                        'Não informado'
                                    )}

                                </div>

                            </div>


                            <div class="col-md-6">

                                <small class="text-muted">
                                    CPF
                                </small>

                                <div>
                                    ${exibir(
                                        formatarCpf(
                                            cpf
                                        )
                                    )}
                                </div>

                            </div>

                        </div>

                    </div>

                </div>


                <!-- ============================================ -->
                <!-- DADOS OCUPACIONAIS -->
                <!-- ============================================ -->

                <div class="card mb-3">

                    <div class="card-header fw-bold">
                        Dados Ocupacionais
                    </div>

                    <div class="card-body">

                        <div class="row g-3">

                            <div class="col-md-6">

                                <small class="text-muted">
                                    Cargo
                                </small>

                                <div class="fw-semibold">
                                    ${exibir(
                                        cargo
                                    )}
                                </div>

                            </div>


                            <div class="col-md-6">

                                <small class="text-muted">
                                    Setor
                                </small>

                                <div>
                                    ${exibir(
                                        setor
                                    )}
                                </div>

                            </div>


                            <div class="col-md-6">

                                <small class="text-muted">
                                    Unidade
                                </small>

                                <div>
                                    ${exibir(
                                        unidade
                                    )}
                                </div>

                            </div>


                            <div class="col-md-6">

                                <small class="text-muted">
                                    CNPJ
                                </small>

                                <div>
                                    ${exibir(
                                        formatarCnpj(
                                            cnpj
                                        )
                                    )}
                                </div>

                            </div>

                        </div>

                    </div>

                </div>


                <!-- ============================================ -->
                <!-- MÉDICO -->
                <!-- ============================================ -->

                <div class="card mb-3">

                    <div class="card-header fw-bold">
                        Médico do ASO
                    </div>

                    <div class="card-body">

                        <div class="row g-3">

                            <div class="col-md-8">

                                <small class="text-muted">
                                    Médico
                                </small>

                                <div>
                                    ${exibir(
                                        medico
                                    )}
                                </div>

                            </div>


                            <div class="col-md-4">

                                <small class="text-muted">
                                    CRM
                                </small>

                                <div>
                                    ${exibir(
                                        crmCompleto
                                    )}
                                </div>

                            </div>

                        </div>

                    </div>

                </div>


                <!-- ============================================ -->
                <!-- RISCOS -->
                <!-- ============================================ -->

                <div class="card mb-3">

                    <div class="card-header fw-bold">

                        Riscos Ocupacionais

                        <span
                            class="badge bg-secondary ms-1"
                        >
                            ${riscos.length}
                        </span>

                    </div>

                    <div class="card-body">

                        ${htmlRiscos}

                    </div>

                </div>


                <!-- ============================================ -->
                <!-- STATUS REAL ESOCIAL / SOC -->
                <!-- ============================================ -->

                <div class="card mb-3">

                    <div class="card-header fw-bold">
                        Status do Evento no SOC / eSocial
                    </div>

                    <div class="card-body">

                        <div class="row g-3">

                            <div class="col-md-6">

                                <small class="text-muted">
                                    Status no SOC
                                </small>

                                <div>

                                    ${
                                        statusEventoSoc
                                            ? `
                                                <span
                                                    class="
                                                        badge
                                                        ${classeStatus}
                                                    "
                                                >
                                                    ${exibir(
                                                        statusEventoSoc
                                                    )}
                                                </span>
                                            `
                                            : `
                                                <span
                                                    class="
                                                        badge
                                                        bg-secondary
                                                    "
                                                >
                                                    Ainda não localizado
                                                </span>
                                            `
                                    }

                                </div>

                            </div>


                            <div class="col-md-6">

                                <small class="text-muted">
                                    Evento eSocial assinado
                                </small>

                                <div>

                                    ${badgeBooleano(
                                        eventoAssinado,
                                        'Sim',
                                        'Não',
                                        'Ainda não localizado'
                                    )}

                                </div>

                            </div>


                            <div class="col-md-6">

                                <small class="text-muted">
                                    Data de geração
                                </small>

                                <div>
                                    ${exibir(
                                        formatarData(
                                            dataGeracaoEvento
                                        )
                                    )}
                                </div>

                            </div>


                            <div class="col-md-6">

                                <small class="text-muted">
                                    Recibo
                                </small>

                                <div
                                    style="
                                        word-break:
                                        break-all;
                                    "
                                >
                                    ${exibir(
                                        numeroRecibo,
                                        'Ainda não disponível'
                                    )}
                                </div>

                            </div>


                            <div class="col-12">

                                <small class="text-muted">
                                    ID do arquivo eSocial
                                </small>

                                <div
                                    style="
                                        word-break:
                                        break-all;
                                    "
                                >
                                    ${exibir(
                                        idArquivoEsocial
                                    )}
                                </div>

                            </div>

                        </div>


                        ${
                            erroEsocial ||
                            codigoErroEsocial
                                ? `

                                    <hr>

                                    <div
                                        class="
                                            alert
                                            alert-danger
                                            mb-0
                                        "
                                    >

                                        <div class="fw-bold mb-1">

                                            <i
                                                class="
                                                    fas
                                                    fa-exclamation-triangle
                                                "
                                            ></i>

                                            Inconsistência eSocial

                                        </div>


                                        ${
                                            codigoErroEsocial
                                                ? `
                                                    <div class="mb-1">

                                                        <strong>
                                                            Código:
                                                        </strong>

                                                        ${exibir(
                                                            codigoErroEsocial
                                                        )}

                                                    </div>
                                                `
                                                : ''
                                        }


                                        ${
                                            erroEsocial
                                                ? `
                                                    <div>

                                                        <strong>
                                                            Erro:
                                                        </strong>

                                                        ${exibir(
                                                            erroEsocial
                                                        )}

                                                    </div>
                                                `
                                                : ''
                                        }

                                    </div>
                                `
                                : ''
                        }

                    </div>

                </div>


                <!-- ============================================ -->
                <!-- DETALHES ORIGINAIS -->
                <!-- ============================================ -->

                ${
                    conteudoAso
                        ? `

                            <div class="card mb-2">

                                <div class="card-header fw-bold">
                                    Detalhes do S-2220
                                </div>

                                <div class="card-body">

                                    <div
                                        style="
                                            max-height:350px;
                                            overflow-y:auto;
                                            background:#f8f9fa;
                                            padding:15px;
                                            border-radius:6px;
                                            font-size:.85rem;
                                            white-space:pre-wrap;
                                            word-wrap:break-word;
                                        "
                                    >${escaparHtml(
                                        conteudoAso
                                    )}</div>

                                </div>

                            </div>

                        `
                        : ''
                }

            </div>
        `;


        // ========================================================
        // ABRIR MODAL
        // ========================================================

        const modalEl =
            document.getElementById(
                'detalhesEventoModal'
            );


        if (
            modalEl
        ) {

            bootstrap.Modal
                .getOrCreateInstance(
                    modalEl
                )
                .show();
        }


    } catch (error) {

        console.error(
            '❌ Erro ASO:',
            error
        );


        mostrarAlertaESocial(
            'Erro ao carregar ASO: ' +
            error.message,
            'danger'
        );
    }
}

    function idsPersistidosSelecionados() {

    return Array
        .from(
            eventosSelecionados
        )
        .filter(
            id => {

                const evento =
                    encontrarEvento(
                        id
                    );


                if (
                    !evento
                ) {

                    return false;
                }


                if (
                    evento.persistido ===
                    false
                ) {

                    return false;
                }


                if (
                    evento.pode_emitir !==
                    true
                ) {

                    return false;
                }


                if (
                    evento.confirmado_nao_emitido !==
                    true
                ) {

                    return false;
                }


                if (
                    evento.emitido_esocial ===
                        true ||
                    evento.ja_emitido ===
                        true
                ) {

                    return false;
                }


                if (
                    evento.aguardando_verificacao ===
                        true ||
                    evento.status ===
                        'aguardando_verificacao'
                ) {

                    return false;
                }


                return true;
            }
        );
}

    async function enviarEventosSelecionados() {
        const ids =
            idsPersistidosSelecionados();

        if (
            !ids.length
        ) {
            mostrarAlertaESocial(
                'Selecione pelo menos um ' +
                'evento salvo no sistema.',
                'warning'
            );

            return;
        }

        if (
            !confirm(
                `Deseja enviar ` +
                `${ids.length} evento(s)?`
            )
        ) {
            return;
        }

        await enviarIds(ids);
    }

    async function enviarTodosEventos() {

    // ========================================================
    // SOMENTE EVENTOS EXPLICITAMENTE LIBERADOS PELO BACKEND
    // ========================================================

    const eventosParaEnviar =
        eventosESocial.filter(
            evento => {

                if (
                    !evento ||
                    evento.persistido ===
                        false
                ) {

                    return false;
                }


                // ================================================
                // BACKEND PRECISA LIBERAR EXPLICITAMENTE
                //
                // pode_emitir já diferencia S-2220 x S-2240 certo.
                // ================================================

                if (
                    evento.pode_emitir !==
                    true
                ) {

                    return false;
                }


                // ================================================
                // NÃO PODE JÁ ESTAR EMITIDO
                // ================================================

                if (
                    evento.emitido_esocial ===
                        true ||
                    evento.ja_emitido ===
                        true
                ) {

                    return false;
                }


                // ================================================
                // NÃO PODE ESTAR AGUARDANDO VERIFICAÇÃO
                // ================================================

                if (
                    evento.aguardando_verificacao ===
                        true ||
                    evento.status ===
                        'aguardando_verificacao'
                ) {

                    return false;
                }


                // ================================================
                // PRECISA ESTAR CLASSIFICADO COMO NÃO EMITIDO
                // ================================================

                if (
                    evento.confirmado_nao_emitido !==
                    true
                ) {

                    return false;
                }


                return true;
            }
        );


    // ========================================================
    // NADA PARA ENVIAR
    // ========================================================

    if (
        !eventosParaEnviar.length
    ) {

        mostrarAlertaESocial(
            'Nenhum evento está liberado para envio. ' +
            'Eventos em "Aguardando verificação" não serão enviados.',
            'info'
        );

        return;
    }


    // ========================================================
    // CONFIRMAR
    // ========================================================

    if (
        !confirm(
            `Deseja enviar ${eventosParaEnviar.length} ` +
            `evento(s) confirmado(s como não emitidos)?`
        )
    ) {

        return;
    }


    // ========================================================
    // ENVIAR
    // ========================================================

    await enviarIds(
        eventosParaEnviar.map(
            evento =>
                String(
                    evento.id
                )
        )
    );
}

    // ============================================================
    // RESOLVER MATRÍCULAS DE UMA HOLDING INTEIRA
    // ============================================================

    async function resolverMatriculasHolding() {

        const holding = String(
            document.getElementById('filtroHoldingEvento')?.value || ''
        ).trim();

        if (!holding) {
            mostrarAlertaESocial(
                'Selecione uma holding no filtro antes de resolver as matrículas.',
                'warning'
            );
            return;
        }

        if (
            !confirm(
                `Tentar resolver agora as matrículas pendentes da ` +
                `holding "${holding}"? Isso consome a cota diária ` +
                `real de consultas ao eSocial.`
            )
        ) {
            return;
        }

        const btn = document.getElementById('btnResolverMatriculasHolding');
        let htmlOriginal = '';

        if (btn) {
            htmlOriginal = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resolvendo...';
        }

        try {

            const token = await obterTokenESocial();

            mostrarAlertaESocial(
                `Resolvendo matrículas da holding "${holding}"...`,
                'info'
            );

            const response = await fetch(
                apiUrl(
                    '/api/soc/matriculas-esocial/processar-fila-holding'
                ),
                {
                    method: 'POST',
                    headers: criarHeaders(token, true),
                    body: JSON.stringify({
                        holding,
                        limite: 15
                    })
                }
            );

            const texto = await response.text();
            let resultado = {};

            try {
                resultado = texto ? JSON.parse(texto) : {};
            } catch (errorJson) {
                resultado = {
                    success: false,
                    error: texto || 'Resposta inválida do servidor.'
                };
            }

            if (!response.ok || resultado.success === false) {
                throw new Error(
                    resultado.error || `Erro HTTP ${response.status}`
                );
            }

            if (resultado.motivo === 'HOLDING_SEM_EMPRESAS_COM_CODIGO_SOC') {

                mostrarAlertaESocial(
                    `Nenhuma empresa com código SOC encontrada para a ` +
                    `holding "${holding}".`,
                    'warning'
                );

            } else if (resultado.executou === false) {

                mostrarAlertaESocial(
                    `Não foi possível processar agora: ` +
                    `${resultado.motivo || 'motivo desconhecido'}.`,
                    'warning'
                );

            } else {

                const resultados = resultado.resultados || [];
                const resolvidos = resultados.filter(
                    r => r.resolvida
                ).length;

                mostrarAlertaESocial(
                    `Processado: ${resolvidos} de ${resultados.length} ` +
                    `matrícula(s) resolvida(s) agora nesta holding. ` +
                    `O restante continua na fila automática.`,
                    resolvidos > 0 ? 'success' : 'info'
                );
            }

            await recarregarEventosESocial();

        } catch (error) {

            console.error(
                '❌ Erro ao resolver matrículas da holding:',
                error
            );

            mostrarAlertaESocial(
                'Não foi possível resolver as matrículas desta ' +
                'holding: ' + error.message,
                'warning'
            );

        } finally {

            if (btn) {
                btn.disabled = false;
                btn.innerHTML = htmlOriginal;
            }
        }
    }

    async function enviarEventoIndividual(
        id
    ) {
        const evento =
            encontrarEvento(
                id
            );

        if (
            !evento ||
            evento.persistido === false
        ) {
            mostrarAlertaESocial(
                'Esse registro veio diretamente ' +
                'do SOC e ainda não está salvo ' +
                'para envio.',
                'warning'
            );

            return;
        }

        if (
            !confirm(
                'Deseja enviar este evento?'
            )
        ) {
            return;
        }

        await enviarIds(
            [String(id)]
        );
    }

    // ============================================================
// AGUARDAR
// ============================================================

function aguardarESocial(
    milissegundos
) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milissegundos
            )
    );
}


// ============================================================
// FAZER REQUISIÇÃO E LER JSON MESMO QUANDO HTTP NÃO É 200
// ============================================================

async function requisicaoEsocialComStatus(
    path,
    options =
        {}
) {

    const response =
        await fetch(
            apiUrl(
                path
            ),
            options
        );


    const texto =
        await response.text();


    let data =
        {};


    if (
        texto
    ) {

        try {

            data =
                JSON.parse(
                    texto
                );

        } catch (
            error
        ) {

            data = {

                success:
                    false,

                error:
                    texto
            };
        }
    }


    return {

        ok:
            response.ok,

        status:
            response.status,

        data
    };
}


// ============================================================
// CONSULTAR PROCESSAMENTO DE UM EVENTO
// ============================================================

async function aguardarProcessamentoEventoEsocial(
    id,
    token,
    {
        maxTentativas =
            12,

        intervaloMs =
            5000
    } = {}
) {

    for (
        let tentativa = 1;
        tentativa <= maxTentativas;
        tentativa++
    ) {

        /*
         * Esperamos antes da primeira consulta porque o lote
         * acabou de ser recebido e normalmente ainda estará
         * em processamento.
         */

        await aguardarESocial(
            intervaloMs
        );


        const retorno =
            await requisicaoEsocialComStatus(

                `/api/soc/consultar-lote-esocial/` +
                `${encodeURIComponent(id)}`,

                {

                    method:
                        'POST',

                    headers:
                        criarHeaders(
                            token,
                            true
                        ),

                    body:
                        JSON.stringify(
                            {}
                        )
                }
            );


        const resultado =
            retorno.data ||
            {};


        console.log(
            `🔎 Processamento eSocial ${id} ` +
            `(${tentativa}/${maxTentativas}):`,
            resultado
        );


        // ====================================================
        // EVENTO ACEITO
        // ====================================================

        if (
            resultado.processado ===
                true &&
            resultado.eventoAceito ===
                true
        ) {

            return {

                finalizado:
                    true,

                sucesso:
                    true,

                resultado
            };
        }


        // ====================================================
        // EVENTO REJEITADO
        // ====================================================

        if (
            resultado.processado ===
                true &&
            resultado.eventoAceito ===
                false
        ) {

            return {

                finalizado:
                    true,

                sucesso:
                    false,

                resultado
            };
        }


        // ====================================================
        // AINDA PROCESSANDO
        // ====================================================

        if (
            resultado.aguardandoProcessamento ===
                true ||
            resultado.processado ===
                false &&
            String(
                resultado.cdRespostaLote ||
                ''
            ) ===
                '101'
        ) {

            continue;
        }


        // ====================================================
        // ERRO DEFINITIVO DA CONSULTA
        // ====================================================

        if (
            retorno.ok ===
                false
        ) {

            return {

                finalizado:
                    true,

                sucesso:
                    false,

                erroConsulta:
                    true,

                resultado
            };
        }
    }


    // ========================================================
    // NÃO TERMINOU DENTRO DO TEMPO
    //
    // NÃO É FALHA DO EVENTO.
    // Ele fica com protocolo salvo e pode ser consultado depois.
    // ========================================================

    return {

        finalizado:
            false,

        sucesso:
            false,

        aguardando:
            true,

        resultado: {

            success:
                true,

            processado:
                false,

            error:
                'O eSocial ainda está processando o evento.'
        }
    };
}


// ============================================================
// MONTAR TEXTO DE ERRO DO ESOCIAL
// ============================================================

function montarErroEventoEsocial(
    resultado
) {

    const ocorrencias =
        Array.isArray(
            resultado?.ocorrencias
        )
            ? resultado.ocorrencias
            : [];


    const textoOcorrencias =
        ocorrencias
            .map(
                ocorrencia =>
                    [
                        ocorrencia.codigo,
                        ocorrencia.descricao,
                        ocorrencia.localizacao
                    ]
                        .filter(
                            Boolean
                        )
                        .join(
                            ' - '
                        )
            )
            .filter(
                Boolean
            )
            .join(
                ' | '
            );


    return (
        textoOcorrencias ||
        resultado?.error ||
        resultado?.descRespostaEvento ||
        resultado?.descRespostaLote ||
        resultado?.descResposta ||
        resultado?.message ||
        'Erro não informado pelo eSocial.'
    );
}

// ============================================================
// CONTROLAR CHECKBOXES DE ENVIO
// ============================================================

function atualizarBloqueioSelecaoEventosESocial() {

    document
        .querySelectorAll(
            '.selecionar-evento'
        )
        .forEach(
            checkbox => {

                const id =
                    String(
                        checkbox.dataset.id ||
                        ''
                    );


                const evento =
                    encontrarEvento(
                        id
                    );


                if (
                    !evento
                ) {

                    checkbox.checked =
                        false;

                    checkbox.disabled =
                        true;

                    eventosSelecionados.delete(
                        id
                    );

                    return;
                }


                // ====================================================
                // SÓ PODE SER SELECIONADO QUANDO O BACKEND LIBEROU
                // ====================================================

                const podeSelecionar =
                    evento.persistido !== false &&
                    evento.pode_emitir === true &&
                    evento.confirmado_nao_emitido === true &&
                    evento.emitido_esocial !== true &&
                    evento.ja_emitido !== true &&
                    evento.aguardando_verificacao !== true &&
                    evento.status !==
                        'aguardando_verificacao' &&
                    String(
                        evento.tipo_evento ||
                        ''
                    )
                        .trim()
                        .toUpperCase() ===
                        'S-2220';


                checkbox.disabled =
                    !podeSelecionar;


                // ====================================================
                // SE NÃO PODE, TIRAR DA SELEÇÃO
                // ====================================================

                if (
                    !podeSelecionar
                ) {

                    checkbox.checked =
                        false;


                    eventosSelecionados.delete(
                        id
                    );
                }
            }
        );


    atualizarSelecaoTodos();
}

async function enviarIds(
    ids
) {

    // ========================================================
    // NORMALIZAR IDS
    // ========================================================

    const listaIds =
        Array.from(
            new Set(
                (
                    Array.isArray(
                        ids
                    )
                        ? ids
                        : []
                )
                    .map(
                        id =>
                            String(
                                id ||
                                ''
                            ).trim()
                    )
                    .filter(
                        Boolean
                    )
            )
        );


    if (
        !listaIds.length
    ) {

        mostrarAlertaESocial(
            'Nenhum evento foi informado para envio.',
            'warning'
        );

        return;
    }


    // ========================================================
    // VALIDAR O QUE REALMENTE PODE SER ENVIADO
    // ========================================================

    const fila =
        listaIds
            .map(
                id => {

                    const evento =
                        encontrarEvento(
                            id
                        );


                    return {

                        id,

                        evento
                    };
                }
            )
            .filter(
                item => {

                    const evento =
                        item.evento;


                    if (
                        !evento ||
                        evento.persistido ===
                            false
                    ) {

                        return false;
                    }


                    // ============================================
                    // BACKEND PRECISA TER CLASSIFICADO
                    // COMO DISPONÍVEL PARA ENVIO
                    //
                    // pode_emitir já diferencia S-2220 x S-2240.
                    // ============================================

                    if (
                        evento.pode_emitir !==
                        true
                    ) {

                        return false;
                    }


                    // ============================================
                    // NÃO PODE ESTAR EMITIDO
                    // ============================================

                    if (
                        evento.emitido_esocial ===
                            true ||
                        evento.ja_emitido ===
                            true
                    ) {

                        return false;
                    }


                    // ============================================
                    // NÃO PODE ESTAR AGUARDANDO VERIFICAÇÃO
                    // ============================================

                    if (
                        evento.aguardando_verificacao ===
                            true ||
                        evento.status ===
                            'aguardando_verificacao'
                    ) {

                        return false;
                    }


                    // ============================================
                    // PRECISA ESTAR CLASSIFICADO COMO NÃO EMITIDO
                    // ============================================

                    if (
                        evento.confirmado_nao_emitido !==
                        true
                    ) {

                        return false;
                    }


                    return true;
                }
            );


    if (
        !fila.length
    ) {

        mostrarAlertaESocial(
            'Nenhum dos eventos selecionados está liberado para envio. ' +
            'Eventos já emitidos ou aguardando verificação foram ignorados.',
            'warning'
        );

        return;
    }


    // ========================================================
    // AVISAR SE ALGUNS FORAM DESCARTADOS
    // ========================================================

    const ignorados =
        listaIds.length -
        fila.length;


    if (
        ignorados >
        0
    ) {

        console.warn(
            `⚠️ ${ignorados} evento(s) não foram colocados ` +
            'na fila porque não estão liberados.'
        );
    }


    // ========================================================
    // TOKEN
    // ========================================================

    let token;


    try {

        token =
            await obterTokenESocial();

    } catch (
        error
    ) {

        mostrarAlertaESocial(
            'Não foi possível iniciar a fila de envio.',
            'danger'
        );

        return;
    }


    // ========================================================
    // CONTADORES
    // ========================================================

    let enviados =
        0;

    let concluidos =
        0;

    let erros =
        0;

    let aguardando =
        0;

    let jaExistiam =
        0;

    let bloqueados =
        0;


    const detalhesErros =
        [];


    let interromperFila =
        false;


    // ========================================================
    // INÍCIO
    // ========================================================

    mostrarAlertaESocial(
        `Iniciando fila de ${fila.length} evento(s). ` +
        'Os eventos serão enviados um por vez.',
        'info'
    );


    // ========================================================
    // PROCESSAR UM POR VEZ
    // ========================================================

    for (
        let indice = 0;
        indice < fila.length;
        indice++
    ) {

        if (
            interromperFila
        ) {

            break;
        }


        const {
            id,
            evento
        } =
            fila[
                indice
            ];


        const nome =
            String(
                evento.colaborador ||
                evento.nome_colaborador ||
                `Evento ${id}`
            );


        // ====================================================
        // PROGRESSO
        // ====================================================

        mostrarAlertaESocial(
            `Processando ${indice + 1}/${fila.length}: ` +
            `${nome}`,
            'info'
        );


        console.log(
            `📤 Fila eSocial ${indice + 1}/${fila.length}:`,
            {
                id,
                colaborador:
                    nome,
                tipo:
                    evento.tipo_evento
            }
        );


        try {

            // =================================================
            // ENVIAR EVENTO
            // =================================================

            const retornoEnvio =
                await requisicaoEsocialComStatus(

                    `/api/soc/enviar-evento-esocial/` +
                    `${encodeURIComponent(id)}`,

                    {

                        method:
                            'POST',

                        headers:
                            criarHeaders(
                                token,
                                true
                            ),

                        body:
                            JSON.stringify(
                                {}
                            )
                    }
                );


            const resultadoEnvio =
                retornoEnvio.data ||
                {};


            console.log(
                `📥 Retorno envio ${id}:`,
                resultadoEnvio
            );


            // =================================================
            // JÁ EXISTIA NO E-SOCIAL
            // =================================================

            if (
                resultadoEnvio.motivo ===
                'EVENTO_JA_EXISTE_NO_ESOCIAL'
            ) {

                jaExistiam++;


                console.log(
                    `✅ ${nome}: já existia no eSocial.`
                );


                continue;
            }


            // =================================================
            // PRODUÇÃO BLOQUEADA PELO .ENV
            //
            // Neste caso NÃO adianta tentar os próximos.
            // Interrompe toda a fila.
            // =================================================

            if (
                resultadoEnvio.motivo ===
                    'PRODUCAO_NAO_AUTORIZADA' ||
                resultadoEnvio.motivo ===
                    'PRODUCAO_BLOQUEADA'
            ) {

                bloqueados++;


                interromperFila =
                    true;


                mostrarAlertaESocial(
                    'A fila foi interrompida porque o envio em Produção ' +
                    'ainda está bloqueado pela configuração de segurança.',
                    'warning'
                );


                break;
            }


            // =================================================
            // VERIFICAÇÃO NÃO PERMITIU ENVIO
            // =================================================

            if (
                resultadoEnvio.motivo ===
                    'VERIFICACAO_ESOCIAL_INCOMPLETA' ||
                resultadoEnvio.motivo ===
                    'VERIFICACAO_ESOCIAL_FALHOU' ||
                resultadoEnvio.motivo ===
                    'EVENTO_FORA_JANELA_SEGURA_BX' ||
                resultadoEnvio.motivo ===
                    'ENVIO_ANTERIOR_INCERTO' ||
                resultadoEnvio.motivo ===
                    'EVENTO_LOCAL_JA_POSSUI_PROTOCOLO'
            ) {

                bloqueados++;


                detalhesErros.push({

                    id,

                    colaborador:
                        nome,

                    etapa:
                        'bloqueado',

                    erro:
                        resultadoEnvio.error ||
                        resultadoEnvio.motivo
                });


                /*
                 * Esse evento foi bloqueado,
                 * mas não interrompe os outros.
                 */

                continue;
            }


            // =================================================
            // ENVIO NÃO FOI ACEITO
            // =================================================

            if (
                retornoEnvio.ok ===
                    false ||
                resultadoEnvio.success !==
                    true ||
                resultadoEnvio.enviadoAoEsocial !==
                    true
            ) {

                erros++;


                detalhesErros.push({

                    id,

                    colaborador:
                        nome,

                    etapa:
                        'envio',

                    erro:
                        montarErroEventoEsocial(
                            resultadoEnvio
                        )
                });


                continue;
            }


            // =================================================
            // LOTE RECEBIDO
            // =================================================

            enviados++;


            const protocolo =
                String(
                    resultadoEnvio.protocoloEnvio ||
                    ''
                ).trim();


            // =================================================
            // SEM PROTOCOLO
            //
            // Não fazemos novo envio.
            // Consideramos situação incerta e seguimos.
            // =================================================

            if (
                !protocolo
            ) {

                aguardando++;


                detalhesErros.push({

                    id,

                    colaborador:
                        nome,

                    etapa:
                        'protocolo',

                    erro:
                        'O eSocial recebeu a requisição, mas o protocolo não foi retornado.'
                });


                continue;
            }


            // =================================================
            // CONSULTAR PROCESSAMENTO
            // =================================================

            mostrarAlertaESocial(
                `${nome}: lote recebido. ` +
                'Aguardando processamento do eSocial...',
                'info'
            );


            const processamento =
                await aguardarProcessamentoEventoEsocial(

                    id,

                    token,

                    {
                        /*
                         * 12 tentativas x 5 segundos
                         * = aproximadamente 1 minuto.
                         */

                        maxTentativas:
                            12,

                        intervaloMs:
                            5000
                    }
                );


            // =================================================
            // CONCLUÍDO
            // =================================================

            if (
                processamento.finalizado ===
                    true &&
                processamento.sucesso ===
                    true
            ) {

                concluidos++;


                const recibo =
                    processamento
                        .resultado
                        ?.numeroRecibo ||
                    '';


                console.log(
                    `✅ ${nome}: concluído.`,
                    {
                        id,
                        recibo
                    }
                );


                continue;
            }


            // =================================================
            // REJEITADO
            // =================================================

            if (
                processamento.finalizado ===
                    true &&
                processamento.sucesso ===
                    false
            ) {

                erros++;


                detalhesErros.push({

                    id,

                    colaborador:
                        nome,

                    etapa:
                        'processamento',

                    erro:
                        montarErroEventoEsocial(
                            processamento.resultado
                        )
                });


                /*
                 * Um erro em um colaborador NÃO para os outros.
                 */

                continue;
            }


            // =================================================
            // AINDA PROCESSANDO
            //
            // O protocolo está salvo.
            // Não enviamos novamente.
            // =================================================

            aguardando++;


            console.warn(
                `⏳ ${nome}: ainda processando no eSocial.`
            );


        } catch (
            error
        ) {

            erros++;


            detalhesErros.push({

                id,

                colaborador:
                    nome,

                etapa:
                    'excecao',

                erro:
                    error?.message ||
                    String(
                        error
                    )
            });


            console.error(
                `❌ Erro na fila eSocial - ${nome}:`,
                error
            );
        }


        // ====================================================
        // PEQUENO INTERVALO ENTRE EVENTOS
        //
        // Evita martelar os Web Services.
        // ====================================================

        if (
            indice <
            fila.length -
            1
        ) {

            await aguardarESocial(
                1500
            );
        }
    }


    // ========================================================
    // RECARREGAR DADOS
    // ========================================================

    eventosSelecionados.clear();


    await carregarEventosESocial();


    // ========================================================
    // RESUMO
    // ========================================================

    const quantidadeProcessada =
        concluidos +
        erros +
        aguardando +
        jaExistiam +
        bloqueados;


    let mensagem =
        `Fila eSocial finalizada. ` +
        `${quantidadeProcessada} evento(s) processado(s). ` +
        `${concluidos} concluído(s).`;


    if (
        jaExistiam
    ) {

        mensagem +=
            ` ${jaExistiam} já existia(m) no eSocial.`;
    }


    if (
        aguardando
    ) {

        mensagem +=
            ` ${aguardando} ainda está(ão) processando.`;
    }


    if (
        erros
    ) {

        mensagem +=
            ` ${erros} apresentou(aram) erro.`;
    }


    if (
        bloqueados
    ) {

        mensagem +=
            ` ${bloqueados} foi(ram) bloqueado(s).`;
    }


    if (
        interromperFila
    ) {

        mensagem +=
            ' A fila foi interrompida antes do final.';
    }


    mostrarAlertaESocial(
        mensagem,
        erros ||
        bloqueados ||
        aguardando
            ? 'warning'
            : 'success'
    );


    // ========================================================
    // LOG COMPLETO
    // ========================================================

    console.log(
        '📊 Resultado final da fila eSocial:',
        {

            solicitados:
                listaIds.length,

            liberados:
                fila.length,

            enviados,

            concluidos,

            jaExistiam,

            aguardando,

            erros,

            bloqueados,

            interrompida:
                interromperFila,

            detalhesErros
        }
    );
}

    // ============================================================
    // CANCELAR
    // ============================================================

    async function cancelarEvento(
        id
    ) {
        const evento =
            encontrarEvento(
                id
            );

        if (
            !evento ||
            evento.persistido === false
        ) {
            mostrarAlertaESocial(
                'Esse registro ainda não ' +
                'está salvo no sistema.',
                'warning'
            );

            return;
        }

        if (
            !confirm(
                'Deseja cancelar este evento?'
            )
        ) {
            return;
        }

        try {
            const token =
                await obterTokenESocial();

            const result =
                await requisicaoJson(
                    `/api/soc/cancelar-evento/` +
                    `${encodeURIComponent(id)}`,
                    {
                        method:
                            'POST',

                        headers:
                            criarHeaders(
                                token,
                                true
                            )
                    }
                );

            if (
                result.success
            ) {
                mostrarAlertaESocial(
                    'Evento cancelado com sucesso!',
                    'success'
                );

                await carregarEventosESocial();

            } else {
                mostrarAlertaESocial(
                    result.error ||
                    'Erro ao cancelar evento.',
                    'danger'
                );
            }

        } catch (error) {
            console.error(
                '❌ Erro ao cancelar:',
                error
            );

            mostrarAlertaESocial(
                'Erro ao cancelar evento: ' +
                error.message,
                'danger'
            );
        }
    }

    // ============================================================
    // XML
    // ============================================================

    async function verXmlEvento(
        id
    ) {
        const evento =
            encontrarEvento(
                id
            );

        if (
            !evento ||
            evento.persistido === false
        ) {
            mostrarAlertaESocial(
                'XML ainda não disponível ' +
                'para esse registro.',
                'info'
            );

            return;
        }

        try {
            const token =
                await obterTokenESocial();

            const data =
                await requisicaoJson(
                    `/api/soc/evento-xml/` +
                    `${encodeURIComponent(id)}`,
                    {
                        headers:
                            criarHeaders(
                                token
                            )
                    }
                );

            const xml =
                data.xml ||
                'XML não disponível';

            const container =
                document.getElementById(
                    'detalhesEventoConteudo'
                );

            if (container) {
                container.innerHTML = `
                    <div class="card bg-light">
                        <div class="card-body">

                            <h6 class="fw-bold">
                                XML -
                                ${escaparHtml(
                                    evento.tipo_evento ||
                                    ''
                                )}
                            </h6>

                            <pre
                                style="
                                    max-height:500px;
                                    overflow-y:auto;
                                    background:#f8f9fa;
                                    padding:15px;
                                    border-radius:6px;
                                    font-size:.7rem;
                                    white-space:pre-wrap;
                                    word-wrap:break-word;
                                "
                            >${escaparHtml(
                                xml
                            )}</pre>

                        </div>
                    </div>
                `;

                window._xmlAtual =
                    xml;

                const modalEl =
                    document.getElementById(
                        'detalhesEventoModal'
                    );

                if (modalEl) {
                    bootstrap.Modal
                        .getOrCreateInstance(
                            modalEl
                        )
                        .show();
                }
            }

        } catch (error) {
            console.error(
                '❌ Erro XML:',
                error
            );

            mostrarAlertaESocial(
                'Erro ao carregar XML: ' +
                error.message,
                'danger'
            );
        }
    }

    // ============================================================
    // FILTROS DA TELA
    // ============================================================

    function recarregarEventosESocial() {
        const filtros = {
            status: document.getElementById('filtroStatusEvento')?.value || '',
            tipoEvento: document.getElementById('filtroTipoEvento')?.value || '',
            dataInicio: document.getElementById('filtroDataInicio')?.value || '',
            dataFim: document.getElementById('filtroDataFim')?.value || ''
        };

        return carregarEventosESocial(filtros);
    }

    function limparFiltrosESocial() {
        [
            'filtroStatusEvento',
            'filtroTipoEvento',
            'filtroDataInicio',
            'filtroDataFim',
            'filtroHoldingEvento',
            'filtroUnidadeEvento',
            'filtroBuscaEvento'
        ].forEach(id => {
            const elemento = document.getElementById(id);
            if (elemento) elemento.value = '';
        });

        return carregarEventosESocial();
    }

    // ============================================================
    // COPIAR XML
    // ============================================================

    function copiarXmlESocial() {
        if (
            !window._xmlAtual
        ) {
            mostrarAlertaESocial(
                'Nenhum XML disponível para copiar.',
                'info'
            );

            return;
        }

        if (
            navigator.clipboard
                ?.writeText
        ) {
            navigator.clipboard
                .writeText(
                    window._xmlAtual
                )
                .then(
                    () =>
                        mostrarAlertaESocial(
                            'XML copiado!',
                            'success'
                        )
                )
                .catch(
                    () =>
                        copiarXmlFallback()
                );

        } else {
            copiarXmlFallback();
        }
    }

    function copiarXmlFallback() {
        const textarea =
            document.createElement(
                'textarea'
            );

        textarea.value =
            window._xmlAtual ||
            '';

        document.body
            .appendChild(
                textarea
            );

        textarea.select();

        document.execCommand(
            'copy'
        );

        document.body
            .removeChild(
                textarea
            );

        mostrarAlertaESocial(
            'XML copiado!',
            'success'
        );
    }

    // ============================================================
    // MODAL SOC
    // ============================================================

    function abrirModalBuscaSoc() {
        const modalEl =
            document.getElementById(
                'buscarDadosSocModal'
            );

        if (!modalEl) {
            mostrarAlertaESocial(
                'Modal de busca SOC ' +
                'não encontrado.',
                'danger'
            );

            return;
        }

        mostrarStatusBuscaSoc('');

        bootstrap.Modal
            .getOrCreateInstance(
                modalEl
            )
            .show();
    }

    function atualizarAvisoModalSoc() {
        const form =
            document.getElementById(
                'buscarSocForm'
            );

        const alerta =
            form?.querySelector(
                '.alert.alert-info'
            );

        if (!alerta) {
            return;
        }

        const tituloModal =
            document.querySelector(
                '#buscarDadosSocModal .modal-title'
            );

        if (tituloModal) {
            tituloModal.innerHTML =
                '<i class="fas fa-sync me-2"></i> Buscar SOC e Preparar eSocial';
        }

        /*
         * O fluxo operacional é por período:
         * SOC -> preparação local/cache -> fila de vínculo -> envio manual.
         */
        alerta.innerHTML = `
            <i class="fas fa-info-circle"></i>

            <strong>
                O que será buscado agora:
            </strong>

            <ul class="mb-0 mt-1">

                <li>
                    Dados reais através do
                    Exporta Dados do SOC.
                </li>

                <li>
                    <strong>S-2220</strong> -
                    Funcionário, ASO, exames
                    e responsável.
                </li>

                <li>
                    Filtro por período de
                    ficha, inclusão ou
                    alteração do ASO.
                </li>

                <li>
                    <strong>S-2240</strong> -
                    quando a regra do SOC indicar que o colaborador precisa do evento,
                    ele também será preparado. O envio continuará bloqueado enquanto
                    faltarem dados obrigatórios ou enquanto a produção S-2240 não estiver liberada.
                </li>

            </ul>
        `;
    }

    // ============================================================
// INICIALIZAR E-SOCIAL
// ============================================================

async function initESocial() {
    console.log('🚀 Inicializando módulo e-Social...');

    try {

        // ========================================================
        // 1. BOTÃO PRINCIPAL - BUSCAR DADOS DO SOC
        // ========================================================

        const btnBuscarDadosSoc =
            document.getElementById('btnBuscarDadosSoc');

        if (btnBuscarDadosSoc) {

            btnBuscarDadosSoc.innerHTML =
                '<i class="fas fa-sync me-1"></i> Buscar e Preparar eSocial';

            btnBuscarDadosSoc.title =
                'Buscar dados do SOC no período e preparar a situação eSocial';

            // Usamos onclick para não cadastrar o evento
            // várias vezes caso initESocial() seja executada novamente.
            btnBuscarDadosSoc.onclick = function (event) {

                event.preventDefault();

                console.log(
                    '✅ Botão Buscar Dados do SOC clicado'
                );

                const modalElement =
                    document.getElementById(
                        'buscarDadosSocModal'
                    );

                if (!modalElement) {
                    console.error(
                        '❌ Modal buscarDadosSocModal não encontrado.'
                    );

                    mostrarAlertaESocial(
                        'Modal de busca do SOC não encontrado.',
                        'danger'
                    );

                    return;
                }

                // Limpar mensagem da busca anterior
                const status =
                    document.getElementById(
                        'buscarSocStatus'
                    );

                if (status) {
                    status.innerHTML = '';
                }

                // Abrir modal
                if (
                    typeof bootstrap === 'undefined' ||
                    !bootstrap.Modal
                ) {
                    console.error(
                        '❌ Bootstrap Modal não está disponível.'
                    );

                    return;
                }

                const modal =
                    bootstrap.Modal.getOrCreateInstance(
                        modalElement
                    );

                modal.show();

                console.log(
                    '✅ Modal Buscar Dados do SOC aberto'
                );
            };

            console.log(
                '✅ Botão btnBuscarDadosSoc configurado'
            );

        } else {

            console.error(
                '❌ Botão btnBuscarDadosSoc não encontrado no HTML'
            );
        }


        // ========================================================
        // 2. BOTÃO "BUSCAR" DENTRO DO MODAL
        // ========================================================

        const btnConfirmarBusca =
            document.getElementById(
                'btnConfirmarBuscaSoc'
            );

        if (btnConfirmarBusca) {

            btnConfirmarBusca.onclick =
                async function (event) {

                    event.preventDefault();

                    console.log(
                        '🔎 Iniciando consulta ao SOC...'
                    );

                    try {

                        await buscarDadosSoc();

                    } catch (error) {

                        console.error(
                            '❌ Erro na busca SOC:',
                            error
                        );

                        const status =
                            document.getElementById(
                                'buscarSocStatus'
                            );

                        if (status) {
                            status.innerHTML = `
                                <div class="alert alert-danger">
                                    <i class="fas fa-exclamation-triangle me-1"></i>
                                    Erro ao buscar dados:
                                    ${error.message}
                                </div>
                            `;
                        }
                    }
                };

            console.log(
                '✅ Botão btnConfirmarBuscaSoc configurado'
            );

        } else {

            console.error(
                '❌ Botão btnConfirmarBuscaSoc não encontrado'
            );
        }


        const btnVerificarSemAso =
            document.getElementById(
                'btnVerificarSemAso'
            );

        if (btnVerificarSemAso) {

            btnVerificarSemAso.onclick =
                async function (event) {

                    event.preventDefault();

                    try {

                        await verificarColaboradoresSemAso();

                    } catch (error) {

                        console.error(
                            '❌ Erro ao verificar colaboradores sem ASO:',
                            error
                        );
                    }
                };
        }


        // ========================================================
        // 3. SELECT HOLDING
        // ========================================================

        const selectHolding =
            document.getElementById(
                'socHolding'
            );

        if (selectHolding) {

            selectHolding.onchange =
                function () {

                    console.log(
                        '📌 Holding selecionada:',
                        this.value || 'Todas'
                    );

                    // Se a função existir, atualizar
                    // empresas conforme a holding.
                    if (
                        typeof preencherEmpresas ===
                        'function'
                    ) {

                        preencherEmpresas();
                    }
                };
        }


        // ========================================================
        // 4. BOTÃO ENVIAR SELECIONADOS
        // ========================================================

        const btnEnviarSelecionados =
            document.getElementById(
                'btnEnviarSelecionados'
            );

        if (btnEnviarSelecionados) {

            btnEnviarSelecionados.onclick =
                async function (event) {

                    event.preventDefault();

                    await enviarEventosSelecionados();
                };
        }


        // ========================================================
        // 5. BOTÃO ENVIAR TODOS PENDENTES
        // ========================================================

        const btnEnviarTodos =
            document.getElementById(
                'btnEnviarTodos'
            );

        if (btnEnviarTodos) {

            btnEnviarTodos.disabled = false;
            btnEnviarTodos.style.display = '';

            btnEnviarTodos.onclick =
                async function (event) {

                    event.preventDefault();

                    await enviarTodosEventos();
                };
        }


        // ========================================================
        // 5b. CONECTOR LOCAL eSOCIAL
        // ========================================================

        instalarConectorLocalEsocial();


        // ========================================================
        // 6. BOTÃO ATUALIZAR STATUS
        // ========================================================

        const btnAtualizarStatus =
            document.getElementById(
                'btnAtualizarStatus'
            );

        if (btnAtualizarStatus) {

            btnAtualizarStatus.onclick =
                async function (event) {

                    event.preventDefault();

                    console.log(
                        '🔄 Atualizando dados e-Social...'
                    );

                    try {

                        // Verifica SOC se essa função existir
                        if (
                            typeof verificarStatusSoc ===
                            'function'
                        ) {

                            await verificarStatusSoc();
                        }

                        // Recarrega eventos
                        await carregarEventosESocial();

                        mostrarAlertaESocial(
                            'Status atualizado com sucesso!',
                            'success'
                        );

                    } catch (error) {

                        console.error(
                            '❌ Erro ao atualizar:',
                            error
                        );

                        mostrarAlertaESocial(
                            'Erro ao atualizar: ' +
                            error.message,
                            'danger'
                        );
                    }
                };
        }


        // ========================================================
        // 7. FILTROS DE EVENTOS
        // ========================================================

        const btnAplicarFiltros =
            document.getElementById(
                'btnAplicarFiltrosEventos'
            );

        if (btnAplicarFiltros) {

            btnAplicarFiltros.onclick =
                function (event) {

                    event.preventDefault();

                    recarregarEventosESocial();
                };
        }


        const btnLimparFiltros =
            document.getElementById(
                'btnLimparFiltrosEventos'
            );

        if (btnLimparFiltros) {
            btnLimparFiltros.onclick = function (event) {
                event.preventDefault();
                limparFiltrosESocial();
            };
        }


        // ========================================================
        // 8. BOTÃO VOLTAR
        // ========================================================

        const btnVoltar =
            document.getElementById(
                'btnVoltarMenuESocial'
            );

        if (btnVoltar) {

            btnVoltar.onclick =
                async function (event) {

                    event.preventDefault();

                    try {

                        const {
                            data
                        } =
                            await supabaseClient
                                .auth
                                .getUser();

                        if (
                            data &&
                            data.user
                        ) {

                            if (
                                typeof mostrarMenu ===
                                'function'
                            ) {

                                mostrarMenu(
                                    data.user
                                );
                            }

                        } else {

                            if (
                                typeof mostrarPaginaLogin ===
                                'function'
                            ) {

                                mostrarPaginaLogin();
                            }
                        }

                    } catch (error) {

                        console.error(
                            '❌ Erro ao voltar:',
                            error
                        );
                    }
                };
        }


        // ========================================================
        // 9. LOGOUT
        // ========================================================

        const logoutBtn =
            document.getElementById(
                'logoutBtnESocial'
            );

        if (logoutBtn) {

            logoutBtn.onclick =
                async function (event) {

                    event.preventDefault();

                    try {

                        await supabaseClient
                            .auth
                            .signOut();

                        if (
                            typeof mostrarPaginaLogin ===
                            'function'
                        ) {

                            mostrarPaginaLogin();
                        }

                    } catch (error) {

                        console.error(
                            '❌ Erro no logout:',
                            error
                        );
                    }
                };
        }


        // ========================================================
        // 10. COPIAR XML
        // ========================================================

        const btnCopiarXml =
            document.getElementById(
                'btnCopiarXML'
            );

        if (btnCopiarXml) {

            btnCopiarXml.onclick =
                function (event) {

                    event.preventDefault();

                    copiarXmlESocial();
                };
        }


        // ========================================================
        // 11. CARREGAR EMPRESAS / HOLDINGS
        // ========================================================

        try {

            console.log(
                '🏢 Carregando empresas e holdings...'
            );

            await carregarEmpresasParaESocial();

            console.log(
                '✅ Empresas e holdings carregadas'
            );

        } catch (error) {

            console.error(
                '❌ Erro ao carregar empresas:',
                error
            );
        }


        // ========================================================
        // 12. CARREGAR EVENTOS SALVOS
        // ========================================================

        try {

            console.log(
                '📋 Carregando eventos e-Social...'
            );

            await carregarEventosESocial();

            console.log(
                '✅ Eventos carregados'
            );

        } catch (error) {

            console.error(
                '❌ Erro ao carregar eventos:',
                error
            );
        }


        // ========================================================
        // 13. VERIFICAR CONEXÃO SOC
        // ========================================================

        if (
            typeof verificarStatusSoc ===
            'function'
        ) {

            try {

                await verificarStatusSoc();

            } catch (error) {

                console.warn(
                    '⚠️ Não foi possível consultar status SOC:',
                    error.message
                );
            }
        }


        // ========================================================
        // FINAL
        // ========================================================

        console.log(
            '✅ Módulo e-Social inicializado'
        );

    } catch (error) {

        console.error(
            '❌ ERRO AO INICIALIZAR E-SOCIAL:',
            error
        );

        if (
            typeof mostrarAlertaESocial ===
            'function'
        ) {

            mostrarAlertaESocial(
                'Erro ao inicializar módulo e-Social: ' +
                error.message,
                'danger'
            );
        }
    }
}

// ============================================================
// PESQUISA + FILTROS LOCAIS (HOLDING / UNIDADE)
// ============================================================

function normalizarBuscaEventoESocial(valor) {
    return String(valor || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function normalizarCpfBuscaESocial(valor) {
    return String(valor || '').replace(/\D/g, '');
}

function atualizarOpcoesFiltrosOrganizacionaisESocial() {
    const selectHolding = document.getElementById('filtroHoldingEvento');
    const selectUnidade = document.getElementById('filtroUnidadeEvento');
    if (!selectHolding || !selectUnidade) return;

    const holdingAtual = selectHolding.value;
    const unidadeAtual = selectUnidade.value;
    const fonte = eventosESocialHistorico.length
        ? eventosESocialHistorico
        : eventosESocialBase;

    const holdings = [...new Set(
        fonte.map(item => String(item.holding || '').trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    selectHolding.innerHTML = '<option value="">Todas as Holdings</option>';
    holdings.forEach(holding => {
        const option = document.createElement('option');
        option.value = holding;
        option.textContent = holding;
        selectHolding.appendChild(option);
    });

    if (holdings.includes(holdingAtual)) selectHolding.value = holdingAtual;

    const holdingSelecionada = selectHolding.value;
    const unidades = [...new Set(
        fonte
            .filter(item => !holdingSelecionada || String(item.holding || '') === holdingSelecionada)
            .map(item => String(item.unidade || item.nome_unidade || '').trim())
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    selectUnidade.innerHTML = '<option value="">Todas as Unidades</option>';
    unidades.forEach(unidade => {
        const option = document.createElement('option');
        option.value = unidade;
        option.textContent = unidade;
        selectUnidade.appendChild(option);
    });

    if (unidades.includes(unidadeAtual)) selectUnidade.value = unidadeAtual;
}

function aplicarFiltrosLocaisESocial() {
    const termoOriginal = String(
        document.getElementById('filtroBuscaEvento')?.value || ''
    ).trim();
    const termo = normalizarBuscaEventoESocial(termoOriginal);
    const termoCpf = normalizarCpfBuscaESocial(termoOriginal);
    const holding = String(
        document.getElementById('filtroHoldingEvento')?.value || ''
    );
    const unidade = String(
        document.getElementById('filtroUnidadeEvento')?.value || ''
    );

    eventosESocial = eventosESocialBase.filter(evento => {
        if (!evento) return false;

        if (holding && String(evento.holding || '') !== holding) return false;
        if (unidade && String(evento.unidade || evento.nome_unidade || '') !== unidade) return false;

        if (!termoOriginal) return true;

        const resumo = obterResumoColaboradorESocial(evento);
        const camposTexto = [
            evento.id,
            evento.colaborador,
            evento.nome_colaborador,
            evento.nomeFuncionario,
            evento.funcionario,
            evento.unidade,
            evento.nome_unidade,
            evento.holding,
            evento.tipo_evento,
            evento.tipo_exame,
            evento.status,
            evento.status_evento_soc,
            evento.status_exibicao,
            evento.numero_recibo,
            evento.numero_recibo_existente,
            evento.id_evento_esocial,
            evento.matricula,
            evento.matricula_soc,
            evento.matricula_origem,
            evento.data_admissao_esocial,
            resumo.matriculaOficial,
            resumo.s2220.texto,
            resumo.s2240.texto,
            resumo.proximaAcao.texto
        ];

        const encontrouTexto = camposTexto.some(valor => {
            const texto = normalizarBuscaEventoESocial(valor);
            return texto && texto.includes(termo);
        });

        if (encontrouTexto) return true;

        if (termoCpf) {
            const cpfEvento = normalizarCpfBuscaESocial(evento.cpf);
            if (cpfEvento && cpfEvento.includes(termoCpf)) return true;
        }

        return false;
    });

    paginaAtualESocial = 1;
    eventosSelecionados.clear();
    renderizarTabelaEventosESocial();
    atualizarEstatisticasESocial();
}

function aplicarBuscaLocalESocial() {
    aplicarFiltrosLocaisESocial();
}

function instalarBuscaEventosESocial() {
    const input = document.getElementById('filtroBuscaEvento');
    const btnLimparBusca = document.getElementById('btnLimparBuscaEvento');
    const filtroHolding = document.getElementById('filtroHoldingEvento');
    const filtroUnidade = document.getElementById('filtroUnidadeEvento');

    if (input && input.dataset.buscaEsocialInstalada !== '1') {
        input.dataset.buscaEsocialInstalada = '1';
        input.addEventListener('input', aplicarFiltrosLocaisESocial);
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                input.value = '';
                aplicarFiltrosLocaisESocial();
            }
        });
    }

    if (btnLimparBusca && btnLimparBusca.dataset.buscaEsocialInstalada !== '1') {
        btnLimparBusca.dataset.buscaEsocialInstalada = '1';
        btnLimparBusca.addEventListener('click', event => {
            event.preventDefault();
            if (input) {
                input.value = '';
                input.focus();
            }
            aplicarFiltrosLocaisESocial();
        });
    }

    if (filtroHolding && filtroHolding.dataset.filtroEsocialInstalado !== '1') {
        filtroHolding.dataset.filtroEsocialInstalado = '1';
        filtroHolding.addEventListener('change', () => {
            if (filtroUnidade) filtroUnidade.value = '';
            atualizarOpcoesFiltrosOrganizacionaisESocial();
            aplicarFiltrosLocaisESocial();
        });
    }

    if (filtroUnidade && filtroUnidade.dataset.filtroEsocialInstalado !== '1') {
        filtroUnidade.dataset.filtroEsocialInstalado = '1';
        filtroUnidade.addEventListener('change', aplicarFiltrosLocaisESocial);
    }
}

async function verificarEventoNoESocial(
    id,
    botao = null
) {

    const evento =
        encontrarEvento(
            id
        );


    if (
        !evento
    ) {

        mostrarAlertaESocial(
            'Evento não encontrado na tela.',
            'warning'
        );

        return;
    }


    if (
        evento.emitido_esocial === true ||
        evento.ja_emitido === true
    ) {

        mostrarAlertaESocial(
            'Este evento já está confirmado como emitido no eSocial.',
            'info'
        );

        return;
    }


    let htmlBotaoOriginal =
        '';


    if (
        botao
    ) {

        htmlBotaoOriginal =
            botao.innerHTML;

        botao.disabled =
            true;

        botao.innerHTML =
            '<i class="fas fa-spinner fa-spin"></i>';
    }


    try {

        const token =
            await obterTokenESocial();


        mostrarAlertaESocial(
            `Atualizando a preparação de ${evento.colaborador || 'o colaborador'}...`,
            'info'
        );


        // ====================================================
        // IMPORTANTE:
        // Primeiro olha só cache/histórico local (sem custo).
        // Se a matrícula ainda não estiver disponível, o passo
        // 'aguardando_matricula' abaixo faz UMA tentativa real
        // de consulta BX na hora, pra atender o clique explícito
        // do usuário (respeitando cota diária/calendário).
        // ====================================================

        const response =
            await fetch(
                apiUrl(
                    `/api/soc/preparar-evento-esocial/` +
                    `${encodeURIComponent(id)}`
                ),
                {
                    method:
                        'POST',
                    headers:
                        criarHeaders(
                            token,
                            true
                        ),
                    body:
                        JSON.stringify({})
                }
            );


        const texto =
            await response.text();


        let resultado =
            {};


        try {

            resultado =
                texto
                    ? JSON.parse(
                        texto
                    )
                    : {};

        } catch (errorJson) {

            resultado = {
                success:
                    false,
                error:
                    texto ||
                    'Resposta inválida do servidor.'
            };
        }


        console.log(
            '🔎 Resultado preparação eSocial:',
            resultado
        );


        if (
            response.status ===
            429
        ) {

            mostrarAlertaESocial(
                'O limite diário de consultas ao eSocial foi atingido para esta empresa. ' +
                'O vínculo continuará na fila automática e não será enviado enquanto não estiver confirmado.',
                'warning'
            );

            return;
        }


        if (
            !response.ok ||
            resultado.success === false
        ) {

            throw new Error(
                resultado.error ||
                `Erro HTTP ${response.status}`
            );
        }


        const situacao =
            String(
                resultado.situacaoPreparacao ||
                ''
            );


        const matricula =
            resultado.matricula
                ?.valor ||
            resultado.evento
                ?.matricula ||
            '';


        if (
            situacao ===
            'ja_emitido'
        ) {

            mostrarAlertaESocial(
                'Evento já localizado no histórico/eSocial. O registro permanece bloqueado para reenvio.',
                'success'
            );

        } else if (
            situacao ===
            'pronto_envio'
        ) {

            mostrarAlertaESocial(
                'Preparação concluída. ' +
                (matricula
                    ? `Matrícula oficial: ${matricula}. `
                    : '') +
                'O evento está pronto para ser selecionado e enviado manualmente.',
                'success'
            );

        } else if (
            situacao ===
            'aguardando_matricula'
        ) {

            mostrarAlertaESocial(
                `Buscando a matrícula oficial de ${evento.colaborador || 'colaborador'} agora...`,
                'info'
            );

            try {

                const respostaBusca =
                    await fetch(
                        apiUrl(
                            `/api/soc/matriculas-esocial/buscar-agora/` +
                            `${encodeURIComponent(id)}`
                        ),
                        {
                            method:
                                'POST',
                            headers:
                                criarHeaders(
                                    token,
                                    true
                                ),
                            body:
                                JSON.stringify({})
                        }
                    );

                const textoBusca =
                    await respostaBusca.text();

                let resultadoBusca =
                    {};

                try {

                    resultadoBusca =
                        textoBusca
                            ? JSON.parse(
                                textoBusca
                            )
                            : {};

                } catch (errorJsonBusca) {

                    resultadoBusca = {
                        success:
                            false,
                        error:
                            textoBusca ||
                            'Resposta inválida do servidor.'
                    };
                }


                if (
                    respostaBusca.status ===
                    429
                ) {

                    mostrarAlertaESocial(
                        resultadoBusca.error ||
                        'Não foi possível consultar agora (limite diário atingido ou bloqueio de calendário). ' +
                        'O vínculo continua na fila automática.',
                        'warning'
                    );

                } else if (
                    resultadoBusca.resolvida
                ) {

                    mostrarAlertaESocial(
                        'Matrícula oficial encontrada agora' +
                        (resultadoBusca.matricula
                            ? `: ${resultadoBusca.matricula}.`
                            : '.'),
                        'success'
                    );

                } else if (
                    resultadoBusca.success ===
                    false
                ) {

                    mostrarAlertaESocial(
                        resultadoBusca.error ||
                        'Não foi possível buscar agora.',
                        'warning'
                    );

                } else {

                    mostrarAlertaESocial(
                        'Ainda não foi encontrada matrícula para este colaborador nesta tentativa. ' +
                        'O vínculo continua na fila automática e vai tentar novamente mais tarde.',
                        'warning'
                    );
                }

            } catch (errorBusca) {

                mostrarAlertaESocial(
                    'O vínculo está na fila automática, mas não foi possível buscar agora: ' +
                    errorBusca.message,
                    'warning'
                );
            }

            iniciarAcompanhamentoPreparacaoEsocial([
                String(id)
            ]);

        } else if (
            situacao ===
            's2240_aguardando_dados'
        ) {

            mostrarAlertaESocial(
                'O vínculo foi preparado, mas o S-2240 ainda aguarda dados obrigatórios/completude antes do envio.',
                'warning'
            );

        } else {

            mostrarAlertaESocial(
                'Dados locais atualizados. O evento ainda aguarda confirmação histórica do eSocial. ' +
                'O processamento continuará em segundo plano.',
                'info'
            );

            iniciarAcompanhamentoPreparacaoEsocial([
                String(id)
            ]);
        }


        await recarregarEventosESocial();


    } catch (error) {

        console.error(
            '❌ Erro preparando evento eSocial:',
            error
        );


        mostrarAlertaESocial(
            'Não foi possível atualizar a preparação deste evento: ' +
            error.message,
            'warning'
        );

    } finally {

        if (
            botao
        ) {

            botao.disabled =
                false;

            botao.innerHTML =
                htmlBotaoOriginal;
        }
    }
}


// ============================================================
// ETAPA 1 - VERIFICAR SE O CPF ESTÁ VINCULADO AO EMPREGADOR
// ============================================================

async function aguardarResultadoConectorLocalESocial(
    id,
    {
        timeoutMs = 120000,
        intervaloMs = 2000
    } = {}
) {
    const inicio =
        Date.now();

    while (
        Date.now() - inicio <
        timeoutMs
    ) {
        const token =
            await obterTokenESocial();

        const response =
            await fetch(
                apiUrl(
                    `/api/soc/conector-local/status-evento/${encodeURIComponent(id)}`
                ),
                {
                    headers:
                        criarHeaders(
                            token
                        )
                }
            );

        const resultado =
            await lerRespostaJson(
                response
            );

        if (
            resultado.concluida ===
                true
        ) {
            return resultado;
        }

        if (
            resultado.status ===
                'erro_conector_local'
        ) {
            throw new Error(
                resultado.erro ||
                'O Conector eSocial encontrou um erro ao processar esta consulta.'
            );
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    intervaloMs
                )
        );
    }

    return {
        success:
            true,
        concluida:
            false,
        status:
            'aguardando_conector_local'
    };
}


// ============================================================
// ETAPA 1 - CONSULTAR VÍNCULO + MATRÍCULA PELO CONECTOR LOCAL
// ============================================================

async function verificarVinculoESocial(
    id,
    botao = null
) {
    const evento =
        encontrarEvento(
            id
        );

    if (!evento) {
        mostrarAlertaESocial(
            'Evento não encontrado na tela.',
            'warning'
        );

        return;
    }

    const htmlOriginal =
        botao?.innerHTML ||
        '';

    if (botao) {
        botao.disabled =
            true;

        botao.innerHTML =
            '<i class="fas fa-spinner fa-spin"></i>';
    }

    try {
        const statusConector =
            await requisicaoJson(
                '/api/soc/conector-local/status'
            );

        if (
            statusConector.online !==
                true
        ) {
            throw new Error(
                'O Conector eSocial não está online neste computador. Abra o INICIAR-CONECTOR.bat e deixe a janela aberta.'
            );
        }

        const token =
            await obterTokenESocial();

        const response =
            await fetch(
                apiUrl(
                    `/api/soc/conector-local/enfileirar-evento/${encodeURIComponent(id)}`
                ),
                {
                    method:
                        'POST',
                    headers:
                        criarHeaders(
                            token,
                            true
                        ),
                    body:
                        JSON.stringify({})
                }
            );

        const resultado =
            await lerRespostaJson(
                response
            );

        if (
            resultado.imediato ===
                true &&
            resultado.matricula
        ) {
            mostrarAlertaESocial(
                `Matrícula oficial já disponível: ${resultado.matricula}.`,
                'success'
            );

            await recarregarEventosESocial();
            return;
        }

        mostrarAlertaESocial(
            'Consulta enviada ao Conector eSocial. O Chrome local fará a verificação automaticamente.',
            'info'
        );

        const final =
            await aguardarResultadoConectorLocalESocial(
                id
            );

        if (
            final.concluida !==
                true
        ) {
            mostrarAlertaESocial(
                'A consulta continua na fila do Conector eSocial. Você pode continuar usando o sistema; o resultado será salvo automaticamente.',
                'info'
            );

            return;
        }

        if (
            final.encontrado ===
                true
        ) {
            mostrarAlertaESocial(
                `Colaborador localizado no eSocial. Matrícula oficial: ${final.matricula || 'localizada'}.`,
                'success'
            );

        } else {
            mostrarAlertaESocial(
                'Não foi localizado empregado com este CPF no módulo SST para o CNPJ consultado.',
                'warning'
            );
        }

        await recarregarEventosESocial();

    } catch (
        error
    ) {
        console.error(
            '❌ Erro no Conector eSocial:',
            error
        );

        mostrarAlertaESocial(
            'Não foi possível consultar pelo Conector eSocial: ' +
            error.message,
            'warning'
        );

    } finally {
        if (botao) {
            botao.disabled =
                false;

            botao.innerHTML =
                htmlOriginal;
        }
    }
}


function handleVerificarVinculoESocial() {
    const id =
        String(
            this.dataset.id ||
            ''
        ).trim();

    if (!id) {
        return;
    }

    verificarVinculoESocial(
        id,
        this
    );
}


// ============================================================
// ETAPA 2 - IMPORTAR MATRÍCULA OFICIAL DO VÍNCULO JÁ CONFIRMADO
// ============================================================

async function buscarMatriculaESocial(
    id,
    botao = null
) {
    const evento = encontrarEvento(id);

    if (!evento) {
        mostrarAlertaESocial('Evento não encontrado na tela.', 'warning');
        return;
    }

    const resumo = obterResumoColaboradorESocial(evento);

    if (resumo.vinculoStatus !== 'vinculado') {
        mostrarAlertaESocial(
            'Primeiro confirme que o CPF está vinculado a este empregador.',
            'warning'
        );
        return;
    }

    const htmlOriginal = botao?.innerHTML || '';

    if (botao) {
        botao.disabled = true;
        botao.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }

    try {
        const token = await obterTokenESocial();
        const response = await fetch(
            apiUrl(`/api/soc/matriculas-esocial/buscar-agora/${encodeURIComponent(id)}`),
            {
                method: 'POST',
                headers: criarHeaders(token, true),
                body: JSON.stringify({})
            }
        );

        const texto = await response.text();
        let resultado = {};

        try {
            resultado = texto ? JSON.parse(texto) : {};
        } catch (_) {
            resultado = {
                success: false,
                error: texto || 'Resposta inválida do servidor.'
            };
        }

        if (!response.ok || resultado.success === false) {
            throw new Error(resultado.error || `Erro HTTP ${response.status}`);
        }

        if (resultado.resolvida === true && resultado.matricula) {
            mostrarAlertaESocial(
                `Matrícula oficial importada: ${resultado.matricula}. Agora verifique os eventos existentes.`,
                'success'
            );
        } else {
            mostrarAlertaESocial(
                'O vínculo está confirmado, mas a matrícula ainda não pôde ser importada com segurança.',
                'warning'
            );
        }

        await recarregarEventosESocial();

    } catch (error) {
        console.error('❌ Erro ao buscar matrícula eSocial:', error);
        mostrarAlertaESocial(
            'Não foi possível buscar a matrícula oficial: ' + error.message,
            'warning'
        );
    } finally {
        if (botao) {
            botao.disabled = false;
            botao.innerHTML = htmlOriginal;
        }
    }
}

function handleBuscarMatriculaESocial() {
    const id = String(this.dataset.id || '').trim();
    if (id) buscarMatriculaESocial(id, this);
}


// ============================================================
// VERIFICAÇÃO REAL (AO VIVO, CONSOME COTA BX)
//
// Diferente de verificarEventoNoESocial (que só olha cache
// local, sem custo), isso pergunta de verdade pro governo se o
// S-2220/S-2240 já existe, via /sincronizar-esocial-existente.
// Confere os dois eventos da pessoa (S-2220 e S-2240) quando
// existirem, num clique só.
// ============================================================

async function verificarStatusRealESocial(
    id,
    botao = null
) {

    const evento =
        encontrarEvento(
            id
        );

    if (
        !evento
    ) {

        mostrarAlertaESocial(
            'Evento não encontrado na tela.',
            'warning'
        );

        return;
    }

    const fonteRelacionados =
        eventosESocialHistorico.length
            ? eventosESocialHistorico
            : eventosESocialBase;

    const irmao =
        fonteRelacionados.find(
            e =>
                normalizarChaveVinculoESocial(e) ===
                    normalizarChaveVinculoESocial(evento) &&
                String(e.id) !== String(evento.id) &&
                ['S-2220', 'S-2240'].includes(
                    String(e.tipo_evento || '').trim().toUpperCase()
                )
        );

    const idsParaChecar =
        irmao
            ? [evento.id, irmao.id]
            : [evento.id];

    let htmlBotaoOriginal = '';

    if (botao) {
        htmlBotaoOriginal = botao.innerHTML;
        botao.disabled = true;
        botao.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }

    try {

        const token =
            await obterTokenESocial();

        mostrarAlertaESocial(
            `Consultando o eSocial de verdade para ${evento.colaborador || 'o colaborador'}...`,
            'info'
        );

        const resultados = [];

        for (const eid of idsParaChecar) {

            const response =
                await fetch(
                    apiUrl(
                        `/api/soc/sincronizar-esocial-existente/${encodeURIComponent(eid)}`
                    ),
                    {
                        method: 'POST',
                        headers: criarHeaders(token, true),
                        body: JSON.stringify({})
                    }
                );

            const texto = await response.text();
            let resultado = {};

            try {
                resultado = texto ? JSON.parse(texto) : {};
            } catch (erroJson) {
                resultado = {
                    success: false,
                    error: texto || 'Resposta inválida do servidor.'
                };
            }

            resultados.push({
                id: eid,
                status: response.status,
                resultado
            });
        }

        const linhas =
            resultados.map(r => {

                const ev =
                    encontrarEvento(r.id) ||
                    {};

                const tipo =
                    ev.tipo_evento ||
                    '?';

                if (r.status === 429) {
                    return `${tipo}: limite diário de consultas ao eSocial atingido para este empregador.`;
                }

                if (r.resultado?.soapFault) {
                    const msg = r.resultado.error || '';
                    if (/procura(ç|c)(ã|a)o/i.test(msg)) {
                        return `${tipo}: SEM PROCURAÇÃO ELETRÔNICA para consultar este empregador.`;
                    }
                    return `${tipo}: erro do eSocial (${msg}).`;
                }

                if (r.resultado?.success === false) {
                    return `${tipo}: ${r.resultado.error || 'não foi possível verificar agora.'}`;
                }

                if (r.resultado?.jaExisteNoEsocial) {
                    const recibo =
                        r.resultado.eventoCorrespondente?.numeroRecibo ||
                        '-';
                    return `${tipo}: JÁ ENVIADO — recibo ${recibo}.`;
                }

                if (r.resultado?.podeEnviar) {
                    return `${tipo}: não encontrado no eSocial — pronto para enviar.`;
                }

                return `${tipo}: ${r.resultado?.motivoBloqueio || 'situação ainda não confirmada com segurança.'}`;
            });

        mostrarAlertaESocial(
            linhas.join(' | '),
            'success'
        );

        await carregarEventosESocial();

    } catch (error) {

        console.error(
            '❌ Erro na verificação real (ao vivo) do eSocial:',
            error
        );

        mostrarAlertaESocial(
            'Não foi possível verificar de verdade no eSocial: ' +
            error.message,
            'warning'
        );

    } finally {

        if (botao) {
            botao.disabled = false;
            botao.innerHTML = htmlBotaoOriginal;
        }
    }
}


function handleVerificarStatusRealESocial() {

    const id =
        String(
            this.dataset.id ||
            ''
        ).trim();

    if (!id) {
        return;
    }

    verificarStatusRealESocial(
        id,
        this
    );
}


// ============================================================
// CLIQUE NO BOTÃO VERIFICAR
// ============================================================

function handleVerificarEventoESocial() {

    const id =
        String(
            this.dataset.id ||
            ''
        ).trim();


    if (
        !id
    ) {

        return;
    }


    verificarEventoNoESocial(
        id,
        this
    );
}


function adicionarControlesVerificacaoESocial() {

    const tbody =
        document.getElementById(
            'eventosBody'
        );


    if (
        !tbody
    ) {

        return;
    }


    const linhas =
        tbody.querySelectorAll(
            'tr'
        );


    linhas.forEach(
        linha => {

            const btnAso =
                linha.querySelector(
                    '.btn-ver-aso[data-id]'
                );


            if (
                !btnAso
            ) {

                return;
            }


            const id =
                String(
                    btnAso.dataset.id ||
                    ''
                );


            const evento =
                encontrarEvento(
                    id
                );


            if (
                !evento
            ) {

                return;
            }


            // ====================================================
            // CHECKBOX
            // ====================================================

            const checkbox =
                linha.querySelector(
                    '.selecionar-evento'
                );


            const podeSelecionar =
                evento.persistido !== false &&
                evento.pode_emitir === true &&
                evento.confirmado_nao_emitido === true &&
                evento.emitido_esocial !== true &&
                evento.ja_emitido !== true &&
                evento.aguardando_verificacao !== true &&
                evento.status !==
                    'aguardando_verificacao' &&
                String(
                    evento.tipo_evento ||
                    ''
                )
                    .trim()
                    .toUpperCase() ===
                    'S-2220';


            if (
                checkbox
            ) {

                checkbox.disabled =
                    !podeSelecionar;


                if (
                    !podeSelecionar
                ) {

                    checkbox.checked =
                        false;


                    eventosSelecionados.delete(
                        id
                    );
                }
            }


            // ====================================================
            // BOTÃO DE ENVIO
            //
            // SE O BACKEND NÃO LIBEROU, REMOVE.
            // ====================================================

            const btnEnviar =
                linha.querySelector(
                    '.btn-enviar-evento'
                );


            if (
                evento.pode_emitir !==
                true
            ) {

                if (
                    btnEnviar
                ) {

                    btnEnviar.remove();
                }

            }


            // ====================================================
            // VERIFICAÇÃO EM ETAPAS
            //
            // Os botões Vínculo -> Matrícula -> Eventos são criados
            // exclusivamente em renderizarTabelaEventosESocial().
            // Não recriar aqui o antigo botão combinado, pois ele
            // furaria a ordem operacional definida para o eSocial.
            // ====================================================
        }
    );


    atualizarBloqueioSelecaoEventosESocial();
}

// ============================================================
// INSTALAR BUSCA QUANDO O HTML ESTIVER DISPONÍVEL
// ============================================================

function instalarExtrasEventosESocial() {

    instalarBuscaEventosESocial();


    /*
     * Se a tabela já tiver sido renderizada,
     * instala também os botões.
     */

    adicionarControlesVerificacaoESocial();
}




// ============================================================
// ROBÔ - RELATÓRIOS GERENCIAIS DE TODOS OS CNPJs
// ============================================================

let timerStatusRoboRelatoriosEsocial =
    null;



let timerStatusConectorLocalEsocial =
    null;

let timerProgressoConsultaPcEsocial =
    null;

let ultimaAssinaturaStatusConectorLocalEsocial =
    '';

let consultaPcEsocialAtual =
    null;

let statusConectorLocalEsocialAtual =
    null;


// ============================================================
// CONECTOR LOCAL V5 - UI
// ============================================================

function garantirBadgeConectorLocalEsocial() {
    let badge =
        document.getElementById(
            'badgeConectorLocalEsocial'
        );

    if (
        badge
    ) {
        return badge;
    }

    const botao =
        document.getElementById(
            'btnResolverMatriculasHolding'
        );

    if (
        !botao?.parentElement
    ) {
        return null;
    }

    badge =
        document.createElement(
            'span'
        );

    badge.id =
        'badgeConectorLocalEsocial';

    badge.className =
        'badge bg-secondary ms-2 align-self-center';

    badge.textContent =
        'Conector: verificando...';

    botao.insertAdjacentElement(
        'afterend',
        badge
    );

    return badge;
}


function formatarCnpjConectorLocalEsocial(
    valor
) {
    const cnpj =
        String(
            valor ||
            ''
        ).replace(
            /\D/g,
            ''
        );

    if (
        cnpj.length !==
            14
    ) {
        return String(
            valor ||
            ''
        );
    }

    return cnpj.replace(
        /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
        '$1.$2.$3/$4-$5'
    );
}


function garantirPainelCnpjsSemAutorizacaoEsocial() {
    let painel =
        document.getElementById(
            'painelCnpjsSemAutorizacaoEsocial'
        );

    if (
        painel
    ) {
        return painel;
    }

    const botao =
        document.getElementById(
            'btnResolverMatriculasHolding'
        );

    const cabecalho =
        botao?.parentElement
            ?.parentElement;

    if (
        !cabecalho
    ) {
        return null;
    }

    painel =
        document.createElement(
            'div'
        );

    painel.id =
        'painelCnpjsSemAutorizacaoEsocial';

    painel.className =
        'alert alert-warning mt-2 mb-3 d-none';

    cabecalho.insertAdjacentElement(
        'afterend',
        painel
    );

    return painel;
}


function renderizarCnpjsSemAutorizacaoEsocial(
    itens
) {
    const painel =
        garantirPainelCnpjsSemAutorizacaoEsocial();

    if (
        !painel
    ) {
        return;
    }

    const lista =
        Array.isArray(
            itens
        )
            ? itens
            : [];

    if (
        !lista.length
    ) {
        painel.classList.add(
            'd-none'
        );

        painel.innerHTML =
            '';

        return;
    }

    painel.classList.remove(
        'd-none'
    );

    const linhas =
        lista
            .map(
                item => {
                    const cnpj =
                        formatarCnpjConectorLocalEsocial(
                            item?.cnpj ||
                            item?.nrInsc ||
                            ''
                        );

                    return `
                        <span
                            class="badge bg-warning text-dark me-2 mb-2"
                            style="font-size:.82rem;"
                        >
                            ${escaparHtml(cnpj)}
                        </span>
                    `;
                }
            )
            .join('');

    painel.innerHTML = `
        <div class="d-flex align-items-start gap-2">
            <i class="fas fa-triangle-exclamation mt-1"></i>

            <div>
                <strong>
                    CNPJs sem autorização de acesso no eSocial
                </strong>

                <div class="small mt-1 mb-2">
                    Estes CNPJs não serão consultados novamente
                    enquanto permanecerem sem autorização.
                </div>

                <div>
                    ${linhas}
                </div>
            </div>
        </div>
    `;
}


function garantirPainelProgressoConsultaPcEsocial() {
    let painel =
        document.getElementById(
            'painelProgressoConsultaPcEsocial'
        );

    if (
        painel
    ) {
        return painel;
    }

    const botao =
        document.getElementById(
            'btnResolverMatriculasHolding'
        );

    const cabecalho =
        botao?.parentElement
            ?.parentElement;

    if (
        !cabecalho
    ) {
        return null;
    }

    painel =
        document.createElement(
            'div'
        );

    painel.id =
        'painelProgressoConsultaPcEsocial';

    painel.className =
        'card shadow-sm mb-3 d-none';

    painel.innerHTML = `
        <div class="card-body py-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div>
                    <strong>
                        <i class="fas fa-desktop me-1"></i>
                        Consulta eSocial pelo PC
                    </strong>
                </div>

                <span
                    class="badge bg-primary"
                    id="statusProgressoConsultaPcEsocial"
                >
                    Preparando
                </span>
            </div>

            <div
                class="progress mb-2"
                style="height:20px;"
            >
                <div
                    id="barraProgressoConsultaPcEsocial"
                    class="progress-bar progress-bar-striped progress-bar-animated"
                    role="progressbar"
                    style="width:0%;"
                >
                    0%
                </div>
            </div>

            <div
                id="textoProgressoConsultaPcEsocial"
                class="small text-muted"
            >
                Preparando consulta...
            </div>

            <div
                id="detalheProgressoConsultaPcEsocial"
                class="small mt-1"
            ></div>
        </div>
    `;

    cabecalho.insertAdjacentElement(
        'afterend',
        painel
    );

    return painel;
}


function atualizarPainelProgressoConsultaPcEsocial({
    processados = 0,
    total = 0,
    status = 'Consultando',
    detalhe = '',
    aviso = '',
    concluida = false
} = {}) {
    const painel =
        garantirPainelProgressoConsultaPcEsocial();

    if (
        !painel
    ) {
        return;
    }

    painel.classList.remove(
        'd-none'
    );

    const percentual =
        total >
            0
            ? Math.min(
                100,
                Math.round(
                    processados /
                    total *
                    100
                )
              )
            : (
                concluida
                    ? 100
                    : 0
              );

    const barra =
        document.getElementById(
            'barraProgressoConsultaPcEsocial'
        );

    if (
        barra
    ) {
        barra.style.width =
            `${percentual}%`;

        barra.textContent =
            `${percentual}%`;

        barra.classList.toggle(
            'progress-bar-animated',
            !concluida
        );

        barra.classList.toggle(
            'bg-success',
            concluida
        );
    }

    const badge =
        document.getElementById(
            'statusProgressoConsultaPcEsocial'
        );

    if (
        badge
    ) {
        badge.textContent =
            status;

        badge.className =
            'badge ' +
            (
                concluida
                    ? 'bg-success'
                    : (
                        aviso
                            ? 'bg-warning text-dark'
                            : 'bg-primary'
                      )
            );
    }

    const texto =
        document.getElementById(
            'textoProgressoConsultaPcEsocial'
        );

    if (
        texto
    ) {
        texto.innerHTML = `
            <strong>
                ${processados} / ${total}
            </strong>
            colaborador(es) processado(s)
        `;
    }

    const detalhes =
        document.getElementById(
            'detalheProgressoConsultaPcEsocial'
        );

    if (
        detalhes
    ) {
        detalhes.innerHTML =
            aviso
                ? `
                    <span class="text-warning-emphasis">
                        <i class="fas fa-triangle-exclamation me-1"></i>
                        ${escaparHtml(aviso)}
                    </span>
                  `
                : escaparHtml(
                    detalhe ||
                    ''
                  );
    }
}


function garantirBotaoConectarCertificadoEsocial() {
    let botao =
        document.getElementById(
            'btnConectarCertificadoEsocial'
        );

    if (
        botao
    ) {
        return botao;
    }

    const consultar =
        document.getElementById(
            'btnResolverMatriculasHolding'
        );

    if (
        !consultar?.parentElement
    ) {
        return null;
    }

    botao =
        document.createElement(
            'button'
        );

    botao.type =
        'button';

    botao.id =
        'btnConectarCertificadoEsocial';

    botao.className =
        'btn btn-outline-primary btn-sm';

    botao.innerHTML =
        '<i class="fas fa-certificate me-1"></i> Conectar certificado';

    botao.title =
        'Abrir o Chrome para autenticar no eSocial com o certificado deste computador.';

    consultar.insertAdjacentElement(
        'beforebegin',
        botao
    );

    return botao;
}


function atualizarBotoesConectorLocalEsocial(
    status
) {
    const conectar =
        garantirBotaoConectarCertificadoEsocial();

    const consultar =
        document.getElementById(
            'btnResolverMatriculasHolding'
        );

    const online =
        status?.online ===
        true;

    const sessaoAtiva =
        status?.sessaoAtiva ===
            true ||
        status?.conector?.sessaoAtiva ===
            true;

    const consultaAtiva =
        Boolean(
            consultaPcEsocialAtual &&
            consultaPcEsocialAtual.concluida !==
                true
        );

    if (
        conectar
    ) {
        if (
            !online
        ) {
            conectar.disabled =
                true;

            conectar.className =
                'btn btn-outline-secondary btn-sm';

            conectar.innerHTML =
                '<i class="fas fa-plug me-1"></i> Conector offline';

        } else if (
            sessaoAtiva
        ) {
            conectar.disabled =
                true;

            conectar.className =
                'btn btn-outline-success btn-sm';

            conectar.innerHTML =
                '<i class="fas fa-check-circle me-1"></i> eSocial conectado';

        } else {
            conectar.disabled =
                false;

            conectar.className =
                'btn btn-primary btn-sm';

            conectar.innerHTML =
                '<i class="fas fa-certificate me-1"></i> Conectar certificado';
        }
    }

    if (
        consultar
    ) {
        consultar.disabled =
            !online ||
            !sessaoAtiva ||
            consultaAtiva;
    }
}


async function atualizarStatusConectorLocalEsocial() {
    const badge =
        garantirBadgeConectorLocalEsocial();

    if (
        !badge
    ) {
        return null;
    }

    try {
        const status =
            await requisicaoJson(
                '/api/soc/conector-local/status'
            );

        statusConectorLocalEsocialAtual =
            status;

        renderizarCnpjsSemAutorizacaoEsocial(
            status.cnpjsSemAutorizacao ||
            []
        );

        const sessaoAtiva =
            status.sessaoAtiva ===
                true ||
            status.conector?.sessaoAtiva ===
                true;

        if (
            status.online ===
                true &&
            sessaoAtiva
        ) {
            badge.className =
                'badge bg-success ms-2 align-self-center';

            badge.textContent =
                status.conector?.ocupado
                    ? 'Conector online • consultando eSocial'
                    : 'Conector online • eSocial conectado';

        } else if (
            status.online ===
                true
        ) {
            badge.className =
                'badge bg-warning text-dark ms-2 align-self-center';

            const estado =
                String(
                    status.estadoConector ||
                    status.conector?.estado ||
                    ''
                );

            badge.textContent =
                estado ===
                    'aguardando_login'
                    ? 'Conector online • aguardando login'
                    : (
                        estado ===
                            'sessao_expirada'
                            ? 'Conector online • sessão expirada'
                            : 'Conector online • certificado não conectado'
                      );

        } else {
            badge.className =
                'badge bg-secondary ms-2 align-self-center';

            badge.textContent =
                'Conector offline';
        }

        atualizarBotoesConectorLocalEsocial(
            status
        );

        const assinatura =
            [
                status.online
                    ? '1'
                    : '0',
                sessaoAtiva
                    ? '1'
                    : '0',
                status.estadoConector ||
                '',
                status.ultimaAtualizacaoFila ||
                '',
                Number(
                    status.eventosConciliados ||
                    0
                ),
                (
                    status.cnpjsSemAutorizacao ||
                    []
                )
                    .map(
                        item =>
                            item?.cnpj ||
                            item?.nrInsc ||
                            ''
                    )
                    .join(',')
            ].join(
                '|'
            );

        if (
            Number(
                status.eventosConciliados ||
                0
            ) >
                0 &&
            !consultaPcEsocialAtual
        ) {
            recarregarEventosESocial()
                .catch(
                    () => null
                );

        } else if (
            ultimaAssinaturaStatusConectorLocalEsocial &&
            assinatura !==
                ultimaAssinaturaStatusConectorLocalEsocial &&
            !consultaPcEsocialAtual
        ) {
            recarregarEventosESocial()
                .catch(
                    () => null
                );
        }

        ultimaAssinaturaStatusConectorLocalEsocial =
            assinatura;

        return status;

    } catch (
        error
    ) {
        statusConectorLocalEsocialAtual =
            null;

        badge.className =
            'badge bg-danger ms-2 align-self-center';

        badge.textContent =
            'Conector indisponível';

        atualizarBotoesConectorLocalEsocial({
            online:
                false,
            sessaoAtiva:
                false
        });

        return null;
    }
}


// ============================================================
// CONECTAR CERTIFICADO
// ============================================================

async function conectarCertificadoConectorLocalEsocial() {
    const botao =
        garantirBotaoConectarCertificadoEsocial();

    const status =
        await atualizarStatusConectorLocalEsocial();

    if (
        status?.online !==
            true
    ) {
        mostrarAlertaESocial(
            'O Conector eSocial não está online neste computador. Entre em contato com o suporte.',
            'warning'
        );

        return;
    }

    if (
        status?.sessaoAtiva ===
            true
    ) {
        mostrarAlertaESocial(
            'O eSocial já está conectado.',
            'info'
        );

        return;
    }

    const htmlOriginal =
        botao?.innerHTML ||
        '';

    if (
        botao
    ) {
        botao.disabled =
            true;

        botao.innerHTML =
            '<i class="fas fa-spinner fa-spin me-1"></i> Abrindo Chrome...';
    }

    try {
        const token =
            await obterTokenESocial();

        const response =
            await fetch(
                apiUrl(
                    '/api/soc/conector-local/solicitar-conexao'
                ),
                {
                    method:
                        'POST',
                    headers:
                        criarHeaders(
                            token,
                            true
                        ),
                    body:
                        JSON.stringify({})
                }
            );

        const resultado =
            await lerRespostaJson(
                response
            );

        if (
            resultado.jaConectado
        ) {
            await atualizarStatusConectorLocalEsocial();

            return;
        }

        mostrarAlertaESocial(
            'Chrome aberto. Entre no eSocial com o certificado. Depois do login ele será minimizado automaticamente.',
            'info'
        );

        if (
            botao
        ) {
            botao.innerHTML =
                '<i class="fas fa-spinner fa-spin me-1"></i> Aguardando login...';
        }

        const inicio =
            Date.now();

        while (
            Date.now() -
            inicio <
            10 *
            60 *
            1000
        ) {
            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        2000
                    )
            );

            const novoStatus =
                await atualizarStatusConectorLocalEsocial();

            if (
                novoStatus?.sessaoAtiva ===
                    true ||
                novoStatus?.conector?.sessaoAtiva ===
                    true
            ) {
                mostrarAlertaESocial(
                    'Certificado validado. O eSocial está conectado e aguardando sua consulta.',
                    'success'
                );

                return;
            }

            if (
                novoStatus?.comando?.status ===
                    'erro'
            ) {
                throw new Error(
                    novoStatus.comando.erro ||
                    'Não foi possível concluir a conexão com o eSocial.'
                );
            }
        }

        throw new Error(
            'Tempo de autenticação esgotado. Clique novamente em "Conectar certificado".'
        );

    } catch (
        error
    ) {
        mostrarAlertaESocial(
            'Não foi possível conectar o certificado: ' +
            error.message,
            'danger'
        );

    } finally {
        if (
            botao
        ) {
            botao.disabled =
                false;

            botao.innerHTML =
                htmlOriginal ||
                '<i class="fas fa-certificate me-1"></i> Conectar certificado';
        }

        await atualizarStatusConectorLocalEsocial();
    }
}


// ============================================================
// ESCOPO HOLDING / UNIDADE
// ============================================================

function obterEscopoSelecionadoConectorLocalEsocial() {
    const holding =
        String(
            document.getElementById(
                'filtroHoldingEvento'
            )?.value ||
            ''
        ).trim();

    const unidade =
        String(
            document.getElementById(
                'filtroUnidadeEvento'
            )?.value ||
            ''
        ).trim();

    if (
        !holding &&
        !unidade
    ) {
        return {
            ok:
                false,
            erro:
                'Selecione uma Holding ou uma Unidade antes de clicar em "Consultar pelo PC".'
        };
    }

    let candidatas =
        (
            Array.isArray(
                empresasSocCache
            )
                ? empresasSocCache
                : []
        )
            .filter(
                empresa => {
                    const holdingEmpresa =
                        String(
                            empresa?.holding ||
                            ''
                        ).trim();

                    const unidadeEmpresa =
                        String(
                            empresa?.unidade ||
                            ''
                        ).trim();

                    if (
                        holding &&
                        holdingEmpresa !==
                            holding
                    ) {
                        return false;
                    }

                    if (
                        unidade &&
                        unidadeEmpresa !==
                            unidade
                    ) {
                        return false;
                    }

                    return true;
                }
            )
            .map(
                empresa => ({
                    ...empresa,
                    empresaId:
                        String(
                            empresa?.id ??
                            ''
                        ).trim(),
                    cnpjLimpo:
                        String(
                            empresa?.cnpj ||
                            ''
                        ).replace(
                            /\D/g,
                            ''
                        )
                })
            )
            .filter(
                empresa =>
                    empresa.empresaId &&
                    empresa.cnpjLimpo.length ===
                        14
            );

    /*
     * Uma unidade sem holding pode ter nome repetido.
     * Não adivinhamos qual CNPJ usar.
     */
    if (
        unidade &&
        !holding &&
        candidatas.length >
            1
    ) {
        return {
            ok:
                false,
            erro:
                `A unidade "${unidade}" existe em mais de uma holding. Selecione também a Holding.`
        };
    }

    const unicas =
        new Map();

    for (
        const empresa
        of candidatas
    ) {
        if (
            !unicas.has(
                empresa.cnpjLimpo
            )
        ) {
            unicas.set(
                empresa.cnpjLimpo,
                empresa
            );
        }
    }

    candidatas =
        Array.from(
            unicas.values()
        );

    if (
        !candidatas.length
    ) {
        return {
            ok:
                false,
            erro:
                'Nenhuma unidade com CNPJ válido foi encontrada para o filtro selecionado.'
        };
    }

    return {
        ok:
            true,
        holding,
        unidade,
        empresas:
            candidatas
    };
}


function eventosPendentesParaEmpresaConectorLocalEsocial(
    empresa
) {
    const origem =
        (
            Array.isArray(
                eventosESocialHistorico
            ) &&
            eventosESocialHistorico.length
        )
            ? eventosESocialHistorico
            : (
                Array.isArray(
                    eventosESocialBase
                ) &&
                eventosESocialBase.length
                    ? eventosESocialBase
                    : eventosESocial
              );

    const cnpj =
        String(
            empresa?.cnpjLimpo ||
            empresa?.cnpj ||
            ''
        ).replace(
            /\D/g,
            ''
        );

    const holding =
        String(
            empresa?.holding ||
            ''
        ).trim();

    const unidade =
        String(
            empresa?.unidade ||
            ''
        ).trim();

    return Array.from(
        new Map(
            (
                Array.isArray(
                    origem
                )
                    ? origem
                    : []
            )
                .filter(
                    evento => {
                        const cnpjEvento =
                            String(
                                evento?.cnpj_unidade ||
                                evento?.cnpj ||
                                ''
                            ).replace(
                                /\D/g,
                                ''
                            );

                        const mesmaEmpresa =
                            cnpjEvento.length ===
                                14
                                ? (
                                    cnpjEvento ===
                                    cnpj
                                  )
                                : (
                                    String(
                                        evento?.holding ||
                                        ''
                                    ).trim() ===
                                        holding &&
                                    String(
                                        evento?.unidade ||
                                        evento?.nome_unidade ||
                                        ''
                                    ).trim() ===
                                        unidade
                                  );

                        if (
                            !mesmaEmpresa
                        ) {
                            return false;
                        }

                        const tipo =
                            String(
                                evento?.tipo_evento ||
                                ''
                            )
                                .trim()
                                .toUpperCase();

                        if (
                            ![
                                'S-2220',
                                'S-2240'
                            ].includes(
                                tipo
                            )
                        ) {
                            return false;
                        }

                        if (
                            evento?.emitido_esocial ===
                                true ||
                            evento?.ja_emitido ===
                                true
                        ) {
                            return false;
                        }

                        const resumo =
                            obterResumoColaboradorESocial(
                                evento
                            );

                        if (
                            resumo.vinculoStatus ===
                                'nao_localizado'
                        ) {
                            return false;
                        }

                        return (
                            resumo.vinculoStatus !==
                                'vinculado' ||
                            !resumo.matriculaOficial ||
                            !resumo.eventosObrigatoriosVerificados
                        );
                    }
                )
                .map(
                    evento => [
                        String(
                            evento.id
                        ),
                        evento
                    ]
                )
        ).values()
    );
}


function chaveColaboradorConectorLocalEsocial(
    evento,
    empresa
) {
    const cpf =
        String(
            evento?.cpf ||
            ''
        ).replace(
            /\D/g,
            ''
        );

    return [
        String(
            empresa?.cnpjLimpo ||
            ''
        ),
        cpf ||
        String(
            evento?.codigo_funcionario ||
            evento?.codigoFuncionario ||
            evento?.id ||
            ''
        )
    ].join(
        '|'
    );
}


// ============================================================
// PROGRESSO
// ============================================================

async function consultarProgressoTarefasConectorLocalEsocial(
    ids
) {
    const token =
        await obterTokenESocial();

    const response =
        await fetch(
            apiUrl(
                '/api/soc/conector-local/progresso-tarefas'
            ),
            {
                method:
                    'POST',
                headers:
                    criarHeaders(
                        token,
                        true
                    ),
                body:
                    JSON.stringify({
                        ids
                    })
            }
        );

    return lerRespostaJson(
        response
    );
}


async function acompanharConsultaPcEsocial() {
    clearInterval(
        timerProgressoConsultaPcEsocial
    );

    if (
        !consultaPcEsocialAtual
    ) {
        return;
    }

    const executar =
        async () => {
            const atual =
                consultaPcEsocialAtual;

            if (
                !atual ||
                atual.concluida ===
                    true
            ) {
                return;
            }

            try {
                const progresso =
                    atual.tarefasIds.length
                        ? await consultarProgressoTarefasConectorLocalEsocial(
                            atual.tarefasIds
                          )
                        : {
                            total:
                                0,
                            finalizadas:
                                0,
                            resolvidos:
                                0,
                            naoLocalizados:
                                0,
                            semAutorizacao:
                                0,
                            erros:
                                0,
                            concluida:
                                true,
                            sessaoAtiva:
                                statusConectorLocalEsocialAtual?.sessaoAtiva ===
                                    true
                          };

                const processados =
                    Math.min(
                        atual.totalColaboradores,
                        atual.finalizadosImediatamente +
                        Number(
                            progresso.finalizadas ||
                            0
                        )
                    );

                const sessaoAtiva =
                    progresso.sessaoAtiva ===
                        true ||
                    statusConectorLocalEsocialAtual?.sessaoAtiva ===
                        true;

                const detalheConector =
                    progresso.progressoConector ||
                    statusConectorLocalEsocialAtual?.conector?.progresso ||
                    null;

                let detalhe =
                    '';

                if (
                    detalheConector?.cnpj
                ) {
                    detalhe =
                        `CNPJ ${formatarCnpjConectorLocalEsocial(detalheConector.cnpj)}`;

                    if (
                        detalheConector.total
                    ) {
                        detalhe +=
                            ` • ${detalheConector.atual || 0}/${detalheConector.total}`;

                        if (
                            detalheConector.cpf
                        ) {
                            detalhe +=
                                ` • CPF ${detalheConector.cpf}`;
                        }
                    }
                }

                const concluiu =
                    (
                        atual.tarefasIds.length ===
                            0 ||
                        progresso.concluida ===
                            true
                    ) &&
                    processados >=
                        atual.totalColaboradores;

                atualizarPainelProgressoConsultaPcEsocial({
                    processados,
                    total:
                        atual.totalColaboradores,
                    status:
                        concluiu
                            ? 'Finalizada'
                            : (
                                sessaoAtiva
                                    ? 'Consultando'
                                    : 'Pausada'
                              ),
                    detalhe,
                    aviso:
                        !concluiu &&
                        !sessaoAtiva
                            ? 'A sessão do eSocial expirou. Clique em "Conectar certificado" para continuar a mesma consulta.'
                            : '',
                    concluida:
                        concluiu
                });

                if (
                    concluiu
                ) {
                    atual.concluida =
                        true;

                    clearInterval(
                        timerProgressoConsultaPcEsocial
                    );

                    timerProgressoConsultaPcEsocial =
                        null;

                    await recarregarEventosESocial();

                    await atualizarStatusConectorLocalEsocial();

                    const resolvidos =
                        Number(
                            progresso.resolvidos ||
                            0
                        );

                    const naoLocalizados =
                        Number(
                            progresso.naoLocalizados ||
                            0
                        );

                    const semAutorizacao =
                        Number(
                            progresso.semAutorizacao ||
                            0
                        );

                    const erros =
                        Number(
                            progresso.erros ||
                            0
                        ) +
                        Number(
                            atual.errosEnfileiramento ||
                            0
                        );

                    mostrarAlertaESocial(
                        `Consulta eSocial finalizada. ` +
                        `${atual.totalColaboradores} colaborador(es) processado(s). ` +
                        `${resolvidos} vínculo(s) confirmado(s)` +
                        (
                            naoLocalizados
                                ? `; ${naoLocalizados} não localizado(s)`
                                : ''
                        ) +
                        (
                            semAutorizacao
                                ? `; ${semAutorizacao} sem autorização`
                                : ''
                        ) +
                        (
                            erros
                                ? `; ${erros} com erro`
                                : ''
                        ) +
                        '. A tabela foi atualizada e já mostra os eventos que precisam ser feitos.',
                        erros
                            ? 'warning'
                            : 'success'
                    );

                    consultaPcEsocialAtual =
                        null;

                    atualizarBotoesConectorLocalEsocial(
                        statusConectorLocalEsocialAtual ||
                        {}
                    );
                }

            } catch (
                error
            ) {
                console.error(
                    '❌ Erro acompanhando consulta pelo PC:',
                    error
                );
            }
        };

    await executar();

    if (
        consultaPcEsocialAtual &&
        consultaPcEsocialAtual.concluida !==
            true
    ) {
        timerProgressoConsultaPcEsocial =
            setInterval(
                executar,
                2000
            );
    }
}


// ============================================================
// CONSULTAR PELO PC
// ============================================================

async function enfileirarEventosConectorLocalEsocial() {
    const status =
        await atualizarStatusConectorLocalEsocial();

    if (
        status?.online !==
            true
    ) {
        mostrarAlertaESocial(
            'O Conector eSocial está offline neste computador. Entre em contato com o suporte.',
            'warning'
        );

        return;
    }

    if (
        status?.sessaoAtiva !==
            true &&
        status?.conector?.sessaoAtiva !==
            true
    ) {
        mostrarAlertaESocial(
            'Primeiro clique em "Conectar certificado" e entre no eSocial.',
            'warning'
        );

        return;
    }

    if (
        consultaPcEsocialAtual &&
        consultaPcEsocialAtual.concluida !==
            true
    ) {
        mostrarAlertaESocial(
            'Já existe uma consulta pelo PC em andamento.',
            'info'
        );

        return;
    }

    const escopo =
        obterEscopoSelecionadoConectorLocalEsocial();

    if (
        !escopo.ok
    ) {
        mostrarAlertaESocial(
            escopo.erro,
            'warning'
        );

        return;
    }

    const grupos =
        [];

    const colaboradores =
        new Set();

    for (
        const empresa
        of escopo.empresas
    ) {
        const eventos =
            eventosPendentesParaEmpresaConectorLocalEsocial(
                empresa
            );

        if (
            !eventos.length
        ) {
            continue;
        }

        grupos.push({
            empresa,
            eventos
        });

        for (
            const evento
            of eventos
        ) {
            colaboradores.add(
                chaveColaboradorConectorLocalEsocial(
                    evento,
                    empresa
                )
            );
        }
    }

    if (
        !grupos.length ||
        !colaboradores.size
    ) {
        mostrarAlertaESocial(
            'Não há colaboradores pendentes de vínculo/matrícula/eventos no filtro selecionado.',
            'info'
        );

        return;
    }

    const descricaoEscopo =
        escopo.unidade
            ? (
                `${escopo.unidade}` +
                (
                    escopo.holding
                        ? ` / ${escopo.holding}`
                        : ''
                )
              )
            : (
                `Holding ${escopo.holding} • ${grupos.length} unidade(s)`
              );

    const confirmou =
        window.confirm(
            `Consultar ${colaboradores.size} colaborador(es) no eSocial?\n\n` +
            `${descricaoEscopo}\n\n` +
            'Nenhum evento será emitido automaticamente. Esta etapa somente valida vínculo, matrícula e existência de S-2220/S-2240.'
        );

    if (
        !confirmou
    ) {
        return;
    }

    const botao =
        document.getElementById(
            'btnResolverMatriculasHolding'
        );

    const htmlOriginal =
        botao?.innerHTML ||
        '';

    if (
        botao
    ) {
        botao.disabled =
            true;

        botao.innerHTML =
            '<i class="fas fa-spinner fa-spin me-1"></i> Preparando consulta...';
    }

    atualizarPainelProgressoConsultaPcEsocial({
        processados:
            0,
        total:
            colaboradores.size,
        status:
            'Preparando',
        detalhe:
            descricaoEscopo
    });

    try {
        const token =
            await obterTokenESocial();

        const tarefasIds =
            new Set();

        let totalSolicitados =
            0;

        let totalEnfileirados =
            0;

        let totalImediatos =
            0;

        let totalSemAutorizacao =
            0;

        let errosEnfileiramento =
            0;

        for (
            let indice = 0;
            indice <
            grupos.length;
            indice++
        ) {
            const {
                empresa,
                eventos
            } =
                grupos[indice];

            atualizarPainelProgressoConsultaPcEsocial({
                processados:
                    0,
                total:
                    colaboradores.size,
                status:
                    'Preparando',
                detalhe:
                    `Enfileirando ${indice + 1}/${grupos.length}: ${empresa.unidade || formatarCnpjConectorLocalEsocial(empresa.cnpjLimpo)}`
            });

            const response =
                await fetch(
                    apiUrl(
                        '/api/soc/conector-local/enfileirar-lote'
                    ),
                    {
                        method:
                            'POST',
                        headers:
                            criarHeaders(
                                token,
                                true
                            ),
                        body:
                            JSON.stringify({
                                ids:
                                    eventos.map(
                                        item =>
                                            item.id
                                    ),
                                empresaId:
                                    empresa.empresaId,
                                cnpjSelecionado:
                                    empresa.cnpjLimpo
                            })
                    }
                );

            const resultado =
                await lerRespostaJson(
                    response
                );

            (
                Array.isArray(
                    resultado.tarefasIds
                )
                    ? resultado.tarefasIds
                    : []
            )
                .forEach(
                    id =>
                        tarefasIds.add(
                            String(
                                id
                            )
                        )
                );

            totalSolicitados +=
                Number(
                    resultado.colaboradores?.solicitados ||
                    0
                );

            totalEnfileirados +=
                Number(
                    resultado.colaboradores?.enfileirados ||
                    0
                );

            totalImediatos +=
                Number(
                    resultado.colaboradores?.resolvidosDoCache ||
                    0
                );

            totalSemAutorizacao +=
                Number(
                    resultado.colaboradores?.semAutorizacao ||
                    0
                );

            errosEnfileiramento +=
                Array.isArray(
                    resultado.erros
                )
                    ? resultado.erros.length
                    : 0;
        }

        const totalColaboradores =
            colaboradores.size;

        /*
         * Uma tarefa representa um colaborador dentro de um CNPJ.
         * O que não gerou tarefa foi resolvido imediatamente,
         * estava sem autorização ou apresentou falha na preparação.
         */
        const finalizadosImediatamente =
            Math.max(
                0,
                totalColaboradores -
                tarefasIds.size
            );

        consultaPcEsocialAtual = {
            descricaoEscopo,
            totalColaboradores,
            tarefasIds:
                Array.from(
                    tarefasIds
                ),
            finalizadosImediatamente,
            totalEnfileirados,
            totalImediatos,
            totalSemAutorizacao,
            errosEnfileiramento,
            concluida:
                false
        };

        mostrarAlertaESocial(
            `Consulta iniciada para ${totalColaboradores} colaborador(es). ` +
            'Você pode acompanhar o progresso nesta tela.',
            'info'
        );

        await acompanharConsultaPcEsocial();

    } catch (
        error
    ) {
        consultaPcEsocialAtual =
            null;

        mostrarAlertaESocial(
            'Não foi possível iniciar a consulta pelo PC: ' +
            error.message,
            'danger'
        );

        atualizarPainelProgressoConsultaPcEsocial({
            processados:
                0,
            total:
                colaboradores.size,
            status:
                'Erro',
            aviso:
                error.message
        });

    } finally {
        if (
            botao
        ) {
            botao.innerHTML =
                htmlOriginal ||
                '<i class="fas fa-desktop me-1"></i> Consultar pelo PC';
        }

        await atualizarStatusConectorLocalEsocial();
    }
}


// ============================================================
// INSTALAR CONTROLES
// ============================================================

function instalarConectorLocalEsocial() {
    const consultar =
        document.getElementById(
            'btnResolverMatriculasHolding'
        );

    const conectar =
        garantirBotaoConectarCertificadoEsocial();

    if (
        conectar
    ) {
        conectar.onclick =
            function (
                event
            ) {
                event.preventDefault();

                conectarCertificadoConectorLocalEsocial();
            };
    }

    if (
        consultar
    ) {
        consultar.className =
            'btn btn-success btn-sm';

        consultar.title =
            'Consultar no eSocial somente a Holding/Unidade selecionada na tela.';

        consultar.innerHTML =
            '<i class="fas fa-desktop me-1"></i> Consultar pelo PC';

        consultar.disabled =
            true;

        consultar.onclick =
            function (
                event
            ) {
                event.preventDefault();

                enfileirarEventosConectorLocalEsocial();
            };
    }

    const diagnostico =
        document.getElementById(
            'btnDiagnosticarRoboEsocial'
        );

    if (
        diagnostico
    ) {
        diagnostico.classList.add(
            'd-none'
        );
    }

    const cancelar =
        document.getElementById(
            'btnCancelarRoboEsocial'
        );

    if (
        cancelar
    ) {
        cancelar.classList.add(
            'd-none'
        );
    }

    const resetAntigo =
        document.getElementById(
            'btnResetarMapeamentoConectorV38'
        );

    if (
        resetAntigo
    ) {
        resetAntigo.remove();
    }

    garantirBadgeConectorLocalEsocial();

    garantirPainelCnpjsSemAutorizacaoEsocial();

    garantirPainelProgressoConsultaPcEsocial();

    clearInterval(
        timerStatusConectorLocalEsocial
    );

    timerStatusConectorLocalEsocial =
        setInterval(
            atualizarStatusConectorLocalEsocial,
            5000
        );

    atualizarStatusConectorLocalEsocial();
}


function garantirControlesRoboRelatoriosEsocial() {

    const botaoAuto =
        document.getElementById(
            'btnResolverMatriculasHolding'
        );


    if (
        !botaoAuto?.parentElement
    ) {
        return null;
    }


    const container =
        botaoAuto.parentElement;


    let botaoManual =
        document.getElementById(
            'btnImportarBaseEsocialManual'
        );


    if (
        !botaoManual
    ) {

        botaoManual =
            document.createElement(
                'button'
            );


        botaoManual.type =
            'button';

        botaoManual.id =
            'btnImportarBaseEsocialManual';

        botaoManual.className =
            'btn btn-outline-success btn-sm';

        botaoManual.title =
            'Contingência: importar manualmente CSV/XLS/XLSX já baixado do eSocial.';

        botaoManual.innerHTML =
            '<i class="fas fa-file-excel me-1"></i> Importar arquivo';

        botaoManual.onclick =
            function (event) {

                event.preventDefault();

                garantirInputRelatorioGerencialEsocial()
                    .click();
            };


        container.appendChild(
            botaoManual
        );
    }

    // Sempre reinstalar o handler, inclusive quando o botão já existe no HTML.
    // A V2 criava o onclick apenas quando o botão era criado dinamicamente,
    // por isso os botões fixos do index.html apareciam mas não faziam nada.
    botaoManual.onclick =
        function (event) {

            event.preventDefault();

            garantirInputRelatorioGerencialEsocial()
                .click();
        };


    let botaoDiagnostico =
        document.getElementById(
            'btnDiagnosticarRoboEsocial'
        );


    if (
        !botaoDiagnostico
    ) {

        botaoDiagnostico =
            document.createElement(
                'button'
            );


        botaoDiagnostico.type =
            'button';

        botaoDiagnostico.id =
            'btnDiagnosticarRoboEsocial';

        botaoDiagnostico.className =
            'btn btn-outline-secondary btn-sm';

        botaoDiagnostico.title =
            'Testar login com certificado A1 e troca de perfil para uma empresa, sem solicitar relatório.';

        botaoDiagnostico.innerHTML =
            '<i class="fas fa-stethoscope me-1"></i> Testar acesso';

        botaoDiagnostico.onclick =
            function (event) {

                event.preventDefault();

                diagnosticarRoboRelatoriosEsocial();
            };


        container.appendChild(
            botaoDiagnostico
        );
    }

    // Idem: se o botão já veio pronto no HTML, ainda precisamos ligar o clique.
    botaoDiagnostico.onclick =
        function (event) {

            event.preventDefault();

            diagnosticarRoboRelatoriosEsocial();
        };


    let botaoCancelar =
        document.getElementById(
            'btnCancelarRoboEsocial'
        );


    if (
        !botaoCancelar
    ) {

        botaoCancelar =
            document.createElement(
                'button'
            );


        botaoCancelar.type =
            'button';

        botaoCancelar.id =
            'btnCancelarRoboEsocial';

        botaoCancelar.className =
            'btn btn-outline-danger btn-sm d-none';

        botaoCancelar.innerHTML =
            '<i class="fas fa-stop me-1"></i> Parar';

        botaoCancelar.onclick =
            function (event) {

                event.preventDefault();

                cancelarAtualizacaoAutomaticaRelatoriosEsocial();
            };


        container.appendChild(
            botaoCancelar
        );
    }

    botaoCancelar.onclick =
        function (event) {

            event.preventDefault();

            cancelarAtualizacaoAutomaticaRelatoriosEsocial();
        };


    let painel =
        document.getElementById(
            'painelRoboRelatoriosEsocial'
        );


    if (
        !painel
    ) {

        painel =
            document.createElement(
                'div'
            );


        painel.id =
            'painelRoboRelatoriosEsocial';

        painel.className =
            'card border-0 shadow-sm mt-2 d-none';

        painel.innerHTML =
            '<div class="card-body py-2 px-3"></div>';


        // O painel precisa ser inserido em relação ao PAI DIRETO do
        // container. Usar closest() aqui pode devolver um ancestral e fazer
        // insertBefore() receber um nó de referência que não é filho dele.
        // insertAdjacentElement('afterend') evita esse erro e mantém o painel
        // logo abaixo dos controles.
        if (
            container.parentElement
        ) {
            container.insertAdjacentElement(
                'afterend',
                painel
            );
        } else {
            container.appendChild(
                painel
            );
        }
    }


    return {
        botaoAuto,
        botaoManual,
        botaoDiagnostico,
        botaoCancelar,
        painel
    };
}


function escaparHtmlRoboEsocial(
    valor
) {

    return String(
        valor ??
        ''
    )
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


function classeStatusItemRoboEsocial(
    status
) {

    const mapa = {
        concluido:
            'bg-success',
        processando:
            'bg-primary',
        pendente:
            'bg-secondary',
        sem_permissao:
            'bg-warning text-dark',
        erro:
            'bg-danger'
    };


    return mapa[
        String(
            status ||
            ''
        )
    ] ||
    'bg-secondary';
}


function renderizarStatusRoboRelatoriosEsocial(
    resultado
) {

    const controles =
        garantirControlesRoboRelatoriosEsocial();


    if (
        !controles
    ) {
        return;
    }


    const {
        botaoAuto,
        botaoDiagnostico,
        botaoCancelar,
        painel
    } =
        controles;


    const execucao =
        resultado?.execucao ||
        null;


    if (
        !execucao
    ) {

        painel.classList.add(
            'd-none'
        );

        botaoAuto.disabled =
            false;

        botaoDiagnostico.disabled =
            false;

        botaoCancelar.classList.add(
            'd-none'
        );

        return;
    }


    painel.classList.remove(
        'd-none'
    );


    const total =
        Number(
            execucao.total_empresas ||
            0
        );


    const processadas =
        Number(
            execucao.processadas ||
            0
        );


    const percentual =
        total > 0
            ? Math.min(
                100,
                Math.round(
                    processadas /
                    total *
                    100
                )
              )
            : 0;


    const emAndamento =
        [
            'pendente',
            'processando'
        ].includes(
            execucao.status
        );


    botaoAuto.disabled =
        emAndamento;

    botaoDiagnostico.disabled =
        emAndamento;

    botaoCancelar.classList.toggle(
        'd-none',
        !emAndamento
    );


    const itens =
        Array.isArray(
            resultado?.itens
        )
            ? resultado.itens
            : [];


    const atuais =
        itens
            .filter(
                item =>
                    [
                        'processando',
                        'erro',
                        'sem_permissao'
                    ].includes(
                        item.status
                    )
            )
            .slice(
                -8
            );


    const recentes =
        atuais.length
            ? atuais
            : itens
                .filter(
                    item =>
                        item.status ===
                        'concluido'
                )
                .slice(
                    -6
                );


    const linhas =
        recentes
            .map(
                item =>
                    `<div class="d-flex justify-content-between align-items-center border-top py-1 gap-2">` +
                        `<div class="small text-truncate">` +
                            `<strong>${escaparHtmlRoboEsocial(item.razao_social || item.unidade || item.cnpj)}</strong>` +
                            ` <span class="text-muted">${escaparHtmlRoboEsocial(item.cnpj)}</span>` +
                        `</div>` +
                        `<span class="badge ${classeStatusItemRoboEsocial(item.status)}">` +
                            `${escaparHtmlRoboEsocial(item.status)}` +
                        `</span>` +
                    `</div>`
            )
            .join('');


    const corpo =
        painel.querySelector(
            '.card-body'
        );


    corpo.innerHTML =
        `<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-1">` +
            `<div>` +
                `<strong><i class="fas fa-robot me-1"></i> Atualização automática eSocial</strong>` +
                `<div class="small text-muted">${escaparHtmlRoboEsocial(execucao.etapa || execucao.status)}</div>` +
            `</div>` +
            `<div class="small">` +
                `<span class="badge bg-success me-1">${Number(execucao.sucessos || 0)} OK</span>` +
                `<span class="badge bg-danger me-1">${Number(execucao.erros || 0)} erro(s)</span>` +
                `<strong>${processadas}/${total}</strong>` +
            `</div>` +
        `</div>` +
        `<div class="progress mb-2" style="height: 8px;">` +
            `<div class="progress-bar" role="progressbar" style="width:${percentual}%" aria-valuenow="${percentual}" aria-valuemin="0" aria-valuemax="100"></div>` +
        `</div>` +
        (execucao.mensagem
            ? `<div class="small mb-1">${escaparHtmlRoboEsocial(execucao.mensagem)}</div>`
            : '') +
        (execucao.cnpj_atual
            ? `<div class="small text-muted mb-1">CNPJ atual: ${escaparHtmlRoboEsocial(execucao.cnpj_atual)}</div>`
            : '') +
        linhas;
}


function controlarPollingRoboRelatoriosEsocial(
    deveContinuar
) {

    if (
        deveContinuar
    ) {

        if (
            !timerStatusRoboRelatoriosEsocial
        ) {

            timerStatusRoboRelatoriosEsocial =
                setInterval(
                    atualizarStatusRoboRelatoriosEsocial,
                    5000
                );
        }

        return;
    }


    if (
        timerStatusRoboRelatoriosEsocial
    ) {

        clearInterval(
            timerStatusRoboRelatoriosEsocial
        );

        timerStatusRoboRelatoriosEsocial =
            null;
    }
}


async function atualizarStatusRoboRelatoriosEsocial() {

    try {

        const token =
            await obterTokenESocial();


        const response =
            await fetch(
                apiUrl(
                    '/api/soc/relatorios-robo/status'
                ),
                {
                    headers:
                        criarHeaders(
                            token
                        )
                }
            );


        const resultado =
            await lerRespostaJson(
                response
            );


        renderizarStatusRoboRelatoriosEsocial(
            resultado
        );


        const status =
            resultado?.execucao?.status ||
            '';


        const rodando =
            [
                'pendente',
                'processando'
            ].includes(
                status
            );


        controlarPollingRoboRelatoriosEsocial(
            rodando
        );


        if (
            !rodando &&
            [
                'concluido',
                'concluido_com_erros'
            ].includes(
                status
            )
        ) {

            await atualizarStatusBaseRelatorioEsocial();
        }

    } catch (
        error
    ) {

        console.warn(
            '⚠️ Status do robô de relatórios indisponível:',
            error
        );

        controlarPollingRoboRelatoriosEsocial(
            false
        );
    }
}


async function diagnosticarRoboRelatoriosEsocial() {

    const controles =
        garantirControlesRoboRelatoriosEsocial();


    if (
        !controles
    ) {
        return;
    }


    const botao =
        controles.botaoDiagnostico;


    const htmlOriginal =
        botao.innerHTML;


    botao.disabled =
        true;

    botao.innerHTML =
        '<i class="fas fa-spinner fa-spin me-1"></i> Testando...';


    try {

        const token =
            await obterTokenESocial();


        mostrarAlertaESocial(
            'Testando login com o certificado A1 e troca de perfil. Nenhum relatório será solicitado.',
            'info'
        );


        const response =
            await fetch(
                apiUrl(
                    '/api/soc/relatorios-robo/diagnosticar'
                ),
                {
                    method:
                        'POST',
                    headers:
                        criarHeaders(
                            token
                        )
                }
            );


        const resultado =
            await lerRespostaJson(
                response
            );


        mostrarAlertaESocial(
            `Acesso automático confirmado${resultado.cnpjTestado ? ` para o CNPJ ${resultado.cnpjTestado}` : ''}.`,
            'success'
        );

    } catch (
        error
    ) {

        console.error(
            '❌ Diagnóstico do robô eSocial:',
            error
        );


        mostrarAlertaESocial(
            'Teste automático falhou: ' +
            error.message +
            '. Se aparecer uma etapa/layout do portal que o robô ainda não reconhece, me envie a mensagem e a tela.',
            'danger'
        );

    } finally {

        botao.disabled =
            false;

        botao.innerHTML =
            htmlOriginal;
    }
}


async function iniciarAtualizacaoAutomaticaRelatoriosEsocial() {

    const controles =
        garantirControlesRoboRelatoriosEsocial();


    if (
        !controles
    ) {
        return;
    }


    try {

        const token =
            await obterTokenESocial();


        const responseEmpresas =
            await fetch(
                apiUrl(
                    '/api/soc/relatorios-robo/empresas'
                ),
                {
                    headers:
                        criarHeaders(
                            token
                        )
                }
            );


        const empresas =
            await lerRespostaJson(
                responseEmpresas
            );


        const total =
            Number(
                empresas.total ||
                0
            );


        if (
            !total
        ) {

            mostrarAlertaESocial(
                'Nenhuma empresa com eSocial autorizado e CNPJ válido foi encontrada.',
                'warning'
            );

            return;
        }


        const confirmou =
            window.confirm(
                `Atualizar automaticamente a base eSocial de ${total} empregador(es)?\n\n` +
                'O backend fará login com o A1, trocará o CNPJ e solicitará um Relatório Gerencial por empregador. O processo continua mesmo se você sair desta aba.'
            );


        if (
            !confirmou
        ) {
            return;
        }


        controles.botaoAuto.disabled =
            true;


        const response =
            await fetch(
                apiUrl(
                    '/api/soc/relatorios-robo/iniciar'
                ),
                {
                    method:
                        'POST',
                    headers:
                        criarHeaders(
                            token
                        )
                }
            );


        const resultado =
            await lerRespostaJson(
                response
            );


        mostrarAlertaESocial(
            `Atualização automática iniciada para ${resultado.totalEmpresas || total} empregador(es).`,
            'success'
        );


        controlarPollingRoboRelatoriosEsocial(
            true
        );


        await atualizarStatusRoboRelatoriosEsocial();

    } catch (
        error
    ) {

        console.error(
            '❌ Falha iniciando robô de relatórios eSocial:',
            error
        );


        mostrarAlertaESocial(
            'Não foi possível iniciar a atualização automática: ' +
            error.message,
            'danger'
        );


        controles.botaoAuto.disabled =
            false;
    }
}


async function cancelarAtualizacaoAutomaticaRelatoriosEsocial() {

    if (
        !window.confirm(
            'Parar a atualização automática após a etapa atual?'
        )
    ) {
        return;
    }


    try {

        const token =
            await obterTokenESocial();


        await fetch(
            apiUrl(
                '/api/soc/relatorios-robo/cancelar'
            ),
            {
                method:
                    'POST',
                headers:
                    criarHeaders(
                        token
                    )
            }
        );


        mostrarAlertaESocial(
            'Cancelamento solicitado. O robô vai parar ao terminar a etapa atual.',
            'warning'
        );

    } catch (
        error
    ) {

        mostrarAlertaESocial(
            'Não foi possível solicitar o cancelamento: ' +
            error.message,
            'danger'
        );
    }
}


if (
    document.readyState ===
    'loading'
) {

    document.addEventListener(
        'DOMContentLoaded',
        instalarExtrasEventosESocial
    );

} else {

    instalarExtrasEventosESocial();
}


// ============================================================
// BASE eSOCIAL - RELATÓRIO GERENCIAL DE TRABALHADORES
// ============================================================
//
// Fonte primária de vínculo + matrícula. O relatório pode ser CSV,
// XLS ou XLSX e pode conter empregadores diferentes em arquivos
// separados enviados de uma só vez. O backend lê o empregador de
// cada linha e grava o vínculo na chave empregador + CPF + matrícula.
// ============================================================

function garantirInputRelatorioGerencialEsocial() {

    let input =
        document.getElementById(
            'inputRelatorioGerencialEsocial'
        );


    if (
        input
    ) {

        return input;
    }


    input =
        document.createElement(
            'input'
        );


    input.type =
        'file';


    input.id =
        'inputRelatorioGerencialEsocial';


    input.accept =
        '.csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';


    input.multiple =
        true;


    input.hidden =
        true;


    document.body.appendChild(
        input
    );


    return input;
}


function garantirStatusBaseEsocial() {

    let badge =
        document.getElementById(
            'baseEsocialRelatorioStatus'
        );


    if (
        badge
    ) {

        return badge;
    }


    const botao =
        document.getElementById(
            'btnResolverMatriculasHolding'
        );


    if (
        !botao?.parentElement
    ) {

        return null;
    }


    badge =
        document.createElement(
            'span'
        );


    badge.id =
        'baseEsocialRelatorioStatus';


    badge.className =
        'badge bg-secondary align-self-center';


    badge.title =
        'Situação da base local carregada a partir do Relatório Gerencial do eSocial';


    badge.textContent =
        'Base eSocial: não carregada';


    botao.parentElement.appendChild(
        badge
    );


    return badge;
}


async function atualizarStatusBaseRelatorioEsocial() {

    const badge =
        garantirStatusBaseEsocial();


    if (
        !badge
    ) {

        return;
    }


    try {

        const token =
            await obterTokenESocial();


        const response =
            await fetch(
                apiUrl(
                    '/api/soc/relatorio-gerencial-esocial/status'
                ),
                {
                    headers:
                        criarHeaders(
                            token
                        )
                }
            );


        const resultado =
            await lerRespostaJson(
                response
            );


        if (
            !resultado.totalVinculos
        ) {

            badge.className =
                'badge bg-secondary align-self-center';

            badge.textContent =
                'Base eSocial: não carregada';

            return;
        }


        badge.className =
            'badge bg-success align-self-center';


        const data =
            resultado.ultimaAtualizacaoGeral
                ? formatarDataExibicao(
                    resultado.ultimaAtualizacaoGeral
                  )
                : '';


        badge.textContent =
            `Base eSocial: ${resultado.totalEmpregadores || 0} empresa(s) / ` +
            `${resultado.totalVinculos || 0} vínculo(s)` +
            (data
                ? ` • ${data}`
                : '');


        badge.title =
            'Relatório Gerencial importado. Consultas de vínculo e matrícula usam esta base local e não consomem BX.';

    } catch (
        error
    ) {

        console.warn(
            '⚠️ Não foi possível consultar o status da base eSocial:',
            error
        );


        badge.className =
            'badge bg-warning text-dark align-self-center';

        badge.textContent =
            'Base eSocial: status indisponível';
    }
}


async function importarRelatorioGerencialEsocial(
    arquivos
) {

    const lista =
        Array.from(
            arquivos ||
            []
        )
            .filter(
                arquivo =>
                    /\.(csv|xls|xlsx)$/i.test(
                        String(
                            arquivo?.name ||
                            ''
                        )
                    )
            );


    if (
        !lista.length
    ) {

        mostrarAlertaESocial(
            'Selecione o arquivo CSV, XLS ou XLSX do relatório "Relação de trabalhadores - eSocial".',
            'warning'
        );

        return;
    }


    const botao =
        document.getElementById(
            'btnResolverMatriculasHolding'
        );


    const htmlOriginal =
        botao?.innerHTML ||
        '';


    if (
        botao
    ) {

        botao.disabled =
            true;


        botao.innerHTML =
            '<i class="fas fa-spinner fa-spin me-1"></i> Importando base...';
    }


    try {

        const token =
            await obterTokenESocial();


        const formData =
            new FormData();


        lista.forEach(
            arquivo =>
                formData.append(
                    'arquivos',
                    arquivo,
                    arquivo.name
                )
        );


        mostrarAlertaESocial(
            `Importando ${lista.length} relatório(s) gerencial(is) do eSocial. Esta operação não consome BX...`,
            'info'
        );


        const response =
            await fetch(
                apiUrl(
                    '/api/soc/relatorio-gerencial-esocial/importar'
                ),
                {
                    method:
                        'POST',
                    headers:
                        criarHeaders(
                            token
                        ),
                    body:
                        formData
                }
            );


        const resultado =
            await lerRespostaJson(
                response
            );


        const empresas =
            Array.isArray(
                resultado.empregadores
            )
                ? resultado.empregadores
                : [];


        const resumoEmpresas =
            empresas
                .slice(
                    0,
                    6
                )
                .map(
                    item =>
                        `${item.nrInsc}: ${item.trabalhadores} vínculo(s)`
                )
                .join(' | ');


        let mensagem =
            `Base eSocial atualizada: ${resultado.linhasValidas || 0} vínculo(s), ` +
            `${empresas.length} empregador(es), ` +
            `${resultado.eventosLocaisAtualizados || 0} evento(s) local(is) reconciliado(s).`;


        if (
            resumoEmpresas
        ) {

            mensagem +=
                ` ${resumoEmpresas}`;
        }


        if (
            Number(
                resultado.linhasIgnoradas ||
                0
            ) > 0
        ) {

            mensagem +=
                ` ${resultado.linhasIgnoradas} linha(s) incompleta(s) foram ignoradas.`;
        }


        if (
            Array.isArray(
                resultado.erros
            ) &&
            resultado.erros.length
        ) {

            console.warn(
                '⚠️ Arquivos/linhas com erro no Relatório Gerencial:',
                resultado.erros
            );
        }


        mostrarAlertaESocial(
            mensagem,
            'success'
        );


        await atualizarStatusBaseRelatorioEsocial();


        await recarregarEventosESocial();

    } catch (
        error
    ) {

        console.error(
            '❌ Erro importando Relatório Gerencial eSocial:',
            error
        );


        mostrarAlertaESocial(
            'Não foi possível importar a base eSocial: ' +
            error.message,
            'danger'
        );

    } finally {

        if (
            botao
        ) {

            botao.disabled =
                false;


            botao.innerHTML =
                htmlOriginal ||
                '<i class="fas fa-file-excel me-1"></i> Importar base eSocial';
        }


        const input =
            document.getElementById(
                'inputRelatorioGerencialEsocial'
            );


        if (
            input
        ) {

            input.value =
                '';
        }
    }
}


function instalarRelatorioGerencialEsocial() {

    const input =
        garantirInputRelatorioGerencialEsocial();


    garantirStatusBaseEsocial();


    if (
        input.dataset.relatorioGerencialInstalado !==
            '1'
    ) {

        input.dataset.relatorioGerencialInstalado =
            '1';


        input.onchange =
            async function () {

                await importarRelatorioGerencialEsocial(
                    this.files
                );
            };
    }


    // Botão principal = Conector local no PC.
    // Importação manual permanece disponível como contingência.
    instalarConectorLocalEsocial();

    atualizarStatusBaseRelatorioEsocial();

}


if (
    document.readyState ===
    'loading'
) {

    document.addEventListener(
        'DOMContentLoaded',
        instalarRelatorioGerencialEsocial
    );

} else {

    instalarRelatorioGerencialEsocial();
}


// ============================================================
// IMPORTAR XMLs BAIXADOS DO PORTAL E-SOCIAL
// ============================================================

async function importarXmlsPortalEsocial(
    arquivos
) {

    const listaArquivos =
        Array.from(
            arquivos ||
            []
        );


    if (
        !listaArquivos.length
    ) {

        return;
    }


    // ========================================================
    // VALIDAR ARQUIVOS
    // ========================================================

    const xmls =
        listaArquivos.filter(
            arquivo =>
                String(
                    arquivo?.name ||
                    ''
                )
                    .toLowerCase()
                    .endsWith(
                        '.xml'
                    )
        );


    if (
        !xmls.length
    ) {

        mostrarAlertaESocial(
            'Selecione pelo menos um arquivo XML.',
            'warning'
        );

        return;
    }


    const btn =
        document.getElementById(
            'btnImportarXmlEsocial'
        );


    const htmlOriginal =
        btn?.innerHTML ||
        '';


    if (
        btn
    ) {

        btn.disabled =
            true;


        btn.innerHTML = `
            <i class="fas fa-spinner fa-spin me-1"></i>
            Importando...
        `;
    }


    let processados =
        0;


    let encontrados =
        0;


    let naoEncontrados =
        0;


    let erros =
        0;


    const detalhesErros =
        [];


    try {

        const token =
            await obterTokenESocial();


        mostrarAlertaESocial(
            `Importando ${xmls.length} XML(s) do eSocial...`,
            'info'
        );


        // ====================================================
        // PROCESSAR UM DE CADA VEZ
        //
        // Não há necessidade de paralelismo.
        // São arquivos locais e queremos retornos claros.
        // ====================================================

        for (
            let indice = 0;
            indice < xmls.length;
            indice++
        ) {

            const arquivo =
                xmls[indice];


            try {

                if (
                    btn
                ) {

                    btn.innerHTML =
                        `<i class="fas fa-spinner fa-spin me-1"></i>` +
                        `Importando ${indice + 1}/${xmls.length}`;
                }


                const xml =
                    await arquivo.text();


                if (
                    !String(
                        xml ||
                        ''
                    ).trim()
                ) {

                    throw new Error(
                        'Arquivo vazio.'
                    );
                }


                const response =
                    await fetch(
                        apiUrl(
                            '/api/soc/importar-evento-esocial-xml'
                        ),
                        {

                            method:
                                'POST',

                            headers:
                                criarHeaders(
                                    token,
                                    true
                                ),

                            body:
                                JSON.stringify({

                                    nomeArquivo:
                                        arquivo.name,

                                    xml
                                })
                        }
                    );


                const texto =
                    await response.text();


                let resultado =
                    {};


                if (
                    texto
                ) {

                    try {

                        resultado =
                            JSON.parse(
                                texto
                            );

                    } catch (
                        error
                    ) {

                        throw new Error(
                            'O servidor retornou uma resposta inválida.'
                        );
                    }
                }


                if (
                    !response.ok ||
                    resultado.success !==
                        true
                ) {

                    throw new Error(
                        resultado.error ||
                        `HTTP ${response.status}`
                    );
                }


                processados++;


                if (
                    resultado.encontradoNoSistema ===
                    true
                ) {

                    encontrados +=
                        Number(
                            resultado.quantidadeAtualizada ||
                            1
                        );

                } else {

                    naoEncontrados++;
                }


                console.log(
                    '✅ XML eSocial importado:',
                    arquivo.name,
                    resultado
                );


            } catch (
                error
            ) {

                erros++;


                detalhesErros.push(
                    `${arquivo.name}: ${error.message}`
                );


                console.error(
                    '❌ Erro importando',
                    arquivo.name,
                    error
                );
            }
        }


        // ====================================================
        // ATUALIZAR TELA
        // ====================================================

        await recarregarEventosESocial();


        // ====================================================
        // RESULTADO
        // ====================================================

        let mensagem =
            `Importação concluída. ` +
            `${processados} XML(s) válido(s). ` +
            `${encontrados} evento(s) confirmado(s) no sistema.`;


        if (
            naoEncontrados
        ) {

            mensagem +=
                ` ${naoEncontrados} XML(s) não tiveram correspondência local.`;
        }


        if (
            erros
        ) {

            mensagem +=
                ` ${erros} arquivo(s) apresentaram erro.`;
        }


        mostrarAlertaESocial(
            mensagem,
            erros
                ? 'warning'
                : 'success'
        );


        if (
            detalhesErros.length
        ) {

            console.warn(
                '⚠️ Erros da importação XML:',
                detalhesErros
            );
        }


    } catch (
        error
    ) {

        console.error(
            '❌ Erro geral importando XMLs:',
            error
        );


        mostrarAlertaESocial(
            'Erro ao importar XMLs: ' +
            error.message,
            'danger'
        );


    } finally {

        if (
            btn
        ) {

            btn.disabled =
                false;


            btn.innerHTML =
                htmlOriginal;
        }


        const input =
            document.getElementById(
                'inputImportarXmlEsocial'
            );


        if (
            input
        ) {

            input.value =
                '';
        }
    }
}


// ============================================================
// INSTALAR IMPORTAÇÃO XML
// ============================================================

function instalarImportacaoXmlEsocial() {

    const btn =
        document.getElementById(
            'btnImportarXmlEsocial'
        );


    const input =
        document.getElementById(
            'inputImportarXmlEsocial'
        );


    if (
        btn &&
        btn.dataset.importacaoXmlInstalada !==
            '1'
    ) {

        btn.dataset.importacaoXmlInstalada =
            '1';


        btn.onclick =
            function (
                event
            ) {

                event.preventDefault();


                if (
                    input
                ) {

                    input.click();
                }
            };
    }


    if (
        input &&
        input.dataset.importacaoXmlInstalada !==
            '1'
    ) {

        input.dataset.importacaoXmlInstalada =
            '1';


        input.onchange =
            async function () {

                await importarXmlsPortalEsocial(
                    this.files
                );
            };
    }
}


// ============================================================
// INSTALAR QUANDO A PÁGINA ESTIVER DISPONÍVEL
// ============================================================

if (
    document.readyState ===
    'loading'
) {

    document.addEventListener(
        'DOMContentLoaded',
        instalarImportacaoXmlEsocial
    );

} else {

    instalarImportacaoXmlEsocial();
}

// ============================================================
// IMPORTAR HISTÓRICO E-SOCIAL POR ZIP
// ============================================================

async function importarHistoricoZipEsocial(
    arquivos
) {

    const lista =
        Array.from(
            arquivos ||
            []
        )
            .filter(
                arquivo =>
                    String(
                        arquivo?.name ||
                        ''
                    )
                        .toLowerCase()
                        .endsWith(
                            '.zip'
                        )
            );


    if (
        !lista.length
    ) {

        mostrarAlertaESocial(
            'Selecione pelo menos um arquivo ZIP.',
            'warning'
        );

        return;
    }


    const botao =
        document.getElementById(
            'btnImportarZipEsocial'
        );


    const htmlOriginal =
        botao?.innerHTML ||
        '';


    if (
        botao
    ) {

        botao.disabled =
            true;
    }


    let totalImportados =
        0;

    let totalAtualizados =
        0;

    let totalSemCorrespondencia =
        0;

    let totalIgnorados =
        0;

    let totalErros =
        0;


    const resultados =
        [];


    try {

        const token =
            await obterTokenESocial();


        for (
            let indice = 0;
            indice < lista.length;
            indice++
        ) {

            const arquivo =
                lista[
                    indice
                ];


            if (
                botao
            ) {

                botao.innerHTML = `
                    <i class="fas fa-spinner fa-spin me-1"></i>

                    Processando ${indice + 1}/${lista.length}
                `;
            }


            mostrarAlertaESocial(
                `Importando histórico ${arquivo.name}...`,
                'info'
            );


            const formData =
                new FormData();


            formData.append(
                'arquivo',
                arquivo
            );


            const response =
                await fetch(
                    apiUrl(
                        '/api/soc/importar-historico-esocial-zip'
                    ),
                    {

                        method:
                            'POST',

                        /*
                         * NÃO colocar Content-Type manualmente.
                         *
                         * O navegador monta o boundary do
                         * multipart/form-data.
                         */

                        headers:
                            criarHeaders(
                                token
                            ),

                        body:
                            formData
                    }
                );


            const resultado =
                await lerRespostaJson(
                    response
                );


            resultados.push(
                resultado
            );


            totalImportados +=
                Number(
                    resultado.importados ||
                    0
                );


            totalAtualizados +=
                Number(
                    resultado.registrosLocaisAtualizados ||
                    0
                );


            totalSemCorrespondencia +=
                Number(
                    resultado.semCorrespondencia ||
                    0
                );


            totalIgnorados +=
                Number(
                    resultado.ignorados ||
                    0
                );


            totalErros +=
                Number(
                    resultado.erros ||
                    0
                );


            console.log(
                '📦 Resultado ZIP eSocial:',
                resultado
            );
        }


        // ====================================================
        // ATUALIZAR TELA
        // ====================================================

        await carregarEventosESocial();


        // ====================================================
        // RESUMO
        // ====================================================

        let mensagem =
            `Histórico eSocial processado. ` +
            `${totalImportados} evento(s) importado(s). ` +
            `${totalAtualizados} registro(s) do sistema ` +
            `foram confirmados como já emitidos.`;


        if (
            totalSemCorrespondencia
        ) {

            mensagem +=
                ` ${totalSemCorrespondencia} evento(s) ainda ` +
                `não possuem correspondência local.`;
        }


        if (
            totalIgnorados
        ) {

            mensagem +=
                ` ${totalIgnorados} XML(s) de outros tipos foram ignorados.`;
        }


        if (
            totalErros
        ) {

            mensagem +=
                ` ${totalErros} XML(s) apresentaram erro.`;
        }


        mostrarAlertaESocial(
            mensagem,
            totalErros
                ? 'warning'
                : 'success'
        );


        console.log(
            '📊 Resumo importação histórica:',
            {
                totalImportados,
                totalAtualizados,
                totalSemCorrespondencia,
                totalIgnorados,
                totalErros,
                resultados
            }
        );


    } catch (
        error
    ) {

        console.error(
            '❌ Erro importando histórico eSocial:',
            error
        );


        mostrarAlertaESocial(
            'Erro ao importar histórico: ' +
            error.message,
            'danger'
        );


    } finally {

        if (
            botao
        ) {

            botao.disabled =
                false;


            botao.innerHTML =
                htmlOriginal;
        }


        const input =
            document.getElementById(
                'inputImportarZipEsocial'
            );


        if (
            input
        ) {

            input.value =
                '';
        }
    }
}


// ============================================================
// INSTALAR BOTÃO ZIP
// ============================================================

function instalarImportacaoHistoricoZipEsocial() {

    const botao =
        document.getElementById(
            'btnImportarZipEsocial'
        );


    const input =
        document.getElementById(
            'inputImportarZipEsocial'
        );


    if (
        botao &&
        botao.dataset.instalado !==
            '1'
    ) {

        botao.dataset.instalado =
            '1';


        botao.addEventListener(
            'click',
            function (
                event
            ) {

                event.preventDefault();


                if (
                    input
                ) {

                    input.click();
                }
            }
        );
    }


    if (
        input &&
        input.dataset.instalado !==
            '1'
    ) {

        input.dataset.instalado =
            '1';


        input.addEventListener(
            'change',
            async function () {

                await importarHistoricoZipEsocial(
                    this.files
                );
            }
        );
    }
}


// ============================================================
// INSTALAR
// ============================================================

if (
    document.readyState ===
    'loading'
) {

    document.addEventListener(
        'DOMContentLoaded',
        instalarImportacaoHistoricoZipEsocial
    );

} else {

    instalarImportacaoHistoricoZipEsocial();
}

    // ============================================================
    // EXPORTAR FUNÇÕES GLOBALMENTE
    // ============================================================

    window.initESocial =
        initESocial;

    window.recarregarEventosESocial =
        recarregarEventosESocial;

    window.carregarEventosESocial =
        carregarEventosESocial;

    window.mostrarAlertaESocial =
        mostrarAlertaESocial;

    window.buscarDadosSoc =
        buscarDadosSoc;

    window.enviarEventosSelecionados =
        enviarEventosSelecionados;

    window.enviarTodosEventos =
        enviarTodosEventos;

    window.verAso =
        verAso;

    window.verXmlEvento =
        verXmlEvento;

    window.cancelarEvento =
        cancelarEvento;

    window.carregarEmpresasParaESocial =
        carregarEmpresasParaESocial;

    window.copiarXmlESocial =
        copiarXmlESocial;

    console.log(
        '✅ esocial.js carregado.'
    );

})();