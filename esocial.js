// ============================================================
// esocial.js - Módulo e-Social com integração SOC
// Atualizado para trabalhar com backend Node na porta 3002
// ============================================================

(() => {
    'use strict';

    // ============================================================
    // CONFIGURAÇÃO
    // ============================================================

    const API_BASE_URL = (() => {
        const hostLocal = [
            'localhost',
            '127.0.0.1'
        ].includes(window.location.hostname);

        /*
         * Se abrir pelo Live Server:
         * http://localhost:5500
         *
         * as APIs continuam sendo chamadas no Node:
         * http://localhost:3002
         */
        if (
            hostLocal &&
            window.location.port !== '3002'
        ) {
            return 'http://localhost:3002';
        }

        /*
         * Se abrir em:
         * http://localhost:3002
         *
         * usa a mesma origem.
         */
        return '';
    })();

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
                    `Confirme se o backend está rodando ` +
                    `em http://localhost:3002.`
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
        const response =
            await fetch(
                apiUrl(path),
                options
            );

        return lerRespostaJson(response);
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
                        'id, unidade, holding'
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

            option.textContent =
                empresa.unidade ||
                `Empresa ${empresa.id}`;

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


    // ========================================================
    // VALIDAR DATAS
    // ========================================================

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


    // ========================================================
    // BLOQUEAR BOTÃO
    // ========================================================

    if (btn) {

        btn.disabled = true;

        btn.innerHTML =
            '<i class="fas fa-spinner fa-spin me-1"></i>' +
            ' Buscando...';
    }


    if (statusEl) {

        statusEl.innerHTML =
            '<div class="alert alert-info">' +
            'Consultando dados no SOC...' +
            '</div>';
    }


    try {

        // ====================================================
        // TOKEN DO SUPABASE
        // ====================================================

        let token = '';


        if (
            typeof obterTokenESocial ===
            'function'
        ) {

            token =
                await obterTokenESocial();
        }


        // ====================================================
        // URL DA API
        // ====================================================
        //
        // Se a página estiver rodando no próprio Node :3002,
        // usa URL relativa.
        //
        // Se estiver no Live Server, força porta 3002.
        // ====================================================

        const baseUrl =
            window.location.port === '3002'
                ? ''
                : 'http://localhost:3002';


        // ====================================================
        // CONSULTAR BACKEND CORRETO
        // ====================================================

        const response =
            await fetch(

                `${baseUrl}/api/soc/buscar-dados-esocial`,

                {

                    method:
                        'POST',

                    headers: {

                        'Content-Type':
                            'application/json',

                        ...(token
                            ? {
                                Authorization:
                                    `Bearer ${token}`
                            }
                            : {})
                    },

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

                                    /*
                                     * Data da ficha/ASO
                                     */
                                    pDataIncAso:
                                        '0',

                                    /*
                                     * Mantemos o filtro
                                     * configurado para o relatório.
                                     */
                                    tpExame:
                                        '1,2,3,4,5,6'
                                }
                            }
                        })
                }
            );


        // ====================================================
        // LER RESPOSTA COM SEGURANÇA
        // ====================================================

        const textoResposta =
            await response.text();


        let result;


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


        // ====================================================
        // INFORMAÇÕES DA CONSULTA
        // ====================================================

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
            '==================================='
        );

        console.log(
            'RESULTADO BUSCA SOC:',
            result
        );

        console.log(
            'Linhas recebidas:',
            linhasRecebidas
        );

        console.log(
            'ASOs agrupados:',
            asosAgrupados
        );

        console.log(
            'Empresas consultadas:',
            empresasConsultadas
        );

        console.log(
            '==================================='
        );


        // ====================================================
        // NENHUM RESULTADO
        // ====================================================

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
        // SUCESSO
        // ====================================================

        if (statusEl) {

            statusEl.innerHTML =

                '<div class="alert alert-success">' +

                '<strong>Consulta ao SOC realizada com sucesso.</strong>' +

                '<br>' +

                `${linhasRecebidas} linha(s) recebida(s) do SOC.` +

                '<br>' +

                `${asosAgrupados} ASO(s) agrupado(s).` +

                '</div>';
        }


        // ====================================================
        // RECARREGAR EVENTOS SALVOS
        // ====================================================
        //
        // Como o backend salva os eventos no Supabase,
        // buscamos novamente a lista oficial da tabela.
        // ====================================================

        if (
            typeof carregarEventosESocial ===
            'function'
        ) {

            await carregarEventosESocial();
        }


        // ====================================================
        // FECHAR MODAL APÓS SUCESSO
        // ====================================================

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

        }, 1200);


    } catch (error) {

        console.error(
            'Erro ao buscar dados SOC:',
            error
        );


        if (statusEl) {

            statusEl.innerHTML =

                '<div class="alert alert-danger">' +

                '<strong>Erro ao consultar o SOC.</strong>' +

                '<br>' +

                error.message +

                '</div>';
        }

    } finally {

        // ====================================================
        // LIBERAR BOTÃO
        // ====================================================

        if (btn) {

            btn.disabled = false;

            btn.innerHTML =
                '<i class="fas fa-search me-1"></i>' +
                ' Buscar';
        }
    }
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
        const cpf = String(evento?.cpf || '').replace(/\D/g, '');
        const empregador = String(
            evento?.nr_insc_empregador ||
            evento?.nrInscEmpregador ||
            ''
        ).replace(/\D/g, '');

        return `${empregador}|${cpf}`;
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
            origem.includes('portal')
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

        const oficial = relacionados.find(item =>
            matriculaPareceOficialESocial(item) &&
            item.data_admissao_esocial
        ) || relacionados.find(matriculaPareceOficialESocial) || evento;

        const matriculaOficial = matriculaPareceOficialESocial(oficial)
            ? String(oficial.matricula || '').trim()
            : '';

        const dataAdmissaoEsocial = String(
            oficial.data_admissao_esocial || ''
        ).trim();

        const ultimaVerificacao = dataMaisRecenteESocial(
            relacionados.flatMap(item => [
                item.verificado_esocial_em,
                item.matricula_oficial_atualizada_em
            ])
        );

        const s2220 = resumoTipoEventoColaboradorESocial(relacionados, 'S-2220');
        const s2240 = resumoTipoEventoColaboradorESocial(relacionados, 'S-2240');

        let proximaAcao = {
            texto: 'Aguardar vínculo eSocial',
            classe: 'secondary',
            icone: 'fa-link'
        };

        if (matriculaOficial) {
            if (s2220.estado !== 'confirmado') {
                proximaAcao = s2220.estado === 'erro'
                    ? { texto: 'Corrigir S-2220', classe: 'danger', icone: 'fa-tools' }
                    : { texto: 'Concluir S-2220', classe: 'primary', icone: 'fa-heartbeat' };
            } else if (s2240.estado !== 'confirmado') {
                const s2240Atual = relacionados.find(
                    item => String(item?.tipo_evento || '').trim().toUpperCase() === 'S-2240'
                );

                proximaAcao = s2240.estado === 'erro'
                    ? { texto: 'Corrigir S-2240', classe: 'danger', icone: 'fa-tools' }
                    : s2240Atual?.s2240_pronto_para_emissao === false
                        ? { texto: 'Completar S-2240', classe: 'warning', icone: 'fa-clipboard-check' }
                        : { texto: 'Concluir S-2240', classe: 'primary', icone: 'fa-shield-alt' };
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
            dataAdmissaoEsocial,
            ultimaVerificacao,
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

            eventosESocial.length
        );


    const pagina =
        eventosESocial.slice(
            inicio,
            fim
        );


    let html =
        '';


    // ========================================================
    // EVENTOS
    // ========================================================

    pagina.forEach(
        evento => {

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

    // Somente S-2220 por enquanto
    String(
        evento.tipo_evento ||
        ''
    )
        .trim()
        .toUpperCase() ===
        'S-2220' &&

    // Backend precisa autorizar tentativa
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
                            resumoColaborador.matriculaOficial
                                ? `
                                    <span class="badge bg-success-subtle text-success-emphasis border border-success-subtle">
                                        <i class="fas fa-user-check me-1"></i>Admissão confirmada
                                    </span>
                                    <div class="small fw-semibold mt-2">
                                        ${escaparHtml(
                                            resumoColaborador.dataAdmissaoEsocial
                                                ? formatarDataExibicao(resumoColaborador.dataAdmissaoEsocial)
                                                : 'Data não informada'
                                        )}
                                    </div>
                                    <div class="small text-muted text-break" title="Matrícula oficial eSocial">
                                        ${escaparHtml(resumoColaborador.matriculaOficial)}
                                    </div>
                                `
                                : `
                                    <span class="badge bg-secondary-subtle text-secondary-emphasis border">
                                        <i class="fas fa-hourglass-half me-1"></i>Aguardando vínculo
                                    </span>
                                `
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

                    <td>${htmlBadgeResumoESocial(resumoColaborador.s2220)}</td>

                    <td>${htmlBadgeResumoESocial(resumoColaborador.s2240)}</td>

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


                            <!-- VERIFICAR MATRÍCULA / EVENTO NO E-SOCIAL -->

                            ${
    codigoTipoEvento === 'S-2220' &&
    evento.emitido_esocial !== true &&
    evento.ja_emitido !== true &&
    !temRecibo
        ? `
            <button
                type="button"
                class="
                    btn
                    btn-outline-info
                    btn-verificar-esocial
                "
                data-id="${escaparHtml(
                    evento.id
                )}"
                title="Buscar matrícula oficial no eSocial"
            >

                <i class="fas fa-search"></i>

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
    // BOTÃO VERIFICAR MATRÍCULA / EVENTO NO E-SOCIAL
    // ========================================================

    document
        .querySelectorAll(
            '.btn-verificar-esocial'
        )
        .forEach(
            btn => {

                btn.onclick =
                    handleVerificarEventoESocial;
            }
        );


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
            eventosESocial.length /
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

                container.insertBefore(
                    li,
                    nextBtn
                );
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
        return eventosESocial.find(
            evento =>
                String(evento.id) ===
                String(id)
        );
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
                    String(
                        evento.tipo_evento ||
                        ''
                    )
                        .trim()
                        .toUpperCase() !==
                    'S-2220'
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
                // SOMENTE S-2220 POR ENQUANTO
                // ================================================

                if (
                    String(
                        evento.tipo_evento ||
                        ''
                    )
                        .trim()
                        .toUpperCase() !==
                    'S-2220'
                ) {

                    return false;
                }


                // ================================================
                // BACKEND PRECISA LIBERAR EXPLICITAMENTE
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
                    // SOMENTE S-2220 POR ENQUANTO
                    // ============================================

                    if (
                        String(
                            evento.tipo_evento ||
                            ''
                        )
                            .trim()
                            .toUpperCase() !==
                        'S-2220'
                    ) {

                        return false;
                    }


                    // ============================================
                    // BACKEND PRECISA TER CLASSIFICADO
                    // COMO DISPONÍVEL PARA ENVIO
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

        /*
         * Atualiza o texto antigo do HTML,
         * que ainda falava que S-2240
         * seria buscado automaticamente.
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
                    <strong>
                        S-2240 ainda não está
                        habilitado nesta busca.
                    </strong>
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

            btnEnviarTodos.onclick =
                async function (event) {

                    event.preventDefault();

                    await enviarTodosEventos();
                };
        }


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


    // ========================================================
    // JÁ CONFIRMADO
    // ========================================================

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


    const tipoEvento =
        String(
            evento.tipo_evento ||
            ''
        )
            .trim()
            .toUpperCase();


    if (
        ![
            'S-2220',
            'S-2240'
        ].includes(
            tipoEvento
        )
    ) {

        mostrarAlertaESocial(
            'A verificação está disponível somente para S-2220 e S-2240.',
            'warning'
        );

        return;
    }


    // ========================================================
    // ESTADO DO BOTÃO
    // ========================================================

    let htmlBotaoOriginal =
        '';


    if (
        botao
    ) {

        htmlBotaoOriginal =
            botao.innerHTML;


        botao.disabled =
            true;


        botao.innerHTML = `
            <i class="fas fa-spinner fa-spin"></i>
        `;
    }


    try {

        const token =
            await obterTokenESocial();


        mostrarAlertaESocial(
            `Consultando ${evento.colaborador || 'o colaborador'} ` +
            'no eSocial de Produção...',
            'info'
        );


        const response =
            await fetch(
                apiUrl(
                    `/api/soc/sincronizar-esocial-existente/` +
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
                        JSON.stringify(
                            {}
                        )
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

                resultado = {

                    success:
                        false,

                    error:
                        texto
                };
            }
        }


        console.log(
            '🔎 Resultado verificação eSocial:',
            resultado
        );


        // ========================================================
        // EVENTO ENCONTRADO
        // ========================================================

        if (
            resultado.jaExisteNoEsocial ===
            true
        ) {

            const recibo =
                resultado
                    .eventoCorrespondente
                    ?.numeroRecibo ||
                resultado
                    .numeroReciboExistente ||
                '';


            let mensagem =
                'Evento encontrado no eSocial de Produção. ' +
                'O registro foi confirmado como Concluído.';


            if (
                recibo
            ) {

                mensagem +=
                    ` Recibo: ${recibo}`;
            }


            mostrarAlertaESocial(
                mensagem,
                'success'
            );


            await recarregarEventosESocial();


            return;
        }


        // ========================================================
        // VERIFICAÇÃO COMPLETA E NÃO ENCONTROU
        // ========================================================

        if (
            resultado.success ===
                true &&
            resultado.verificacaoCompleta ===
                true &&
            resultado.jaExisteNoEsocial ===
                false
        ) {

            const matriculaBx =
                resultado
                    .vinculoTrabalhista
                    ?.matricula ||
                '';


            const matriculaAlterada =
                resultado
                    .vinculoTrabalhista
                    ?.alterada ===
                true;


            let mensagem =
                'Verificação concluída. ' +
                'O evento não foi encontrado no eSocial de Produção.';


            if (
                matriculaBx
            ) {

                mensagem +=
                    ` Matrícula oficial confirmada no eSocial: ${matriculaBx}.`;
            }


            if (
                matriculaAlterada
            ) {

                mensagem +=
                    ' O evento local foi atualizado e será gerado novamente antes do envio.';
            }

            mostrarAlertaESocial(
                mensagem,
                'warning'
            );


            await recarregarEventosESocial();


            return;
        }


        // ========================================================
        // IDENTIFICAR INDISPONIBILIDADE DO SERVIÇO BX
        // ========================================================

        const erroCompleto =
            String(
                resultado.error ||
                resultado.descResposta ||
                resultado.motivoBloqueio ||
                ''
            );


        const erroNormalizado =
            erroCompleto
                .toLowerCase();


        const servicoIndisponivel =
            response.status >=
                500 ||

            erroNormalizado.includes(
                'configuration error'
            ) ||

            erroNormalizado.includes(
                'environmentsettings.config'
            ) ||

            erroNormalizado.includes(
                'retornou html em vez de xml'
            ) ||

            erroNormalizado.includes(
                'server error'
            );


        if (
            servicoIndisponivel
        ) {

            mostrarAlertaESocial(
                'O serviço de consulta do eSocial está indisponível no momento. ' +
                'O evento continuará como "Aguardando verificação" e ' +
                'não poderá ser enviado até conseguirmos confirmar sua situação.',
                'warning'
            );


            return;
        }


        // ========================================================
        // OUTRA FALHA NA VERIFICAÇÃO
        // ========================================================

        mostrarAlertaESocial(
            'Não foi possível confirmar a situação deste evento. ' +
            'Ele continuará como "Aguardando verificação" e não será enviado.',
            'warning'
        );


    } catch (
        error
    ) {

        console.error(
            '❌ Erro verificando evento no eSocial:',
            error
        );


        mostrarAlertaESocial(
            'Não foi possível acessar o serviço de consulta do eSocial. ' +
            'O evento continuará como "Aguardando verificação".',
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
            // BOTÃO DE VERIFICAÇÃO
            // ====================================================

            const tipo =
                String(
                    evento.tipo_evento ||
                    ''
                )
                    .trim()
                    .toUpperCase();


            const erroMatricula =
                String(
                    evento.erro_esocial ||
                    evento.codigo_erro_esocial ||
                    ''
                ).includes(
                    '1557'
                );


            const aguardando =
                evento.aguardando_verificacao ===
                    true ||
                evento.status ===
                    'aguardando_verificacao' ||
                erroMatricula ||
                (
                    tipo === 'S-2220' &&
                    evento.emitido_esocial !== true &&
                    evento.ja_emitido !== true &&
                    !evento.numero_recibo
                );


            if (
                aguardando &&
                [
                    'S-2220',
                    'S-2240'
                ].includes(
                    tipo
                )
            ) {

                let btnVerificar =
                    linha.querySelector(
                        '.btn-verificar-esocial'
                    );


                if (
                    !btnVerificar
                ) {

                    btnVerificar =
                        document.createElement(
                            'button'
                        );


                    btnVerificar.type =
                        'button';


                    btnVerificar.className =
                        'btn btn-outline-info btn-verificar-esocial';


                    btnVerificar.dataset.id =
                        id;


                    btnVerificar.title =
                        erroMatricula
                            ? 'Buscar matrícula oficial no eSocial'
                            : 'Verificar no eSocial';


                    btnVerificar.innerHTML =
                        '<i class="fas fa-search"></i>';


                    btnAso.insertAdjacentElement(
                        'afterend',
                        btnVerificar
                    );
                }


                btnVerificar.onclick =
                    handleVerificarEventoESocial;
            }
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