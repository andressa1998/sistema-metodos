'use strict';

// ============================================================
// src/routes/soc-integration.js
// Integração SOC - Exporta Dados / eSocial
// ============================================================

const express = require('express');
const soap = require('soap');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');
const https = require('https');
const {
    SignedXml
} = require('xml-crypto');
const {
    DOMParser,
    XMLSerializer
} = require('@xmldom/xmldom');
const {
    validarXmlS2220ContraXsd
} = require('../services/esocial-xsd');

// ============================================================
// VARIÁVEIS DE AMBIENTE
// ============================================================

function env(name, fallback = '') {
    const value = process.env[name];

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return fallback;
    }

    return String(value).trim();
}


function envNumber(name, fallback) {
    const value = Number(
        env(name)
    );

    return (
        Number.isFinite(value) &&
        value > 0
    )
        ? value
        : fallback;
}


function envJson(name, fallback = {}) {
    const value =
        env(name);

    if (!value) {
        return fallback;
    }

    try {

        const parsed =
            JSON.parse(value);

        return (
            parsed &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed)
        )
            ? parsed
            : fallback;

    } catch (error) {

        console.warn(
            `⚠️ ${name} não contém JSON válido.`
        );

        return fallback;
    }
}


// ============================================================
// CONFIGURAÇÃO SOC
// ============================================================

const SOC_CONFIG = {

    endpoint:
        env(
            'SOC_WS_URL',
            'https://ws1.soc.com.br/WSSoc/services/ExportaDadosWs'
        ),

    wsdl:
        env(
            'SOC_WSDL_URL',
            'https://ws1.soc.com.br/WSSoc/services/ExportaDadosWs?wsdl'
        ),

    username:
        env(
            'SOC_WS_USERNAME'
        ),

    password:
        env(
            'SOC_WS_PASSWORD'
        ),

    empresaPrincipal:
        env(
            'SOC_EMPRESA_PRINCIPAL'
        ),

    tipoSaida:
        env(
            'SOC_TIPO_SAIDA',
            'json'
        ),

    timeout:
        envNumber(
            'SOC_TIMEOUT_MS',
            60000
        ),

    parametrosFixos:
        envJson(
            'SOC_PARAMETROS_FIXOS_JSON',
            {}
        )
};


// ============================================================
// EXTRAÇÕES DO PROGRAMA 733
// ============================================================

const SOC_EXTRACOES = {

    teste: {

        codigo:
            env(
                'SOC_EXPORTA_TESTE_CODIGO'
            ),

        chave:
            env(
                'SOC_EXPORTA_TESTE_CHAVE'
            )
    },


    aso: {

        codigo:
            env(
                'SOC_EXPORTA_ASO_CODIGO'
            ),

        chave:
            env(
                'SOC_EXPORTA_ASO_CHAVE'
            )
    },

    ged: {

    codigo:
        env(
            'SOC_EXPORTA_GED_CODIGO'
        ),

    chave:
        env(
            'SOC_EXPORTA_GED_CHAVE'
        )
},


    funcionarios: {

        codigo:
            env(
                'SOC_EXPORTA_FUNCIONARIOS_CODIGO'
            ),

        chave:
            env(
                'SOC_EXPORTA_FUNCIONARIOS_CHAVE'
            )
    },


    s2220: {

        codigo:
            env(
                'SOC_EXPORTA_S2220_CODIGO'
            ),

        chave:
            env(
                'SOC_EXPORTA_S2220_CHAVE'
            )
    },

        eventosesocial: {

    codigo:
        env(
            'SOC_EXPORTA_EVENTOS_ESOCIAL_CODIGO'
        ),

    chave:
        env(
            'SOC_EXPORTA_EVENTOS_ESOCIAL_CHAVE'
        )
},


    s2240: {

        codigo:
            env(
                'SOC_EXPORTA_S2240_CODIGO'
            ),

        chave:
            env(
                'SOC_EXPORTA_S2240_CHAVE'
            )
    }
};


// ============================================================
// SUPABASE
// ============================================================

let supabaseClient =
    null;


function getSupabase() {

    if (supabaseClient) {

        return supabaseClient;
    }


    const supabaseUrl =
        env(
            'SUPABASE_URL'
        );


    const supabaseKey =
        env(
            'SUPABASE_SERVICE_ROLE_KEY'
        );


    if (
        !supabaseUrl ||
        !supabaseKey
    ) {

        throw new Error(
            'Supabase não configurado. ' +
            'Defina SUPABASE_URL e ' +
            'SUPABASE_SERVICE_ROLE_KEY no .env.'
        );
    }


    supabaseClient =
        createClient(
            supabaseUrl,
            supabaseKey,
            {
                auth: {

                    persistSession:
                        false,

                    autoRefreshToken:
                        false
                }
            }
        );


    return supabaseClient;
}


// ============================================================
// ERROS / CONFIGURAÇÃO
// ============================================================

class SocResponseError extends Error {

    constructor(message) {

        super(message);

        this.name =
            'SocResponseError';

        this.socReached =
            true;
    }
}


function validarConfiguracaoSoc() {

    const faltando =
        [];


    if (
        !SOC_CONFIG.username
    ) {

        faltando.push(
            'SOC_WS_USERNAME'
        );
    }


    if (
        !SOC_CONFIG.password
    ) {

        faltando.push(
            'SOC_WS_PASSWORD'
        );
    }


    if (
        !SOC_CONFIG.empresaPrincipal
    ) {

        faltando.push(
            'SOC_EMPRESA_PRINCIPAL'
        );
    }


    if (
        faltando.length
    ) {

        throw new Error(
            'Configuração SOC incompleta: ' +
            faltando.join(', ')
        );
    }
}


function extracaoConfigurada(
    tipo
) {

    const nome =
        String(
            tipo || ''
        )
            .trim()
            .toLowerCase();


    const extracao =
        SOC_EXTRACOES[
            nome
        ];


    return Boolean(
        extracao?.codigo &&
        extracao?.chave
    );
}


function obterExtracao(
    tipo
) {

    const nome =
        String(
            tipo || ''
        )
            .trim()
            .toLowerCase();


    const extracao =
        SOC_EXTRACOES[
            nome
        ];


    if (!extracao) {

        throw new Error(
            `Extração inválida: "${tipo}".`
        );
    }


    if (
        !extracao.codigo ||
        !extracao.chave
    ) {

        throw new Error(
            `Extração "${nome}" não configurada. ` +
            `Preencha SOC_EXPORTA_${nome.toUpperCase()}_CODIGO e ` +
            `SOC_EXPORTA_${nome.toUpperCase()}_CHAVE no .env.`
        );
    }


    return extracao;
}


function obterExtracaoDeTeste() {

    const ordem = [

        'teste',

        's2220',

        'aso',

        'funcionarios',

        's2240'
    ];


    for (
        const tipo
        of ordem
    ) {

        if (
            extracaoConfigurada(
                tipo
            )
        ) {

            return {

                tipo,

                ...SOC_EXTRACOES[
                    tipo
                ]
            };
        }
    }


    return null;
}


// ============================================================
// SOAP
// ============================================================

let socClientPromise =
    null;


async function getSocClient() {

    validarConfiguracaoSoc();


    if (
        !socClientPromise
    ) {

        socClientPromise =
            soap

                .createClientAsync(
                    SOC_CONFIG.wsdl,
                    {
                        endpoint:
                            SOC_CONFIG.endpoint,

                        disableCache:
                            true,

                        wsdl_options: {

                            timeout:
                                SOC_CONFIG.timeout
                        }
                    }
                )

                .then(
                    client => {

                        client.setEndpoint(
                            SOC_CONFIG.endpoint
                        );


                        client.setSecurity(
                            new soap.WSSecurity(
                                SOC_CONFIG.username,
                                SOC_CONFIG.password,
                                {
                                    passwordType:
                                        'PasswordDigest',

                                    hasTimeStamp:
                                        true,

                                    hasNonce:
                                        true,

                                    mustUnderstand:
                                        true
                                }
                            )
                        );


                        return client;
                    }
                )

                .catch(
                    error => {

                        socClientPromise =
                            null;

                        throw error;
                    }
                );
    }


    return socClientPromise;
}


// ============================================================
// INTERPRETAR RETORNO SOAP
// ============================================================

function parsePossivelJson(
    value
) {

    if (
        value === undefined ||
        value === null
    ) {

        return null;
    }


    if (
        typeof value !==
        'string'
    ) {

        return value;
    }


    let text =
        value.trim();


    if (!text) {

        return null;
    }


    for (
        let tentativa = 0;
        tentativa < 2;
        tentativa++
    ) {

        try {

            const parsed =
                JSON.parse(
                    text
                );


            if (
                typeof parsed ===
                'string'
            ) {

                text =
                    parsed.trim();

                continue;
            }


            return parsed;

        } catch (error) {

            return text;
        }
    }


    return text;
}


function valorBooleanoSoc(
    value
) {

    if (
        value === true
    ) {

        return true;
    }


    return (
        String(value)
            .trim()
            .toLowerCase()
        ===
        'true'
    );
}


function interpretarRetornoSoap(
    result
) {

    const primeiraResposta =
        Array.isArray(
            result
        )
            ? result[0]
            : result;


    const retorno =

        primeiraResposta?.return ??

        primeiraResposta?.result ??

        primeiraResposta?.resultado ??

        primeiraResposta;


    if (
        retorno === undefined ||
        retorno === null
    ) {

        throw new SocResponseError(
            'O SOC respondeu sem conteúdo.'
        );
    }


    if (
        typeof retorno ===
            'object' &&
        !Array.isArray(
            retorno
        )
    ) {

        const possuiErro =

            retorno.erro ??

            retorno.error ??

            retorno.temErro ??

            false;


        if (
            valorBooleanoSoc(
                possuiErro
            )
        ) {

            throw new SocResponseError(

                retorno.mensagemErro ||

                retorno.mensagem ||

                retorno.message ||

                'O SOC informou erro ao executar o Exporta Dados.'
            );
        }


        const payload =

            retorno.retorno ??

            retorno.dados ??

            retorno.resultado ??

            retorno.result ??

            retorno;


        return parsePossivelJson(
            payload
        );
    }


    return parsePossivelJson(
        retorno
    );
}


function formatarErro(
    error
) {

    const fault =

        error?.root
            ?.Envelope
            ?.Body
            ?.Fault

        ||

        error?.root
            ?.Envelope
            ?.Body
            ?.fault;


    const responseBody =

        error?.response?.data ||

        error?.body ||

        null;


    const faultMessage =

        fault?.faultstring ||

        fault?.Reason?.Text ||

        fault?.reason?.text;


    return {

        message:

            faultMessage ||

            error?.message ||

            'Erro desconhecido ao acessar o SOC.',


        code:
            error?.code ||
            null,


        httpStatus:
            error?.response?.status ||
            null,


        socReached:
            Boolean(
                error?.socReached ||
                error?.response ||
                error?.root
            ),


        fault:
            fault ||
            null,


        response:
            typeof responseBody ===
                'string'
                ? responseBody.slice(
                    0,
                    6000
                )
                : responseBody
    };
}


// ============================================================
// DATAS / CAMPOS
// ============================================================

function converterDataParaSoc(
    value
) {

    const text =
        String(
            value || ''
        ).trim();


    if (!text) {

        return '';
    }


    if (
        /^\d{2}\/\d{2}\/\d{4}$/
            .test(
                text
            )
    ) {

        return text;
    }


    const iso =
        text.match(
            /^(\d{4})-(\d{2})-(\d{2})$/
        );


    if (iso) {

        return (
            `${iso[3]}/` +
            `${iso[2]}/` +
            `${iso[1]}`
        );
    }


    return text;
}


function normalizarData(
    value
) {

    const text =
        String(
            value || ''
        ).trim();


    if (!text) {

        return '';
    }


    const brasileira =
        text.match(
            /^(\d{2})\/(\d{2})\/(\d{4})/
        );


    if (
        brasileira
    ) {

        return (
            `${brasileira[3]}-` +
            `${brasileira[2]}-` +
            `${brasileira[1]}`
        );
    }


    const iso =
        text.match(
            /^(\d{4})-(\d{2})-(\d{2})/
        );


    if (iso) {

        return (
            `${iso[1]}-` +
            `${iso[2]}-` +
            `${iso[3]}`
        );
    }


    return text;
}


function primeiroCampo(
    objeto,
    nomes,
    fallback = ''
) {

    if (
        !objeto ||
        typeof objeto !==
            'object'
    ) {

        return fallback;
    }


    for (
        const nome
        of nomes
    ) {

        const value =
            objeto[
                nome
            ];


        if (
            value !== undefined &&
            value !== null &&
            value !== ''
        ) {

            return value;
        }
    }


    const campos =
        new Map(

            Object.entries(
                objeto
            )

                .map(
                    (
                        [
                            key,
                            value
                        ]
                    ) => [

                        key
                            .toLowerCase(),

                        value
                    ]
                )
        );


    for (
        const nome
        of nomes
    ) {

        const value =
            campos.get(
                String(
                    nome
                ).toLowerCase()
            );


        if (
            value !== undefined &&
            value !== null &&
            value !== ''
        ) {

            return value;
        }
    }


    return fallback;
}


function normalizarCpf(
    value
) {

    return String(
        value || ''
    )
        .replace(
            /\D/g,
            ''
        );
}


function normalizarCnpj(
    value
) {

    return String(
        value || ''
    )
        .replace(
            /\D/g,
            ''
        );
}


function texto(
    value
) {

    return String(
        value ?? ''
    )
        .trim();
}


// ============================================================
// EXPORTA DADOS
// ============================================================

function montarParametrosExportaDados({
    codigo,
    chave,
    empresa,
    empresaTrabalho,
    filtros = {}
}) {

    if (
        !codigo ||
        !chave
    ) {

        throw new Error(
            'Código e chave do Exporta Dados são obrigatórios.'
        );
    }


    const filtrosValidos =
        filtros &&
        typeof filtros ===
            'object' &&
        !Array.isArray(
            filtros
        )
            ? filtros
            : {};


    const empresaConsulta =
        String(
            empresa ||
            SOC_CONFIG
                .empresaPrincipal ||
            ''
        ).trim();


    if (
        !empresaConsulta
    ) {

        throw new Error(
            'Nenhuma empresa SOC foi informada para a consulta.'
        );
    }


    const parametros = {

        ...SOC_CONFIG
            .parametrosFixos,

        ...filtrosValidos,

        empresa:
            empresaConsulta,

        codigo:
            String(
                codigo
            ).trim(),

        chave:
            String(
                chave
            ).trim(),

        tipoSaida:
            SOC_CONFIG.tipoSaida ||
            'json'
    };


    if (
        empresaTrabalho !== undefined &&
        empresaTrabalho !== null &&
        String(
            empresaTrabalho
        ).trim() !== ''
    ) {

        parametros
            .empresaTrabalho =
            String(
                empresaTrabalho
            ).trim();
    }


    return parametros;
}


async function exportarDadosSoc({
    codigo,
    chave,
    empresa,
    empresaTrabalho,
    filtros = {}
}) {

    const client =
        await getSocClient();


    if (
        typeof client
            .exportaDadosWsAsync
        !==
        'function'
    ) {

        const metodos =
            Object.keys(
                client
            )

                .filter(
                    key =>
                        typeof client[
                            key
                        ] ===
                        'function'
                )

                .filter(
                    key =>
                        key
                            .toLowerCase()
                            .includes(
                                'exporta'
                            )
                );


        throw new Error(
            'O método exportaDadosWs não foi encontrado no WSDL. ' +
            `Métodos encontrados: ${metodos.join(', ') || 'nenhum'}.`
        );
    }


    const parametros =
        montarParametrosExportaDados({
            codigo,
            chave,
            empresa,
            empresaTrabalho,
            filtros
        });


    console.log(
        '📤 Consultando SOC:',
        {
            codigo:
                String(
                    codigo
                ),

            empresa:
                parametros
                    .empresa,

            empresaTrabalho:
                parametros
                    .empresaTrabalho ||
                null,

            tipoSaida:
                parametros
                    .tipoSaida
        }
    );


    const argumentos = {

        arg0: {

            parametros:
                JSON.stringify(
                    parametros
                )
        }
    };


    const result =
        await client
            .exportaDadosWsAsync(
                argumentos,
                {
                    timeout:
                        SOC_CONFIG
                            .timeout
                }
            );


    const dados =
        interpretarRetornoSoap(
            result
        );


    console.log(
        '📥 Resposta recebida do SOC.'
    );


    return dados;
}


function localizarArray(
    value,
    profundidade = 0
) {

    if (
        profundidade > 8 ||
        value === undefined ||
        value === null
    ) {

        return [];
    }


    if (
        Array.isArray(
            value
        )
    ) {

        return value;
    }


    if (
        typeof value ===
        'string'
    ) {

        const parsed =
            parsePossivelJson(
                value
            );


        if (
            parsed === value
        ) {

            return [];
        }


        return localizarArray(
            parsed,
            profundidade + 1
        );
    }


    if (
        typeof value !==
        'object'
    ) {

        return [];
    }


    const chavesPreferidas = [

        'dados',

        'registros',

        'itens',

        'items',

        'rows',

        'resultado',

        'result',

        'retorno',

        'funcionarios',

        'eventos'
    ];


    for (
        const nome
        of chavesPreferidas
    ) {

        const chaveEncontrada =
            Object.keys(
                value
            )
                .find(
                    key =>
                        key
                            .toLowerCase()
                        ===
                        nome
                            .toLowerCase()
                );


        if (
            !chaveEncontrada
        ) {

            continue;
        }


        const resultado =
            localizarArray(
                value[
                    chaveEncontrada
                ],
                profundidade + 1
            );


        if (
            resultado.length >
            0
        ) {

            return resultado;
        }
    }


    for (
        const item
        of Object.values(
            value
        )
    ) {

        if (
            Array.isArray(
                item
            )
        ) {

            return item;
        }
    }


    return [
        value
    ];
}


async function buscarEmpresasSupabase({
    holding,
    empresaId
} = {}) {

    let query =
        getSupabase()
            .from('precos')
            .select(
                [
                    'id',
                    'unidade',
                    'holding',
                    'cnpj',
                    'razao_social',
                    'codigo_soc',

                    // Configuração eSocial por unidade
                    'tp_insc_empregador_esocial',
                    'nr_insc_empregador_esocial',
                    'esocial_autorizado'
                ].join(', ')
            )
            .order(
                'unidade'
            );


    if (
        holding
    ) {

        query =
            query.eq(
                'holding',
                holding
            );
    }


    if (
        empresaId
    ) {

        query =
            query.eq(
                'id',
                empresaId
            );
    }


    const {
        data,
        error
    } =
        await query;


    if (
        error
    ) {

        throw error;
    }


    return Array.isArray(
        data
    )
        ? data
        : [];
}


function criarIndiceEmpresas(
    empresas
) {

    const porId =
        new Map();

    const porCodigoSoc =
        new Map();

    const porCnpj =
        new Map();

    const porCnpjBase =
        new Map();


    for (
        const empresa
        of empresas || []
    ) {

        if (
            empresa.id !==
                undefined &&
            empresa.id !==
                null
        ) {

            porId.set(
                String(
                    empresa.id
                ).trim(),
                empresa
            );
        }


        const codigoSoc =
            String(
                empresa.codigo_soc ||
                ''
            ).trim();


        if (
            codigoSoc &&
            !porCodigoSoc.has(
                codigoSoc
            )
        ) {

            porCodigoSoc.set(
                codigoSoc,
                empresa
            );
        }


        const cnpj =
            normalizarCnpj(
                empresa.cnpj
            );


        if (
            cnpj
        ) {

            porCnpj.set(
                cnpj,
                empresa
            );


            const cnpjBase =
                cnpj.substring(
                    0,
                    8
                );


            if (
                cnpjBase
            ) {

                porCnpjBase.set(
                    cnpjBase,
                    empresa
                );
            }
        }
    }


    return {
        porId,
        porCodigoSoc,
        porCnpj,
        porCnpjBase
    };
}


function localizarEmpresaDoRegistro(
    registro,
    indiceEmpresas
) {

    if (
        !indiceEmpresas
    ) {

        return null;
    }


    const inscricaoUnidade =
        normalizarCnpj(
            primeiroCampo(
                registro,
                [
                    'NRINSCEMPRESAUNIDADE',
                    'NRINSCUNIDADE',
                    'nrInscEmpresaUnidade'
                ],
                ''
            )
        );


    if (
        inscricaoUnidade
    ) {

        const baseUnidade =
            inscricaoUnidade
                .substring(
                    0,
                    8
                );


        const porBase =
            indiceEmpresas
                .porCnpjBase
                ?.get(
                    baseUnidade
                );


        if (
            porBase
        ) {

            return porBase;
        }


        const porCnpj =
            indiceEmpresas
                .porCnpj
                ?.get(
                    inscricaoUnidade
                );


        if (
            porCnpj
        ) {

            return porCnpj;
        }
    }


    const codigoEmpresaSoc =
        texto(
            primeiroCampo(
                registro,
                [
                    'CODIGOEMPRESA',
                    'codigoEmpresa',
                    'codEmpresa'
                ],
                ''
            )
        );


    if (
        codigoEmpresaSoc
    ) {

        const porSoc =
            indiceEmpresas
                .porCodigoSoc
                ?.get(
                    codigoEmpresaSoc
                );


        if (
            porSoc
        ) {

            return porSoc;
        }


        const porId =
            indiceEmpresas
                .porId
                ?.get(
                    codigoEmpresaSoc
                );


        if (
            porId
        ) {

            return porId;
        }
    }


    return null;
}

async function baixarEventosBxUmPorUm({
    tpInsc,
    nrInsc,
    identificadores,
    eventoLocal,
    maxDownloads = 8
}) {

    const listaOriginal =
        Array.isArray(
            identificadores
        )
            ? identificadores
            : [];


    /*
     * Fazemos uma cópia.
     *
     * Não alteramos o array original retornado pela consulta.
     */

    const lista =
        [
            ...listaOriginal
        ];


    const eventosInterpretados =
        [];


    const falhas =
        [];


    const idsTentados =
        [];


    const recibosTentados =
        [];


    let correspondente =
        null;


    let interrompidoPorCorrespondencia =
        false;


    // ========================================================
    // LIMITE
    // ========================================================

    const limite =
        Math.min(
            lista.length,
            Math.max(
                0,
                Number(
                    maxDownloads
                ) || 0
            )
        );


    // ========================================================
    // PROCESSAR UM DE CADA VEZ
    // ========================================================

    for (
        let indice = 0;
        indice < limite;
        indice++
    ) {

        const identificador =
            lista[
                indice
            ];


        const idEvento =
            String(
                identificador?.id ||
                ''
            ).trim();


        const numeroRecibo =
            String(
                identificador?.nrRec ||
                ''
            ).trim();


        if (
            !idEvento &&
            !numeroRecibo
        ) {

            falhas.push({

                idEvento:
                    null,

                numeroRecibo:
                    null,

                metodo:
                    null,

                cdResposta:
                    null,

                descResposta:
                    'Identificador sem ID e sem recibo.'
            });


            continue;
        }


        // ====================================================
        // NÃO DISPARAR REQUISIÇÕES COLADAS
        //
        // O Webservice não permite paralelismo.
        // Além disso, observamos comportamento instável quando
        // fazemos várias solicitações imediatamente seguidas.
        // ====================================================

        if (
            indice > 0
        ) {

            console.log(
                '⏳ Aguardando 2,5 segundos antes do próximo download BX...'
            );


            await aguardarEntreChamadasBx(
                2500
            );
        }


        let download;


        let metodoUtilizado;


        try {

            // ==================================================
            // PRIORIDADE: NÚMERO DO RECIBO
            //
            // A própria consulta de identificadores devolve
            // obrigatoriamente nrRec.
            // ==================================================

            if (
                numeroRecibo
            ) {

                metodoUtilizado =
                    'recibo';


                recibosTentados.push(
                    numeroRecibo
                );


                if (
                    idEvento
                ) {

                    idsTentados.push(
                        idEvento
                    );
                }


                console.log(
                    `📥 BX ${indice + 1}/${limite} - download pelo RECIBO:`,
                    {
                        idEvento,
                        numeroRecibo
                    }
                );


                download =
                    await solicitarDownloadEventosPorNrReciboBx({

                        tpInsc,

                        nrInsc,

                        recibos: [
                            numeroRecibo
                        ]
                    });


            } else {

                // ==================================================
                // FALLBACK:
                // SOMENTE SE NÃO EXISTIR RECIBO
                // ==================================================

                metodoUtilizado =
                    'id';


                idsTentados.push(
                    idEvento
                );


                console.log(
                    `📥 BX ${indice + 1}/${limite} - download pelo ID:`,
                    idEvento
                );


                download =
                    await solicitarDownloadEventosPorIdBx({

                        tpInsc,

                        nrInsc,

                        ids: [
                            idEvento
                        ]
                    });
            }


            // ==================================================
            // SOAP FAULT
            // ==================================================

            if (
                download?.soapFault
            ) {

                falhas.push({

                    idEvento:
                        idEvento ||
                        null,

                    numeroRecibo:
                        numeroRecibo ||
                        null,

                    metodo:
                        metodoUtilizado,

                    cdResposta:
                        null,

                    descResposta:
                        download.faultString ||
                        'SOAP Fault no download.'
                });


                continue;
            }


            const cdResposta =
                String(
                    download?.cdResposta ||
                    ''
                ).trim();


            // ==================================================
            // NÃO FAZEMOS RETRY AUTOMÁTICO
            //
            // Cada nova chamada consome o limite diário BX.
            // ==================================================

            if (
                cdResposta !==
                '201'
            ) {

                falhas.push({

                    idEvento:
                        idEvento ||
                        null,

                    numeroRecibo:
                        numeroRecibo ||
                        null,

                    metodo:
                        metodoUtilizado,

                    cdResposta,

                    descResposta:
                        download?.descResposta ||
                        'Download não concluído.'
                });


                continue;
            }


            const arquivos =
                Array.isArray(
                    download?.arquivos
                )
                    ? download.arquivos
                    : [];


            if (
                !arquivos.length
            ) {

                falhas.push({

                    idEvento:
                        idEvento ||
                        null,

                    numeroRecibo:
                        numeroRecibo ||
                        null,

                    metodo:
                        metodoUtilizado,

                    cdResposta,

                    descResposta:
                        'eSocial respondeu 201, mas nenhum arquivo foi retornado.'
                });


                continue;
            }


            const interpretadosNesteDownload =
                [];


            // ==================================================
            // INTERPRETAR ARQUIVOS
            // ==================================================

            for (
                const arquivo
                of arquivos
            ) {

                const cdArquivo =
                    String(
                        arquivo?.cdResposta ||
                        ''
                    ).trim();


                if (
                    cdArquivo &&
                    cdArquivo !==
                        '201'
                ) {

                    continue;
                }


                if (
                    !arquivo?.xmlEvento
                ) {

                    continue;
                }


                const interpretado =
                    interpretarEventoBaixadoBx({

                        ...arquivo,

                        idEvento:
                            arquivo.idEvento ||
                            idEvento ||
                            '',

                        numeroRecibo:
                            arquivo.numeroRecibo ||
                            numeroRecibo ||
                            ''
                    });


                if (
                    !interpretado
                ) {

                    continue;
                }


                interpretadosNesteDownload.push(
                    interpretado
                );


                eventosInterpretados.push(
                    interpretado
                );
            }


            // ==================================================
            // SALVAR CACHE
            // ==================================================

            if (
                interpretadosNesteDownload.length
            ) {

                await salvarEventosBxNoBanco(
                    interpretadosNesteDownload
                );
            }


            // ==================================================
            // PROCURAR CORRESPONDÊNCIA
            // ==================================================

            correspondente =
                interpretadosNesteDownload.find(
                    item =>
                        item.tipoEvento !==
                            'S-3000' &&
                        eventoBxCorrespondeAoEventoLocal(
                            eventoLocal,
                            item
                        )
                ) ||
                null;


            if (
                correspondente
            ) {

                console.log(
                    '🚫 EVENTO JÁ EXISTE NO eSOCIAL:',
                    {
                        tipoEvento:
                            correspondente.tipoEvento,

                        idEvento:
                            correspondente.idEvento,

                        numeroRecibo:
                            correspondente.numeroRecibo,

                        cpf:
                            correspondente.cpf,

                        matricula:
                            correspondente.matricula,

                        dataReferencia:
                            correspondente.dataReferencia
                    }
                );


                interrompidoPorCorrespondencia =
                    true;


                break;
            }


        } catch (
            error
        ) {

            console.error(
                '❌ Erro no download BX individual:',
                {
                    idEvento,

                    numeroRecibo,

                    metodo:
                        metodoUtilizado,

                    error:
                        error?.message ||
                        String(
                            error
                        )
                }
            );


            falhas.push({

                idEvento:
                    idEvento ||
                    null,

                numeroRecibo:
                    numeroRecibo ||
                    null,

                metodo:
                    metodoUtilizado ||
                    null,

                cdResposta:
                    null,

                descResposta:
                    error?.message ||
                    String(
                        error
                    )
            });
        }
    }


    // ========================================================
    // VERIFICAÇÃO COMPLETA
    // ========================================================

    const todosProcessados =
        !interrompidoPorCorrespondencia &&
        limite >= lista.length &&
        falhas.length === 0;


    return {

        correspondente,

        eventosInterpretados,

        falhas,

        idsTentados,

        recibosTentados,

        quantidadeIdsRecebidos:
            lista.length,

        quantidadeIdsTentados:
            idsTentados.length,

        quantidadeRecibosTentados:
            recibosTentados.length,

        interrompidoPorCorrespondencia,

        todosProcessados
    };
}


// ============================================================
// S-2220 - FILTROS / AGRUPAMENTO
// ============================================================

function traduzirTipoExameOcupacional(
    value
) {

    const tipos = {

        '0':
            'Admissional',

        '1':
            'Periódico',

        '2':
            'Retorno ao Trabalho',

        '3':
            'Mudança de Função/Risco Ocupacional',

        '4':
            'Monitoração Pontual',

        '9':
            'Demissional'
    };


    const codigo =
        String(
            value ?? ''
        ).trim();


    if (
        !codigo
    ) {

        return 'Não informado';
    }


    return (
        tipos[
            codigo
        ] ||
        `Tipo ${codigo}`
    );
}


function montarFiltrosS2220({
    dataInicio,
    dataFim,
    extrasComuns = {},
    extrasS2220 = {}
}) {

    return {

        funcionarioInicio:
            '0',

        funcionarioFim:
            '9999999999',

        pFuncionario:
            '0',

        funcionario:
            '0',

        dataInicio:
            converterDataParaSoc(
                dataInicio
            ),

        dataFim:
            converterDataParaSoc(
                dataFim
            ),

        pDataIncAso:
            '0',

        tpExame:
            '1,2,3,4,5,6',


        ...(
            extrasComuns &&
            typeof extrasComuns ===
                'object'
                ? extrasComuns
                : {}
        ),


        ...(
            extrasS2220 &&
            typeof extrasS2220 ===
                'object'
                ? extrasS2220
                : {}
        )
    };
}


function criarChaveAsoS2220(
    registro
) {

    const codigoEmpresa =
        texto(
            primeiroCampo(
                registro,
                [
                    'CODIGOEMPRESA',
                    'codigoEmpresa'
                ],
                ''
            )
        );


    const cpf =
        normalizarCpf(
            primeiroCampo(
                registro,
                [
                    'CPFTRAB',
                    'cpfTrab',
                    'cpf'
                ],
                ''
            )
        );


    const codigoFuncionario =
        texto(
            primeiroCampo(
                registro,
                [
                    'CODIGOFUNCIONARIO',
                    'codigoFuncionario'
                ],
                ''
            )
        );


    const idFicha =
        texto(
            primeiroCampo(
                registro,
                [
                    'IDFICHA',
                    'idFicha'
                ],
                ''
            )
        );


    const dataAso =
        texto(
            primeiroCampo(
                registro,
                [
                    'DTASO',
                    'DATAFICHA',
                    'DTEXAME'
                ],
                ''
            )
        );


    const tipo =
        texto(
            primeiroCampo(
                registro,
                [
                    'TPEXAMEOCUP',
                    'tpExameOcup'
                ],
                ''
            )
        );


    const identificadorPessoa =
        cpf ||
        codigoFuncionario;


    const identificadorFicha =
        idFicha ||
        `${dataAso}|${tipo}`;


    if (
        !codigoEmpresa &&
        !identificadorPessoa &&
        !identificadorFicha
    ) {

        return '';
    }


    return [

        codigoEmpresa,

        identificadorPessoa,

        identificadorFicha

    ].join(
        '|'
    );
}


function extrairExameS2220(
    registro
) {

    const descricao =
        texto(
            primeiroCampo(
                registro,
                [
                    'DESCRICAOEXAME',
                    'descricaoExame'
                ],
                ''
            )
        );


    const data =
        normalizarData(
            primeiroCampo(
                registro,
                [
                    'DTEXAME',
                    'dtExame'
                ],
                ''
            )
        );


    const procedimento =
        texto(
            primeiroCampo(
                registro,
                [
                    'PROCREALIZADO',
                    'procRealizado'
                ],
                ''
            )
        );


    const ordem =
        texto(
            primeiroCampo(
                registro,
                [
                    'ORDEMEXAME',
                    'ordemExame'
                ],
                ''
            )
        );


    const observacao =
        texto(
            primeiroCampo(
                registro,
                [
                    'OBSPROC',
                    'obsProc'
                ],
                ''
            )
        );


    const tipoExame =
        texto(
            primeiroCampo(
                registro,
                [
                    'TPEXAME',
                    'tpExame'
                ],
                ''
            )
        );


    const resultadoAlteradoNormal =
        texto(
            primeiroCampo(
                registro,
                [
                    'INDRESULTADOALTNORMAL'
                ],
                ''
            )
        );


    const resultadoAgravamento =
        texto(
            primeiroCampo(
                registro,
                [
                    'INDRESULTADOAGRAV'
                ],
                ''
            )
        );


    const resultadoEstavel =
        texto(
            primeiroCampo(
                registro,
                [
                    'INDRESULTADOESTAVEL'
                ],
                ''
            )
        );


    if (
        !descricao &&
        !data &&
        !procedimento &&
        !ordem
    ) {

        return null;
    }


    return {

        descricao,

        data,

        procedimento,

        ordem,

        observacao,

        tipoExame,

        resultadoAlteradoNormal,

        resultadoAgravamento,

        resultadoEstavel
    };
}


function adicionarExameSemDuplicar(
    exames,
    exame
) {

    if (
        !exame
    ) {

        return;
    }


    const chave = [

        exame.procedimento,

        exame.data,

        exame.descricao,

        exame.ordem

    ].join(
        '|'
    );


    if (
        exames.some(
            item =>
                item._chave ===
                chave
        )
    ) {

        return;
    }


    exames.push({

        ...exame,

        _chave:
            chave
    });
}


function agruparRegistrosS2220(
    registros,
    empresas,
    {
        exigirEmpresaMapeada =
            false
    } = {}
) {

    if (
        !Array.isArray(
            registros
        ) ||
        registros.length ===
            0
    ) {

        return [];
    }


    const indiceEmpresas =
        criarIndiceEmpresas(
            empresas
        );


    const grupos =
        new Map();


    for (
        const registro
        of registros
    ) {

        if (
            !registro ||
            typeof registro !==
                'object'
        ) {

            continue;
        }


        const empresa =
            localizarEmpresaDoRegistro(
                registro,
                indiceEmpresas
            );


        if (
            exigirEmpresaMapeada &&
            !empresa
        ) {

            continue;
        }


        const chave =
            criarChaveAsoS2220(
                registro
            );


        if (
            !chave
        ) {

            console.warn(
                '⚠️ Linha S-2220 ignorada porque não foi possível criar a chave do ASO.'
            );

            continue;
        }


        if (
            !grupos.has(
                chave
            )
        ) {

            grupos.set(
                chave,
                {
                    empresa,
                    registros:
                        [],
                    exames:
                        []
                }
            );
        }


        const grupo =
            grupos.get(
                chave
            );


        if (
            !grupo.empresa &&
            empresa
        ) {

            grupo.empresa =
                empresa;
        }


        grupo.registros.push(
            registro
        );


        adicionarExameSemDuplicar(
            grupo.exames,
            extrairExameS2220(
                registro
            )
        );
    }


    const eventos =
        [];


    for (
        const grupo
        of grupos.values()
    ) {

        const evento =
            normalizarGrupoS2220(
                grupo.registros,
                indiceEmpresas
            );


        if (
            !evento ||
            typeof evento !==
                'object'
        ) {

            console.warn(
                '⚠️ Grupo S-2220 ignorado porque não pôde ser normalizado.'
            );

            continue;
        }


        eventos.push(
            evento
        );
    }


    console.log(
        `📋 Agrupamento S-2220: ` +
        `${eventos.length} ASO(s) válido(s).`
    );


    return eventos;
}

// ============================================================
// CONFIGURAÇÃO DOWNLOAD BX POR NÚMERO DE RECIBO
// ============================================================

let cacheConfigDownloadNrReciboBx =
    null;


function carregarConfigDownloadNrReciboBx() {

    if (
        cacheConfigDownloadNrReciboBx
    ) {

        return cacheConfigDownloadNrReciboBx;
    }


    const configDownload =
        carregarConfigBxEsocial()
            .download;


    const diretorio =
        obterDiretorioComunicacaoBxEsocial();


    const arquivos =
        listarArquivosRecursivamente(
            diretorio
        );


    const xsd =
        arquivos.find(
            arquivo =>
                /^SolicitacaoDownloadEventosPorNrRecibo.*\.xsd$/i.test(
                    path.basename(
                        arquivo
                    )
                )
        );


    if (
        !xsd
    ) {

        throw new Error(
            'SolicitacaoDownloadEventosPorNrRecibo*.xsd não encontrado no pacote de comunicação.'
        );
    }


    cacheConfigDownloadNrReciboBx = {

        wsdl:
            configDownload.wsdl,

        xsd,

        namespaceServico:
            configDownload.namespaceServico,

        namespaceMensagem:
            extrairTargetNamespaceBx(
                xsd
            ),

        soapAction:
            extrairSoapActionBx(
                configDownload.wsdl,
                'SolicitarDownloadEventosPorNrRecibo'
            )
    };


    console.log(
        '✅ Configuração BX por recibo carregada:',
        {
            xsd:
                path.basename(
                    xsd
                ),

            soapAction:
                cacheConfigDownloadNrReciboBx.soapAction
        }
    );


    return cacheConfigDownloadNrReciboBx;
}


// ============================================================
// MONTAR XML DOWNLOAD POR NÚMERO DE RECIBO
// ============================================================

function montarXmlSolicitacaoDownloadPorNrReciboBx({
    tpInsc,
    nrInsc,
    recibos
}) {

    const config =
        carregarConfigDownloadNrReciboBx();


    const tipoInscricao =
        String(
            tpInsc ||
            ''
        ).trim();


    const numeroInscricao =
        normalizarDocumentoEsocial(
            nrInsc
        );


    const recibosNormalizados =
        Array.from(
            new Set(
                (
                    Array.isArray(
                        recibos
                    )
                        ? recibos
                        : []
                )
                    .map(
                        item =>
                            String(
                                item ||
                                ''
                            ).trim()
                    )
                    .filter(
                        Boolean
                    )
            )
        );


    // ========================================================
    // VALIDAR EMPREGADOR
    // ========================================================

    if (
        ![
            '1',
            '2'
        ].includes(
            tipoInscricao
        )
    ) {

        throw new Error(
            'tpInsc inválido para download BX por recibo.'
        );
    }


    if (
        !numeroInscricao
    ) {

        throw new Error(
            'nrInsc não informado para download BX por recibo.'
        );
    }


    // ========================================================
    // VALIDAR RECIBOS
    // ========================================================

    if (
        recibosNormalizados.length < 1 ||
        recibosNormalizados.length > 50
    ) {

        throw new Error(
            'O download BX por recibo exige entre 1 e 50 recibos.'
        );
    }


    // ========================================================
    // XML
    // ========================================================

    let xml =
        '<?xml version="1.0" encoding="UTF-8"?>';


    xml +=
        `<eSocial xmlns="${config.namespaceMensagem}">`;


    xml +=
        '<download>';


    // ========================================================
    // EMPREGADOR
    // ========================================================

    xml +=
        '<ideEmpregador>';


    xml +=
        `<tpInsc>${escaparXmlEsocial(tipoInscricao)}</tpInsc>`;


    xml +=
        `<nrInsc>${escaparXmlEsocial(numeroInscricao)}</nrInsc>`;


    xml +=
        '</ideEmpregador>';


    // ========================================================
    // SOLICITAÇÃO POR NÚMERO DE RECIBO
    //
    // IMPORTANTE:
    //
    // O nome correto exigido pelo XSD/eSocial é:
    //
    // solicDownloadEventosPorNrRecibo
    //
    // NÃO:
    //
    // solicDownloadEvtsPorNrRecibo
    // ========================================================

    xml +=
        '<solicDownloadEventosPorNrRecibo>';


    for (
        const numeroRecibo
        of recibosNormalizados
    ) {

        xml +=
            `<nrRec>${escaparXmlEsocial(numeroRecibo)}</nrRec>`;
    }


    xml +=
        '</solicDownloadEventosPorNrRecibo>';


    xml +=
        '</download>';


    xml +=
        '</eSocial>';


    return xml;
}


// ============================================================
// ENVELOPE SOAP DOWNLOAD POR RECIBO
// ============================================================

function montarEnvelopeSoapDownloadPorNrReciboBx(
    xmlAssinado
) {

    const config =
        carregarConfigDownloadNrReciboBx();


    const xmlInterno =
        removerDeclaracaoXml(
            xmlAssinado
        );


    if (
        !xmlInterno
    ) {

        throw new Error(
            'XML assinado do download por recibo não informado.'
        );
    }


    return (
        '<?xml version="1.0" encoding="utf-8"?>' +

        '<soap:Envelope ' +
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
            'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
            'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +

            '<soap:Body>' +

                `<SolicitarDownloadEventosPorNrRecibo ` +
                    `xmlns="${config.namespaceServico}">` +

                    '<solicitacao>' +

                        xmlInterno +

                    '</solicitacao>' +

                '</SolicitarDownloadEventosPorNrRecibo>' +

            '</soap:Body>' +

        '</soap:Envelope>'
    );
}


// ============================================================
// SOLICITAR DOWNLOAD POR RECIBO
// ============================================================

async function solicitarDownloadEventosPorNrReciboBx({
    tpInsc,
    nrInsc,
    recibos
}) {

    const config =
        carregarConfigDownloadNrReciboBx();


    // ========================================================
    // XML
    // ========================================================

    const xml =
        montarXmlSolicitacaoDownloadPorNrReciboBx({

            tpInsc,

            nrInsc,

            recibos
        });


    // ========================================================
    // ASSINAR
    // ========================================================

    const assinatura =
        assinarXmlEsocial(
            xml
        );


    if (
        !assinatura ||
        !assinatura.xmlAssinado
    ) {

        throw new Error(
            'Não foi possível assinar o download BX por recibo.'
        );
    }


    // ========================================================
    // SOAP
    // ========================================================

    const envelope =
        montarEnvelopeSoapDownloadPorNrReciboBx(
            assinatura.xmlAssinado
        );


    console.log(
        '📨 Download BX por recibo:',
        {
            quantidadeRecibos:
                Array.isArray(
                    recibos
                )
                    ? recibos.length
                    : 0,

            endpoint:
                ESOCIAL_URL_DOWNLOAD_PRODUCAO
        }
    );


    // ========================================================
    // ENVIAR
    // ========================================================

    const respostaHttp =
        await enviarSoapEsocial({

            url:
                ESOCIAL_URL_DOWNLOAD_PRODUCAO,

            soapAction:
                config.soapAction,

            envelope
        });


    if (
        !respostaHttp
    ) {

        throw new Error(
            'Nenhuma resposta recebida no download BX por recibo.'
        );
    }


    const body =
        String(
            respostaHttp.body ||
            ''
        ).trim();


    if (
        !body
    ) {

        throw new Error(
            `Download BX por recibo respondeu HTTP ${respostaHttp.statusCode} sem conteúdo.`
        );
    }


    if (
        /<html[\s>]/i.test(
            body
        ) ||
        /<!DOCTYPE\s+html/i.test(
            body
        )
    ) {

        throw new Error(
            `Download BX por recibo retornou HTML. HTTP ${respostaHttp.statusCode}.`
        );
    }


    const retorno =
        extrairRetornoDownloadBx(
            body
        );


    return {

        httpStatus:
            respostaHttp.statusCode,

        ...retorno
    };
}


// ============================================================
// ESPERA ENTRE CHAMADAS BX
// ============================================================

function aguardarEntreChamadasBx(
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


function normalizarGrupoS2220(
    registrosGrupo,
    indiceEmpresas
) {

    // ========================================================
    // VALIDAR GRUPO
    // ========================================================

    if (
        !Array.isArray(registrosGrupo) ||
        registrosGrupo.length === 0
    ) {

        return null;
    }


    const registros =
        registrosGrupo.filter(
            item =>
                item &&
                typeof item === 'object'
        );


    if (
        registros.length === 0
    ) {

        return null;
    }


    // ========================================================
    // REGISTRO PRINCIPAL
    // ========================================================

    const registro =
        registros[0];


    // ========================================================
    // LOCALIZAR UNIDADE DO COLABORADOR
    // ========================================================

    const codigoEmpresa =
        texto(
            primeiroCampo(
                registro,
                [
                    'CODIGOEMPRESA',
                    'codigoEmpresa',
                    'empresa'
                ],
                ''
            )
        );


    const empresa =
        localizarEmpresaDoRegistro(
            registro,
            indiceEmpresas
        );


    // ========================================================
    // CNPJ DA UNIDADE
    // ========================================================

    const cnpjUnidade =
        normalizarCnpj(
            empresa?.cnpj ||
            ''
        );


    // ========================================================
    // EMPREGADOR E-SOCIAL
    // ========================================================
    //
    // REGRA:
    //
    // O empregador é definido pela UNIDADE encontrada
    // para este colaborador.
    //
    // PRIORIDADE:
    //
    // 1. nr_insc_empregador_esocial cadastrado manualmente
    // 2. raiz do CNPJ da unidade encontrada
    //
    // NÃO usamos mais NRINSCEMPRESA do SOC como empregador.
    //
    // ========================================================

    let tpInscEmpregador =
        String(
            empresa
                ?.tp_insc_empregador_esocial ||
            '1'
        )
            .trim();


    if (
        !['1', '2'].includes(
            tpInscEmpregador
        )
    ) {

        tpInscEmpregador =
            '1';
    }


    let nrInscEmpregador =
        String(
            empresa
                ?.nr_insc_empregador_esocial ||
            ''
        )
            .replace(
                /[^0-9A-Za-z]/g,
                ''
            )
            .toUpperCase()
            .trim();


    // ========================================================
    // FALLBACK AUTOMÁTICO PELO CNPJ DA UNIDADE
    // ========================================================
    //
    // Se não foi configurado manualmente:
    //
    // CNPJ:
    // 12.345.678/0001-90
    //
    // nrInsc:
    // 12345678
    //
    // ========================================================

    if (
        !nrInscEmpregador &&
        tpInscEmpregador === '1' &&
        cnpjUnidade &&
        cnpjUnidade.length >= 8
    ) {

        nrInscEmpregador =
            cnpjUnidade.substring(
                0,
                8
            );
    }


    // ========================================================
    // AUTORIZAÇÃO PARA TRANSMISSÃO
    // ========================================================

    const esocialAutorizado =
        empresa?.esocial_autorizado ===
        true;


    // ========================================================
    // FUNCIONÁRIO
    // ========================================================

    const codigoFuncionario =
        texto(
            primeiroCampo(
                registro,
                [
                    'CODIGOFUNCIONARIO',
                    'codigoFuncionario'
                ],
                ''
            )
        );


    const colaborador =
        texto(
            primeiroCampo(
                registro,
                [
                    'NMTRAB',
                    'NOMEFUNCIONARIO',
                    'nomeFuncionario'
                ],
                ''
            )
        );


    const cpf =
        normalizarCpf(
            primeiroCampo(
                registro,
                [
                    'CPFTRAB',
                    'CPF',
                    'cpf'
                ],
                ''
            )
        );


    const matricula =
        texto(
            primeiroCampo(
                registro,
                [
                    'MATRICULA',
                    'MATRICULARH'
                ],
                ''
            )
        );


    const codCateg =
        texto(
            primeiroCampo(
                registro,
                [
                    'CODCATEG',
                    'codCateg',
                    'cod_categ'
                ],
                ''
            )
        );


    // ========================================================
    // FICHA SOC
    // ========================================================

    const idFicha =
        texto(
            primeiroCampo(
                registro,
                [
                    'IDFICHA',
                    'idFicha'
                ],
                ''
            )
        );


    // ========================================================
    // TIPO DO EXAME
    // ========================================================

    const tpExameOcup =
        texto(
            primeiroCampo(
                registro,
                [
                    'TPEXAMEOCUP',
                    'tpExameOcup'
                ],
                ''
            )
        );


    const tiposExameOcup = {

        '0':
            'Admissional',

        '1':
            'Periódico',

        '2':
            'Retorno ao Trabalho',

        '3':
            'Mudança de Função/Risco Ocupacional',

        '4':
            'Monitoração Pontual',

        '9':
            'Demissional'
    };


    const tipoExame =
        tiposExameOcup[
            tpExameOcup
        ] ||
        (
            tpExameOcup
                ? `Tipo ${tpExameOcup}`
                : 'Não informado'
        );


    // ========================================================
    // DATA DO ASO
    // ========================================================

    const dataAso =
        normalizarData(
            primeiroCampo(
                registro,
                [
                    'DTASO',
                    'DATAFICHA'
                ],
                ''
            )
        );


    const dataEmissaoAso =
        dataAso;


    // ========================================================
    // RESULTADO DO ASO
    // ========================================================

    const resultadoAsoCodigo =
        texto(
            primeiroCampo(
                registro,
                [
                    'RESASO',
                    'RESASOSOC'
                ],
                ''
            )
        );


    let resultadoAso =
        'Não informado';


    let asoApto =
        null;


    if (
        resultadoAsoCodigo === '1'
    ) {

        resultadoAso =
            'Apto';

        asoApto =
            true;

    } else if (
        resultadoAsoCodigo === '2'
    ) {

        resultadoAso =
            'Inapto';

        asoApto =
            false;

    } else if (
        resultadoAsoCodigo
    ) {

        resultadoAso =
            resultadoAsoCodigo;
    }


    // ========================================================
    // MÉDICO EMITENTE
    // ========================================================

    const medicoEmitente =
        texto(
            primeiroCampo(
                registro,
                [
                    'NMEMISSORASO',
                    'NMMEDFICHA',
                    'NMRESPAVULSO'
                ],
                ''
            )
        );


    const medicoCrm =
        texto(
            primeiroCampo(
                registro,
                [
                    'NRCRMEMISSORASO',
                    'NRCRMMEDFICHA',
                    'NRCRMRESPAVULSO'
                ],
                ''
            )
        );


    const medicoUfCrm =
        texto(
            primeiroCampo(
                registro,
                [
                    'UFCRMEMISSORASO',
                    'UFCRMMEDFICHA',
                    'UFCRMRESPAVULSO'
                ],
                ''
            )
        );


    // ========================================================
    // RESPONSÁVEL PCMSO
    // ========================================================

    const responsavel =
        texto(
            primeiroCampo(
                registro,
                [
                    'NOMERESPONSAVEL'
                ],
                ''
            )
        );


    const cpfResponsavel =
        normalizarCpf(
            primeiroCampo(
                registro,
                [
                    'CPFRESPONSAVEL'
                ],
                ''
            )
        );


    const conselhoResponsavel =
        texto(
            primeiroCampo(
                registro,
                [
                    'NRCONSELHOCLASSERESPONSAVEL'
                ],
                ''
            )
        );


    const ufConselhoResponsavel =
        texto(
            primeiroCampo(
                registro,
                [
                    'UFCONSELHOCLASSERESPONSAVEL'
                ],
                ''
            )
        );


    // ========================================================
    // EXAMES
    // ========================================================

    const exames = [];


    const examesJaAdicionados =
        new Set();


    for (
        const linha
        of registros
    ) {

        const descricaoExame =
            texto(
                primeiroCampo(
                    linha,
                    [
                        'DESCRICAOEXAME'
                    ],
                    ''
                )
            );


        const dataExame =
            normalizarData(
                primeiroCampo(
                    linha,
                    [
                        'DTEXAME'
                    ],
                    ''
                )
            );


        const procedimentoEsocial =
            texto(
                primeiroCampo(
                    linha,
                    [
                        'PROCREALIZADO'
                    ],
                    ''
                )
            );


        const tipoExameSoc =
            texto(
                primeiroCampo(
                    linha,
                    [
                        'TPEXAME'
                    ],
                    ''
                )
            );


        const observacao =
            texto(
                primeiroCampo(
                    linha,
                    [
                        'OBSPROC'
                    ],
                    ''
                )
            );


        const ordem =
            texto(
                primeiroCampo(
                    linha,
                    [
                        'ORDEMEXAME'
                    ],
                    ''
                )
            );


        const resultadoAlteradoNormal =
            texto(
                primeiroCampo(
                    linha,
                    [
                        'INDRESULTADOALTNORMAL'
                    ],
                    ''
                )
            );


        const resultadoAgravamento =
            texto(
                primeiroCampo(
                    linha,
                    [
                        'INDRESULTADOAGRAV'
                    ],
                    ''
                )
            );


        const resultadoEstavel =
            texto(
                primeiroCampo(
                    linha,
                    [
                        'INDRESULTADOESTAVEL'
                    ],
                    ''
                )
            );


        if (
            !descricaoExame &&
            !procedimentoEsocial
        ) {

            continue;
        }


        const chaveExame =
            [
                dataExame,
                procedimentoEsocial,
                descricaoExame,
                ordem
            ].join('|');


        if (
            examesJaAdicionados.has(
                chaveExame
            )
        ) {

            continue;
        }


        examesJaAdicionados.add(
            chaveExame
        );


        exames.push({

            // Campos internos
            data:
                dataExame,

            descricao:
                descricaoExame,

            procedimentoEsocial,

            tipoExameSoc,

            observacao,

            ordem,

            resultadoAlteradoNormal,

            resultadoAgravamento,

            resultadoEstavel,


            // Campos diretamente compatíveis
            // com a montagem do S-2220
            dtExm:
                dataExame,

            procRealizado:
                procedimentoEsocial,

            obsProc:
                observacao,

            ordExame:
                ordem
        });
    }


    // ========================================================
    // RESUMO DO ASO
    // ========================================================

    const aso =
        montarResumoAsoS2220({

            idFicha,

            colaborador,

            cpf,

            matricula,

            dataAso,

            tipoExame,

            resultadoAso,

            medico:
                medicoEmitente,

            crm:
                medicoCrm,

            ufCrm:
                medicoUfCrm,

            responsavel,

            cpfResponsavel,

            exames
        });


    // ========================================================
    // RETORNO
    // ========================================================

    return {

        // ====================================================
        // UNIDADE / EMPRESA
        // ====================================================

        empresaId:
            empresa?.id ||
            null,

        holding:
            empresa?.holding ||
            'N/A',

        unidade:
            empresa?.unidade ||
            (
                codigoEmpresa
                    ? `Empresa SOC ${codigoEmpresa}`
                    : 'N/A'
            ),

        cnpjUnidade:
            cnpjUnidade ||
            '',

        codigoEmpresa,


        // ====================================================
        // EMPREGADOR E-SOCIAL DAQUELE COLABORADOR
        // ====================================================

        tpInscEmpregador,

        nrInscEmpregador,

        esocialAutorizado,


        // ====================================================
        // FUNCIONÁRIO
        // ====================================================

        colaborador:
            colaborador ||
            'N/A',

        cpf:
            cpf ||
            '',

        codigoFuncionario,

        matricula,

        codCateg,


        // ====================================================
        // FICHA
        // ====================================================

        idFicha,


        // ====================================================
        // EVENTO
        // ====================================================

        tipoEvento:
            'S-2220',

        tpExameOcup,

        tipoExame,

        dataExame:
            dataAso,

        status:
            'pendente',

        numeroRecibo:
            '',


        // ====================================================
        // ASO
        // ====================================================

        aso,

        asoApto,

        resultadoAso,

        resultadoAsoCodigo,

        dataEmissaoAso,

        /*
         * Será complementado pelo GED 1858.
         */

        asoAssinado:
            null,


        // ====================================================
        // MÉDICO
        // ====================================================

        medicoEmitente,

        medicoCrm,

        medicoUfCrm,


        // ====================================================
        // RESPONSÁVEL PCMSO
        // ====================================================

        responsavel,

        cpfResponsavel,

        conselhoResponsavel,

        ufConselhoResponsavel,


        // ====================================================
        // EXAMES
        // ====================================================

        exames,


        // ====================================================
        // CAMPOS COMPLEMENTADOS PELO 29169
        // ====================================================

        cargoColaborador:
            '',

        setorColaborador:
            '',

        funcaoColaborador:
            '',

        aptidaoAso:
            '',

        riscosAso:
            [],


        // ====================================================
        // CONTROLE
        // ====================================================

        origem:
            'SOC',

        persistido:
            false,

        rawSoc:
            registros
    };
}

// ============================================================
// MONTAR RESUMO DO ASO S-2220
// ============================================================

function montarResumoAsoS2220({
    idFicha,
    colaborador,
    cpf,
    matricula,
    dataAso,
    tipoExame,
    resultadoAso,
    medico,
    crm,
    ufCrm,
    responsavel,
    cpfResponsavel,
    exames
}) {

    const linhas = [];


    // ========================================================
    // AUXILIAR
    // ========================================================

    function adicionar(
        rotulo,
        valor
    ) {

        const valorTexto =
            texto(
                valor
            );


        if (
            valorTexto
        ) {

            linhas.push(
                `${rotulo}: ${valorTexto}`
            );
        }
    }


    // ========================================================
    // DADOS PRINCIPAIS
    // ========================================================

    adicionar(
        'Ficha SOC',
        idFicha
    );


    adicionar(
        'Trabalhador',
        colaborador
    );


    adicionar(
        'CPF',
        cpf
    );


    adicionar(
        'Matrícula',
        matricula
    );


    adicionar(
        'Data do ASO',
        dataAso
    );


    adicionar(
        'Tipo do ASO',
        tipoExame
    );


    adicionar(
        'Resultado do ASO',
        resultadoAso
    );


    // ========================================================
    // MÉDICO
    // ========================================================

    if (
        medico ||
        crm ||
        ufCrm
    ) {

        let medicoTexto =
            medico ||
            'Não informado';


        if (
            crm
        ) {

            medicoTexto +=
                ` - CRM ${crm}`;
        }


        if (
            ufCrm
        ) {

            medicoTexto +=
                `/${ufCrm}`;
        }


        adicionar(
            'Médico',
            medicoTexto
        );
    }


    // ========================================================
    // RESPONSÁVEL PCMSO
    // ========================================================

    if (
        responsavel
    ) {

        let responsavelTexto =
            responsavel;


        if (
            cpfResponsavel
        ) {

            responsavelTexto +=
                ` - CPF ${cpfResponsavel}`;
        }


        adicionar(
            'Responsável PCMSO',
            responsavelTexto
        );
    }


    // ========================================================
    // EXAMES
    // ========================================================

    if (
        Array.isArray(exames) &&
        exames.length > 0
    ) {

        linhas.push('');

        linhas.push(
            'Exames / procedimentos:'
        );


        exames.forEach(
            (
                exame,
                index
            ) => {

                const partes = [];


                // ================================================
                // DATA
                // ================================================

                const dataExame =
                    exame?.data ||
                    exame?.dtExm ||
                    '';


                if (
                    dataExame
                ) {

                    partes.push(
                        dataExame
                    );
                }


                // ================================================
                // DESCRIÇÃO
                // ================================================

                if (
                    exame?.descricao
                ) {

                    partes.push(
                        exame.descricao
                    );
                }


                // ================================================
                // PROCEDIMENTO E-SOCIAL
                // ================================================

                const procedimento =
                    exame?.procedimentoEsocial ||
                    exame?.procRealizado ||
                    exame?.procedimento ||
                    '';


                if (
                    procedimento
                ) {

                    partes.push(
                        `eSocial ${procedimento}`
                    );
                }


                // ================================================
                // LINHA
                // ================================================

                linhas.push(
                    `${index + 1}. ${
                        partes.length
                            ? partes.join(' | ')
                            : 'Exame'
                    }`
                );
            }
        );
    }


    // ========================================================
    // RETORNO
    // ========================================================

    return linhas.join(
        '\n'
    );
}

// ============================================================
// COMPLEMENTO ASO 29169
// ============================================================

function converterJsonEmArray(
    value
) {

    if (
        Array.isArray(
            value
        )
    ) {

        return value;
    }


    if (
        !value
    ) {

        return [];
    }


    if (
        typeof value ===
        'object'
    ) {

        return [
            value
        ];
    }


    if (
        typeof value ===
            'string' &&
        value.trim()
    ) {

        try {

            const parsed =
                JSON.parse(
                    value
                );


            if (
                Array.isArray(
                    parsed
                )
            ) {

                return parsed;
            }


            return (
                parsed &&
                typeof parsed ===
                    'object'
            )
                ? [
                    parsed
                ]
                : [];

        } catch (error) {

            return [];
        }
    }


    return [];
}


async function complementarEventosComAso29169(
    eventos2220
) {

    if (
        !Array.isArray(
            eventos2220
        ) ||
        eventos2220.length ===
            0
    ) {

        return [];
    }


    const eventosValidos =
        eventos2220.filter(
            evento =>
                evento &&
                typeof evento ===
                    'object'
        );


    if (
        !eventosValidos.length
    ) {

        console.warn(
            '⚠️ Nenhum evento S-2220 válido para complementar.'
        );

        return [];
    }


    if (
        !extracaoConfigurada(
            'aso'
        )
    ) {

        console.warn(
            '⚠️ Exporta Dados ASO complementar não configurado. ' +
            'Os eventos seguirão sem cargo, setor, aptidão e riscos.'
        );

        return eventosValidos;
    }


    const extracaoAso =
        obterExtracao(
            'aso'
        );


    const eventosPorEmpresa =
        new Map();


    for (
        const evento
        of eventosValidos
    ) {

        const codigoEmpresa =
            String(
                evento.codigoEmpresa ||
                evento.codigo_empresa ||
                ''
            ).trim();


        const idFicha =
            String(
                evento.idFicha ||
                evento.id_ficha_soc ||
                ''
            ).trim();


        if (
            !codigoEmpresa ||
            !idFicha
        ) {

            console.warn(
                '⚠️ Evento sem código da empresa ou IDFICHA não será complementado:',
                {
                    colaborador:
                        evento.colaborador ||
                        null,

                    codigoEmpresa:
                        codigoEmpresa ||
                        null,

                    idFicha:
                        idFicha ||
                        null
                }
            );

            continue;
        }


        if (
            !eventosPorEmpresa.has(
                codigoEmpresa
            )
        ) {

            eventosPorEmpresa.set(
                codigoEmpresa,
                []
            );
        }


        eventosPorEmpresa
            .get(
                codigoEmpresa
            )
            .push(
                evento
            );
    }


    const TAMANHO_LOTE =
        10000;


    for (
        const [
            codigoEmpresa,
            eventosEmpresa
        ]
        of eventosPorEmpresa
    ) {

        const sequenciais = [

            ...new Set(

                eventosEmpresa

                    .map(
                        evento =>
                            String(
                                evento.idFicha ||
                                evento.id_ficha_soc ||
                                ''
                            ).trim()
                    )

                    .filter(
                        Boolean
                    )
            )
        ];


        if (
            !sequenciais.length
        ) {

            continue;
        }


        console.log(
            `🔎 Complementando ASOs da empresa ${codigoEmpresa}: ` +
            `${sequenciais.length} ficha(s).`
        );


        const registrosAso =
            [];


        for (
            let inicio = 0;
            inicio < sequenciais.length;
            inicio += TAMANHO_LOTE
        ) {

            const lote =
                sequenciais.slice(
                    inicio,
                    inicio + TAMANHO_LOTE
                );


            try {

                const retornoAso =
                    await exportarDadosSoc({

                        codigo:
                            extracaoAso.codigo,

                        chave:
                            extracaoAso.chave,

                        empresa:
                            SOC_CONFIG
                                .empresaPrincipal,

                        empresaTrabalho:
                            codigoEmpresa,

                        filtros: {

                            listaSequencialFicha:
                                lote.join(
                                    ','
                                )
                        }
                    });


                registrosAso.push(
                    ...localizarArray(
                        retornoAso
                    )
                );


            } catch (error) {

                console.error(
                    `❌ Erro ao consultar complemento ASO da empresa ${codigoEmpresa}:`,
                    formatarErro(
                        error
                    )
                );
            }
        }


        console.log(
            `✅ Complemento ASO ${codigoEmpresa}: ` +
            `${registrosAso.length} registro(s).`
        );


        const asoPorNumeroGuia =
            new Map();


        for (
            const registroAso
            of registrosAso
        ) {

            if (
                !registroAso ||
                typeof registroAso !==
                    'object'
            ) {

                continue;
            }


            const numeroGuia =
                texto(
                    primeiroCampo(
                        registroAso,
                        [
                            'NUMERO_GUIA',
                            'numero_guia',
                            'numeroGuia'
                        ],
                        ''
                    )
                );


            if (
                numeroGuia
            ) {

                asoPorNumeroGuia
                    .set(
                        numeroGuia,
                        registroAso
                    );
            }
        }


        for (
            const evento
            of eventosEmpresa
        ) {

            const idFicha =
                texto(
                    evento.idFicha ||
                    evento.id_ficha_soc ||
                    ''
                );


            const complemento =
                asoPorNumeroGuia
                    .get(
                        idFicha
                    );


            if (
                !complemento
            ) {

                console.warn(
                    `⚠️ Relatório ASO não retornou complemento para a ficha ${idFicha}.`
                );

                continue;
            }


            const cnpjComplemento =
                normalizarCnpj(
                    primeiroCampo(
                        complemento,
                        [
                            'CNPJ',
                            'cnpj'
                        ],
                        ''
                    )
                );


            if (
                cnpjComplemento
            ) {

                evento.cnpjUnidade =
                    cnpjComplemento;
            }


            const estabelecimento =
                texto(
                    primeiroCampo(
                        complemento,
                        [
                            'ESTABELECIMENTO',
                            'estabelecimento'
                        ],
                        ''
                    )
                );


            if (
                estabelecimento
            ) {

                evento.unidade =
                    estabelecimento;
            }


            evento.cargoColaborador =
                texto(
                    primeiroCampo(
                        complemento,
                        [
                            'CARGO',
                            'cargo'
                        ],
                        ''
                    )
                );


            evento.setorColaborador =
                texto(
                    primeiroCampo(
                        complemento,
                        [
                            'SETOR',
                            'setor'
                        ],
                        ''
                    )
                );


            evento.funcaoColaborador =
                texto(
                    primeiroCampo(
                        complemento,
                        [
                            'FUNÇÃO',
                            'FUNCAO',
                            'funcao'
                        ],
                        ''
                    )
                );


            evento.aptidaoAso =
                texto(
                    primeiroCampo(
                        complemento,
                        [
                            'APTIDAO',
                            'aptidao'
                        ],
                        ''
                    )
                );


            const dataAsoComplementar =
                normalizarData(
                    primeiroCampo(
                        complemento,
                        [
                            'DATA_ASO',
                            'data_aso',
                            'dataAso'
                        ],
                        ''
                    )
                );


            evento.dataAsoComplementar =
                dataAsoComplementar ||
                '';


            if (
                !evento.dataExame &&
                dataAsoComplementar
            ) {

                evento.dataExame =
                    dataAsoComplementar;
            }


            const riscosRaw =
                primeiroCampo(
                    complemento,
                    [
                        'RISCOS_DA_FCO_ASO',
                        'riscos_da_fco_aso',
                        'riscosDaFcoAso'
                    ],
                    ''
                );


            evento.riscosAso =
                converterJsonEmArray(
                    riscosRaw
                )

                    .map(
                        risco => {

                            if (
                                !risco ||
                                typeof risco !==
                                    'object'
                            ) {

                                return null;
                            }


                            return {

                                agente:
                                    texto(
                                        primeiroCampo(
                                            risco,
                                            [
                                                'agente',
                                                'AGENTE'
                                            ],
                                            ''
                                        )
                                    ),


                                descricao_risco:
                                    texto(
                                        primeiroCampo(
                                            risco,
                                            [
                                                'descricao_risco',
                                                'DESCRICAO_RISCO',
                                                'descricaoRisco'
                                            ],
                                            ''
                                        )
                                    )
                            };
                        }
                    )

                    .filter(
                        risco =>
                            risco &&
                            (
                                risco.agente ||
                                risco.descricao_risco
                            )
                    );


            const examesRaw =
                primeiroCampo(
                    complemento,
                    [
                        'EXAMES_DA_FCO',
                        'exames_da_fco',
                        'examesDaFco'
                    ],
                    ''
                );


            evento.examesAso29169 =
                converterJsonEmArray(
                    examesRaw
                );


            evento.cpfMedicoExaminador =
                normalizarCpf(
                    primeiroCampo(
                        complemento,
                        [
                            'CPF_MEDICO_EXAMINADOR',
                            'cpf_medico_examinador'
                        ],
                        ''
                    )
                );


            evento.cpfMedicoCoordenador =
                normalizarCpf(
                    primeiroCampo(
                        complemento,
                        [
                            'CPF_MEDICO_COORDENADOR',
                            'cpf_medico_coordenador'
                        ],
                        ''
                    )
                );


            evento.observacaoAso =
                texto(
                    primeiroCampo(
                        complemento,
                        [
                            'OBS_ASO',
                            'obs_aso'
                        ],
                        ''
                    )
                );


            evento.numeroGuia =
                texto(
                    primeiroCampo(
                        complemento,
                        [
                            'NUMERO_GUIA',
                            'numero_guia'
                        ],
                        ''
                    )
                );


            evento.rawAso29169 =
                complemento;


            console.log(
                `✅ ASO complementado: ${idFicha} | ` +
                `${evento.cargoColaborador || 'sem cargo'} | ` +
                `${evento.aptidaoAso || 'sem aptidão'} | ` +
                `${evento.riscosAso.length} risco(s)`
            );
        }
    }


    return eventosValidos;
}

// ============================================================
// COMPLEMENTAR EVENTOS COM STATUS DO ESOCIAL - EXPORTA DADOS 6603
// ============================================================
//
// RELACIONAMENTO CONFIRMADO:
//
// 6603.SEQUENCIAL
// =
// esocial_eventos.id_ficha_soc / evento.idFicha
//
// Consulta:
// S-2220 -> layout 2220
// S-2240 -> layout 2240
//
// ============================================================

async function complementarEventosComStatus6603(
    eventos,
    {
        dataInicio,
        dataFim
    } = {}
) {

    // ========================================================
    // VALIDAR ENTRADA
    // ========================================================

    if (
        !Array.isArray(eventos) ||
        eventos.length === 0
    ) {

        return eventos || [];
    }


    const eventosValidos =
        eventos.filter(
            evento =>
                evento &&
                typeof evento === 'object'
        );


    if (
        eventosValidos.length === 0
    ) {

        return [];
    }


    // ========================================================
    // VERIFICAR EXTRAÇÃO
    // ========================================================

    if (
        !extracaoConfigurada(
            'eventosesocial'
        )
    ) {

        console.warn(
            '⚠️ Exporta Dados 6603 não configurado. ' +
            'Status dos eventos eSocial não será consultado.'
        );

        return eventosValidos;
    }


    if (
        !dataInicio ||
        !dataFim
    ) {

        console.warn(
            '⚠️ Período não informado para consulta do Exporta Dados 6603.'
        );

        return eventosValidos;
    }


    const extracao =
        obterExtracao(
            'eventosesocial'
        );


    // ========================================================
    // AGRUPAR POR EMPRESA + LAYOUT
    // ========================================================

    const grupos =
        new Map();


    for (
        const evento
        of eventosValidos
    ) {

        const codigoEmpresa =
            String(
                evento.codigoEmpresa ||
                evento.codigo_empresa ||
                ''
            ).trim();


        const idFicha =
            String(
                evento.idFicha ||
                evento.id_ficha_soc ||
                ''
            ).trim();


        const tipoEvento =
            String(
                evento.tipoEvento ||
                evento.tipo_evento ||
                ''
            )
                .trim()
                .toUpperCase();


        if (
            !codigoEmpresa ||
            !idFicha
        ) {

            continue;
        }


        let layout =
            '';


        if (
            tipoEvento === 'S-2220'
        ) {

            layout =
                '2220';

        } else if (
            tipoEvento === 'S-2240'
        ) {

            layout =
                '2240';

        } else {

            continue;
        }


        const chaveGrupo =
            `${codigoEmpresa}|${layout}`;


        if (
            !grupos.has(
                chaveGrupo
            )
        ) {

            grupos.set(
                chaveGrupo,
                {
                    codigoEmpresa,
                    layout,
                    eventos:
                        []
                }
            );
        }


        grupos
            .get(
                chaveGrupo
            )
            .eventos
            .push(
                evento
            );
    }


    // ========================================================
    // FUNÇÃO AUXILIAR PARA COMPARAR DATAS
    // ========================================================

    function timestampDataSoc(
        value
    ) {

        const normalizada =
            normalizarData(
                value
            );


        if (
            !normalizada ||
            !/^\d{4}-\d{2}-\d{2}$/
                .test(
                    normalizada
                )
        ) {

            return 0;
        }


        const timestamp =
            Date.parse(
                `${normalizada}T00:00:00`
            );


        return Number.isFinite(
            timestamp
        )
            ? timestamp
            : 0;
    }


    // ========================================================
    // CONSULTAR CADA EMPRESA / LAYOUT
    // ========================================================

    for (
        const grupo
        of grupos.values()
    ) {

        const {
            codigoEmpresa,
            layout,
            eventos:
                eventosGrupo
        } =
            grupo;


        console.log(
            `🔎 Consultando status eSocial 6603 | ` +
            `Empresa ${codigoEmpresa} | ` +
            `Layout ${layout}`
        );


        try {

            const retorno =
                await exportarDadosSoc({

                    codigo:
                        extracao.codigo,

                    chave:
                        extracao.chave,

                    /*
                     * 6603:
                     *
                     * empresa = empresa principal
                     * empresaTrabalho = empresa consultada
                     */

                    empresa:
                        SOC_CONFIG
                            .empresaPrincipal,

                    empresaTrabalho:
                        codigoEmpresa,

                    filtros: {

                        dataInicio:
                            converterDataParaSoc(
                                dataInicio
                            ),

                        dataFim:
                            converterDataParaSoc(
                                dataFim
                            ),

                        /*
                         * 99 = todos os status
                         */

                        status:
                            '99',

                        layout,

                        unidade:
                            '0',

                        ambiente:
                            'true'
                    }
                });


            const registros =
                localizarArray(
                    retorno
                );


            console.log(
                `📥 6603 Empresa ${codigoEmpresa} ` +
                `Layout ${layout}: ` +
                `${registros.length} registro(s).`
            );


            // ====================================================
            // INDEXAR PELO SEQUENCIAL
            // ====================================================

            const porSequencial =
                new Map();


            for (
                const registro
                of registros
            ) {

                if (
                    !registro ||
                    typeof registro !== 'object'
                ) {

                    continue;
                }


                const sequencial =
                    String(
                        primeiroCampo(
                            registro,
                            [
                                'SEQUENCIAL',
                                'sequencial'
                            ],
                            ''
                        )
                    ).trim();


                if (!sequencial) {

                    continue;
                }


                /*
                 * Se houver mais de um registro para a mesma ficha,
                 * ficamos com o de DATAGERACAO mais recente.
                 *
                 * Em empate de data, o último retornado substitui
                 * o anterior.
                 */

                const atual =
                    porSequencial.get(
                        sequencial
                    );


                if (!atual) {

                    porSequencial.set(
                        sequencial,
                        registro
                    );

                    continue;
                }


                const dataAtual =
                    timestampDataSoc(
                        primeiroCampo(
                            atual,
                            [
                                'DATAGERACAO'
                            ],
                            ''
                        )
                    );


                const dataNovo =
                    timestampDataSoc(
                        primeiroCampo(
                            registro,
                            [
                                'DATAGERACAO'
                            ],
                            ''
                        )
                    );


                if (
                    dataNovo >=
                    dataAtual
                ) {

                    porSequencial.set(
                        sequencial,
                        registro
                    );
                }
            }


            // ====================================================
            // COMPLEMENTAR NOSSOS EVENTOS
            // ====================================================

            for (
                const evento
                of eventosGrupo
            ) {

                const idFicha =
                    String(
                        evento.idFicha ||
                        evento.id_ficha_soc ||
                        ''
                    ).trim();


                const registro6603 =
                    porSequencial.get(
                        idFicha
                    );


                /*
                 * Se ainda não existe no 6603,
                 * isso é perfeitamente possível.
                 *
                 * Exemplo:
                 * S-2240 acabou de ser identificado como necessário,
                 * mas ainda não foi gerado no SOC.
                 */

                if (
                    !registro6603
                ) {

                    evento.statusEventoSoc =
                        '';

                    evento.eventoAssinado =
                        null;

                    continue;
                }


                // ================================================
                // STATUS REAL NO SOC
                // ================================================

                const statusEvento =
                    String(
                        primeiroCampo(
                            registro6603,
                            [
                                'STATUSEVENTO',
                                'statusEvento'
                            ],
                            ''
                        )
                    ).trim();


                evento.statusEventoSoc =
                    statusEvento;

                    const statusNormalizado =
                        statusEvento
                            .trim()
                            .toLowerCase();


                const numeroRecibo =
                    String(
                        primeiroCampo(
                            registro6603,
                            [
                                'NRRECIBO',
                                'nrRecibo'
                            ],
                            ''
                        )
                    ).trim();



                // ================================================
                // ASSINATURA DO EVENTO
                // ================================================

                evento.eventoAssinado =
                statusNormalizado === 'assinado' ||
                (
                    statusNormalizado === 'concluido' &&
                    Boolean(numeroRecibo)
                );

                evento.numeroRecibo =
                numeroRecibo;


                // ================================================
                // RECIBO
                // ================================================

                evento.numeroRecibo =
                    String(
                        primeiroCampo(
                            registro6603,
                            [
                                'NRRECIBO',
                                'nrRecibo'
                            ],
                            ''
                        )
                    ).trim();


                // ================================================
                // ERRO ESOCIAL
                // ================================================

                evento.erroEsocial =
                    String(
                        primeiroCampo(
                            registro6603,
                            [
                                'ERRO',
                                'erro'
                            ],
                            ''
                        )
                    ).trim();


                evento.codigoErroEsocial =
                    String(
                        primeiroCampo(
                            registro6603,
                            [
                                'CODIGOERROESOCIAL',
                                'codigoErroEsocial'
                            ],
                            ''
                        )
                    ).trim();


                // ================================================
                // ID DO ARQUIVO
                // ================================================

                evento.idArquivoEsocial =
                    String(
                        primeiroCampo(
                            registro6603,
                            [
                                'IDARQUIVO',
                                'idArquivo'
                            ],
                            ''
                        )
                    ).trim();


                // ================================================
                // DATA DA GERAÇÃO
                // ================================================

                evento.dataGeracaoEvento =
                    normalizarData(
                        primeiroCampo(
                            registro6603,
                            [
                                'DATAGERACAO',
                                'dataGeracao'
                            ],
                            ''
                        )
                    );


                console.log(
                    `✅ Status 6603: ` +
                    `${evento.tipoEvento || evento.tipo_evento} | ` +
                    `Ficha ${idFicha} | ` +
                    `${statusEvento || 'sem status'} | ` +
                    `Assinado: ${
                        evento.eventoAssinado
                            ? 'Sim'
                            : 'Não'
                    }`
                );
            }


        } catch (error) {

            console.error(
                `❌ Erro 6603 Empresa ${codigoEmpresa} ` +
                `Layout ${layout}:`,
                formatarErro(
                    error
                )
            );


            /*
             * Não interrompemos toda a consulta.
             * Os ASOs continuam sendo salvos mesmo se
             * o relatório 6603 falhar.
             */
        }
    }


    return eventosValidos;
}

// ============================================================
// COMPLEMENTAR ASO COM ASSINATURA DIGITAL - GED 1858
// ============================================================
//
// RELACIONAMENTO:
//
// GED.SEQUENCIAL_FICHA
// =
// S-2220.IDFICHA
//
// No teste realizado:
//
// CD_TIPO_GED = 7 -> ASO
//
// ASSINADO_DIGITALMENTE:
//
// 0 = Não assinado
// 1 = Assinado
//
// ============================================================

async function complementarEventosComGed1858(
    eventos2220
) {

    // ========================================================
    // VALIDAR
    // ========================================================

    if (
        !Array.isArray(eventos2220) ||
        eventos2220.length === 0
    ) {

        return eventos2220 || [];
    }


    const eventosValidos =
        eventos2220.filter(
            evento =>
                evento &&
                typeof evento === 'object'
        );


    if (
        eventosValidos.length === 0
    ) {

        return [];
    }


    // ========================================================
    // VERIFICAR CONFIGURAÇÃO GED
    // ========================================================

    if (
        !extracaoConfigurada(
            'ged'
        )
    ) {

        console.warn(
            '⚠️ Exporta Dados GED 1858 não configurado.'
        );

        return eventosValidos;
    }


    const extracaoGed =
        obterExtracao(
            'ged'
        );


    // ========================================================
    // CACHE
    // ========================================================
    //
    // Evita consultar a mesma ficha duas vezes.
    //
    // ========================================================

    const cache =
        new Map();


    // ========================================================
    // PROCESSAR CADA ASO
    // ========================================================

    for (
        const evento
        of eventosValidos
    ) {

        const codigoEmpresa =
            String(
                evento.codigoEmpresa ||
                evento.codigo_empresa ||
                ''
            ).trim();


        const idFicha =
            String(
                evento.idFicha ||
                evento.id_ficha_soc ||
                ''
            ).trim();


        if (
            !codigoEmpresa ||
            !idFicha
        ) {

            continue;
        }


        const chaveCache =
            `${codigoEmpresa}:${idFicha}`;


        let registroAsoGed;


        // ====================================================
        // CONSULTAR SOMENTE SE NÃO ESTIVER NO CACHE
        // ====================================================

        if (
            cache.has(
                chaveCache
            )
        ) {

            registroAsoGed =
                cache.get(
                    chaveCache
                );

        } else {

            try {

                console.log(
                    `📄 Consultando GED 1858 | ` +
                    `Empresa ${codigoEmpresa} | ` +
                    `Ficha ${idFicha}`
                );


                // ================================================
                // CONSULTA GED
                // ================================================
                //
                // No teste confirmado:
                //
                // empresa = código SOC da empresa
                //
                // tipoBusca = 1
                // sequencialFicha = IDFICHA
                //
                // CD_TIPO_GED 7 = ASO
                //
                // ================================================

                const retornoGed =
                    await exportarDadosSoc({

                        codigo:
                            extracaoGed.codigo,

                        chave:
                            extracaoGed.chave,

                        empresa:
                            codigoEmpresa,

                        filtros: {

                            tipoBusca:
                                '1',

                            sequencialFicha:
                                idFicha,

                            filtraPorTipoSocged:
                                '1',

                            codigoTipoSocged:
                                '7'
                        }
                    });


                let registrosGed =
                    localizarArray(
                        retornoGed
                    );


                // ================================================
                // SE FILTRO PELO TIPO 7 NÃO RETORNAR NADA,
                // CONSULTAR TODOS OS DOCUMENTOS DA FICHA
                // ================================================

                if (
                    registrosGed.length === 0
                ) {

                    console.warn(
                        `⚠️ GED tipo 7 não encontrado para ` +
                        `ficha ${idFicha}. Buscando todos os GEDs.`
                    );


                    const retornoGedTodos =
                        await exportarDadosSoc({

                            codigo:
                                extracaoGed.codigo,

                            chave:
                                extracaoGed.chave,

                            empresa:
                                codigoEmpresa,

                            filtros: {

                                tipoBusca:
                                    '1',

                                sequencialFicha:
                                    idFicha,

                                filtraPorTipoSocged:
                                    '0'
                            }
                        });


                    registrosGed =
                        localizarArray(
                            retornoGedTodos
                        );
                }


                // ================================================
                // LOCALIZAR O DOCUMENTO ASO
                // ================================================

                registroAsoGed =
                    registrosGed.find(
                        registro => {

                            if (
                                !registro ||
                                typeof registro !== 'object'
                            ) {

                                return false;
                            }


                            const sequencial =
                                String(
                                    primeiroCampo(
                                        registro,
                                        [
                                            'SEQUENCIAL_FICHA',
                                            'sequencial_ficha',
                                            'sequencialFicha'
                                        ],
                                        ''
                                    )
                                ).trim();


                            const tipoGed =
                                String(
                                    primeiroCampo(
                                        registro,
                                        [
                                            'CD_TIPO_GED',
                                            'cd_tipo_ged'
                                        ],
                                        ''
                                    )
                                ).trim();


                            const nomeArquivo =
                                String(
                                    primeiroCampo(
                                        registro,
                                        [
                                            'NM_ARQUIVOS_GED',
                                            'nm_arquivos_ged'
                                        ],
                                        ''
                                    )
                                )
                                    .trim()
                                    .toLowerCase();


                            const nomeGed =
                                String(
                                    primeiroCampo(
                                        registro,
                                        [
                                            'NM_GED',
                                            'nm_ged'
                                        ],
                                        ''
                                    )
                                )
                                    .trim()
                                    .toLowerCase();


                            if (
                                sequencial &&
                                sequencial !== idFicha
                            ) {

                                return false;
                            }


                            // Principal:
                            // Tipo GED 7

                            if (
                                tipoGed === '7'
                            ) {

                                return true;
                            }


                            // Fallback:
                            // nome do arquivo contém ASO

                            if (
                                nomeArquivo.includes(
                                    'aso'
                                )
                            ) {

                                return true;
                            }


                            // Fallback:
                            // nome GED contém ASO

                            if (
                                nomeGed.includes(
                                    'aso'
                                )
                            ) {

                                return true;
                            }


                            return false;
                        }
                    ) || null;


                cache.set(
                    chaveCache,
                    registroAsoGed
                );


            } catch (error) {

                console.error(
                    `❌ Erro GED 1858 | ` +
                    `Empresa ${codigoEmpresa} | ` +
                    `Ficha ${idFicha}:`,
                    error.message
                );


                cache.set(
                    chaveCache,
                    null
                );


                registroAsoGed =
                    null;
            }
        }


        // ====================================================
        // NÃO ACHOU ASO NO GED
        // ====================================================

        if (
            !registroAsoGed
        ) {

            console.warn(
                `⚠️ Documento ASO não encontrado no GED ` +
                `para a ficha ${idFicha}.`
            );


            /*
             * Não colocamos false.
             *
             * Não encontrado é diferente de
             * "encontrado e não assinado".
             */

            evento.asoAssinado =
                null;


            continue;
        }


        // ====================================================
        // ASSINATURA DIGITAL
        // ====================================================
        //
        // O retorno REAL do teste trouxe:
        //
        // ASSINADO_DIGITALMENTE
        //
        // A documentação fala:
        //
        // IC_ASSINADO_DIGITALMENTE
        //
        // Aceitamos os dois.
        //
        // ====================================================

        const assinatura =
            String(
                primeiroCampo(
                    registroAsoGed,
                    [
                        'ASSINADO_DIGITALMENTE',
                        'IC_ASSINADO_DIGITALMENTE',
                        'assinado_digitalmente'
                    ],
                    ''
                )
            ).trim();


        if (
            assinatura === '1'
        ) {

            evento.asoAssinado =
                true;

        } else if (
            assinatura === '0'
        ) {

            evento.asoAssinado =
                false;

        } else {

            evento.asoAssinado =
                null;
        }


        // ====================================================
        // DADOS COMPLEMENTARES DA ASSINATURA
        // ====================================================

        evento.dataAssinaturaAso =
            normalizarData(
                primeiroCampo(
                    registroAsoGed,
                    [
                        'DT_assinatura_digital',
                        'DT_ASSINATURA_DIGITAL',
                        'dt_assinatura_digital'
                    ],
                    ''
                )
            );


        evento.horaAssinaturaAso =
            String(
                primeiroCampo(
                    registroAsoGed,
                    [
                        'HR_assinatura_digital',
                        'HR_ASSINATURA_DIGITAL',
                        'hr_assinatura_digital'
                    ],
                    ''
                )
            ).trim();


        // ====================================================
        // DADOS DO GED
        // ====================================================

        evento.codigoGedAso =
            String(
                primeiroCampo(
                    registroAsoGed,
                    [
                        'CD_GED',
                        'cd_ged'
                    ],
                    ''
                )
            ).trim();


        evento.codigoArquivoGedAso =
            String(
                primeiroCampo(
                    registroAsoGed,
                    [
                        'CD_ARQUIVO_GED',
                        'cd_arquivo_ged'
                    ],
                    ''
                )
            ).trim();


        evento.nomeArquivoGedAso =
            String(
                primeiroCampo(
                    registroAsoGed,
                    [
                        'NM_ARQUIVOS_GED',
                        'nm_arquivos_ged'
                    ],
                    ''
                )
            ).trim();


        // ====================================================
        // LOG
        // ====================================================

        let textoAssinatura =
            'Não informado';


        if (
            evento.asoAssinado === true
        ) {

            textoAssinatura =
                'SIM';

        } else if (
            evento.asoAssinado === false
        ) {

            textoAssinatura =
                'NÃO';
        }


        console.log(
            `✍️ Assinatura ASO | ` +
            `Ficha ${idFicha} | ` +
            `${textoAssinatura} | ` +
            `${evento.nomeArquivoGedAso || 'arquivo não informado'}`
        );
    }


    return eventosValidos;
}


// ============================================================
// REGRA OPERACIONAL S-2220 / S-2240
// ============================================================
//
// S-2220 -> TODOS
//
// S-2240 -> SOMENTE:
//
// 0 = Admissional
// 3 = Mudança de Função/Risco
//
// ============================================================

function aplicarRegraEventosEsocial(
    eventos2220
) {

    if (
        !Array.isArray(
            eventos2220
        ) ||
        eventos2220.length ===
            0
    ) {

        return [];
    }


    const eventosValidos =
        eventos2220.filter(
            evento =>
                evento &&
                typeof evento ===
                    'object'
        );


    const resultado =
        [];


    for (
        const eventoOriginal
        of eventosValidos
    ) {

        const tpExameOcup =
            String(

                eventoOriginal
                    .tpExameOcup ??

                eventoOriginal
                    .tp_exame_ocup ??

                ''

            ).trim();


        // ====================================================
        // S-2220 SEMPRE
        // ====================================================

        resultado.push({

            ...eventoOriginal,

            tipoEvento:
                'S-2220'
        });


        // ====================================================
        // S-2240 APENAS ADMISSIONAL OU MUDANÇA
        // ====================================================

        const precisaS2240 =

            tpExameOcup ===
                '0'

            ||

            tpExameOcup ===
                '3';


        if (
            !precisaS2240
        ) {

            continue;
        }


        resultado.push({

            ...eventoOriginal,

            tipoEvento:
                'S-2240',

            status:
                'pendente',

            numeroRecibo:
                '',

            geradoPorRegra2240:
                true
        });


        console.log(
            `➕ S-2240 necessário: ` +
            `${eventoOriginal.colaborador || 'Funcionário'} | ` +
            `Ficha ${eventoOriginal.idFicha || '-'} | ` +
            `Tipo SOC ${tpExameOcup}`
        );
    }


    const quantidade2220 =
        resultado.filter(
            item =>
                item.tipoEvento ===
                'S-2220'
        ).length;


    const quantidade2240 =
        resultado.filter(
            item =>
                item.tipoEvento ===
                'S-2240'
        ).length;


    console.log(
        `📋 Regra eSocial aplicada: ` +
        `${quantidade2220} S-2220 + ` +
        `${quantidade2240} S-2240`
    );


    return resultado;
}

// ============================================================
// CONFIGURAÇÃO DE ASSINATURA E-SOCIAL
// ============================================================

const ESOCIAL_ALG_ASSINATURA =
    'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';

const ESOCIAL_ALG_DIGEST =
    'http://www.w3.org/2001/04/xmlenc#sha256';

const ESOCIAL_ALG_C14N =
    'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

const ESOCIAL_ALG_ENVELOPED =
    'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

const ESOCIAL_NS_SIGNATURE =
    'http://www.w3.org/2000/09/xmldsig#';


// ============================================================
// CACHE DO CERTIFICADO
// ============================================================

let cacheCertificadoEsocial =
    null;


// ============================================================
// CARREGAR CERTIFICADO A1
// ============================================================

function carregarCertificadoEsocial() {

    if (
        cacheCertificadoEsocial
    ) {

        return cacheCertificadoEsocial;
    }


    // ========================================================
    // CONFIGURAÇÃO
    // ========================================================

    const caminhoConfigurado =
        String(
            process.env.ESOCIAL_CERT_PATH ||
            ''
        ).trim();


    const senha =
        String(
            process.env.ESOCIAL_CERT_PASSWORD ||
            ''
        );


    if (
        !caminhoConfigurado
    ) {

        throw new Error(
            'ESOCIAL_CERT_PATH não configurado.'
        );
    }


    if (
        !senha
    ) {

        throw new Error(
            'ESOCIAL_CERT_PASSWORD não configurado.'
        );
    }


    const caminhoCertificado =
        path.isAbsolute(
            caminhoConfigurado
        )
            ? caminhoConfigurado

            : path.resolve(
                process.cwd(),
                caminhoConfigurado
            );


    if (
        !fs.existsSync(
            caminhoCertificado
        )
    ) {

        throw new Error(
            `Certificado A1 não encontrado em ${caminhoCertificado}`
        );
    }


    // ========================================================
    // LER PFX
    // ========================================================

    const pfxBuffer =
        fs.readFileSync(
            caminhoCertificado
        );


    let p12;


    try {

        const pfxAsn1 =
            forge.asn1.fromDer(
                pfxBuffer.toString(
                    'binary'
                )
            );


        p12 =
            forge.pkcs12.pkcs12FromAsn1(
                pfxAsn1,
                false,
                senha
            );

    } catch (error) {

        throw new Error(
            'Não foi possível abrir o certificado A1. ' +
            'Confira o arquivo e a senha.'
        );
    }


    // ========================================================
    // LOCALIZAR CHAVE PRIVADA
    // ========================================================

    let keyBags =
        p12.getBags({
            bagType:
                forge.pki.oids.pkcs8ShroudedKeyBag
        })[
            forge.pki.oids.pkcs8ShroudedKeyBag
        ] || [];


    if (
        !keyBags.length
    ) {

        keyBags =
            p12.getBags({
                bagType:
                    forge.pki.oids.keyBag
            })[
                forge.pki.oids.keyBag
            ] || [];
    }


    if (
        !keyBags.length
    ) {

        throw new Error(
            'Chave privada não encontrada no certificado A1.'
        );
    }


    const privateKey =
        keyBags[0].key;


    if (
        !privateKey
    ) {

        throw new Error(
            'Não foi possível extrair a chave privada do A1.'
        );
    }


    // ========================================================
    // LOCALIZAR CERTIFICADOS
    // ========================================================

    const certBags =
        p12.getBags({
            bagType:
                forge.pki.oids.certBag
        })[
            forge.pki.oids.certBag
        ] || [];


    if (
        !certBags.length
    ) {

        throw new Error(
            'Nenhum certificado X509 encontrado no PFX.'
        );
    }


    // ========================================================
    // LOCALIZAR CERTIFICADO QUE CORRESPONDE À CHAVE PRIVADA
    // ========================================================

    let certificado =
        null;


    for (
        const bag
        of certBags
    ) {

        const cert =
            bag?.cert;


        if (
            !cert ||
            !cert.publicKey
        ) {

            continue;
        }


        try {

            const moduloCert =
                cert.publicKey.n
                    ?.toString(16);

            const expoenteCert =
                cert.publicKey.e
                    ?.toString(16);

            const moduloPrivado =
                privateKey.n
                    ?.toString(16);

            const expoentePrivado =
                privateKey.e
                    ?.toString(16);


            if (
                moduloCert &&
                moduloPrivado &&
                moduloCert ===
                    moduloPrivado &&
                expoenteCert ===
                    expoentePrivado
            ) {

                certificado =
                    cert;

                break;
            }

        } catch (error) {

            // continua procurando
        }
    }


    if (
        !certificado
    ) {

        throw new Error(
            'Não foi possível localizar no PFX o certificado correspondente à chave privada.'
        );
    }


    // ========================================================
    // VALIDAR VIGÊNCIA
    // ========================================================

    const agora =
        new Date();


    if (
        agora <
        certificado.validity.notBefore
    ) {

        throw new Error(
            'O certificado digital ainda não está válido.'
        );
    }


    if (
        agora >
        certificado.validity.notAfter
    ) {

        throw new Error(
            'O certificado digital está vencido.'
        );
    }


    // ========================================================
    // CONVERTER PARA PEM
    // ========================================================

    const privateKeyPem =
        forge.pki.privateKeyToPem(
            privateKey
        );


    const publicCertPem =
        forge.pki.certificateToPem(
            certificado
        );


    cacheCertificadoEsocial = {

        privateKeyPem,

        publicCertPem,

        validadeInicio:
            certificado.validity.notBefore,

        validadeFim:
            certificado.validity.notAfter
    };


    return cacheCertificadoEsocial;
}


// ============================================================
// VALIDAR ESTRUTURA DA ASSINATURA
// ============================================================

function validarEstruturaAssinaturaEsocial(
    xmlAssinado
) {

    const xml =
        String(
            xmlAssinado ||
            ''
        );


    const erros =
        [];


    if (
        !xml.includes(
            '<Reference URI="">'
        )
    ) {

        erros.push(
            'Reference URI não está vazio.'
        );
    }


    if (
        !xml.includes(
            `SignatureMethod Algorithm="${ESOCIAL_ALG_ASSINATURA}"`
        )
    ) {

        erros.push(
            'Algoritmo RSA-SHA256 não encontrado.'
        );
    }


    if (
        !xml.includes(
            `DigestMethod Algorithm="${ESOCIAL_ALG_DIGEST}"`
        )
    ) {

        erros.push(
            'Digest SHA-256 não encontrado.'
        );
    }


    if (
        !xml.includes(
            `CanonicalizationMethod Algorithm="${ESOCIAL_ALG_C14N}"`
        )
    ) {

        erros.push(
            'Canonicalização C14N não encontrada.'
        );
    }


    if (
        !xml.includes(
            `Transform Algorithm="${ESOCIAL_ALG_ENVELOPED}"`
        )
    ) {

        erros.push(
            'Transform Enveloped não encontrado.'
        );
    }


    if (
        !xml.includes(
            `Transform Algorithm="${ESOCIAL_ALG_C14N}"`
        )
    ) {

        erros.push(
            'Transform C14N não encontrado.'
        );
    }


    if (
        !xml.includes(
            '<X509Certificate>'
        )
    ) {

        erros.push(
            'X509Certificate não encontrado na assinatura.'
        );
    }


    return {

        valida:
            erros.length === 0,

        erros
    };
}


function validarAssinaturaXmlEsocial(
    xmlAssinado,
    publicCertPem
) {

    // ========================================================
    // VALIDAR ENTRADA
    // ========================================================

    const xml =
        String(
            xmlAssinado ||
            ''
        ).trim();


    if (
        !xml
    ) {

        throw new Error(
            'XML assinado não informado.'
        );
    }


    if (
        !publicCertPem
    ) {

        throw new Error(
            'Certificado público não informado para validação.'
        );
    }


    // ========================================================
    // PARSEAR XML
    // ========================================================

    const documento =
        new DOMParser()
            .parseFromString(
                xml,
                'text/xml'
            );


    if (
        !documento ||
        !documento.documentElement
    ) {

        throw new Error(
            'Não foi possível interpretar o XML assinado.'
        );
    }


    // ========================================================
    // PREPARAR VERIFICADOR
    // ========================================================
    //
    // O certificado usado para validar será exatamente
    // aquele extraído do nosso próprio A1.
    //
    // Não confiamos automaticamente em um certificado
    // recebido dentro do XML.
    //
    // ========================================================

    const verificador =
        new SignedXml({

            publicCert:
                publicCertPem,

            getCertFromKeyInfo:
                () => null
        });


    // ========================================================
    // LOCALIZAR SIGNATURE
    // ========================================================
    //
    // xml-crypto 6.1.2 possui findSignatures().
    //
    // Não usamos:
    //
    // require('xml-crypto').xpath
    //
    // pois xpath não é exportado pela versão 6.1.2.
    //
    // ========================================================

    const assinaturas =
        verificador.findSignatures(
            documento
        );


    if (
        !Array.isArray(
            assinaturas
        )
    ) {

        throw new Error(
            'Não foi possível localizar a assinatura XML.'
        );
    }


    if (
        assinaturas.length === 0
    ) {

        throw new Error(
            'Nenhuma assinatura XML foi encontrada.'
        );
    }


    if (
        assinaturas.length > 1
    ) {

        throw new Error(
            `O XML possui ${assinaturas.length} assinaturas. ` +
            'Era esperada exatamente uma.'
        );
    }


    // ========================================================
    // CARREGAR SIGNATURE
    // ========================================================

    verificador.loadSignature(
        assinaturas[0]
    );


    // ========================================================
    // VALIDAR ASSINATURA
    // ========================================================

    let assinaturaValida =
        false;


    try {

        assinaturaValida =
            verificador.checkSignature(
                xml
            );

    } catch (error) {

        throw new Error(
            'Erro ao validar assinatura XML: ' +
            (
                error?.message ||
                String(error)
            )
        );
    }


    if (
        !assinaturaValida
    ) {

        throw new Error(
            'A assinatura XML gerada não passou na validação criptográfica local.'
        );
    }


    // ========================================================
    // VERIFICAR REFERÊNCIAS AUTENTICADAS
    // ========================================================
    //
    // getSignedReferences() deve ser usado somente
    // depois de checkSignature() retornar true.
    //
    // ========================================================

    const referenciasAssinadas =
        verificador
            .getSignedReferences();


    if (
        !Array.isArray(
            referenciasAssinadas
        )
    ) {

        throw new Error(
            'Não foi possível recuperar as referências autenticadas.'
        );
    }


    if (
        referenciasAssinadas.length !== 1
    ) {

        throw new Error(
            'A assinatura precisa possuir exatamente uma referência autenticada. ' +
            `Encontradas: ${referenciasAssinadas.length}.`
        );
    }


    // ========================================================
    // VALIDAR REFERENCE URI=""
    // ========================================================

    if (
        !xml.includes(
            '<Reference URI="">'
        )
    ) {

        throw new Error(
            'A assinatura não possui Reference URI="".'
        );
    }


    // ========================================================
    // RESULTADO
    // ========================================================

    return {

        valida:
            true,

        quantidadeAssinaturas:
            assinaturas.length,

        quantidadeReferencias:
            referenciasAssinadas.length,

        referenceUriVazio:
            true
    };
}


// ============================================================
// ASSINAR XML E-SOCIAL
// ============================================================

function assinarXmlEsocial(
    xmlOriginal
) {

    const xml =
        String(
            xmlOriginal ||
            ''
        ).trim();


    if (
        !xml
    ) {

        throw new Error(
            'XML para assinatura não informado.'
        );
    }


    // ========================================================
    // NÃO ASSINAR DUAS VEZES
    // ========================================================

    if (
        xml.includes(
            ESOCIAL_NS_SIGNATURE
        ) &&
        xml.includes(
            '<Signature'
        )
    ) {

        throw new Error(
            'O XML já possui uma assinatura digital.'
        );
    }


    // ========================================================
    // VALIDAR DOCUMENTO
    // ========================================================

    const documento =
        new DOMParser()
            .parseFromString(
                xml,
                'text/xml'
            );


    if (
        !documento ||
        !documento.documentElement
    ) {

        throw new Error(
            'XML inválido.'
        );
    }


    const raiz =
        documento.documentElement;


    if (
        raiz.localName !==
        'eSocial'
    ) {

        throw new Error(
            'O elemento raiz do XML precisa ser eSocial.'
        );
    }


    // ========================================================
    // CARREGAR A1
    // ========================================================

    const certificado =
        carregarCertificadoEsocial();


    // ========================================================
    // CONFIGURAR XMLDSIG
    // ========================================================

    const assinatura =
        new SignedXml({

            privateKey:
                certificado.privateKeyPem,

            publicCert:
                certificado.publicCertPem,

            signatureAlgorithm:
                ESOCIAL_ALG_ASSINATURA,

            canonicalizationAlgorithm:
                ESOCIAL_ALG_C14N
        });


    // ========================================================
    // REFERÊNCIA
    // ========================================================
    //
    // IMPORTANTE PARA O E-SOCIAL:
    //
    // URI=""
    //
    // A versão 6.1.2 suporta isso através de:
    //
    // isEmptyUri: true
    //
    // ========================================================

    assinatura.addReference({

        xpath:
            "/*[local-name(.)='eSocial']",

        transforms: [

            ESOCIAL_ALG_ENVELOPED,

            ESOCIAL_ALG_C14N
        ],

        digestAlgorithm:
            ESOCIAL_ALG_DIGEST,

        isEmptyUri:
            true
    });


    // ========================================================
    // CALCULAR ASSINATURA
    // ========================================================
    //
    // A Signature será filha de <eSocial>, depois de evtMonit.
    //
    // ========================================================

    assinatura.computeSignature(
        xml,
        {

            location: {

                reference:
                    "/*[local-name(.)='eSocial']",

                action:
                    'append'
            }
        }
    );


    const xmlAssinado =
        assinatura.getSignedXml();


    if (
        !xmlAssinado
    ) {

        throw new Error(
            'A biblioteca não retornou o XML assinado.'
        );
    }


    // ========================================================
    // VALIDAR ESTRUTURA
    // ========================================================

    const estrutura =
        validarEstruturaAssinaturaEsocial(
            xmlAssinado
        );


    if (
        !estrutura.valida
    ) {

        throw new Error(
            'Estrutura da assinatura eSocial inválida: ' +
            estrutura.erros.join('; ')
        );
    }


    // ========================================================
    // VALIDAR CRIPTOGRAFICAMENTE
    // ========================================================

    validarAssinaturaXmlEsocial(
        xmlAssinado,
        certificado.publicCertPem
    );


    // ========================================================
    // RESULTADO
    // ========================================================

    return {

        success:
            true,

        assinaturaValida:
            true,

        referenceUri:
            '',

        algoritmoAssinatura:
            ESOCIAL_ALG_ASSINATURA,

        algoritmoDigest:
            ESOCIAL_ALG_DIGEST,

        canonicalizacao:
            ESOCIAL_ALG_C14N,

        xmlAssinado
    };
}


async function salvarEventos(
    eventos
) {

    const db =
        getSupabase();


    const salvos =
        [];


    // ========================================================
    // VALIDAR
    // ========================================================

    if (
        !Array.isArray(eventos) ||
        eventos.length === 0
    ) {

        return salvos;
    }


    // ========================================================
    // AUXILIAR JSON ARRAY
    // ========================================================

    const normalizarListaJson =
        valor => {

            if (
                Array.isArray(valor)
            ) {

                return valor;
            }


            if (
                valor &&
                typeof valor === 'object'
            ) {

                return [
                    valor
                ];
            }


            if (
                typeof valor === 'string' &&
                valor.trim()
            ) {

                try {

                    const parsed =
                        JSON.parse(
                            valor
                        );


                    if (
                        Array.isArray(parsed)
                    ) {

                        return parsed;
                    }


                    if (
                        parsed &&
                        typeof parsed ===
                        'object'
                    ) {

                        return [
                            parsed
                        ];
                    }

                } catch (error) {

                    return [];
                }
            }


            return [];
        };


    // ========================================================
    // AUXILIAR TEXTO PARA LOG/RETORNO
    // ========================================================

    const serializarTexto =
        valor => {

            if (
                valor === undefined ||
                valor === null
            ) {

                return null;
            }


            if (
                typeof valor === 'string'
            ) {

                return valor;
            }


            try {

                return JSON.stringify(
                    valor
                );

            } catch (error) {

                return String(
                    valor
                );
            }
        };


    // ========================================================
    // PROCESSAR
    // ========================================================

    for (
        const item
        of eventos
    ) {

        if (
            !item ||
            typeof item !== 'object'
        ) {

            continue;
        }


        try {

            // ====================================================
            // IDENTIFICAÇÃO
            // ====================================================

            const codigoEmpresa =
                String(
                    item.codigoEmpresa ||
                    item.codigo_empresa ||
                    ''
                ).trim();


            const codigoFuncionario =
                String(
                    item.codigoFuncionario ||
                    item.codigo_funcionario ||
                    ''
                ).trim();


            const idFichaSoc =
                String(
                    item.idFicha ||
                    item.id_ficha_soc ||
                    ''
                ).trim();


            const tipoEvento =
                String(
                    item.tipoEvento ||
                    item.tipo_evento ||
                    ''
                )
                    .trim()
                    .toUpperCase();


            const tipoExame =
                String(
                    item.tipoExame ||
                    item.tipo_exame ||
                    ''
                ).trim();


            // ====================================================
            // EMPRESA
            // ====================================================

            const holding =
                String(
                    item.holding ||
                    ''
                ).trim();


            const unidade =
                String(
                    item.unidade ||
                    ''
                ).trim();


            const cnpjUnidade =
                normalizarCnpj(
                    item.cnpjUnidade ||
                    item.cnpj_unidade ||
                    ''
                );


            // ====================================================
            // EMPREGADOR E-SOCIAL
            // ====================================================

            const tpInscEmpregador =
                String(
                    item.tpInscEmpregador ||
                    item.tp_insc_empregador ||
                    ''
                ).trim();


            const nrInscEmpregador =
                String(
                    item.nrInscEmpregador ||
                    item.nr_insc_empregador ||
                    ''
                )
                    .replace(
                        /[^0-9A-Za-z]/g,
                        ''
                    )
                    .toUpperCase()
                    .trim();


            // ====================================================
            // FUNCIONÁRIO
            // ====================================================

            const colaborador =
                String(
                    item.colaborador ||
                    ''
                ).trim();


            const cpf =
                normalizarCpf(
                    item.cpf ||
                    ''
                );


            const matricula =
                String(
                    item.matricula ||
                    ''
                ).trim();


            const codCateg =
                String(
                    item.codCateg ||
                    item.cod_categ ||
                    ''
                ).trim();


            // ====================================================
            // TIPO EXAME OCUPACIONAL
            // ====================================================

            const tpExameOcup =
                String(
                    item.tpExameOcup ||
                    item.tp_exame_ocup ||
                    ''
                ).trim();


            // ====================================================
            // DATA
            // ====================================================

            const dataExameValor =
                item.dataExame ||
                item.data_exame ||
                '';


            const dataExame =
                dataExameValor
                    ? normalizarData(
                        dataExameValor
                    )
                    : null;


            // ====================================================
            // ASO
            // ====================================================

            const aso =
                String(
                    item.aso ||
                    ''
                );


            const resultadoAso =
                String(
                    item.resultadoAso ||
                    item.resultado_aso ||
                    ''
                ).trim();


            let asoApto =
                null;


            if (
                item.asoApto === true ||
                item.aso_apto === true
            ) {

                asoApto =
                    true;

            } else if (
                item.asoApto === false ||
                item.aso_apto === false
            ) {

                asoApto =
                    false;
            }


            // ====================================================
            // DATA DO ASO
            // ====================================================

            const dataEmissaoAsoValor =
                item.dataEmissaoAso ||
                item.data_emissao_aso ||
                '';


            const dataEmissaoAso =
                dataEmissaoAsoValor
                    ? normalizarData(
                        dataEmissaoAsoValor
                    )
                    : dataExame;


            // ====================================================
            // ASSINATURA DO DOCUMENTO ASO
            // ====================================================

            let asoAssinado =
                null;


            if (
                item.asoAssinado === true ||
                item.aso_assinado === true
            ) {

                asoAssinado =
                    true;

            } else if (
                item.asoAssinado === false ||
                item.aso_assinado === false
            ) {

                asoAssinado =
                    false;
            }


            // ====================================================
            // MÉDICO
            // ====================================================

            const medicoEmitente =
                String(
                    item.medicoEmitente ||
                    item.medico_emitente ||
                    ''
                ).trim();


            const medicoCrm =
                String(
                    item.medicoCrm ||
                    item.medico_crm ||
                    ''
                ).trim();


            const medicoUfCrm =
                String(
                    item.medicoUfCrm ||
                    item.medico_uf_crm ||
                    ''
                )
                    .trim()
                    .toUpperCase();


            // ====================================================
            // RESPONSÁVEL PCMSO
            // ====================================================

            const responsavelPcmso =
                String(
                    item.responsavel ||
                    item.responsavelPcmso ||
                    item.responsavel_pcmso ||
                    ''
                ).trim();


            const cpfResponsavelPcmso =
                normalizarCpf(
                    item.cpfResponsavel ||
                    item.cpfResponsavelPcmso ||
                    item.cpf_responsavel_pcmso ||
                    ''
                );


            const crmResponsavelPcmso =
                String(
                    item.conselhoResponsavel ||
                    item.crmResponsavelPcmso ||
                    item.crm_responsavel_pcmso ||
                    ''
                ).trim();


            const ufCrmResponsavelPcmso =
                String(
                    item.ufConselhoResponsavel ||
                    item.ufCrmResponsavelPcmso ||
                    item.uf_crm_responsavel_pcmso ||
                    ''
                )
                    .trim()
                    .toUpperCase();


            // ====================================================
            // EXAMES
            // ====================================================

            const examesAso =
                normalizarListaJson(
                    item.exames ||
                    item.examesAso ||
                    item.exames_aso ||
                    []
                );


            // ====================================================
            // 29169
            // ====================================================

            const cargoColaborador =
                String(
                    item.cargoColaborador ||
                    item.cargo_colaborador ||
                    ''
                ).trim();


            const setorColaborador =
                String(
                    item.setorColaborador ||
                    item.setor_colaborador ||
                    ''
                ).trim();


            const aptidaoAso =
                String(
                    item.aptidaoAso ||
                    item.aptidao_aso ||
                    ''
                ).trim();


            const riscosAso =
                normalizarListaJson(
                    item.riscosAso ||
                    item.riscos_aso ||
                    []
                );


            // ====================================================
            // 6603 - STATUS E-SOCIAL NO SOC
            // ====================================================

            const statusEventoSocNovo =
                String(
                    item.statusEventoSoc ||
                    item.status_evento_soc ||
                    ''
                ).trim();


            let eventoAssinadoNovo =
                null;


            if (
                item.eventoAssinado === true ||
                item.evento_assinado === true
            ) {

                eventoAssinadoNovo =
                    true;

            } else if (
                item.eventoAssinado === false ||
                item.evento_assinado === false
            ) {

                eventoAssinadoNovo =
                    false;
            }


            const numeroReciboNovo =
                String(
                    item.numeroRecibo ||
                    item.numero_recibo ||
                    ''
                ).trim();


            const erroEsocialNovo =
                String(
                    item.erroEsocial ||
                    item.erro_esocial ||
                    ''
                ).trim();


            const codigoErroEsocialNovo =
                String(
                    item.codigoErroEsocial ||
                    item.codigo_erro_esocial ||
                    ''
                ).trim();


            const idArquivoEsocialNovo =
                String(
                    item.idArquivoEsocial ||
                    item.id_arquivo_esocial ||
                    ''
                ).trim();


            const dataGeracaoEventoValor =
                item.dataGeracaoEvento ||
                item.data_geracao_evento ||
                '';


            const dataGeracaoEventoNova =
                dataGeracaoEventoValor
                    ? normalizarData(
                        dataGeracaoEventoValor
                    )
                    : null;


            // ====================================================
            // VALIDAR
            // ====================================================

            if (
                !codigoEmpresa
            ) {

                console.warn(
                    '⚠️ Evento ignorado: codigoEmpresa ausente.',
                    {
                        idFichaSoc,
                        tipoEvento
                    }
                );

                continue;
            }


            if (
                !tipoEvento
            ) {

                console.warn(
                    '⚠️ Evento ignorado: tipoEvento ausente.',
                    {
                        codigoEmpresa,
                        idFichaSoc
                    }
                );

                continue;
            }


            // ====================================================
            // PROCURAR EXISTENTE
            // ====================================================

            let existente =
                null;


            const camposExistentes =
                [
                    'id',
                    'status',
                    'numero_recibo',
                    'status_evento_soc',
                    'evento_assinado',
                    'erro_esocial',
                    'codigo_erro_esocial',
                    'id_arquivo_esocial',
                    'data_geracao_evento',

                    'id_evento_esocial',
                    'protocolo_envio',
                    'xml_gerado',
                    'xml_assinado',
                    'retorno_envio',
                    'retorno_processamento',
                    'data_envio',
                    'ambiente_esocial'
                ].join(', ');


            if (
                idFichaSoc
            ) {

                const {
                    data,
                    error
                } =

                    await db

                        .from(
                            'esocial_eventos'
                        )

                        .select(
                            camposExistentes
                        )

                        .eq(
                            'codigo_empresa',
                            codigoEmpresa
                        )

                        .eq(
                            'tipo_evento',
                            tipoEvento
                        )

                        .eq(
                            'id_ficha_soc',
                            idFichaSoc
                        )

                        .limit(1)

                        .maybeSingle();


                if (
                    error
                ) {

                    throw error;
                }


                existente =
                    data ||
                    null;
            }


            // ====================================================
            // FALLBACK SEM IDFICHA
            // ====================================================

            if (
                !existente &&
                !idFichaSoc
            ) {

                let query =

                    db

                        .from(
                            'esocial_eventos'
                        )

                        .select(
                            camposExistentes
                        )

                        .eq(
                            'codigo_empresa',
                            codigoEmpresa
                        )

                        .eq(
                            'tipo_evento',
                            tipoEvento
                        );


                if (
                    cpf
                ) {

                    query =
                        query.eq(
                            'cpf',
                            cpf
                        );

                } else if (
                    codigoFuncionario
                ) {

                    query =
                        query.eq(
                            'codigo_funcionario',
                            codigoFuncionario
                        );
                }


                if (
                    dataExame
                ) {

                    query =
                        query.eq(
                            'data_exame',
                            dataExame
                        );
                }


                if (
                    tipoExame
                ) {

                    query =
                        query.eq(
                            'tipo_exame',
                            tipoExame
                        );
                }


                const {
                    data,
                    error
                } =

                    await query
                        .limit(1)
                        .maybeSingle();


                if (
                    error
                ) {

                    throw error;
                }


                existente =
                    data ||
                    null;
            }


            // ====================================================
            // PRESERVAR STATUS 6603 EXISTENTE
            // ====================================================

            const statusEventoSocFinal =
                statusEventoSocNovo ||
                existente?.status_evento_soc ||
                null;


            const numeroReciboFinal =
                numeroReciboNovo ||
                existente?.numero_recibo ||
                null;


            const eventoAssinadoFinal =
                eventoAssinadoNovo !== null
                    ? eventoAssinadoNovo
                    : (
                        existente?.evento_assinado ??
                        null
                    );


            const erroEsocialFinal =
                erroEsocialNovo ||
                existente?.erro_esocial ||
                null;


            const codigoErroEsocialFinal =
                codigoErroEsocialNovo ||
                existente?.codigo_erro_esocial ||
                null;


            const idArquivoEsocialFinal =
                idArquivoEsocialNovo ||
                existente?.id_arquivo_esocial ||
                null;


            const dataGeracaoEventoFinal =
                dataGeracaoEventoNova ||
                existente?.data_geracao_evento ||
                null;


            // ====================================================
            // STATUS INTERNO
            // ====================================================

            const statusSocNormalizado =
                String(
                    statusEventoSocFinal ||
                    ''
                )
                    .trim()
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(
                        /[\u0300-\u036f]/g,
                        ''
                    );


            let statusSistema =
                String(
                    existente?.status ||
                    item.status ||
                    'pendente'
                )
                    .trim()
                    .toLowerCase();


            if (
                statusSocNormalizado.includes(
                    'inconsist'
                ) ||
                statusSocNormalizado ===
                    'erro'
            ) {

                statusSistema =
                    'erro';

            } else if (
                statusSocNormalizado.includes(
                    'conclu'
                ) &&
                numeroReciboFinal
            ) {

                statusSistema =
                    'sucesso';

            } else if (
                statusSocNormalizado ===
                    'excluido'
            ) {

                statusSistema =
                    'cancelado';

            } else if (
                [
                    'pendente',
                    'assinado',
                    'processando',
                    'apto para envio',
                    'reprocessar',
                    'reprocessado'
                ].includes(
                    statusSocNormalizado
                )
            ) {

                statusSistema =
                    'pendente';
            }


            // ====================================================
            // DADOS DE TRANSMISSÃO DIRETA
            // ====================================================
            //
            // IMPORTANTE:
            //
            // Uma nova busca no SOC NÃO pode apagar XML,
            // protocolo ou retorno que já salvamos.
            //
            // ====================================================

            const idEventoEsocialFinal =
                String(
                    item.idEventoEsocial ||
                    item.id_evento_esocial ||
                    existente?.id_evento_esocial ||
                    ''
                ).trim() ||
                null;


            const protocoloEnvioFinal =
                String(
                    item.protocoloEnvio ||
                    item.protocolo_envio ||
                    existente?.protocolo_envio ||
                    ''
                ).trim() ||
                null;


            const xmlGeradoFinal =
                String(
                    item.xmlGerado ||
                    item.xml_gerado ||
                    existente?.xml_gerado ||
                    ''
                ) ||
                null;


            const xmlAssinadoFinal =
                String(
                    item.xmlAssinado ||
                    item.xml_assinado ||
                    existente?.xml_assinado ||
                    ''
                ) ||
                null;


            const retornoEnvioFinal =
                serializarTexto(
                    item.retornoEnvio ??
                    item.retorno_envio ??
                    existente?.retorno_envio
                );


            const retornoProcessamentoFinal =
                serializarTexto(
                    item.retornoProcessamento ??
                    item.retorno_processamento ??
                    existente?.retorno_processamento
                );


            const dataEnvioFinal =
                item.dataEnvio ||
                item.data_envio ||
                existente?.data_envio ||
                null;


            let ambienteEsocialFinal =
                item.ambienteEsocial ??
                item.ambiente_esocial ??
                existente?.ambiente_esocial ??
                process.env.ESOCIAL_AMBIENTE ??
                2;


            ambienteEsocialFinal =
                Number(
                    ambienteEsocialFinal
                );


            if (
                ambienteEsocialFinal !== 1 &&
                ambienteEsocialFinal !== 2
            ) {

                ambienteEsocialFinal =
                    2;
            }


            // ====================================================
            // DADOS PARA SUPABASE
            // ====================================================

            const dadosBanco = {

                // ------------------------------------------------
                // EMPRESA
                // ------------------------------------------------

                holding:
                    holding ||
                    'N/A',

                unidade:
                    unidade ||
                    'N/A',

                cnpj_unidade:
                    cnpjUnidade ||
                    null,

                codigo_empresa:
                    codigoEmpresa,


                // ------------------------------------------------
                // EMPREGADOR E-SOCIAL
                // ------------------------------------------------

                tp_insc_empregador:
                    tpInscEmpregador ||
                    null,

                nr_insc_empregador:
                    nrInscEmpregador ||
                    null,


                // ------------------------------------------------
                // FUNCIONÁRIO
                // ------------------------------------------------

                colaborador:
                    colaborador ||
                    'N/A',

                cpf:
                    cpf ||
                    null,

                codigo_funcionario:
                    codigoFuncionario ||
                    null,

                matricula:
                    matricula ||
                    null,

                cod_categ:
                    codCateg ||
                    null,


                // ------------------------------------------------
                // FICHA
                // ------------------------------------------------

                id_ficha_soc:
                    idFichaSoc ||
                    null,


                // ------------------------------------------------
                // EVENTO
                // ------------------------------------------------

                tipo_evento:
                    tipoEvento,

                tipo_exame:
                    tipoExame ||
                    null,

                tp_exame_ocup:
                    tpExameOcup ||
                    null,

                data_exame:
                    dataExame,

                status:
                    statusSistema,


                // ------------------------------------------------
                // ASO
                // ------------------------------------------------

                aso:
                    aso ||
                    '',

                aso_apto:
                    asoApto,

                resultado_aso:
                    resultadoAso ||
                    null,

                data_emissao_aso:
                    dataEmissaoAso ||
                    null,

                aso_assinado:
                    asoAssinado,


                // ------------------------------------------------
                // EXAMES E-SOCIAL
                // ------------------------------------------------

                exames_aso:
                    examesAso.length
                        ? examesAso
                        : null,


                // ------------------------------------------------
                // MÉDICO
                // ------------------------------------------------

                medico_emitente:
                    medicoEmitente ||
                    null,

                medico_crm:
                    medicoCrm ||
                    null,

                medico_uf_crm:
                    medicoUfCrm ||
                    null,


                // ------------------------------------------------
                // RESPONSÁVEL PCMSO
                // ------------------------------------------------

                responsavel_pcmso:
                    responsavelPcmso ||
                    null,

                cpf_responsavel_pcmso:
                    cpfResponsavelPcmso ||
                    null,

                crm_responsavel_pcmso:
                    crmResponsavelPcmso ||
                    null,

                uf_crm_responsavel_pcmso:
                    ufCrmResponsavelPcmso ||
                    null,


                // ------------------------------------------------
                // DADOS OCUPACIONAIS
                // ------------------------------------------------

                cargo_colaborador:
                    cargoColaborador ||
                    null,

                setor_colaborador:
                    setorColaborador ||
                    null,

                aptidao_aso:
                    aptidaoAso ||
                    null,

                riscos_aso:
                    riscosAso.length
                        ? riscosAso
                        : null,


                // ------------------------------------------------
                // STATUS SOC / 6603
                // ------------------------------------------------

                status_evento_soc:
                    statusEventoSocFinal,

                evento_assinado:
                    eventoAssinadoFinal,

                numero_recibo:
                    numeroReciboFinal,

                erro_esocial:
                    erroEsocialFinal,

                codigo_erro_esocial:
                    codigoErroEsocialFinal,

                id_arquivo_esocial:
                    idArquivoEsocialFinal,

                data_geracao_evento:
                    dataGeracaoEventoFinal,


                // ------------------------------------------------
                // NOSSA TRANSMISSÃO DIRETA
                // ------------------------------------------------

                id_evento_esocial:
                    idEventoEsocialFinal,

                protocolo_envio:
                    protocoloEnvioFinal,

                xml_gerado:
                    xmlGeradoFinal,

                xml_assinado:
                    xmlAssinadoFinal,

                retorno_envio:
                    retornoEnvioFinal,

                retorno_processamento:
                    retornoProcessamentoFinal,

                data_envio:
                    dataEnvioFinal,

                ambiente_esocial:
                    ambienteEsocialFinal,


                // ------------------------------------------------
                // CONTROLE
                // ------------------------------------------------

                updated_at:
                    new Date()
                        .toISOString()
            };


            // ====================================================
            // UPDATE
            // ====================================================

            if (
                existente
            ) {

                console.log(
                    `♻️ Atualizando: ` +
                    `${colaborador} | ` +
                    `${tipoEvento} | ` +
                    `Ficha ${idFichaSoc || '-'}`
                );


                const {
                    error:
                        erroUpdate
                } =

                    await db

                        .from(
                            'esocial_eventos'
                        )

                        .update(
                            dadosBanco
                        )

                        .eq(
                            'id',
                            existente.id
                        );


                if (
                    erroUpdate
                ) {

                    throw erroUpdate;
                }


                salvos.push({

                    ...item,

                    id:
                        existente.id,

                    tipoEvento,

                    tipo_evento:
                        tipoEvento,

                    matricula,

                    codCateg,

                    cod_categ:
                        codCateg,

                    tpInscEmpregador,

                    tp_insc_empregador:
                        tpInscEmpregador,

                    nrInscEmpregador,

                    nr_insc_empregador:
                        nrInscEmpregador,

                    tpExameOcup,

                    tp_exame_ocup:
                        tpExameOcup,

                    exames:
                        examesAso,

                    examesAso:
                        examesAso,

                    exames_aso:
                        examesAso,

                    responsavel:
                        responsavelPcmso,

                    responsavel_pcmso:
                        responsavelPcmso,

                    cpfResponsavel:
                        cpfResponsavelPcmso,

                    cpf_responsavel_pcmso:
                        cpfResponsavelPcmso,

                    conselhoResponsavel:
                        crmResponsavelPcmso,

                    crm_responsavel_pcmso:
                        crmResponsavelPcmso,

                    ufConselhoResponsavel:
                        ufCrmResponsavelPcmso,

                    uf_crm_responsavel_pcmso:
                        ufCrmResponsavelPcmso,

                    cargoColaborador,

                    setorColaborador,

                    aptidaoAso,

                    riscosAso,

                    status:
                        statusSistema,

                    numeroRecibo:
                        numeroReciboFinal ||
                        '',

                    numero_recibo:
                        numeroReciboFinal,

                    statusEventoSoc:
                        statusEventoSocFinal,

                    status_evento_soc:
                        statusEventoSocFinal,

                    eventoAssinado:
                        eventoAssinadoFinal,

                    evento_assinado:
                        eventoAssinadoFinal,

                    atualizado:
                        true,

                    novo:
                        false
                });


                continue;
            }


            // ====================================================
            // INSERT
            // ====================================================

            console.log(
                `➕ Inserindo: ` +
                `${colaborador} | ` +
                `${tipoEvento} | ` +
                `Ficha ${idFichaSoc || '-'}`
            );


            const {
                data:
                    inserido,

                error:
                    erroInsert
            } =

                await db

                    .from(
                        'esocial_eventos'
                    )

                    .insert([
                        {

                            ...dadosBanco,

                            created_at:
                                new Date()
                                    .toISOString()
                        }
                    ])

                    .select(
                        'id'
                    )

                    .single();


            if (
                erroInsert
            ) {

                throw erroInsert;
            }


            salvos.push({

                ...item,

                id:
                    inserido.id,

                tipoEvento,

                tipo_evento:
                    tipoEvento,

                matricula,

                codCateg,

                cod_categ:
                    codCateg,

                tpInscEmpregador,

                tp_insc_empregador:
                    tpInscEmpregador,

                nrInscEmpregador,

                nr_insc_empregador:
                    nrInscEmpregador,

                tpExameOcup,

                tp_exame_ocup:
                    tpExameOcup,

                exames:
                    examesAso,

                examesAso:
                    examesAso,

                exames_aso:
                    examesAso,

                responsavel:
                    responsavelPcmso,

                responsavel_pcmso:
                    responsavelPcmso,

                cpfResponsavel:
                    cpfResponsavelPcmso,

                cpf_responsavel_pcmso:
                    cpfResponsavelPcmso,

                conselhoResponsavel:
                    crmResponsavelPcmso,

                crm_responsavel_pcmso:
                    crmResponsavelPcmso,

                ufConselhoResponsavel:
                    ufCrmResponsavelPcmso,

                uf_crm_responsavel_pcmso:
                    ufCrmResponsavelPcmso,

                cargoColaborador,

                setorColaborador,

                aptidaoAso,

                riscosAso,

                status:
                    statusSistema,

                numeroRecibo:
                    numeroReciboFinal ||
                    '',

                numero_recibo:
                    numeroReciboFinal,

                statusEventoSoc:
                    statusEventoSocFinal,

                status_evento_soc:
                    statusEventoSocFinal,

                eventoAssinado:
                    eventoAssinadoFinal,

                evento_assinado:
                    eventoAssinadoFinal,

                atualizado:
                    false,

                novo:
                    true
            });


        } catch (error) {

            console.error(
                '❌ Erro ao salvar evento eSocial:',
                {

                    idFicha:
                        item?.idFicha ||
                        item?.id_ficha_soc,

                    tipoEvento:
                        item?.tipoEvento ||
                        item?.tipo_evento,

                    erro:
                        error?.message ||
                        error
                }
            );


            throw error;
        }
    }


    // ========================================================
    // RESUMO
    // ========================================================

    const qtd2220 =
        salvos.filter(
            item =>
                (
                    item.tipoEvento ||
                    item.tipo_evento
                ) === 'S-2220'
        ).length;


    const qtd2240 =
        salvos.filter(
            item =>
                (
                    item.tipoEvento ||
                    item.tipo_evento
                ) === 'S-2240'
        ).length;


    console.log(
        `💾 Eventos salvos: ` +
        `${salvos.length} total | ` +
        `${qtd2220} S-2220 | ` +
        `${qtd2240} S-2240`
    );


    return salvos;
}

// ============================================================
// COMUNICAÇÃO DIRETA E-SOCIAL - ENVIO DE LOTE
// ============================================================

const ESOCIAL_NAMESPACE_LOTE_ENVIO =
    'http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_1';


const ESOCIAL_NAMESPACE_SERVICO_ENVIO =
    'http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0';


const ESOCIAL_SOAP_ACTION_ENVIO =
    'http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0/ServicoEnviarLoteEventos/EnviarLoteEventos';


const ESOCIAL_URL_ENVIO_PRODUCAO =
    'https://webservices.envio.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc';


// ============================================================
// AMBIENTE / TRAVA DE PRODUÇÃO
// ============================================================

function obterAmbienteEsocialConfigurado() {

    const ambiente =
        Number(
            process.env.ESOCIAL_AMBIENTE ||
            2
        );


    if (
        ambiente !== 1 &&
        ambiente !== 2
    ) {

        throw new Error(
            'ESOCIAL_AMBIENTE deve ser 1 (Produção) ou 2 (Produção Restrita).'
        );
    }


    return ambiente;
}


function producaoEsocialExplicitamentePermitida() {

    const valor =
        String(
            process.env.ESOCIAL_PERMITIR_PRODUCAO ||
            ''
        )
            .trim()
            .toLowerCase();


    return [
        '1',
        'true',
        'sim',
        'yes',
        'on'
    ].includes(
        valor
    );
}


function obterUrlEnvioEsocial(
    ambiente
) {

    return Number(
        ambiente
    ) === 1
        ? ESOCIAL_URL_ENVIO_PRODUCAO
        : ESOCIAL_URL_ENVIO_RESTRITA;
}


// ============================================================
// NORMALIZAR DOCUMENTO
// ============================================================

function normalizarDocumentoEsocial(
    valor
) {

    return String(
        valor ||
        ''
    )
        .replace(
            /[^0-9A-Za-z]/g,
            ''
        )
        .toUpperCase()
        .trim();
}


// ============================================================
// COLETAR CONTEÚDO ASN.1
// ============================================================

function coletarConteudoAsn1(
    no,
    resultado = []
) {

    if (!no) {
        return resultado;
    }


    if (
        Array.isArray(
            no.value
        )
    ) {

        for (
            const filho
            of no.value
        ) {

            coletarConteudoAsn1(
                filho,
                resultado
            );
        }


        return resultado;
    }


    if (
        typeof no.value !==
        'string'
    ) {

        return resultado;
    }


    if (
        no.type ===
        forge.asn1.Type.OID
    ) {

        try {

            resultado.push({

                tipo:
                    'oid',

                valor:
                    forge.asn1.derToOid(
                        no.value
                    )
            });

        } catch (error) {

            // ignorar
        }


        return resultado;
    }


    let textoValor =
        no.value;


    try {

        textoValor =
            forge.util.decodeUtf8(
                no.value
            );

    } catch (error) {

        // mantém o valor original
    }


    resultado.push({

        tipo:
            'texto',

        valor:
            textoValor
    });


    return resultado;
}


// ============================================================
// EXTRAIR OTHERNAME POR OID
// ============================================================

function extrairOtherNameCertificado(
    certificado,
    oidProcurado
) {

    if (!certificado) {
        return '';
    }


    const extensao =
        certificado.getExtension(
            'subjectAltName'
        );


    if (
        !extensao ||
        !Array.isArray(
            extensao.altNames
        )
    ) {

        return '';
    }


    for (
        const altName
        of extensao.altNames
    ) {

        /*
         * type 0 = otherName
         */

        if (
            Number(
                altName.type
            ) !== 0
        ) {

            continue;
        }


        let objetoAsn1 =
            altName.value;


        try {

            if (
                typeof objetoAsn1 ===
                'string'
            ) {

                objetoAsn1 =
                    forge.asn1.fromDer(
                        objetoAsn1
                    );
            }

        } catch (error) {

            continue;
        }


        const campos =
            coletarConteudoAsn1(
                objetoAsn1,
                []
            );


        const possuiOid =
            campos.some(
                campo =>
                    campo.tipo === 'oid' &&
                    campo.valor === oidProcurado
            );


        if (!possuiOid) {
            continue;
        }


        const textos =
            campos

                .filter(
                    campo =>
                        campo.tipo === 'texto'
                )

                .map(
                    campo =>
                        String(
                            campo.valor ||
                            ''
                        )
                );


        return textos.join('');
    }


    return '';
}


// ============================================================
// IDENTIFICAÇÃO DO TRANSMISSOR PELO A1
// ============================================================

function carregarIdentificacaoTransmissorDoA1() {

    const dadosCertificado =
        carregarCertificadoEsocial();


    if (
        !dadosCertificado ||
        !dadosCertificado.publicCertPem
    ) {

        throw new Error(
            'Certificado público do A1 não disponível.'
        );
    }


    const certificado =
        forge.pki.certificateFromPem(
            dadosCertificado.publicCertPem
        );


    // ========================================================
    // 1. TENTAR CNPJ PELO OID ICP-BRASIL
    // ========================================================
    //
    // 2.16.76.1.3.3 = CNPJ da pessoa jurídica
    //
    // ========================================================

    let cnpj =
        normalizarDocumentoEsocial(
            extrairOtherNameCertificado(
                certificado,
                '2.16.76.1.3.3'
            )
        );


    /*
     * Eventuais bytes ASN.1 podem acompanhar o texto.
     * Para certificados numéricos ICP-Brasil procuramos
     * os 14 dígitos.
     */

    const matchCnpjOtherName =
        cnpj.match(
            /(\d{14})/
        );


    if (
        matchCnpjOtherName
    ) {

        cnpj =
            matchCnpjOtherName[1];
    }


    // ========================================================
    // 2. FALLBACK PELO CN
    // ========================================================

    if (
        !/^\d{14}$/.test(
            cnpj
        )
    ) {

        const campoCn =
            certificado.subject
                .getField(
                    'CN'
                );


        const cn =
            String(
                campoCn?.value ||
                ''
            );


        const matchCnpj =
            cn.match(
                /(\d{14})(?!\d)/
            );


        if (
            matchCnpj
        ) {

            cnpj =
                matchCnpj[1];
        }
    }


    // ========================================================
    // 3. FALLBACK OPCIONAL POR ENV
    // ========================================================

    if (
        !/^\d{14}$/.test(
            cnpj
        )
    ) {

        const cnpjEnv =
            normalizarDocumentoEsocial(
                process.env
                    .ESOCIAL_TRANSMISSOR_CNPJ
            );


        if (
            /^\d{14}$/.test(
                cnpjEnv
            )
        ) {

            cnpj =
                cnpjEnv;
        }
    }


    if (
        !/^\d{14}$/.test(
            cnpj
        )
    ) {

        throw new Error(
            'Não foi possível identificar automaticamente o CNPJ ' +
            'do transmissor no certificado A1.'
        );
    }


    return {

        tpInsc:
            '1',

        nrInsc:
            cnpj
    };
}


// ============================================================
// REMOVER DECLARAÇÃO XML
// ============================================================

function removerDeclaracaoXml(
    xml
) {

    return String(
        xml ||
        ''
    )
        .replace(
            /^\s*<\?xml[^?]*\?>\s*/i,
            ''
        )
        .trim();
}


// ============================================================
// EXTRAIR ID INTERNO DO EVENTO
// ============================================================

function extrairIdInternoEventoEsocial(
    xml
) {

    const conteudo =
        String(
            xml ||
            ''
        );


    const match =
        conteudo.match(
            /<(?:(?:\w+):)?evtMonit\b[^>]*\bId="([^"]+)"/i
        );


    return match
        ? String(match[1]).trim()
        : '';
}


function montarLoteEsocial({
    eventos,
    transmissor
}) {

    // ========================================================
    // VALIDAR EVENTOS
    // ========================================================

    if (
        !Array.isArray(eventos) ||
        eventos.length === 0
    ) {

        throw new Error(
            'Nenhum evento informado para o lote.'
        );
    }


    if (
        eventos.length > 50
    ) {

        throw new Error(
            'O eSocial permite no máximo 50 eventos por lote.'
        );
    }


    // ========================================================
    // VALIDAR TRANSMISSOR
    // ========================================================

    if (
        !transmissor ||
        !transmissor.tpInsc ||
        !transmissor.nrInsc
    ) {

        throw new Error(
            'Identificação do transmissor não informada.'
        );
    }


    const tpInscTransmissor =
        String(
            transmissor.tpInsc
        ).trim();


    const nrInscTransmissor =
        normalizarDocumentoEsocial(
            transmissor.nrInsc
        );


    if (
        !['1', '2'].includes(
            tpInscTransmissor
        )
    ) {

        throw new Error(
            'tpInsc do transmissor inválido.'
        );
    }


    if (
        !nrInscTransmissor
    ) {

        throw new Error(
            'nrInsc do transmissor não informado.'
        );
    }


    // ========================================================
    // EMPREGADOR
    // ========================================================

    const primeiro =
        eventos[0];


    const tpInscEmpregador =
        String(
            primeiro.tp_insc_empregador ||
            primeiro.tpInscEmpregador ||
            ''
        ).trim();


    const nrInscEmpregador =
        normalizarDocumentoEsocial(
            primeiro.nr_insc_empregador ||
            primeiro.nrInscEmpregador ||
            ''
        );


    if (
        !['1', '2'].includes(
            tpInscEmpregador
        )
    ) {

        throw new Error(
            'tpInsc do empregador inválido.'
        );
    }


    if (
        !nrInscEmpregador
    ) {

        throw new Error(
            'nrInsc do empregador não encontrado.'
        );
    }


    // ========================================================
    // VALIDAR MESMO EMPREGADOR
    // ========================================================

    for (
        const evento
        of eventos
    ) {

        const tp =
            String(
                evento.tp_insc_empregador ||
                evento.tpInscEmpregador ||
                ''
            ).trim();


        const nr =
            normalizarDocumentoEsocial(
                evento.nr_insc_empregador ||
                evento.nrInscEmpregador ||
                ''
            );


        if (
            tp !== tpInscEmpregador ||
            nr !== nrInscEmpregador
        ) {

            throw new Error(
                'Todos os eventos do lote precisam pertencer ao mesmo empregador.'
            );
        }
    }


    // ========================================================
    // GRUPO DO LOTE
    // ========================================================
    //
    // 1 = Eventos de tabela
    // 2 = Eventos não periódicos
    // 3 = Eventos periódicos
    //
    // S-2220 = grupo 2
    //
    // IMPORTANTE:
    // grupo pertence a <envioLoteEventos>,
    // NÃO ao <eSocial>.
    //
    // ========================================================

    const grupo =
        '2';


    // ========================================================
    // MONTAR EVENTOS
    // ========================================================

    let xmlEventos =
        '';


    for (
        const evento
        of eventos
    ) {

        const xmlAssinado =
            String(
                evento.xml_assinado ||
                evento.xmlAssinado ||
                ''
            ).trim();


        if (
            !xmlAssinado
        ) {

            throw new Error(
                `Evento ${evento.id || '-'} não possui XML assinado.`
            );
        }


        // ====================================================
        // ID SALVO NO BANCO
        // ====================================================

        const idBanco =
            String(
                evento.id_evento_esocial ||
                evento.idEventoEsocial ||
                ''
            ).trim();


        // ====================================================
        // ID EXISTENTE DENTRO DO XML
        // ====================================================

        const idXml =
            extrairIdInternoEventoEsocial(
                xmlAssinado
            );


        if (
            !idBanco
        ) {

            throw new Error(
                `Evento ${evento.id || '-'} não possui id_evento_esocial.`
            );
        }


        if (
            !idXml
        ) {

            throw new Error(
                `Não foi possível localizar o Id dentro do XML do evento ${evento.id || '-'}.`
            );
        }


        if (
            idBanco !==
            idXml
        ) {

            throw new Error(
                `Id inconsistente no evento ${evento.id || '-'}. ` +
                'O Id salvo no banco é diferente do Id existente no XML.'
            );
        }


        // ====================================================
        // REMOVER <?xml ... ?>
        // ====================================================

        const xmlEventoSemDeclaracao =
            removerDeclaracaoXml(
                xmlAssinado
            );


        // ====================================================
        // WRAPPER <evento>
        // ====================================================

        xmlEventos +=
            `      <evento Id="${escaparXmlEsocial(idBanco)}">\n`;

        xmlEventos +=
            `${xmlEventoSemDeclaracao}\n`;

        xmlEventos +=
            `      </evento>\n`;
    }


    // ========================================================
    // MONTAR LOTE
    // ========================================================

    let xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n';


    /*
     * CORREÇÃO IMPORTANTE:
     *
     * ERRADO:
     *
     * <eSocial ... grupo="2">
     *   <envioLoteEventos>
     *
     *
     * CORRETO:
     *
     * <eSocial ...>
     *   <envioLoteEventos grupo="2">
     */

    xml +=
        `<eSocial xmlns="${ESOCIAL_NAMESPACE_LOTE_ENVIO}">\n`;


    xml +=
        `  <envioLoteEventos grupo="${grupo}">\n`;


    // ========================================================
    // EMPREGADOR
    // ========================================================

    xml +=
        `    <ideEmpregador>\n`;

    xml +=
        `      <tpInsc>${escaparXmlEsocial(tpInscEmpregador)}</tpInsc>\n`;

    xml +=
        `      <nrInsc>${escaparXmlEsocial(nrInscEmpregador)}</nrInsc>\n`;

    xml +=
        `    </ideEmpregador>\n`;


    // ========================================================
    // TRANSMISSOR
    // ========================================================

    xml +=
        `    <ideTransmissor>\n`;

    xml +=
        `      <tpInsc>${escaparXmlEsocial(tpInscTransmissor)}</tpInsc>\n`;

    xml +=
        `      <nrInsc>${escaparXmlEsocial(nrInscTransmissor)}</nrInsc>\n`;

    xml +=
        `    </ideTransmissor>\n`;


    // ========================================================
    // EVENTOS
    // ========================================================

    xml +=
        `    <eventos>\n`;

    xml +=
        xmlEventos;

    xml +=
        `    </eventos>\n`;


    xml +=
        `  </envioLoteEventos>\n`;

    xml +=
        `</eSocial>`;


    // ========================================================
    // RETORNO
    // ========================================================

    return {

        grupo,

        tpInscEmpregador,

        nrInscEmpregador,

        tpInscTransmissor,

        nrInscTransmissor,

        quantidadeEventos:
            eventos.length,

        xml
    };
}


// ============================================================
// MONTAR SOAP 1.1
// ============================================================

function montarEnvelopeSoapEnvioLote(
    xmlLote
) {

    const lote =
        removerDeclaracaoXml(
            xmlLote
        );


    return (
        '<?xml version="1.0" encoding="utf-8"?>' +

        '<soap:Envelope ' +

            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +

            'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +

            'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +

            '<soap:Body>' +

                `<EnviarLoteEventos xmlns="${ESOCIAL_NAMESPACE_SERVICO_ENVIO}">` +

                    '<loteEventos>' +

                        lote +

                    '</loteEventos>' +

                '</EnviarLoteEventos>' +

            '</soap:Body>' +

        '</soap:Envelope>'
    );
}


// ============================================================
// POST HTTPS COM mTLS
// ============================================================

function enviarSoapEsocial({
    url,
    soapAction,
    envelope
}) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            const caminhoConfigurado =
                String(
                    process.env
                        .ESOCIAL_CERT_PATH ||
                    ''
                ).trim();


            const senha =
                String(
                    process.env
                        .ESOCIAL_CERT_PASSWORD ||
                    ''
                );


            if (
                !caminhoConfigurado
            ) {

                return reject(
                    new Error(
                        'ESOCIAL_CERT_PATH não configurado.'
                    )
                );
            }


            const caminhoCertificado =
                path.isAbsolute(
                    caminhoConfigurado
                )
                    ? caminhoConfigurado

                    : path.resolve(
                        process.cwd(),
                        caminhoConfigurado
                    );


            if (
                !fs.existsSync(
                    caminhoCertificado
                )
            ) {

                return reject(
                    new Error(
                        'Certificado A1 não encontrado.'
                    )
                );
            }


            const endereco =
                new URL(
                    url
                );


            const corpo =
                Buffer.from(
                    envelope,
                    'utf8'
                );


            const requisicao =
                https.request(
                    {

                        protocol:
                            endereco.protocol,

                        hostname:
                            endereco.hostname,

                        port:
                            endereco.port ||
                            443,

                        path:
                            `${endereco.pathname}${endereco.search}`,

                        method:
                            'POST',

                        pfx:
                            fs.readFileSync(
                                caminhoCertificado
                            ),

                        passphrase:
                            senha,

                        rejectUnauthorized:
                            true,

                        minVersion:
                            'TLSv1.2',

                        headers: {

                            'Content-Type':
                                'text/xml; charset=utf-8',

                            'SOAPAction':
                                `"${soapAction}"`,

                            'Content-Length':
                                corpo.length,

                            'Accept':
                                'text/xml, application/xml'
                        }
                    },

                    resposta => {

                        let conteudo =
                            '';


                        resposta.setEncoding(
                            'utf8'
                        );


                        resposta.on(
                            'data',
                            parte => {

                                conteudo +=
                                    parte;
                            }
                        );


                        resposta.on(
                            'end',
                            () => {

                                resolve({

                                    statusCode:
                                        resposta.statusCode,

                                    headers:
                                        resposta.headers,

                                    body:
                                        conteudo
                                });
                            }
                        );
                    }
                );


            requisicao.setTimeout(
                60000,
                () => {

                    requisicao.destroy(
                        new Error(
                            'Timeout ao comunicar com o eSocial.'
                        )
                    );
                }
            );


            requisicao.on(
                'error',
                reject
            );


            requisicao.write(
                corpo
            );


            requisicao.end();
        }
    );
}


// ============================================================
// AUXILIAR XML POR LOCALNAME
// ============================================================

function encontrarElementosPorLocalName(
    no,
    nome,
    encontrados = []
) {

    if (!no) {
        return encontrados;
    }


    if (
        no.nodeType === 1 &&
        String(
            no.localName ||
            no.nodeName ||
            ''
        )
            .replace(
                /^.*:/,
                ''
            ) === nome
    ) {

        encontrados.push(
            no
        );
    }


    if (
        no.childNodes
    ) {

        for (
            let i = 0;
            i <
            no.childNodes.length;
            i++
        ) {

            encontrarElementosPorLocalName(
                no.childNodes[i],
                nome,
                encontrados
            );
        }
    }


    return encontrados;
}


// ============================================================
// TEXTO DE ELEMENTO
// ============================================================

function textoPrimeiroElemento(
    no,
    nome
) {

    const encontrados =
        encontrarElementosPorLocalName(
            no,
            nome,
            []
        );


    if (
        !encontrados.length
    ) {

        return '';
    }


    return String(
        encontrados[0]
            .textContent ||
        ''
    ).trim();
}


// ============================================================
// EXTRAIR RETORNO DO ENVIO
// ============================================================

function extrairRetornoEnvioLote(
    xmlResposta
) {

    const xml =
        String(
            xmlResposta ||
            ''
        ).trim();


    if (
        !xml
    ) {

        throw new Error(
            'O eSocial retornou uma resposta vazia.'
        );
    }


    const documento =
        new DOMParser()
            .parseFromString(
                xml,
                'text/xml'
            );


    // ========================================================
    // SOAP FAULT
    // ========================================================

    const faults =
        encontrarElementosPorLocalName(
            documento,
            'Fault',
            []
        );


    if (
        faults.length
    ) {

        const fault =
            faults[0];


        const faultCode =
            textoPrimeiroElemento(
                fault,
                'faultcode'
            );


        const faultString =
            textoPrimeiroElemento(
                fault,
                'faultstring'
            );


        return {

            soapFault:
                true,

            faultCode,

            faultString,

            cdResposta:
                '',

            descResposta:
                faultString,

            protocoloEnvio:
                '',

            ocorrencias:
                [],

            rawXml:
                xml
        };
    }


    // ========================================================
    // STATUS E-SOCIAL
    // ========================================================

    const statusNodes =
        encontrarElementosPorLocalName(
            documento,
            'status',
            []
        );


    const statusNode =
        statusNodes[0] ||
        documento;


    const cdResposta =
        textoPrimeiroElemento(
            statusNode,
            'cdResposta'
        );


    const descResposta =
        textoPrimeiroElemento(
            statusNode,
            'descResposta'
        );


    // ========================================================
    // DADOS DE RECEPÇÃO
    // ========================================================

    const protocoloEnvio =
        textoPrimeiroElemento(
            documento,
            'protocoloEnvio'
        );


    const dhRecepcao =
        textoPrimeiroElemento(
            documento,
            'dhRecepcao'
        );


    const versaoAplicativoRecepcao =
        textoPrimeiroElemento(
            documento,
            'versaoAplicativoRecepcao'
        );


    // ========================================================
    // OCORRÊNCIAS
    // ========================================================

    const ocorrenciaNodes =
        encontrarElementosPorLocalName(
            documento,
            'ocorrencia',
            []
        );


    const ocorrencias =
        ocorrenciaNodes.map(
            ocorrencia => ({

                tipo:
                    textoPrimeiroElemento(
                        ocorrencia,
                        'tipo'
                    ),

                codigo:
                    textoPrimeiroElemento(
                        ocorrencia,
                        'codigo'
                    ),

                descricao:
                    textoPrimeiroElemento(
                        ocorrencia,
                        'descricao'
                    ),

                localizacao:
                    textoPrimeiroElemento(
                        ocorrencia,
                        'localizacao'
                    )
            })
        );


    return {

        soapFault:
            false,

        cdResposta,

        descResposta,

        protocoloEnvio,

        dhRecepcao,

        versaoAplicativoRecepcao,

        ocorrencias,

        rawXml:
            xml
    };
}


async function enviarLoteEsocial(
    xmlLote,
    ambiente = 2
) {

    const ambienteFinal =
        Number(
            ambiente
        );


    if (
        ambienteFinal !== 1 &&
        ambienteFinal !== 2
    ) {

        throw new Error(
            'Ambiente eSocial inválido para envio do lote.'
        );
    }


    // ========================================================
    // SEGUNDA TRAVA DE PRODUÇÃO
    //
    // Mesmo que alguma rota chame esta função diretamente,
    // Produção não transmite sem autorização explícita.
    // ========================================================

    if (
        ambienteFinal === 1 &&
        !producaoEsocialExplicitamentePermitida()
    ) {

        throw new Error(
            'ENVIO_PRODUCAO_BLOQUEADO: ' +
            'ESOCIAL_PERMITIR_PRODUCAO não está habilitado.'
        );
    }


    const url =
        obterUrlEnvioEsocial(
            ambienteFinal
        );


    const envelope =
        montarEnvelopeSoapEnvioLote(
            xmlLote
        );


    const respostaHttp =
        await enviarSoapEsocial({

            url,

            soapAction:
                ESOCIAL_SOAP_ACTION_ENVIO,

            envelope
        });


    const retorno =
        extrairRetornoEnvioLote(
            respostaHttp.body
        );


    return {

        httpStatus:
            respostaHttp.statusCode,

        ambiente:
            ambienteFinal,

        url,

        ...retorno
    };
}

const ESOCIAL_URL_CONSULTA_PRODUCAO =
    'https://webservices.consulta.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc';


// ============================================================
// URL DE CONSULTA DE LOTE POR AMBIENTE
// ============================================================

function obterUrlConsultaLoteEsocial(
    ambiente
) {

    const ambienteFinal =
        Number(
            ambiente
        );


    if (
        ambienteFinal === 1
    ) {

        return ESOCIAL_URL_CONSULTA_PRODUCAO;
    }


    if (
        ambienteFinal === 2
    ) {

        return ESOCIAL_URL_CONSULTA_RESTRITA;
    }


    throw new Error(
        'Ambiente eSocial inválido para consulta de lote.'
    );
}


let cacheConfigConsultaLoteEsocial =
    null;


// ============================================================
// LISTAR ARQUIVOS RECURSIVAMENTE
// ============================================================

function listarArquivosRecursivamente(
    diretorio
) {

    const resultado = [];


    if (
        !fs.existsSync(
            diretorio
        )
    ) {

        return resultado;
    }


    const itens =
        fs.readdirSync(
            diretorio,
            {
                withFileTypes:
                    true
            }
        );


    for (
        const item
        of itens
    ) {

        const caminho =
            path.join(
                diretorio,
                item.name
            );


        if (
            item.isDirectory()
        ) {

            resultado.push(
                ...listarArquivosRecursivamente(
                    caminho
                )
            );

            continue;
        }


        if (
            item.isFile()
        ) {

            resultado.push(
                caminho
            );
        }
    }


    return resultado;
}


// ============================================================
// CARREGAR CONFIGURAÇÃO DO WS DE CONSULTA
// ============================================================

function carregarConfigConsultaLoteEsocial() {

    if (
        cacheConfigConsultaLoteEsocial
    ) {

        return cacheConfigConsultaLoteEsocial;
    }


    const caminhoConfigurado =
        String(
            process.env.ESOCIAL_COMUNICACAO_DIR ||
            './src/esocial/comunicacao'
        ).trim();


    const diretorio =
        path.isAbsolute(
            caminhoConfigurado
        )
            ? caminhoConfigurado

            : path.resolve(
                process.cwd(),
                caminhoConfigurado
            );


    if (
        !fs.existsSync(
            diretorio
        )
    ) {

        throw new Error(
            `Diretório do pacote de comunicação não encontrado: ${diretorio}`
        );
    }


    const arquivos =
        listarArquivosRecursivamente(
            diretorio
        );


    // ========================================================
    // WSDL
    // ========================================================

    const arquivoWsdl =
        arquivos.find(
            arquivo =>
                /^WsConsultarLoteEventos.*\.wsdl$/i.test(
                    path.basename(
                        arquivo
                    )
                )
        );


    if (
        !arquivoWsdl
    ) {

        throw new Error(
            'WsConsultarLoteEventos*.wsdl não encontrado no pacote de comunicação.'
        );
    }


    const conteudoWsdl =
        fs.readFileSync(
            arquivoWsdl,
            'utf8'
        );


    // ========================================================
    // SOAP ACTION
    // ========================================================

    const matchSoapAction =
        conteudoWsdl.match(
            /soapAction\s*=\s*"([^"]*\/ConsultarLoteEventos)"/i
        );


    if (
        !matchSoapAction
    ) {

        throw new Error(
            'SOAPAction de ConsultarLoteEventos não encontrada no WSDL.'
        );
    }


    const soapAction =
        matchSoapAction[1];


    // ========================================================
    // NAMESPACE DO SERVIÇO
    // ========================================================

    let namespaceServico =
        '';


    const matchOperacao =
        soapAction.match(
            /^(.*)\/ServicoConsultarLoteEventos\/ConsultarLoteEventos$/i
        );


    if (
        matchOperacao
    ) {

        namespaceServico =
            matchOperacao[1];
    }


    if (
        !namespaceServico
    ) {

        const matchNamespace =
            conteudoWsdl.match(
                /targetNamespace\s*=\s*"([^"]+)"/i
            );


        namespaceServico =
            matchNamespace
                ? matchNamespace[1]
                : '';
    }


    if (
        !namespaceServico
    ) {

        throw new Error(
            'Namespace do serviço de consulta não encontrado.'
        );
    }


    // ========================================================
    // XSD DE CONSULTA
    // ========================================================

    const arquivoXsd =
        arquivos.find(
            arquivo =>
                /^ConsultaLoteEventos.*\.xsd$/i.test(
                    path.basename(
                        arquivo
                    )
                )
        );


    if (
        !arquivoXsd
    ) {

        throw new Error(
            'ConsultaLoteEventos*.xsd não encontrado no pacote de comunicação.'
        );
    }


    const conteudoXsd =
        fs.readFileSync(
            arquivoXsd,
            'utf8'
        );


    const matchNamespaceConsulta =
        conteudoXsd.match(
            /targetNamespace\s*=\s*"([^"]+)"/i
        );


    if (
        !matchNamespaceConsulta
    ) {

        throw new Error(
            'targetNamespace do XSD de consulta não encontrado.'
        );
    }


    const namespaceConsulta =
        matchNamespaceConsulta[1];


    cacheConfigConsultaLoteEsocial = {

        arquivoWsdl,

        arquivoXsd,

        soapAction,

        namespaceServico,

        namespaceConsulta
    };


    console.log(
        '✅ Configuração consulta eSocial carregada:',
        {
            wsdl:
                path.basename(
                    arquivoWsdl
                ),

            xsd:
                path.basename(
                    arquivoXsd
                ),

            namespaceConsulta,

            namespaceServico,

            soapAction
        }
    );


    return cacheConfigConsultaLoteEsocial;
}


// ============================================================
// MONTAR XML DA CONSULTA
// ============================================================

function montarXmlConsultaLoteEsocial(
    protocoloEnvio
) {

    const protocolo =
        String(
            protocoloEnvio ||
            ''
        ).trim();


    if (
        !protocolo
    ) {

        throw new Error(
            'Protocolo de envio não informado.'
        );
    }


    const config =
        carregarConfigConsultaLoteEsocial();


    let xml =
        '<?xml version="1.0" encoding="UTF-8"?>';


    xml +=
        `<eSocial xmlns="${config.namespaceConsulta}">`;


    xml +=
        '<consultaLoteEventos>';


    xml +=
        `<protocoloEnvio>${escaparXmlEsocial(protocolo)}</protocoloEnvio>`;


    xml +=
        '</consultaLoteEventos>';


    xml +=
        '</eSocial>';


    return xml;
}


// ============================================================
// MONTAR ENVELOPE SOAP DA CONSULTA
// ============================================================

function montarEnvelopeSoapConsultaLote(
    protocoloEnvio
) {

    const config =
        carregarConfigConsultaLoteEsocial();


    const xmlConsulta =
        removerDeclaracaoXml(
            montarXmlConsultaLoteEsocial(
                protocoloEnvio
            )
        );


    return (
        '<?xml version="1.0" encoding="utf-8"?>' +

        '<soap:Envelope ' +
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
            'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
            'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +

            '<soap:Body>' +

                `<ConsultarLoteEventos xmlns="${config.namespaceServico}">` +

                    '<consulta>' +

                        xmlConsulta +

                    '</consulta>' +

                '</ConsultarLoteEventos>' +

            '</soap:Body>' +

        '</soap:Envelope>'
    );
}


// ============================================================
// FILHO DIRETO POR LOCALNAME
// ============================================================

function primeiroFilhoPorLocalName(
    no,
    nome
) {

    if (
        !no ||
        !no.childNodes
    ) {

        return null;
    }


    for (
        let i = 0;
        i <
        no.childNodes.length;
        i++
    ) {

        const filho =
            no.childNodes[i];


        if (
            filho.nodeType !== 1
        ) {

            continue;
        }


        const localName =
            String(
                filho.localName ||
                filho.nodeName ||
                ''
            )
                .replace(
                    /^.*:/,
                    ''
                );


        if (
            localName ===
            nome
        ) {

            return filho;
        }
    }


    return null;
}


// ============================================================
// TEXTO DE FILHO DIRETO
// ============================================================

function textoFilhoDireto(
    no,
    nome
) {

    const filho =
        primeiroFilhoPorLocalName(
            no,
            nome
        );


    return filho
        ? String(
            filho.textContent ||
            ''
        ).trim()
        : '';
}


// ============================================================
// EXTRAIR OCORRÊNCIAS
// ============================================================

function extrairOcorrenciasEsocial(
    no
) {

    if (!no) {

        return [];
    }


    const ocorrencias =
        encontrarElementosPorLocalName(
            no,
            'ocorrencia',
            []
        );


    return ocorrencias.map(
        ocorrencia => ({

            tipo:
                textoPrimeiroElemento(
                    ocorrencia,
                    'tipo'
                ),

            codigo:
                textoPrimeiroElemento(
                    ocorrencia,
                    'codigo'
                ),

            descricao:
                textoPrimeiroElemento(
                    ocorrencia,
                    'descricao'
                ),

            localizacao:
                textoPrimeiroElemento(
                    ocorrencia,
                    'localizacao'
                )
        })
    );
}


// ============================================================
// EXTRAIR RETORNOS DOS EVENTOS DO LOTE
// ============================================================

function extrairEventosRetornoLote(
    retornoProcessamento
) {

    const retornoEventos =
        primeiroFilhoPorLocalName(
            retornoProcessamento,
            'retornoEventos'
        );


    if (
        !retornoEventos
    ) {

        return [];
    }


    const resultado = [];


    for (
        let i = 0;
        i <
        retornoEventos.childNodes.length;
        i++
    ) {

        const noEvento =
            retornoEventos.childNodes[i];


        if (
            noEvento.nodeType !== 1
        ) {

            continue;
        }


        const localName =
            String(
                noEvento.localName ||
                noEvento.nodeName ||
                ''
            )
                .replace(
                    /^.*:/,
                    ''
                );


        if (
            localName !==
            'evento'
        ) {

            continue;
        }


        const id =
            String(
                noEvento.getAttribute(
                    'Id'
                ) ||
                ''
            ).trim();


        // ====================================================
        // XML INTERNO DE RETORNO
        // ====================================================

        const processamentos =
            encontrarElementosPorLocalName(
                noEvento,
                'processamento',
                []
            );


        const processamento =
            processamentos[0] ||
            null;


        const cdResposta =
            processamento
                ? textoPrimeiroElemento(
                    processamento,
                    'cdResposta'
                )
                : '';


        const descResposta =
            processamento
                ? textoPrimeiroElemento(
                    processamento,
                    'descResposta'
                )
                : '';


        const dhProcessamento =
            processamento
                ? textoPrimeiroElemento(
                    processamento,
                    'dhProcessamento'
                )
                : '';


        const versaoAplicativoProcessamento =
            processamento
                ? (
                    textoPrimeiroElemento(
                        processamento,
                        'versaoAppProcessamento'
                    ) ||

                    textoPrimeiroElemento(
                        processamento,
                        'versaoAplicativoProcessamento'
                    )
                )
                : '';


        // ====================================================
        // RECIBO
        // ====================================================

        const recibos =
            encontrarElementosPorLocalName(
                noEvento,
                'recibo',
                []
            );


        const recibo =
            recibos[0] ||
            null;


        const nrRecibo =
            recibo
                ? textoPrimeiroElemento(
                    recibo,
                    'nrRecibo'
                )
                : '';


        const hash =
            recibo
                ? textoPrimeiroElemento(
                    recibo,
                    'hash'
                )
                : '';


        // ====================================================
        // DUPLICIDADE
        // ====================================================

        const evtDupl =
            String(
                noEvento.getAttribute(
                    'evtDupl'
                ) ||
                ''
            ).trim();


        // ====================================================
        // OCORRÊNCIAS
        // ====================================================

        const ocorrencias =
            processamento
                ? extrairOcorrenciasEsocial(
                    processamento
                )
                : [];


        resultado.push({

            idEvento:
                id,

            cdResposta,

            descResposta,

            dhProcessamento,

            versaoAplicativoProcessamento,

            nrRecibo,

            hash,

            evtDupl:
                evtDupl === 'true' ||
                evtDupl === '1',

            ocorrencias
        });
    }


    return resultado;
}


// ============================================================
// EXTRAIR RETORNO DA CONSULTA
// ============================================================

function extrairRetornoConsultaLote(
    xmlResposta
) {

    const xml =
        String(
            xmlResposta ||
            ''
        ).trim();


    if (
        !xml
    ) {

        throw new Error(
            'Resposta vazia ao consultar lote no eSocial.'
        );
    }


    const documento =
        new DOMParser()
            .parseFromString(
                xml,
                'text/xml'
            );


    // ========================================================
    // SOAP FAULT
    // ========================================================

    const faults =
        encontrarElementosPorLocalName(
            documento,
            'Fault',
            []
        );


    if (
        faults.length
    ) {

        const fault =
            faults[0];


        return {

            soapFault:
                true,

            faultCode:
                textoPrimeiroElemento(
                    fault,
                    'faultcode'
                ),

            faultString:
                textoPrimeiroElemento(
                    fault,
                    'faultstring'
                ),

            rawXml:
                xml
        };
    }


    // ========================================================
    // RETORNO DO LOTE
    // ========================================================

    const retornos =
        encontrarElementosPorLocalName(
            documento,
            'retornoProcessamentoLoteEventos',
            []
        );


    if (
        !retornos.length
    ) {

        throw new Error(
            'retornoProcessamentoLoteEventos não encontrado na resposta.'
        );
    }


    const retorno =
        retornos[0];


    // ========================================================
    // STATUS DO LOTE
    // ========================================================

    const status =
        primeiroFilhoPorLocalName(
            retorno,
            'status'
        );


    if (
        !status
    ) {

        throw new Error(
            'Status do lote não encontrado na resposta.'
        );
    }


    const cdResposta =
        textoFilhoDireto(
            status,
            'cdResposta'
        );


    const descResposta =
        textoFilhoDireto(
            status,
            'descResposta'
        );


    const tempoEstimadoConclusao =
        textoFilhoDireto(
            status,
            'tempoEstimadoConclusao'
        );


    // ========================================================
    // DADOS DA RECEPÇÃO
    // ========================================================

    const dadosRecepcao =
        primeiroFilhoPorLocalName(
            retorno,
            'dadosRecepcaoLote'
        );


    const protocoloEnvio =
        dadosRecepcao
            ? textoFilhoDireto(
                dadosRecepcao,
                'protocoloEnvio'
            )
            : '';


    const dhRecepcao =
        dadosRecepcao
            ? textoFilhoDireto(
                dadosRecepcao,
                'dhRecepcao'
            )
            : '';


    // ========================================================
    // PROCESSAMENTO
    // ========================================================

    const dadosProcessamento =
        primeiroFilhoPorLocalName(
            retorno,
            'dadosProcessamentoLote'
        );


    const versaoAplicativoProcessamentoLote =
        dadosProcessamento
            ? (
                textoFilhoDireto(
                    dadosProcessamento,
                    'versaoAplicativoProcessamentoLote'
                ) ||

                textoFilhoDireto(
                    dadosProcessamento,
                    'versaoAppProcessamentoLote'
                )
            )
            : '';


    // ========================================================
    // EVENTOS
    // ========================================================

    const eventos =
        extrairEventosRetornoLote(
            retorno
        );


    return {

        soapFault:
            false,

        cdResposta,

        descResposta,

        tempoEstimadoConclusao,

        protocoloEnvio,

        dhRecepcao,

        versaoAplicativoProcessamentoLote,

        ocorrencias:
            extrairOcorrenciasEsocial(
                status
            ),

        eventos,

        rawXml:
            xml
    };
}


// ============================================================
// CONSULTAR LOTE NO E-SOCIAL
// ============================================================

async function consultarLoteEsocial(
    protocoloEnvio,
    ambiente
) {

    const protocolo =
        String(
            protocoloEnvio ||
            ''
        ).trim();


    if (
        !protocolo
    ) {

        throw new Error(
            'Protocolo de envio não informado.'
        );
    }


    const ambienteFinal =
        Number(
            ambiente
        );


    if (
        ambienteFinal !== 1 &&
        ambienteFinal !== 2
    ) {

        throw new Error(
            'Ambiente do protocolo não identificado. ' +
            'Informe 1 para Produção ou 2 para Produção Restrita.'
        );
    }


    const config =
        carregarConfigConsultaLoteEsocial();


    const url =
        obterUrlConsultaLoteEsocial(
            ambienteFinal
        );


    const envelope =
        montarEnvelopeSoapConsultaLote(
            protocolo
        );


    console.log(
        '🔎 Consultando lote eSocial:',
        {

            protocolo,

            ambiente:
                ambienteFinal,

            ambienteDescricao:
                ambienteFinal === 1
                    ? 'Produção'
                    : 'Produção Restrita',

            url
        }
    );


    const respostaHttp =
        await enviarSoapEsocial({

            url,

            soapAction:
                config.soapAction,

            envelope
        });


    if (
        !respostaHttp
    ) {

        throw new Error(
            'Nenhuma resposta recebida na consulta do lote eSocial.'
        );
    }


    const retorno =
        extrairRetornoConsultaLote(
            respostaHttp.body
        );


    return {

        httpStatus:
            respostaHttp.statusCode,

        ambiente:
            ambienteFinal,

        url,

        ...retorno
    };
}

// ============================================================
// eSOCIAL BX
// CONSULTAR EVENTOS JÁ EXISTENTES NO eSOCIAL
// PRODUÇÃO REAL - SOMENTE LEITURA
// ============================================================

const ESOCIAL_URL_IDENTIFICADORES_PRODUCAO =
    'https://webservices.download.esocial.gov.br/servicos/empregador/dwlcirurgico/WsConsultarIdentificadoresEventos.svc';

const ESOCIAL_URL_DOWNLOAD_PRODUCAO =
    'https://webservices.download.esocial.gov.br/servicos/empregador/dwlcirurgico/WsSolicitarDownloadEventos.svc';


let cacheConfigBxEsocial =
    null;


// ============================================================
// NORMALIZAR CPF
// ============================================================

function normalizarCpfEsocial(
    valor
) {

    return String(
        valor ||
        ''
    ).replace(
        /\D/g,
        ''
    );
}


// ============================================================
// DIRETÓRIO DOS ARQUIVOS DE COMUNICAÇÃO
// ============================================================

function obterDiretorioComunicacaoBxEsocial() {

    const caminhoConfigurado =
        String(
            process.env.ESOCIAL_COMUNICACAO_DIR ||
            './src/esocial/comunicacao'
        ).trim();


    const diretorio =
        path.isAbsolute(
            caminhoConfigurado
        )
            ? caminhoConfigurado
            : path.resolve(
                process.cwd(),
                caminhoConfigurado
            );


    if (
        !fs.existsSync(
            diretorio
        )
    ) {

        throw new Error(
            `Diretório de comunicação do eSocial não encontrado: ${diretorio}`
        );
    }


    return diretorio;
}


// ============================================================
// LER TARGET NAMESPACE DE XML/XSD/WSDL
// ============================================================

function extrairTargetNamespaceBx(
    caminhoArquivo
) {

    const conteudo =
        fs.readFileSync(
            caminhoArquivo,
            'utf8'
        );


    const match =
        conteudo.match(
            /targetNamespace\s*=\s*"([^"]+)"/i
        );


    if (
        !match
    ) {

        throw new Error(
            `targetNamespace não encontrado em ${path.basename(caminhoArquivo)}.`
        );
    }


    return match[1];
}


// ============================================================
// EXTRAIR SOAP ACTION
// ============================================================

function extrairSoapActionBx(
    caminhoWsdl,
    operacao
) {

    const conteudo =
        fs.readFileSync(
            caminhoWsdl,
            'utf8'
        );


    const operacaoEscapada =
        String(
            operacao
        ).replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
        );


    const regex =
        new RegExp(
            `soapAction\\s*=\\s*"([^"]*${operacaoEscapada}[^"]*)"`,
            'i'
        );


    const match =
        conteudo.match(
            regex
        );


    if (
        !match
    ) {

        throw new Error(
            `SOAPAction da operação ${operacao} não encontrada em ${path.basename(caminhoWsdl)}.`
        );
    }


    return match[1];
}


// ============================================================
// LOCALIZAR CONFIGURAÇÃO BX NO PACOTE OFICIAL
// ============================================================

function carregarConfigBxEsocial() {

    if (
        cacheConfigBxEsocial
    ) {

        return cacheConfigBxEsocial;
    }


    const diretorio =
        obterDiretorioComunicacaoBxEsocial();


    const arquivos =
        listarArquivosRecursivamente(
            diretorio
        );


    const wsdlIdentificadores =
        arquivos.find(
            arquivo =>
                /^WsConsultarIdentificadoresEventos.*\.wsdl$/i.test(
                    path.basename(
                        arquivo
                    )
                )
        );


    const xsdIdentificadoresTrabalhador =
        arquivos.find(
            arquivo =>
                /^ConsultaIdentificadoresEventosTrabalhador.*\.xsd$/i.test(
                    path.basename(
                        arquivo
                    )
                )
        );


    const wsdlDownload =
        arquivos.find(
            arquivo =>
                /^WsSolicitarDownloadEventos.*\.wsdl$/i.test(
                    path.basename(
                        arquivo
                    )
                )
        );


    const xsdDownloadPorId =
        arquivos.find(
            arquivo =>
                /^SolicitacaoDownloadEventosPorId.*\.xsd$/i.test(
                    path.basename(
                        arquivo
                    )
                )
        );


    const faltantes =
        [];


    if (
        !wsdlIdentificadores
    ) {

        faltantes.push(
            'WsConsultarIdentificadoresEventos*.wsdl'
        );
    }


    if (
        !xsdIdentificadoresTrabalhador
    ) {

        faltantes.push(
            'ConsultaIdentificadoresEventosTrabalhador*.xsd'
        );
    }


    if (
        !wsdlDownload
    ) {

        faltantes.push(
            'WsSolicitarDownloadEventos*.wsdl'
        );
    }


    if (
        !xsdDownloadPorId
    ) {

        faltantes.push(
            'SolicitacaoDownloadEventosPorId*.xsd'
        );
    }


    if (
        faltantes.length
    ) {

        throw new Error(
            'Arquivos necessários do BX não encontrados no pacote de comunicação: ' +
            faltantes.join(', ')
        );
    }


    cacheConfigBxEsocial = {

        identificadores: {

            wsdl:
                wsdlIdentificadores,

            xsd:
                xsdIdentificadoresTrabalhador,

            namespaceServico:
                extrairTargetNamespaceBx(
                    wsdlIdentificadores
                ),

            namespaceMensagem:
                extrairTargetNamespaceBx(
                    xsdIdentificadoresTrabalhador
                ),

            soapAction:
                extrairSoapActionBx(
                    wsdlIdentificadores,
                    'ConsultarIdentificadoresEventosTrabalhador'
                )
        },


        download: {

            wsdl:
                wsdlDownload,

            xsd:
                xsdDownloadPorId,

            namespaceServico:
                extrairTargetNamespaceBx(
                    wsdlDownload
                ),

            namespaceMensagem:
                extrairTargetNamespaceBx(
                    xsdDownloadPorId
                ),

            soapAction:
                extrairSoapActionBx(
                    wsdlDownload,
                    'SolicitarDownloadEventosPorId'
                )
        }
    };


    console.log(
        '✅ Configuração BX eSocial carregada:',
        {
            wsdlIdentificadores:
                path.basename(
                    wsdlIdentificadores
                ),

            xsdIdentificadores:
                path.basename(
                    xsdIdentificadoresTrabalhador
                ),

            wsdlDownload:
                path.basename(
                    wsdlDownload
                ),

            xsdDownload:
                path.basename(
                    xsdDownloadPorId
                )
        }
    );


    return cacheConfigBxEsocial;
}


function normalizarDataHoraBx(
    valor,
    nomeCampo
) {

    const data =
        valor instanceof Date
            ? new Date(
                valor.getTime()
            )
            : new Date(
                valor
            );


    if (
        Number.isNaN(
            data.getTime()
        )
    ) {

        throw new Error(
            `${nomeCampo} inválida.`
        );
    }


    // ========================================================
    // HORÁRIO OFICIAL USADO NA CONSULTA eSOCIAL
    //
    // Não enviamos mais:
    //
    // 2026-08-19T18:09:24Z
    //
    // Enviamos:
    //
    // 2026-08-19T15:09:24-03:00
    //
    // O instante é o mesmo, porém o offset fica explícito.
    // ========================================================

    const formatador =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                timeZone:
                    'America/Sao_Paulo',

                year:
                    'numeric',

                month:
                    '2-digit',

                day:
                    '2-digit',

                hour:
                    '2-digit',

                minute:
                    '2-digit',

                second:
                    '2-digit',

                hourCycle:
                    'h23'
            }
        );


    const partes =
        {};


    for (
        const parte
        of formatador.formatToParts(
            data
        )
    ) {

        if (
            parte.type !==
            'literal'
        ) {

            partes[
                parte.type
            ] =
                parte.value;
        }
    }


    const ano =
        partes.year;

    const mes =
        partes.month;

    const dia =
        partes.day;

    const hora =
        partes.hour;

    const minuto =
        partes.minute;

    const segundo =
        partes.second;


    if (
        !ano ||
        !mes ||
        !dia ||
        !hora ||
        !minuto ||
        !segundo
    ) {

        throw new Error(
            `Não foi possível formatar ${nomeCampo} para o eSocial.`
        );
    }


    // ========================================================
    // CALCULAR OFFSET DE America/Sao_Paulo
    // ========================================================

    const instanteSemMs =
        Math.floor(
            data.getTime() /
            1000
        ) *
        1000;


    const horarioLocalComoUtc =
        Date.UTC(
            Number(
                ano
            ),
            Number(
                mes
            ) - 1,
            Number(
                dia
            ),
            Number(
                hora
            ),
            Number(
                minuto
            ),
            Number(
                segundo
            )
        );


    const offsetMinutos =
        Math.round(
            (
                horarioLocalComoUtc -
                instanteSemMs
            ) /
            60000
        );


    const sinal =
        offsetMinutos >= 0
            ? '+'
            : '-';


    const offsetAbsoluto =
        Math.abs(
            offsetMinutos
        );


    const offsetHoras =
        String(
            Math.floor(
                offsetAbsoluto /
                60
            )
        ).padStart(
            2,
            '0'
        );


    const offsetMin =
        String(
            offsetAbsoluto %
            60
        ).padStart(
            2,
            '0'
        );


    const resultado =
        `${ano}-${mes}-${dia}` +
        `T${hora}:${minuto}:${segundo}` +
        `${sinal}${offsetHoras}:${offsetMin}`;


    return resultado;
}


// ============================================================
// VALIDAR JANELA DE CONSULTA
// ============================================================

function validarJanelaConsultaBx({
    dtIni,
    dtFim
}) {

    const inicio =
        new Date(
            dtIni
        );


    const fim =
        new Date(
            dtFim
        );


    if (
        Number.isNaN(
            inicio.getTime()
        ) ||
        Number.isNaN(
            fim.getTime()
        )
    ) {

        throw new Error(
            'Período BX inválido.'
        );
    }


    if (
        inicio.getTime() >
        fim.getTime()
    ) {

        throw new Error(
            'dtIni não pode ser maior que dtFim.'
        );
    }


    const limite31Dias =
        31 *
        24 *
        60 *
        60 *
        1000;


    if (
        (
            fim.getTime() -
            inicio.getTime()
        ) >
        limite31Dias
    ) {

        throw new Error(
            'A consulta BX permite no máximo 31 dias por período.'
        );
    }


    const limiteFinal =
        Date.now() -
        (
            60 *
            60 *
            1000
        );


    if (
        fim.getTime() >
        limiteFinal
    ) {

        throw new Error(
            'dtFim precisa ser pelo menos 1 hora anterior ao horário atual.'
        );
    }


    return {
        inicio,
        fim
    };
}


// ============================================================
// XML - CONSULTAR IDENTIFICADORES DO TRABALHADOR
// ============================================================

function montarXmlConsultaIdentificadoresTrabalhadorBx({
    tpInsc,
    nrInsc,
    cpf,
    dtIni,
    dtFim
}) {

    const config =
        carregarConfigBxEsocial()
            .identificadores;


    const tipoInscricao =
        String(
            tpInsc ||
            ''
        ).trim();


    const numeroInscricao =
        normalizarDocumentoEsocial(
            nrInsc
        );


    const cpfTrab =
        normalizarCpfEsocial(
            cpf
        );


    if (
        ![
            '1',
            '2'
        ].includes(
            tipoInscricao
        )
    ) {

        throw new Error(
            'tpInsc do empregador inválido para BX.'
        );
    }


    if (
        !numeroInscricao
    ) {

        throw new Error(
            'nrInsc do empregador não informado para BX.'
        );
    }


    if (
        cpfTrab.length !== 11
    ) {

        throw new Error(
            'CPF do trabalhador deve possuir 11 dígitos.'
        );
    }


    const inicio =
        normalizarDataHoraBx(
            dtIni,
            'dtIni'
        );


    const fim =
        normalizarDataHoraBx(
            dtFim,
            'dtFim'
        );


    validarJanelaConsultaBx({
        dtIni:
            inicio,

        dtFim:
            fim
    });


    let xml =
        '<?xml version="1.0" encoding="UTF-8"?>';


    xml +=
        `<eSocial xmlns="${config.namespaceMensagem}">`;


    xml +=
        '<consultaIdentificadoresEvts>';


    xml +=
        '<ideEmpregador>';


    xml +=
        `<tpInsc>${escaparXmlEsocial(tipoInscricao)}</tpInsc>`;


    xml +=
        `<nrInsc>${escaparXmlEsocial(numeroInscricao)}</nrInsc>`;


    xml +=
        '</ideEmpregador>';


    xml +=
        '<consultaEvtsTrabalhador>';


    xml +=
        `<cpfTrab>${escaparXmlEsocial(cpfTrab)}</cpfTrab>`;


    xml +=
        `<dtIni>${escaparXmlEsocial(inicio)}</dtIni>`;


    xml +=
        `<dtFim>${escaparXmlEsocial(fim)}</dtFim>`;


    xml +=
        '</consultaEvtsTrabalhador>';


    xml +=
        '</consultaIdentificadoresEvts>';


    xml +=
        '</eSocial>';


    return {
        xml,
        dtIni:
            inicio,
        dtFim:
            fim
    };
}

// ============================================================
// SOAP - CONSULTAR IDENTIFICADORES DE EVENTOS DO TRABALHADOR
// ============================================================

function montarEnvelopeSoapConsultaIdentificadoresTrabalhadorBx(
    xmlAssinado
) {

    const config =
        carregarConfigBxEsocial()
            .identificadores;


    const xmlInterno =
        removerDeclaracaoXml(
            xmlAssinado
        );


    if (
        !xmlInterno
    ) {

        throw new Error(
            'XML assinado da consulta BX não informado.'
        );
    }


    /*
     * Estrutura EXATA prevista pelo WSDL:
     *
     * <ConsultarIdentificadoresEventosTrabalhador>
     *
     *     <consultaEventosTrabalhador>
     *
     *         <eSocial>
     *             ...
     *         </eSocial>
     *
     *     </consultaEventosTrabalhador>
     *
     * </ConsultarIdentificadoresEventosTrabalhador>
     *
     *
     * IMPORTANTE:
     *
     * consultaEventosTrabalhador pertence ao namespace
     * DO SERVIÇO.
     *
     * O <eSocial> interno já possui o namespace próprio
     * do XSD da consulta.
     */


    return (
        '<?xml version="1.0" encoding="utf-8"?>' +

        '<soap:Envelope ' +
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
            'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
            'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +

            '<soap:Body>' +

                `<ConsultarIdentificadoresEventosTrabalhador ` +
                    `xmlns="${config.namespaceServico}">` +

                    '<consultaEventosTrabalhador>' +

                        xmlInterno +

                    '</consultaEventosTrabalhador>' +

                '</ConsultarIdentificadoresEventosTrabalhador>' +

            '</soap:Body>' +

        '</soap:Envelope>'
    );
}


function montarEnvelopeSoapBx({
    operacao,
    namespaceServico,
    xmlAssinado
}) {

    const xml =
        removerDeclaracaoXml(
            xmlAssinado
        );

    return (
        '<?xml version="1.0" encoding="utf-8"?>' +

        '<soap:Envelope ' +
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
            'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
            'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +

            '<soap:Body>' +

                `<${operacao} xmlns="${namespaceServico}">` +

                    '<consulta xmlns="">' +

                        xml +

                    '</consulta>' +

                `</${operacao}>` +

            '</soap:Body>' +

        '</soap:Envelope>'
    );
}

function extrairDetalhesErroHtmlBx(
    html
) {

    const conteudo =
        String(
            html ||
            ''
        );


    function extrairTag(
        tag
    ) {

        const regex =
            new RegExp(
                `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
                'i'
            );


        const match =
            conteudo.match(
                regex
            );


        if (
            !match
        ) {

            return '';
        }


        return String(
            match[1] ||
            ''
        )
            .replace(
                /<[^>]+>/g,
                ' '
            )
            .replace(
                /&nbsp;/gi,
                ' '
            )
            .replace(
                /&lt;/gi,
                '<'
            )
            .replace(
                /&gt;/gi,
                '>'
            )
            .replace(
                /&amp;/gi,
                '&'
            )
            .replace(
                /&quot;/gi,
                '"'
            )
            .replace(
                /\s+/g,
                ' '
            )
            .trim();
    }


    const title =
        extrairTag(
            'title'
        );


    const h1 =
        extrairTag(
            'h1'
        );


    const h2 =
        extrairTag(
            'h2'
        );


    const pre =
        extrairTag(
            'pre'
        );


    return {

        title,

        h1,

        h2,

        pre,

        resumo:
            [
                title,
                h1,
                h2,
                pre
            ]
                .filter(
                    Boolean
                )
                .join(
                    ' | '
                )
                .substring(
                    0,
                    8000
                )
    };
}

async function chamarMetodoSoapBxViaWsdl({
    wsdl,
    endpoint,
    metodo,
    xmlAssinado
}) {

    if (
        !wsdl ||
        !fs.existsSync(
            wsdl
        )
    ) {

        throw new Error(
            `WSDL BX não encontrado: ${wsdl || '-'}`
        );
    }


    if (
        !endpoint
    ) {

        throw new Error(
            'Endpoint BX não informado.'
        );
    }


    if (
        !metodo
    ) {

        throw new Error(
            'Método SOAP BX não informado.'
        );
    }


    const xmlInterno =
        removerDeclaracaoXml(
            xmlAssinado
        );


    if (
        !xmlInterno
    ) {

        throw new Error(
            'XML assinado do BX não informado.'
        );
    }


    // ========================================================
    // CERTIFICADO
    // ========================================================

    const caminhoConfigurado =
        String(
            process.env.ESOCIAL_CERT_PATH ||
            ''
        ).trim();


    const senha =
        String(
            process.env.ESOCIAL_CERT_PASSWORD ||
            ''
        );


    if (
        !caminhoConfigurado
    ) {

        throw new Error(
            'ESOCIAL_CERT_PATH não configurado.'
        );
    }


    const caminhoCertificado =
        path.isAbsolute(
            caminhoConfigurado
        )
            ? caminhoConfigurado
            : path.resolve(
                process.cwd(),
                caminhoConfigurado
            );


    if (
        !fs.existsSync(
            caminhoCertificado
        )
    ) {

        throw new Error(
            `Certificado A1 não encontrado: ${caminhoCertificado}`
        );
    }


    const pfx =
        fs.readFileSync(
            caminhoCertificado
        );


    // ========================================================
    // CLIENTE SOAP
    // ========================================================

    let client;


    try {

        client =
            await soap.createClientAsync(
                wsdl,
                {
                    disableCache:
                        true
                }
            );

    } catch (
        error
    ) {

        throw new Error(
            'Não foi possível carregar o WSDL BX: ' +
            (
                error?.message ||
                String(
                    error
                )
            )
        );
    }


    client.setEndpoint(
        endpoint
    );


    client.setSecurity(
        new soap.ClientSSLSecurityPFX(
            pfx,
            senha,
            {
                rejectUnauthorized:
                    true,

                strictSSL:
                    true,

                minVersion:
                    'TLSv1.2'
            }
        )
    );


    const funcaoSoap =
        client[
            metodo
        ];


    if (
        typeof funcaoSoap !==
        'function'
    ) {

        const metodos =
            Object.keys(
                client
            )
                .filter(
                    chave =>
                        typeof client[
                            chave
                        ] ===
                        'function'
                );


        throw new Error(
            `Método ${metodo} não encontrado no WSDL. ` +
            `Métodos: ${metodos.join(', ')}`
        );
    }


    const marcador =
        `__ESOCIAL_BX_XML_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}__`;


    // ========================================================
    // CHAMADA
    // ========================================================

    return await new Promise(
        (
            resolve,
            reject
        ) => {

            funcaoSoap.call(
                client,

                {
                    consulta:
                        marcador
                },

                (
                    error,
                    result,
                    rawResponse,
                    soapHeader,
                    rawRequest
                ) => {

                    if (
                        error
                    ) {

                        const statusHttp =
                            error?.response?.status ||
                            error?.response?.statusCode ||
                            null;


                        const corpoResposta =
                            String(
                                error?.body ||
                                error?.response?.data ||
                                rawResponse ||
                                ''
                            );


                        const contentType =
                            String(
                                error?.response?.headers?.[
                                    'content-type'
                                ] ||
                                ''
                            );


                        // ========================================
                        // EXTRAIR ERRO ASP.NET
                        // ========================================

                        const detalhesHtml =
                            extrairDetalhesErroHtmlBx(
                                corpoResposta
                            );


                        console.error(
                            '❌ ERRO HTTP BX:',
                            {
                                endpoint,

                                metodo,

                                statusHttp,

                                contentType,

                                title:
                                    detalhesHtml.title,

                                h1:
                                    detalhesHtml.h1,

                                h2:
                                    detalhesHtml.h2,

                                pre:
                                    detalhesHtml.pre
                            }
                        );


                        const mensagemOriginal =
                            error?.message &&
                            String(
                                error.message
                            ) !==
                                '[object Object]'
                                ? String(
                                    error.message
                                )
                                : '';


                        const mensagemServidor =
                            detalhesHtml.resumo ||
                            corpoResposta
                                .replace(
                                    /<style[\s\S]*?<\/style>/gi,
                                    ' '
                                )
                                .replace(
                                    /<script[\s\S]*?<\/script>/gi,
                                    ' '
                                )
                                .replace(
                                    /<[^>]+>/g,
                                    ' '
                                )
                                .replace(
                                    /\s+/g,
                                    ' '
                                )
                                .trim()
                                .substring(
                                    0,
                                    8000
                                );


                        const erroFinal =
                            new Error(
                                `Falha na chamada SOAP BX` +
                                (
                                    statusHttp
                                        ? ` HTTP ${statusHttp}`
                                        : ''
                                ) +
                                (
                                    mensagemOriginal
                                        ? `: ${mensagemOriginal}`
                                        : ''
                                ) +
                                (
                                    mensagemServidor
                                        ? ` | SERVIDOR: ${mensagemServidor}`
                                        : ''
                                )
                            );


                        erroFinal.httpStatus =
                            statusHttp;


                        erroFinal.rawResponse =
                            corpoResposta;


                        erroFinal.endpoint =
                            endpoint;


                        erroFinal.metodo =
                            metodo;


                        return reject(
                            erroFinal
                        );
                    }


                    return resolve({

                        success:
                            true,

                        result,

                        rawResponse:
                            String(
                                rawResponse ||
                                ''
                            ),

                        rawRequest:
                            String(
                                rawRequest ||
                                client.lastRequest ||
                                ''
                            )
                    });
                },

                {
                    timeout:
                        60000,

                    postProcess:
                        xmlSoap => {

                            const xmlCompleto =
                                String(
                                    xmlSoap ||
                                    ''
                                );


                            if (
                                !xmlCompleto.includes(
                                    marcador
                                )
                            ) {

                                throw new Error(
                                    'Marcador BX não localizado no SOAP gerado pelo WSDL.'
                                );
                            }


                            return xmlCompleto.replace(
                                marcador,
                                xmlInterno
                            );
                        }
                }
            );
        }
    );
}


// ============================================================
// SOAP FAULT BX
// ============================================================

function extrairSoapFaultBx(
    documento,
    xml
) {

    const faults =
        encontrarElementosPorLocalName(
            documento,
            'Fault',
            []
        );


    if (
        !faults.length
    ) {

        return null;
    }


    const fault =
        faults[0];


    return {

        soapFault:
            true,

        faultCode:
            textoPrimeiroElemento(
                fault,
                'faultcode'
            ),

        faultString:
            textoPrimeiroElemento(
                fault,
                'faultstring'
            ),

        rawXml:
            xml
    };
}


// ============================================================
// LER RETORNO DA CONSULTA DE IDENTIFICADORES
// ============================================================

function extrairRetornoIdentificadoresBx(
    xmlResposta
) {

    const xml =
        String(
            xmlResposta ||
            ''
        ).trim();


    if (
        !xml
    ) {

        throw new Error(
            'Resposta vazia ao consultar identificadores no eSocial.'
        );
    }


    const documento =
        new DOMParser()
            .parseFromString(
                xml,
                'text/xml'
            );


    const fault =
        extrairSoapFaultBx(
            documento,
            xml
        );


    if (
        fault
    ) {

        return fault;
    }


    const retornos =
        encontrarElementosPorLocalName(
            documento,
            'retornoConsultaIdentificadoresEvts',
            []
        );


    if (
        !retornos.length
    ) {

        throw new Error(
            'retornoConsultaIdentificadoresEvts não encontrado.'
        );
    }


    const retorno =
        retornos[0];


    const status =
        primeiroFilhoPorLocalName(
            retorno,
            'status'
        );


    const cdResposta =
        status
            ? textoFilhoDireto(
                status,
                'cdResposta'
            )
            : '';


    const descResposta =
        status
            ? textoFilhoDireto(
                status,
                'descResposta'
            )
            : '';


    const retornoIdentificadores =
        primeiroFilhoPorLocalName(
            retorno,
            'retornoIdentificadoresEvts'
        );


    const qtdeTotEvtsConsulta =
        retornoIdentificadores
            ? Number(
                textoFilhoDireto(
                    retornoIdentificadores,
                    'qtdeTotEvtsConsulta'
                ) ||
                0
            )
            : 0;


    const dhUltimoEvtRetornado =
        retornoIdentificadores
            ? textoFilhoDireto(
                retornoIdentificadores,
                'dhUltimoEvtRetornado'
            )
            : '';


    const identificadores =
        retornoIdentificadores
            ? encontrarElementosPorLocalName(
                retornoIdentificadores,
                'identificadorEvt',
                []
            )
                .map(
                    item => ({

                        id:
                            textoFilhoDireto(
                                item,
                                'id'
                            ),

                        nrRec:
                            textoFilhoDireto(
                                item,
                                'nrRec'
                            )
                    })
                )
                .filter(
                    item =>
                        Boolean(
                            item.id
                        )
                )
            : [];


    return {

        soapFault:
            false,

        cdResposta,

        descResposta,

        qtdeTotEvtsConsulta,

        dhUltimoEvtRetornado,

        identificadores,

        consultaCompleta:
            qtdeTotEvtsConsulta <=
            identificadores.length,

        rawXml:
            xml
    };
}


// ============================================================
// CONSULTAR IDENTIFICADORES NO eSOCIAL - PRODUÇÃO
// ============================================================

async function consultarIdentificadoresEventosTrabalhadorBx({
    tpInsc,
    nrInsc,
    cpf,
    dtIni,
    dtFim
}) {

    // ========================================================
    // CONFIGURAÇÃO DO WSDL/XSD
    // ========================================================

    const config =
        carregarConfigBxEsocial()
            .identificadores;


    // ========================================================
    // MONTAR XML INTERNO
    // ========================================================

    const consulta =
        montarXmlConsultaIdentificadoresTrabalhadorBx({

            tpInsc,

            nrInsc,

            cpf,

            dtIni,

            dtFim
        });


    // ========================================================
    // ASSINAR XML DA CONSULTA
    // ========================================================

    const assinatura =
        assinarXmlEsocial(
            consulta.xml
        );


    if (
        !assinatura ||
        !assinatura.xmlAssinado
    ) {

        throw new Error(
            'Não foi possível assinar a consulta BX.'
        );
    }


    // ========================================================
    // MONTAR SOAP EXATAMENTE COMO WSDL
    // ========================================================

    const envelope =
        montarEnvelopeSoapConsultaIdentificadoresTrabalhadorBx(
            assinatura.xmlAssinado
        );


    // ========================================================
    // LOG - SEM MOSTRAR CERTIFICADO
    // ========================================================

    console.log(
        '🔎 Consultando identificadores eSocial BX:',
        {
            ambiente:
                1,

            tpInsc,

            nrInsc,

            cpf,

            dtIni:
                consulta.dtIni,

            dtFim:
                consulta.dtFim,

            soapAction:
                config.soapAction,

            endpoint:
                ESOCIAL_URL_IDENTIFICADORES_PRODUCAO
        }
    );


    // ========================================================
    // ENVIAR VIA HTTPS + mTLS
    //
    // Usamos nossa função que já funcionou no envio eSocial.
    // ========================================================

    const respostaHttp =
        await enviarSoapEsocial({

            url:
                ESOCIAL_URL_IDENTIFICADORES_PRODUCAO,

            soapAction:
                config.soapAction,

            envelope
        });


    // ========================================================
    // VALIDAR RESPOSTA HTTP
    // ========================================================

    if (
        !respostaHttp
    ) {

        throw new Error(
            'Nenhuma resposta recebida do BX eSocial.'
        );
    }


    const body =
        String(
            respostaHttp.body ||
            ''
        ).trim();


    if (
        !body
    ) {

        throw new Error(
            `BX eSocial respondeu HTTP ${respostaHttp.statusCode}, mas sem conteúdo.`
        );
    }


    // ========================================================
    // NÃO TENTAR PARSEAR HTML COMO XML DO eSOCIAL
    // ========================================================

    if (
        /<html[\s>]/i.test(
            body
        ) ||
        /<!DOCTYPE\s+html/i.test(
            body
        )
    ) {

        const resumo =
            body
                .replace(
                    /<style[\s\S]*?<\/style>/gi,
                    ' '
                )
                .replace(
                    /<script[\s\S]*?<\/script>/gi,
                    ' '
                )
                .replace(
                    /<[^>]+>/g,
                    ' '
                )
                .replace(
                    /&nbsp;/gi,
                    ' '
                )
                .replace(
                    /\s+/g,
                    ' '
                )
                .trim()
                .substring(
                    0,
                    3000
                );


        throw new Error(
            `BX retornou HTML em vez de XML. ` +
            `HTTP ${respostaHttp.statusCode}. ` +
            resumo
        );
    }


    // ========================================================
    // INTERPRETAR XML DO eSOCIAL
    // ========================================================

    const retorno =
        extrairRetornoIdentificadoresBx(
            body
        );


    return {

        httpStatus:
            respostaHttp.statusCode,

        dtIni:
            consulta.dtIni,

        dtFim:
            consulta.dtFim,

        ...retorno
    };
}


// ============================================================
// XML DOWNLOAD POR ID
// ============================================================

function montarXmlSolicitacaoDownloadPorIdBx({
    tpInsc,
    nrInsc,
    ids
}) {

    const config =
        carregarConfigBxEsocial()
            .download;


    const tipoInscricao =
        String(
            tpInsc ||
            ''
        ).trim();


    const numeroInscricao =
        normalizarDocumentoEsocial(
            nrInsc
        );


    const idsNormalizados =
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
                        item =>
                            String(
                                item ||
                                ''
                            ).trim()
                    )
                    .filter(
                        Boolean
                    )
            )
        );


    if (
        ![
            '1',
            '2'
        ].includes(
            tipoInscricao
        )
    ) {

        throw new Error(
            'tpInsc inválido para download BX.'
        );
    }


    if (
        !numeroInscricao
    ) {

        throw new Error(
            'nrInsc não informado para download BX.'
        );
    }


    if (
        idsNormalizados.length < 1 ||
        idsNormalizados.length > 50
    ) {

        throw new Error(
            'O download BX exige entre 1 e 50 IDs.'
        );
    }


    let xml =
        '<?xml version="1.0" encoding="UTF-8"?>';


    xml +=
        `<eSocial xmlns="${config.namespaceMensagem}">`;


    xml +=
        '<download>';


    xml +=
        '<ideEmpregador>';


    xml +=
        `<tpInsc>${escaparXmlEsocial(tipoInscricao)}</tpInsc>`;


    xml +=
        `<nrInsc>${escaparXmlEsocial(numeroInscricao)}</nrInsc>`;


    xml +=
        '</ideEmpregador>';


    xml +=
        '<solicDownloadEvtsPorId>';


    for (
        const id
        of idsNormalizados
    ) {

        xml +=
            `<id>${escaparXmlEsocial(id)}</id>`;
    }


    xml +=
        '</solicDownloadEvtsPorId>';


    xml +=
        '</download>';


    xml +=
        '</eSocial>';


    return xml;
}


// ============================================================
// PRIMEIRO FILHO ELEMENTO
// ============================================================

function primeiroFilhoElementoBx(
    no
) {

    if (
        !no ||
        !no.childNodes
    ) {

        return null;
    }


    for (
        let i = 0;
        i < no.childNodes.length;
        i++
    ) {

        const filho =
            no.childNodes[i];


        if (
            filho.nodeType === 1
        ) {

            return filho;
        }
    }


    return null;
}


// ============================================================
// SERIALIZAR XML INTERNO
// ============================================================

function serializarPrimeiroFilhoElementoBx(
    no
) {

    const filho =
        primeiroFilhoElementoBx(
            no
        );


    if (
        !filho
    ) {

        return '';
    }


    return new XMLSerializer()
        .serializeToString(
            filho
        );
}


// ============================================================
// INTERPRETAR RETORNO DE DOWNLOAD BX
// ============================================================

function extrairRetornoDownloadBx(
    xmlResposta
) {

    const xml =
        String(
            xmlResposta ||
            ''
        ).trim();


    if (
        !xml
    ) {

        throw new Error(
            'Resposta vazia no download BX.'
        );
    }


    // ========================================================
    // PARSE XML
    // ========================================================

    const documento =
        new DOMParser()
            .parseFromString(
                xml,
                'text/xml'
            );


    if (
        !documento ||
        !documento.documentElement
    ) {

        throw new Error(
            'Resposta XML inválida no download BX.'
        );
    }


    // ========================================================
    // SOAP FAULT
    // ========================================================

    const fault =
        extrairSoapFaultBx(
            documento,
            xml
        );


    if (
        fault
    ) {

        return fault;
    }


    // ========================================================
    // FUNÇÕES LOCAIS DE APOIO
    // ========================================================

    function localNameDoNo(
        no
    ) {

        return String(
            no?.localName ||
            no?.nodeName ||
            ''
        )
            .replace(
                /^.*:/,
                ''
            );
    }


    function possuiAncestral(
        no,
        nome
    ) {

        let atual =
            no?.parentNode ||
            null;


        while (
            atual
        ) {

            if (
                localNameDoNo(
                    atual
                ) === nome
            ) {

                return true;
            }


            atual =
                atual.parentNode ||
                null;
        }


        return false;
    }


    // ========================================================
    // TODOS OS ELEMENTOS DOWNLOAD
    // ========================================================

    const downloads =
        encontrarElementosPorLocalName(
            documento,
            'download',
            []
        );


    // ========================================================
    // RETORNO DOS ARQUIVOS
    //
    // Procuramos globalmente porque o conteúdo pode estar
    // encapsulado pelo SOAP antes do XML do eSocial.
    // ========================================================

    const retornosSolicDownload =
        encontrarElementosPorLocalName(
            documento,
            'retornoSolicDownloadEvts',
            []
        );


    const retornoSolicDownload =
        retornosSolicDownload.length
            ? retornosSolicDownload[0]
            : null;


    // ========================================================
    // LOCALIZAR DOWNLOAD PRINCIPAL
    //
    // Não usamos simplesmente downloads[0].
    //
    // Procuramos primeiro o <download> que tenha:
    // - status direto
    // OU
    // - retornoSolicDownloadEvts
    // ========================================================

    let downloadPrincipal =
        null;


    for (
        const itemDownload
        of downloads
    ) {

        const statusDireto =
            primeiroFilhoPorLocalName(
                itemDownload,
                'status'
            );


        const retornoDentro =
            encontrarElementosPorLocalName(
                itemDownload,
                'retornoSolicDownloadEvts',
                []
            );


        if (
            statusDireto ||
            retornoDentro.length
        ) {

            downloadPrincipal =
                itemDownload;

            break;
        }
    }


    if (
        !downloadPrincipal &&
        downloads.length
    ) {

        downloadPrincipal =
            downloads[0];
    }


    // ========================================================
    // STATUS GERAL
    // ========================================================

    let statusGeral =
        downloadPrincipal
            ? primeiroFilhoPorLocalName(
                downloadPrincipal,
                'status'
            )
            : null;


    // ========================================================
    // FALLBACK 1
    //
    // Se não estiver como filho direto, procurar um status
    // dentro do download que NÃO pertença a <arquivo>.
    // ========================================================

    if (
        !statusGeral &&
        downloadPrincipal
    ) {

        const statusesDentroDownload =
            encontrarElementosPorLocalName(
                downloadPrincipal,
                'status',
                []
            );


        statusGeral =
            statusesDentroDownload.find(
                itemStatus =>
                    !possuiAncestral(
                        itemStatus,
                        'arquivo'
                    )
            ) ||
            null;
    }


    // ========================================================
    // FALLBACK 2
    //
    // Procurar no documento todo um status que não seja
    // status individual de arquivo.
    // ========================================================

    if (
        !statusGeral
    ) {

        const todosStatus =
            encontrarElementosPorLocalName(
                documento,
                'status',
                []
            );


        statusGeral =
            todosStatus.find(
                itemStatus =>
                    !possuiAncestral(
                        itemStatus,
                        'arquivo'
                    )
            ) ||
            null;
    }


    // ========================================================
    // ARQUIVOS
    // ========================================================

    let arquivosContainer =
        null;


    if (
        retornoSolicDownload
    ) {

        arquivosContainer =
            primeiroFilhoPorLocalName(
                retornoSolicDownload,
                'arquivos'
            );


        if (
            !arquivosContainer
        ) {

            const encontrados =
                encontrarElementosPorLocalName(
                    retornoSolicDownload,
                    'arquivos',
                    []
                );


            arquivosContainer =
                encontrados.length
                    ? encontrados[0]
                    : null;
        }
    }


    // ========================================================
    // CASO O WRAPPER retornoSolicDownloadEvts NÃO TENHA
    // SIDO LOCALIZADO, TENTAR ENCONTRAR <arquivos> GLOBALMENTE
    // ========================================================

    if (
        !arquivosContainer
    ) {

        const encontrados =
            encontrarElementosPorLocalName(
                documento,
                'arquivos',
                []
            );


        arquivosContainer =
            encontrados.length
                ? encontrados[0]
                : null;
    }


    // ========================================================
    // LER ARQUIVOS
    // ========================================================

    const arquivos =
        [];


    if (
        arquivosContainer
    ) {

        const nosArquivo =
            encontrarElementosPorLocalName(
                arquivosContainer,
                'arquivo',
                []
            );


        for (
            const arquivo
            of nosArquivo
        ) {

            // ==================================================
            // STATUS DO ARQUIVO
            // ==================================================

            const statusArquivo =
                primeiroFilhoPorLocalName(
                    arquivo,
                    'status'
                );


            const cdRespostaArquivo =
                statusArquivo
                    ? textoFilhoDireto(
                        statusArquivo,
                        'cdResposta'
                    )
                    : '';


            const descRespostaArquivo =
                statusArquivo
                    ? textoFilhoDireto(
                        statusArquivo,
                        'descResposta'
                    )
                    : '';


            // ==================================================
            // EVENTO
            // ==================================================

            const evt =
                primeiroFilhoPorLocalName(
                    arquivo,
                    'evt'
                );


            let idEvento =
                '';


            let xmlEvento =
                '';


            if (
                evt
            ) {

                idEvento =
                    String(
                        evt.getAttribute(
                            'Id'
                        ) ||
                        ''
                    ).trim();


                xmlEvento =
                    serializarPrimeiroFilhoElementoBx(
                        evt
                    );
            }


            // ==================================================
            // RECIBO
            // ==================================================

            const rec =
                primeiroFilhoPorLocalName(
                    arquivo,
                    'rec'
                );


            let numeroRecibo =
                '';


            let xmlRecibo =
                '';


            if (
                rec
            ) {

                numeroRecibo =
                    String(
                        rec.getAttribute(
                            'nrRec'
                        ) ||
                        ''
                    ).trim();


                xmlRecibo =
                    serializarPrimeiroFilhoElementoBx(
                        rec
                    );
            }


            arquivos.push({

                cdResposta:
                    cdRespostaArquivo,

                descResposta:
                    descRespostaArquivo,

                idEvento,

                numeroRecibo,

                xmlEvento,

                xmlRecibo
            });
        }
    }


    // ========================================================
    // STATUS GERAL NORMAL
    // ========================================================

    let cdResposta =
        statusGeral
            ? textoFilhoDireto(
                statusGeral,
                'cdResposta'
            )
            : '';


    let descResposta =
        statusGeral
            ? textoFilhoDireto(
                statusGeral,
                'descResposta'
            )
            : '';


    let statusGeralInferido =
        false;


    // ========================================================
    // FALLBACK:
    //
    // Se o retorno trouxe <arquivo>, mas por algum motivo
    // o status geral não ficou acessível no XML recebido,
    // consideramos a solicitação geral aceita.
    //
    // NÃO fazemos isso se não houver nenhum arquivo.
    // ========================================================

    if (
        !cdResposta &&
        arquivos.length
    ) {

        cdResposta =
            '201';


        descResposta =
            'Consulta realizada com sucesso. Status geral inferido pela presença de arquivos no retorno.';


        statusGeralInferido =
            true;
    }


    // ========================================================
    // SE NÃO TEM STATUS NEM ARQUIVO,
    // DEVOLVER ESTRUTURA PARA DIAGNÓSTICO
    // ========================================================

    if (
        !cdResposta &&
        !arquivos.length
    ) {

        const nomes =
            [];


        function coletarNomes(
            no,
            nivel = 0
        ) {

            if (
                !no ||
                nivel > 8
            ) {

                return;
            }


            if (
                no.nodeType === 1
            ) {

                nomes.push(
                    `${'  '.repeat(nivel)}${localNameDoNo(no)}`
                );
            }


            if (
                no.childNodes
            ) {

                for (
                    let i = 0;
                    i < no.childNodes.length;
                    i++
                ) {

                    coletarNomes(
                        no.childNodes[i],
                        nivel + 1
                    );
                }
            }
        }


        coletarNomes(
            documento.documentElement
        );


        throw new Error(
            'Não foi possível localizar o status nem arquivos no retorno BX. ' +
            'Estrutura recebida: ' +
            nomes
                .slice(
                    0,
                    80
                )
                .join(
                    ' > '
                )
        );
    }


    // ========================================================
    // LOG SEGURO
    // ========================================================

    console.log(
        '📥 Retorno download BX:',
        {
            cdResposta,

            descResposta,

            statusGeralInferido,

            quantidadeDownloads:
                downloads.length,

            possuiRetornoSolicDownload:
                Boolean(
                    retornoSolicDownload
                ),

            quantidadeArquivos:
                arquivos.length,

            arquivos:
                arquivos.map(
                    item => ({

                        cdResposta:
                            item.cdResposta,

                        idEvento:
                            item.idEvento,

                        numeroRecibo:
                            item.numeroRecibo,

                        possuiXmlEvento:
                            Boolean(
                                item.xmlEvento
                            ),

                        possuiXmlRecibo:
                            Boolean(
                                item.xmlRecibo
                            )
                    })
                )
        }
    );


    // ========================================================
    // RETORNO FINAL
    // ========================================================

    return {

        soapFault:
            false,

        cdResposta,

        descResposta,

        statusGeralInferido,

        possuiRetornoEventos:
            Boolean(
                retornoSolicDownload ||
                arquivos.length
            ),

        quantidadeArquivos:
            arquivos.length,

        arquivos,

        rawXml:
            xml
    };
}

// ============================================================
// SOAP - DOWNLOAD DE EVENTOS POR ID
// ============================================================

function montarEnvelopeSoapDownloadPorIdBx(
    xmlAssinado
) {

    const config =
        carregarConfigBxEsocial()
            .download;


    const xmlInterno =
        removerDeclaracaoXml(
            xmlAssinado
        );


    if (
        !xmlInterno
    ) {

        throw new Error(
            'XML assinado do download BX não informado.'
        );
    }


    /*
     * Estrutura EXATA do WSDL:
     *
     * <SolicitarDownloadEventosPorId>
     *
     *     <solicitacao>
     *
     *         <eSocial>
     *             ...
     *         </eSocial>
     *
     *     </solicitacao>
     *
     * </SolicitarDownloadEventosPorId>
     */


    return (
        '<?xml version="1.0" encoding="utf-8"?>' +

        '<soap:Envelope ' +
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
            'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
            'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +

            '<soap:Body>' +

                `<SolicitarDownloadEventosPorId ` +
                    `xmlns="${config.namespaceServico}">` +

                    '<solicitacao>' +

                        xmlInterno +

                    '</solicitacao>' +

                '</SolicitarDownloadEventosPorId>' +

            '</soap:Body>' +

        '</soap:Envelope>'
    );
}


// ============================================================
// DOWNLOAD DOS EVENTOS POR ID - eSOCIAL PRODUÇÃO
// ============================================================

async function solicitarDownloadEventosPorIdBx({
    tpInsc,
    nrInsc,
    ids
}) {

    // ========================================================
    // CONFIGURAÇÃO
    // ========================================================

    const config =
        carregarConfigBxEsocial()
            .download;


    // ========================================================
    // MONTAR XML INTERNO
    //
    // <eSocial>
    //     <download>
    //         <ideEmpregador>
    //         <solicDownloadEvtsPorId>
    //             <id>...</id>
    // ========================================================

    const xml =
        montarXmlSolicitacaoDownloadPorIdBx({

            tpInsc,

            nrInsc,

            ids
        });


    if (
        !xml
    ) {

        throw new Error(
            'Não foi possível montar o XML de download BX.'
        );
    }


    // ========================================================
    // ASSINAR XML
    // ========================================================

    const assinatura =
        assinarXmlEsocial(
            xml
        );


    if (
        !assinatura ||
        !assinatura.xmlAssinado
    ) {

        throw new Error(
            'Não foi possível assinar o XML de download BX.'
        );
    }


    // ========================================================
    // MONTAR ENVELOPE SOAP CORRETO
    //
    // WSDL:
    //
    // SolicitarDownloadEventosPorId
    //     ↓
    // solicitacao
    //     ↓
    // eSocial
    // ========================================================

    const envelope =
        montarEnvelopeSoapDownloadPorIdBx(
            assinatura.xmlAssinado
        );


    // ========================================================
    // LOG RESUMIDO
    // ========================================================

    console.log(
        '📥 Solicitando download de eventos BX:',
        {
            ambiente:
                1,

            tpInsc,

            nrInsc,

            quantidadeIds:
                Array.isArray(
                    ids
                )
                    ? ids.length
                    : 0,

            endpoint:
                ESOCIAL_URL_DOWNLOAD_PRODUCAO,

            soapAction:
                config.soapAction
        }
    );


    // ========================================================
    // ENVIAR VIA HTTPS + CERTIFICADO A1
    // ========================================================

    const respostaHttp =
        await enviarSoapEsocial({

            url:
                ESOCIAL_URL_DOWNLOAD_PRODUCAO,

            soapAction:
                config.soapAction,

            envelope
        });


    if (
        !respostaHttp
    ) {

        throw new Error(
            'Nenhuma resposta recebida do serviço de download BX.'
        );
    }


    const body =
        String(
            respostaHttp.body ||
            ''
        ).trim();


    if (
        !body
    ) {

        throw new Error(
            `Download BX respondeu HTTP ${respostaHttp.statusCode}, mas sem conteúdo.`
        );
    }


    // ========================================================
    // EVITAR PARSE DE HTML
    // ========================================================

    if (
        /<html[\s>]/i.test(
            body
        ) ||
        /<!DOCTYPE\s+html/i.test(
            body
        )
    ) {

        const resumo =
            body
                .replace(
                    /<style[\s\S]*?<\/style>/gi,
                    ' '
                )
                .replace(
                    /<script[\s\S]*?<\/script>/gi,
                    ' '
                )
                .replace(
                    /<[^>]+>/g,
                    ' '
                )
                .replace(
                    /&nbsp;/gi,
                    ' '
                )
                .replace(
                    /\s+/g,
                    ' '
                )
                .trim()
                .substring(
                    0,
                    3000
                );


        throw new Error(
            `Download BX retornou HTML em vez de XML. ` +
            `HTTP ${respostaHttp.statusCode}. ` +
            resumo
        );
    }


    // ========================================================
    // INTERPRETAR RETORNO
    // ========================================================

    const retorno =
        extrairRetornoDownloadBx(
            body
        );


    return {

        httpStatus:
            respostaHttp.statusCode,

        ...retorno
    };
}


// ============================================================
// IDENTIFICAR TIPO DO EVENTO BAIXADO
// ============================================================

function detectarTipoEventoEsocialBx(
    documento
) {

    const mapa = [

        [
            'evtMonit',
            'S-2220'
        ],

        [
            'evtExpRisco',
            'S-2240'
        ],

        [
            'evtExclusao',
            'S-3000'
        ],

        [
            'evtAdmiss',
            'S-2200'
        ]
    ];


    for (
        const [
            tag,
            tipo
        ]
        of mapa
    ) {

        const encontrados =
            encontrarElementosPorLocalName(
                documento,
                tag,
                []
            );


        if (
            encontrados.length
        ) {

            return {

                tipoEvento:
                    tipo,

                noEvento:
                    encontrados[0]
            };
        }
    }


    return {

        tipoEvento:
            '',

        noEvento:
            null
    };
}


// ============================================================
// INTERPRETAR EVENTO REAL DO eSOCIAL
// ============================================================

function interpretarEventoBaixadoBx({
    xmlEvento,
    xmlRecibo,
    idEvento,
    numeroRecibo
}) {

    const xml =
        String(
            xmlEvento ||
            ''
        ).trim();


    if (
        !xml
    ) {

        return null;
    }


    const documento =
        new DOMParser()
            .parseFromString(
                xml,
                'text/xml'
            );


    const deteccao =
        detectarTipoEventoEsocialBx(
            documento
        );


    if (
        !deteccao.tipoEvento ||
        !deteccao.noEvento
    ) {

        return null;
    }


    const ideEmpregador =
        encontrarElementosPorLocalName(
            deteccao.noEvento,
            'ideEmpregador',
            []
        )[0] ||
        null;


    const ideVinculo =
        encontrarElementosPorLocalName(
            deteccao.noEvento,
            'ideVinculo',
            []
        )[0] ||
        null;


    const idNoXml =
        String(
            deteccao.noEvento.getAttribute(
                'Id'
            ) ||
            ''
        ).trim();


    let dataReferencia =
        '';


    if (
        deteccao.tipoEvento ===
        'S-2220'
    ) {

        dataReferencia =
            textoPrimeiroElemento(
                deteccao.noEvento,
                'dtAso'
            );

    } else if (
        deteccao.tipoEvento ===
        'S-2240'
    ) {

        dataReferencia =
            textoPrimeiroElemento(
                deteccao.noEvento,
                'dtIniCondicao'
            );
    }


    const infoExclusao =
        deteccao.tipoEvento ===
        'S-3000'
            ? (
                encontrarElementosPorLocalName(
                    deteccao.noEvento,
                    'infoExclusao',
                    []
                )[0] ||
                null
            )
            : null;


    return {

        tipoEvento:
            deteccao.tipoEvento,

        idEvento:
            idNoXml ||
            String(
                idEvento ||
                ''
            ).trim(),

        numeroRecibo:
            String(
                numeroRecibo ||
                ''
            ).trim(),

        tpInscEmpregador:
            ideEmpregador
                ? textoFilhoDireto(
                    ideEmpregador,
                    'tpInsc'
                )
                : '',

        nrInscEmpregador:
            ideEmpregador
                ? textoFilhoDireto(
                    ideEmpregador,
                    'nrInsc'
                )
                : '',

        cpf:
            ideVinculo
                ? textoFilhoDireto(
                    ideVinculo,
                    'cpfTrab'
                )
                : '',

        matricula:
            ideVinculo
                ? textoFilhoDireto(
                    ideVinculo,
                    'matricula'
                )
                : '',

        codCateg:
            ideVinculo
                ? textoFilhoDireto(
                    ideVinculo,
                    'codCateg'
                )
                : '',

        dataReferencia:
            dataReferencia
                ? String(
                    dataReferencia
                ).substring(
                    0,
                    10
                )
                : '',

        tipoEventoExcluido:
            infoExclusao
                ? textoFilhoDireto(
                    infoExclusao,
                    'tpEvento'
                )
                : '',

        numeroReciboExcluido:
            infoExclusao
                ? textoFilhoDireto(
                    infoExclusao,
                    'nrRecEvt'
                )
                : '',

        xmlEvento:
            xml,

        xmlRecibo:
            String(
                xmlRecibo ||
                ''
            ).trim()
    };
}


// ============================================================
// DATA PRINCIPAL DO EVENTO LOCAL
// ============================================================

function obterDataReferenciaEventoLocalBx(
    evento
) {

    const tipoEvento =
        String(
            evento?.tipo_evento ||
            evento?.tipoEvento ||
            ''
        )
            .trim()
            .toUpperCase();


    let valor =
        '';


    if (
        tipoEvento ===
        'S-2220'
    ) {

        valor =
            evento.data_emissao_aso ||
            evento.data_exame ||
            evento.dataAso ||
            evento.dataExame ||
            '';

    } else if (
        tipoEvento ===
        'S-2240'
    ) {

        valor =
            evento.data_inicio_condicao ||
            evento.dataInicioCondicao ||
            evento.data_exame ||
            evento.dataExame ||
            '';
    }


    return valor
        ? String(
            valor
        ).substring(
            0,
            10
        )
        : '';
}


// ============================================================
// COMPARAR EVENTO LOCAL X EVENTO REAL eSOCIAL
// ============================================================

function eventoBxCorrespondeAoEventoLocal(
    evento,
    bx
) {

    if (
        !evento ||
        !bx
    ) {

        return false;
    }


    const tipoLocal =
        String(
            evento.tipo_evento ||
            evento.tipoEvento ||
            ''
        )
            .trim()
            .toUpperCase();


    const tipoBx =
        String(
            bx.tipoEvento ||
            ''
        )
            .trim()
            .toUpperCase();


    if (
        tipoLocal !==
        tipoBx
    ) {

        return false;
    }


    const nrInscLocal =
        normalizarDocumentoEsocial(
            evento.nr_insc_empregador ||
            evento.nrInscEmpregador ||
            ''
        );


    const nrInscBx =
        normalizarDocumentoEsocial(
            bx.nrInscEmpregador ||
            ''
        );


    if (
        nrInscLocal !==
        nrInscBx
    ) {

        return false;
    }


    const cpfLocal =
        normalizarCpfEsocial(
            evento.cpf
        );


    const cpfBx =
        normalizarCpfEsocial(
            bx.cpf
        );


    if (
        cpfLocal !==
        cpfBx
    ) {

        return false;
    }


    const matriculaLocal =
        String(
            evento.matricula ||
            ''
        ).trim();


    const matriculaBx =
        String(
            bx.matricula ||
            ''
        ).trim();


    if (
        matriculaLocal
    ) {

        if (
            matriculaLocal !==
            matriculaBx
        ) {

            return false;
        }

    } else {

        const codCategLocal =
            String(
                evento.cod_categ ||
                evento.codCateg ||
                ''
            ).trim();


        const codCategBx =
            String(
                bx.codCateg ||
                ''
            ).trim();


        if (
            !codCategLocal ||
            codCategLocal !==
            codCategBx
        ) {

            return false;
        }
    }


    const dataLocal =
        obterDataReferenciaEventoLocalBx(
            evento
        );


    const dataBx =
        String(
            bx.dataReferencia ||
            ''
        ).substring(
            0,
            10
        );


    return Boolean(
        dataLocal &&
        dataBx &&
        dataLocal === dataBx
    );
}


// ============================================================
// SALVAR EVENTOS REAIS BAIXADOS
// ============================================================

async function salvarEventosBxNoBanco(
    eventosBx
) {

    const registros =
        (
            Array.isArray(
                eventosBx
            )
                ? eventosBx
                : []
        )
            .filter(
                item =>
                    item &&
                    item.idEvento &&
                    item.tipoEvento
            )
            .map(
                item => {

                    const agora =
                        new Date()
                            .toISOString();


                    return {

                        ambiente:
                            1,

                        tp_insc_empregador:
                            item.tpInscEmpregador ||
                            null,

                        nr_insc_empregador:
                            item.nrInscEmpregador ||
                            null,

                        cpf:
                            item.cpf ||
                            null,

                        matricula:
                            item.matricula ||
                            null,

                        cod_categ:
                            item.codCateg ||
                            null,

                        tipo_evento:
                            item.tipoEvento,

                        data_referencia:
                            item.dataReferencia ||
                            null,

                        id_evento_esocial:
                            item.idEvento,

                        numero_recibo:
                            item.numeroRecibo ||
                            null,

                        numero_recibo_referenciado:
                            item.numeroReciboExcluido ||
                            null,

                        xml_evento:
                            item.xmlEvento ||
                            null,

                        xml_recibo:
                            item.xmlRecibo ||
                            null,

                        consultado_em:
                            agora,

                        updated_at:
                            agora
                    };
                }
            );


    if (
        !registros.length
    ) {

        return [];
    }


    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_eventos_bx'
            )
            .upsert(
                registros,
                {
                    onConflict:
                        'id_evento_esocial'
                }
            )
            .select('*');


    if (
        error
    ) {

        throw error;
    }


    return data ||
        [];
}

// ============================================================
// TESTE BX - DOWNLOAD DE UM ÚNICO EVENTO POR ID
//
// Esta rota NÃO consulta identificadores.
// Ela faz somente 1 chamada ao serviço de download.
//
// Serve para descobrir se o erro 308 está sendo causado
// pelo lote de IDs ou pelo próprio download.
// ============================================================

router.post(
    '/teste-download-esocial-id/:id',

    async (
        req,
        res
    ) => {

        try {

            const idEventoLocal =
                String(
                    req.params.id ||
                    ''
                ).trim();


            const idEventoEsocial =
                String(
                    req.body?.idEvento ||
                    ''
                ).trim();


            // ====================================================
            // VALIDAR
            // ====================================================

            if (
                !idEventoLocal
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'ID do evento local não informado.'
                    });
            }


            if (
                !idEventoEsocial
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'idEvento do eSocial não informado.'
                    });
            }


            if (
                !/^ID[0-9]+$/i.test(
                    idEventoEsocial
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'Formato do ID do eSocial inválido.',

                        idEvento:
                            idEventoEsocial
                    });
            }


            // ====================================================
            // BUSCAR EVENTO LOCAL
            // ====================================================

            const {
                data:
                    evento,

                error:
                    erroBusca
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .select('*')
                    .eq(
                        'id',
                        idEventoLocal
                    )
                    .single();


            if (
                erroBusca
            ) {

                throw erroBusca;
            }


            if (
                !evento
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        error:
                            'Evento local não encontrado.'
                    });
            }


            // ====================================================
            // EMPREGADOR
            // ====================================================

            const tpInsc =
                String(
                    evento.tp_insc_empregador ||
                    ''
                ).trim();


            const nrInsc =
                normalizarDocumentoEsocial(
                    evento.nr_insc_empregador ||
                    ''
                );


            if (
                !tpInsc ||
                !nrInsc
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'Empregador não identificado no evento local.',

                        tpInsc,

                        nrInsc
                    });
            }


            console.log(
                '🧪 TESTE BX - download de um único evento:',
                {
                    eventoLocal:
                        evento.id,

                    tpInsc,

                    nrInsc,

                    idEventoEsocial
                }
            );


            // ====================================================
            // DOWNLOAD
            //
            // IMPORTANTE:
            // NÃO consulta identificadores.
            //
            // Vai diretamente ao download com 1 único ID.
            // ====================================================

            const retorno =
                await solicitarDownloadEventosPorIdBx({

                    tpInsc,

                    nrInsc,

                    ids: [
                        idEventoEsocial
                    ]
                });


            // ====================================================
            // RESUMIR ARQUIVOS
            //
            // Não devolvemos os XMLs completos no teste.
            // ====================================================

            const arquivos =
                (
                    Array.isArray(
                        retorno?.arquivos
                    )
                        ? retorno.arquivos
                        : []
                )
                    .map(
                        arquivo => ({

                            cdResposta:
                                arquivo.cdResposta ||
                                null,

                            descResposta:
                                arquivo.descResposta ||
                                null,

                            idEvento:
                                arquivo.idEvento ||
                                null,

                            numeroRecibo:
                                arquivo.numeroRecibo ||
                                null,

                            possuiXmlEvento:
                                Boolean(
                                    arquivo.xmlEvento
                                ),

                            possuiXmlRecibo:
                                Boolean(
                                    arquivo.xmlRecibo
                                )
                        })
                    );


            // ====================================================
            // RESPOSTA
            // ====================================================

            return res.json({

                success:
                    String(
                        retorno?.cdResposta ||
                        ''
                    ) === '201',

                teste:
                    'download-unico-por-id',

                ambiente:
                    1,

                eventoLocalId:
                    evento.id,

                empregador: {

                    tpInsc,

                    nrInsc
                },

                idSolicitado:
                    idEventoEsocial,

                httpStatus:
                    retorno?.httpStatus ||
                    null,

                cdResposta:
                    retorno?.cdResposta ||
                    null,

                descResposta:
                    retorno?.descResposta ||
                    null,

                quantidadeArquivos:
                    arquivos.length,

                arquivos
            });


        } catch (
            error
        ) {

            console.error(
                '❌ Erro no teste de download BX por ID:',
                error?.message ||
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    teste:
                        'download-unico-por-id',

                    error:
                        error?.message ||
                        String(
                            error
                        )
                });
        }
    }
);

// ============================================================
// VERIFICAÇÃO BX OBRIGATÓRIA ANTES DO ENVIO EM PRODUÇÃO
// ============================================================

async function verificarEventoExistenteNoEsocialAntesDoEnvio(
    evento
) {

    if (
        !evento ||
        typeof evento !== 'object'
    ) {

        throw new Error(
            'Evento não informado para verificação BX.'
        );
    }


    const tipoEvento =
        String(
            evento.tipo_evento ||
            ''
        )
            .trim()
            .toUpperCase();


    if (
        tipoEvento !==
        'S-2220'
    ) {

        return {

            success:
                false,

            verificacaoCompleta:
                false,

            jaExisteNoEsocial:
                false,

            etapa:
                'validacao-local',

            error:
                'A verificação automática antes do envio está liberada somente para S-2220 nesta etapa.'
        };
    }


    // ========================================================
    // JÁ CONFIRMAMOS ANTERIORMENTE QUE EXISTE
    //
    // Não gastamos outro acesso BX.
    // ========================================================

    if (
        evento.existe_no_esocial === true ||
        String(
            evento.numero_recibo_existente ||
            ''
        ).trim()
    ) {

        return {

            success:
                true,

            verificacaoCompleta:
                false,

            jaExisteNoEsocial:
                true,

            origem:
                'cache-confirmado',

            correspondente: {

                tipoEvento,

                idEvento:
                    String(
                        evento.id_evento_esocial_existente ||
                        ''
                    ).trim() ||
                    null,

                numeroRecibo:
                    String(
                        evento.numero_recibo_existente ||
                        ''
                    ).trim() ||
                    null,

                cpf:
                    normalizarCpfEsocial(
                        evento.cpf
                    ),

                matricula:
                    String(
                        evento.matricula ||
                        ''
                    ).trim(),

                dataReferencia:
                    obterDataReferenciaEventoLocalBx(
                        evento
                    )
            }
        };
    }


    const cpf =
        normalizarCpfEsocial(
            evento.cpf
        );


    const tpInsc =
        String(
            evento.tp_insc_empregador ||
            ''
        ).trim();


    const nrInsc =
        normalizarDocumentoEsocial(
            evento.nr_insc_empregador ||
            ''
        );


    if (
        cpf.length !== 11
    ) {

        return {

            success:
                false,

            verificacaoCompleta:
                false,

            jaExisteNoEsocial:
                false,

            etapa:
                'validacao-local',

            error:
                'CPF inválido no evento local.'
        };
    }


    if (
        !tpInsc ||
        !nrInsc
    ) {

        return {

            success:
                false,

            verificacaoCompleta:
                false,

            jaExisteNoEsocial:
                false,

            etapa:
                'validacao-local',

            error:
                'Empregador não identificado no evento local.'
        };
    }


    // ========================================================
    // CONSULTA POR DATA DE RECEPÇÃO
    // ========================================================

    const margemSegurancaBxMs =
        2 *
        60 *
        60 *
        1000;


    const dtFim =
        new Date(
            Date.now() -
            margemSegurancaBxMs
        );


    const dtIni =
        new Date(
            dtFim.getTime() -
            (
                30 *
                24 *
                60 *
                60 *
                1000
            )
        );


    let consulta;


    try {

        consulta =
            await consultarIdentificadoresEventosTrabalhadorBx({

                tpInsc,

                nrInsc,

                cpf,

                dtIni,

                dtFim
            });

    } catch (
        error
    ) {

        return {

            success:
                false,

            verificacaoCompleta:
                false,

            jaExisteNoEsocial:
                false,

            etapa:
                'consultar-identificadores',

            error:
                error?.message ||
                String(
                    error
                )
        };
    }


    if (
        consulta.soapFault
    ) {

        return {

            success:
                false,

            verificacaoCompleta:
                false,

            jaExisteNoEsocial:
                false,

            etapa:
                'consultar-identificadores',

            soapFault:
                true,

            faultCode:
                consulta.faultCode,

            error:
                consulta.faultString ||
                'SOAP Fault na consulta BX.'
        };
    }


    const codigosConsultaValidos =
        new Set([
            '201',
            '203',
            '406'
        ]);


    if (
        !codigosConsultaValidos.has(
            String(
                consulta.cdResposta ||
                ''
            )
        )
    ) {

        return {

            success:
                false,

            verificacaoCompleta:
                false,

            jaExisteNoEsocial:
                false,

            etapa:
                'consultar-identificadores',

            cdResposta:
                consulta.cdResposta,

            descResposta:
                consulta.descResposta,

            error:
                consulta.descResposta ||
                'Consulta BX não concluída.'
        };
    }


    // ========================================================
    // DOWNLOAD DOS EVENTOS ENCONTRADOS
    // ========================================================

    const resultadoDownload =
        await baixarEventosBxUmPorUm({

            tpInsc,

            nrInsc,

            identificadores:
                consulta.identificadores,

            eventoLocal:
                evento,

            maxDownloads:
                8
        });


    const correspondente =
        resultadoDownload.correspondente ||
        null;


    const consultaIdentificadoresCompleta =
        Boolean(
            consulta.consultaCompleta
        );


    const verificacaoCompleta =
        !correspondente &&
        consultaIdentificadoresCompleta &&
        resultadoDownload.todosProcessados;


    const agora =
        new Date()
            .toISOString();


    const {
        error:
            erroUpdate
    } =
        await getSupabase()
            .from(
                'esocial_eventos'
            )
            .update({

                verificado_esocial_em:
                    agora,

                verificacao_esocial_completa:
                    verificacaoCompleta,

                verificacao_esocial_dt_ini:
                    consulta.dtIni,

                verificacao_esocial_dt_fim:
                    consulta.dtFim,

                existe_no_esocial:
                    Boolean(
                        correspondente
                    ),

                id_evento_esocial_existente:
                    correspondente?.idEvento ||
                    null,

                numero_recibo_existente:
                    correspondente?.numeroRecibo ||
                    null,

                updated_at:
                    agora
            })
            .eq(
                'id',
                evento.id
            );


    if (
        erroUpdate
    ) {

        throw erroUpdate;
    }


    // ========================================================
    // EVENTOS ANTIGOS
    //
    // Se não encontramos duplicidade, mas o evento é antigo,
    // uma janela de 30 dias não é suficiente para garantir que
    // ele nunca foi transmitido anteriormente.
    // ========================================================

    const dataReferencia =
        obterDataReferenciaEventoLocalBx(
            evento
        );


    let eventoForaJanelaSegura =
        false;


    if (
        dataReferencia
    ) {

        const dataReferenciaDate =
            new Date(
                `${dataReferencia}T00:00:00-03:00`
            );


        if (
            !Number.isNaN(
                dataReferenciaDate.getTime()
            )
        ) {

            const limiteReferencia =
                Date.now() -
                (
                    30 *
                    24 *
                    60 *
                    60 *
                    1000
                );


            eventoForaJanelaSegura =
                dataReferenciaDate.getTime() <
                limiteReferencia;
        }
    }


    return {

        success:
            true,

        origem:
            'bx-producao',

        jaExisteNoEsocial:
            Boolean(
                correspondente
            ),

        verificacaoCompleta,

        eventoForaJanelaSegura,

        dataReferencia:
            dataReferencia ||
            null,

        correspondente,

        consulta: {

            cdResposta:
                consulta.cdResposta,

            descResposta:
                consulta.descResposta,

            quantidadeTotalEncontrada:
                consulta.qtdeTotEvtsConsulta,

            quantidadeRetornada:
                consulta.identificadores.length,

            consultaCompleta:
                consultaIdentificadoresCompleta,

            dtIni:
                consulta.dtIni,

            dtFim:
                consulta.dtFim
        },

        download: {

            quantidadeIdsRecebidos:
                resultadoDownload.quantidadeIdsRecebidos,

            quantidadeIdsTentados:
                resultadoDownload.quantidadeIdsTentados,

            quantidadeEventosInterpretados:
                resultadoDownload.eventosInterpretados.length,

            falhas:
                resultadoDownload.falhas,

            todosProcessados:
                resultadoDownload.todosProcessados,

            interrompidoPorCorrespondencia:
                resultadoDownload.interrompidoPorCorrespondencia
        }
    };
}


router.post(
    '/sincronizar-esocial-existente/:id',

    async (
        req,
        res
    ) => {

        try {

            const id =
                String(
                    req.params.id ||
                    ''
                ).trim();


            if (
                !id
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'ID do evento não informado.'
                    });
            }


            // ====================================================
            // BUSCAR EVENTO LOCAL
            // ====================================================

            const {
                data:
                    evento,

                error:
                    erroBusca
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .select('*')
                    .eq(
                        'id',
                        id
                    )
                    .single();


            if (
                erroBusca
            ) {

                throw erroBusca;
            }


            if (
                !evento
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        error:
                            'Evento não encontrado.'
                    });
            }


            // ====================================================
            // TIPO
            // ====================================================

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

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'A sincronização BX está disponível somente para S-2220 e S-2240.'
                    });
            }


            // ====================================================
            // CPF
            // ====================================================

            const cpf =
                normalizarCpfEsocial(
                    evento.cpf
                );


            if (
                cpf.length !== 11
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'CPF inválido no evento local.'
                    });
            }


            // ====================================================
            // EMPREGADOR
            // ====================================================

            const tpInsc =
                String(
                    evento.tp_insc_empregador ||
                    ''
                ).trim();


            const nrInsc =
                normalizarDocumentoEsocial(
                    evento.nr_insc_empregador ||
                    ''
                );


            if (
                !tpInsc ||
                !nrInsc
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'Empregador não identificado no evento local.'
                    });
            }


            // ====================================================
            // PERÍODO BX
            //
            // 2 horas de margem de segurança.
            // ====================================================

            const margemSegurancaBxMs =
                2 *
                60 *
                60 *
                1000;


            const limiteDtFimBx =
                new Date(
                    Date.now() -
                    margemSegurancaBxMs
                );


            let dtFim;


            if (
                req.body?.dtFim
            ) {

                dtFim =
                    new Date(
                        req.body.dtFim
                    );


                if (
                    Number.isNaN(
                        dtFim.getTime()
                    )
                ) {

                    return res
                        .status(400)
                        .json({

                            success:
                                false,

                            error:
                                'dtFim inválida.'
                        });
                }


                if (
                    dtFim.getTime() >
                    limiteDtFimBx.getTime()
                ) {

                    dtFim =
                        limiteDtFimBx;
                }

            } else {

                dtFim =
                    limiteDtFimBx;
            }


            let dtIni;


            if (
                req.body?.dtIni
            ) {

                dtIni =
                    new Date(
                        req.body.dtIni
                    );


                if (
                    Number.isNaN(
                        dtIni.getTime()
                    )
                ) {

                    return res
                        .status(400)
                        .json({

                            success:
                                false,

                            error:
                                'dtIni inválida.'
                        });
                }

            } else {

                dtIni =
                    new Date(
                        dtFim.getTime() -
                        (
                            30 *
                            24 *
                            60 *
                            60 *
                            1000
                        )
                    );
            }


            // ====================================================
            // 1. CONSULTAR IDENTIFICADORES
            // ====================================================

            const consulta =
                await consultarIdentificadoresEventosTrabalhadorBx({

                    tpInsc,

                    nrInsc,

                    cpf,

                    dtIni,

                    dtFim
                });


            if (
                consulta.soapFault
            ) {

                return res
                    .status(502)
                    .json({

                        success:
                            false,

                        etapa:
                            'consultar-identificadores',

                        soapFault:
                            true,

                        faultCode:
                            consulta.faultCode,

                        error:
                            consulta.faultString
                    });
            }


            const codigosConsultaValidos =
                new Set([
                    '201',
                    '203',
                    '406'
                ]);


            if (
                !codigosConsultaValidos.has(
                    String(
                        consulta.cdResposta ||
                        ''
                    )
                )
            ) {

                return res
                    .status(422)
                    .json({

                        success:
                            false,

                        etapa:
                            'consultar-identificadores',

                        cdResposta:
                            consulta.cdResposta,

                        descResposta:
                            consulta.descResposta,

                        dtIni:
                            consulta.dtIni,

                        dtFim:
                            consulta.dtFim
                    });
            }


            // ====================================================
            // 2. DOWNLOAD
            //
            // AGORA UM ID POR VEZ.
            //
            // Nunca mais mandamos a lista inteira de IDs.
            // ====================================================

            const resultadoDownload =
                await baixarEventosBxUmPorUm({

                    tpInsc,

                    nrInsc,

                    identificadores:
                        consulta.identificadores,

                    eventoLocal:
                        evento,

                    /*
                     * 1 acesso já foi usado pela consulta.
                     *
                     * Colocamos no máximo 8 downloads nesta
                     * execução e deixamos uma margem.
                     */

                    maxDownloads:
                        8
                });


            const correspondente =
                resultadoDownload.correspondente ||
                null;


            // ====================================================
            // 3. COMPLETUDE
            //
            // Se achamos o evento:
            // NÃO precisamos considerar consulta completa para
            // bloquear reenvio.
            //
            // Se NÃO achamos:
            // só liberaremos no futuro se absolutamente tudo tiver
            // sido analisado.
            // ====================================================

            const consultaIdentificadoresCompleta =
                Boolean(
                    consulta.consultaCompleta
                );


            const verificacaoCompleta =
                !correspondente &&
                consultaIdentificadoresCompleta &&
                resultadoDownload.todosProcessados;


            // ====================================================
            // 4. ATUALIZAR EVENTO LOCAL
            // ====================================================

            const agora =
                new Date()
                    .toISOString();


            const {
                error:
                    erroUpdate
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        verificado_esocial_em:
                            agora,

                        verificacao_esocial_completa:
                            verificacaoCompleta,

                        verificacao_esocial_dt_ini:
                            consulta.dtIni,

                        verificacao_esocial_dt_fim:
                            consulta.dtFim,

                        existe_no_esocial:
                            Boolean(
                                correspondente
                            ),

                        id_evento_esocial_existente:
                            correspondente?.idEvento ||
                            null,

                        numero_recibo_existente:
                            correspondente?.numeroRecibo ||
                            null,

                        updated_at:
                            agora
                    })
                    .eq(
                        'id',
                        evento.id
                    );


            if (
                erroUpdate
            ) {

                throw erroUpdate;
            }


            // ====================================================
            // 5. RESPOSTA
            // ====================================================

            return res.json({

                success:
                    true,

                somenteLeitura:
                    true,

                ambienteConsultado:
                    1,

                eventoLocalId:
                    evento.id,

                tipoEventoLocal:
                    tipoEvento,

                cpf,

                empregador: {

                    tpInsc,

                    nrInsc
                },

                periodoRecepcaoConsultado: {

                    dtIni:
                        consulta.dtIni,

                    dtFim:
                        consulta.dtFim
                },

                consultaIdentificadores: {

                    cdResposta:
                        consulta.cdResposta,

                    descResposta:
                        consulta.descResposta,

                    quantidadeTotalEncontrada:
                        consulta.qtdeTotEvtsConsulta,

                    quantidadeRetornada:
                        consulta.identificadores.length,

                    consultaCompleta:
                        consultaIdentificadoresCompleta,

                    dhUltimoEvtRetornado:
                        consulta.dhUltimoEvtRetornado ||
                        null
                },

                download: {

                    modo:
                        'individual-sequencial',

                    quantidadeIdsRecebidos:
                        resultadoDownload.quantidadeIdsRecebidos,

                    quantidadeIdsTentados:
                        resultadoDownload.quantidadeIdsTentados,

                    idsTentados:
                        resultadoDownload.idsTentados,

                    quantidadeEventosInterpretados:
                        resultadoDownload.eventosInterpretados.length,

                    quantidadeFalhas:
                        resultadoDownload.falhas.length,

                    falhas:
                        resultadoDownload.falhas,

                    interrompidoPorCorrespondencia:
                        resultadoDownload.interrompidoPorCorrespondencia,

                    todosProcessados:
                        resultadoDownload.todosProcessados
                },

                verificacaoCompleta,

                jaExisteNoEsocial:
                    Boolean(
                        correspondente
                    ),

                eventoCorrespondente:
                    correspondente
                        ? {

                            tipoEvento:
                                correspondente.tipoEvento,

                            idEvento:
                                correspondente.idEvento,

                            numeroRecibo:
                                correspondente.numeroRecibo,

                            cpf:
                                correspondente.cpf,

                            matricula:
                                correspondente.matricula,

                            codCateg:
                                correspondente.codCateg,

                            dataReferencia:
                                correspondente.dataReferencia
                        }
                        : null,

                podeEnviar:
                    false,

                motivoBloqueio:
                    correspondente
                        ? (
                            'Evento já existe no eSocial. Não pode ser reenviado.'
                        )
                        : (
                            verificacaoCompleta
                                ? (
                                    'Verificação concluída. A liberação do envio em Produção ainda não foi habilitada.'
                                )
                                : (
                                    'Verificação incompleta. Envio deve permanecer bloqueado.'
                                )
                        )
            });


        } catch (
            error
        ) {

            console.error(
                '❌ Erro ao sincronizar eventos existentes do eSocial:',
                error?.message ||
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error?.message ||
                        String(
                            error
                        )
                });
        }
    }
);

// ============================================================
// STATUS DA INTEGRAÇÃO
// ============================================================

router.get(
    '/status-integracao',

    async (
        req,
        res
    ) => {

        try {

            const client =
                await getSocClient();


            const metodos =
                Object.keys(
                    client
                )

                    .filter(
                        key =>
                            typeof client[
                                key
                            ] ===
                            'function'
                    )

                    .filter(
                        key =>
                            key
                                .toLowerCase()
                                .includes(
                                    'exporta'
                                )
                    );


            const extracaoTeste =
                obterExtracaoDeTeste();


            if (
                !extracaoTeste
            ) {

                return res.json({

                    connected:
                        true,

                    serverReachable:
                        true,

                    authenticated:
                        false,

                    message:
                        'WSDL do SOC carregado. ' +
                        'Configure código e chave de uma extração ' +
                        'do programa 733 para testar a consulta.',

                    metodos,

                    url:
                        SOC_CONFIG.endpoint
                });
            }


            const filtrosTeste =
                envJson(
                    'SOC_FILTROS_TESTE_JSON',
                    {}
                );


            const empresaTeste =
                env(
                    'SOC_EMPRESA_TESTE'
                );


            const dados =
                await exportarDadosSoc({

                    codigo:
                        extracaoTeste.codigo,

                    chave:
                        extracaoTeste.chave,

                    empresaTrabalho:
                        empresaTeste ||
                        undefined,

                    filtros:
                        filtrosTeste
                });


            const registros =
                localizarArray(
                    dados
                );


            return res.json({

                connected:
                    true,

                serverReachable:
                    true,

                authenticated:
                    true,

                message:
                    'Conexão e consulta ao SOC realizadas com sucesso.',

                extracaoUsada:
                    extracaoTeste.tipo,

                tipoRetorno:
                    Array.isArray(
                        dados
                    )
                        ? 'array'
                        : typeof dados,

                quantidade:
                    registros.length,

                url:
                    SOC_CONFIG.endpoint
            });


        } catch (error) {

            const detalhe =
                formatarErro(
                    error
                );


            console.error(
                '❌ Erro integração SOC:',
                detalhe
            );


            return res

                .status(
                    502
                )

                .json({

                    connected:
                        false,

                    serverReachable:
                        detalhe.socReached,

                    authenticated:
                        Boolean(
                            error?.socReached
                        ),

                    message:
                        detalhe.message,

                    details:
                        detalhe,

                    url:
                        SOC_CONFIG.endpoint
                });
        }
    }
);

// ============================================================
// ASSINAR EVENTO S-2220
// ============================================================

router.post(
    '/assinar-evento/:id',

    async (
        req,
        res
    ) => {

        try {

            const id =
                String(
                    req.params.id ||
                    ''
                ).trim();


            if (
                !id
            ) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,

                        error:
                            'ID do evento não informado.'
                    });
            }


            // ====================================================
            // BUSCAR EVENTO
            // ====================================================

            const {
                data:
                    evento,

                error:
                    erroBusca
            } =

                await getSupabase()

                    .from(
                        'esocial_eventos'
                    )

                    .select('*')

                    .eq(
                        'id',
                        id
                    )

                    .single();


            if (
                erroBusca
            ) {

                throw erroBusca;
            }


            if (
                !evento
            ) {

                return res
                    .status(404)
                    .json({
                        success:
                            false,

                        error:
                            'Evento não encontrado.'
                    });
            }


            // ====================================================
            // POR ENQUANTO SOMENTE S-2220
            // ====================================================

            const tipoEvento =
                String(
                    evento.tipo_evento ||
                    ''
                )
                    .trim()
                    .toUpperCase();


            if (
                tipoEvento !==
                'S-2220'
            ) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,

                        error:
                            'A assinatura direta está implementada somente para S-2220 neste momento.'
                    });
            }


            // ====================================================
            // JÁ CONCLUÍDO
            // ====================================================

            if (
                evento.numero_recibo
            ) {

                return res
                    .status(409)
                    .json({
                        success:
                            false,

                        error:
                            'Este evento já possui recibo eSocial. ' +
                            'Não será criada uma nova assinatura.'
                    });
            }


            // ====================================================
            // XML JÁ ASSINADO
            // ====================================================

            if (
                evento.xml_assinado
            ) {

                const certificado =
                    carregarCertificadoEsocial();


                validarAssinaturaXmlEsocial(
                    evento.xml_assinado,
                    certificado.publicCertPem
                );


                return res.json({

                    success:
                        true,

                    tipoEvento:
                        'S-2220',

                    ambiente:
                        Number(
                            evento.ambiente_esocial ||
                            2
                        ),

                    idEvento:
                        evento.id_evento_esocial,

                    jaExistia:
                        true,

                    assinaturaValidaLocal:
                        true,

                    referenceUri:
                        '',

                    xmlAssinado:
                        evento.xml_assinado
                });
            }


            // ====================================================
            // OBTER OU GERAR XML ORIGINAL
            // ====================================================

            let xmlGerado =
                String(
                    evento.xml_gerado ||
                    ''
                ).trim();


            let idEvento =
                String(
                    evento.id_evento_esocial ||
                    ''
                ).trim();


            let ambiente =
                Number(
                    evento.ambiente_esocial ||
                    process.env.ESOCIAL_AMBIENTE ||
                    2
                );


            if (
                ambiente !== 1 &&
                ambiente !== 2
            ) {

                ambiente =
                    2;
            }


            if (
                !xmlGerado
            ) {

                const resultadoXml =
                    gerarXmlS2220(
                        evento,
                        {
                            ambiente
                        }
                    );


                xmlGerado =
                    resultadoXml.xml;


                idEvento =
                    resultadoXml.idEvento;


                ambiente =
                    resultadoXml.ambiente;
            }


            // ====================================================
            // ASSINAR
            // ====================================================

            const resultadoAssinatura =
                assinarXmlEsocial(
                    xmlGerado
                );


            // ====================================================
            // SALVAR
            // ====================================================

            const {
                error:
                    erroUpdate
            } =

                await getSupabase()

                    .from(
                        'esocial_eventos'
                    )

                    .update({

                        id_evento_esocial:
                            idEvento,

                        xml_gerado:
                            xmlGerado,

                        xml_assinado:
                            resultadoAssinatura.xmlAssinado,

                        ambiente_esocial:
                            ambiente,

                        updated_at:
                            new Date()
                                .toISOString()
                    })

                    .eq(
                        'id',
                        id
                    );


            if (
                erroUpdate
            ) {

                throw erroUpdate;
            }


            // ====================================================
            // RESULTADO
            // ====================================================

            return res.json({

                success:
                    true,

                tipoEvento:
                    'S-2220',

                ambiente,

                idEvento,

                jaExistia:
                    false,

                assinaturaValidaLocal:
                    true,

                referenceUri:
                    resultadoAssinatura.referenceUri,

                algoritmoAssinatura:
                    resultadoAssinatura.algoritmoAssinatura,

                algoritmoDigest:
                    resultadoAssinatura.algoritmoDigest,

                canonicalizacao:
                    resultadoAssinatura.canonicalizacao,

                xmlAssinado:
                    resultadoAssinatura.xmlAssinado
            });


        } catch (error) {

            console.error(
                '❌ Erro ao assinar evento eSocial:',
                error?.message ||
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error?.message ||
                        String(error)
                });
        }
    }
);

// ============================================================
// VALIDAR S-2220 CONTRA XSD OFICIAL
// ============================================================

router.post(
    '/validar-xsd/:id',

    async (
        req,
        res
    ) => {

        try {

            const id =
                String(
                    req.params.id ||
                    ''
                ).trim();


            if (
                !id
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'ID do evento não informado.'
                    });
            }


            // ====================================================
            // BUSCAR EVENTO
            // ====================================================

            const {
                data:
                    evento,

                error:
                    erroBusca
            } =

                await getSupabase()

                    .from(
                        'esocial_eventos'
                    )

                    .select('*')

                    .eq(
                        'id',
                        id
                    )

                    .single();


            if (
                erroBusca
            ) {

                throw erroBusca;
            }


            if (
                !evento
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        error:
                            'Evento não encontrado.'
                    });
            }


            // ====================================================
            // SOMENTE S-2220
            // ====================================================

            if (
                String(
                    evento.tipo_evento ||
                    ''
                )
                    .trim()
                    .toUpperCase()
                !==
                'S-2220'
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'A validação XSD está implementada ' +
                            'somente para S-2220 neste momento.'
                    });
            }


            // ====================================================
            // XML A VALIDAR
            // ====================================================

            /*
             * Preferimos o assinado porque é exatamente
             * o documento que posteriormente será colocado
             * no lote e transmitido.
             */

            const xml =
                String(
                    evento.xml_assinado ||
                    evento.xml_gerado ||
                    ''
                ).trim();


            if (
                !xml
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'O evento ainda não possui XML gerado.'
                    });
            }


            // ====================================================
            // VALIDAR
            // ====================================================

            const resultado =
                await validarXmlS2220ContraXsd(
                    xml
                );


            // ====================================================
            // RETORNO
            // ====================================================

            return res.json({

                success:
                    true,

                eventoId:
                    evento.id,

                idEvento:
                    evento.id_evento_esocial,

                tipoEvento:
                    evento.tipo_evento,

                ambiente:
                    evento.ambiente_esocial,

                xmlUsado:
                    evento.xml_assinado
                        ? 'xml_assinado'
                        : 'xml_gerado',

                xsdValido:
                    resultado.valido,

                schema:
                    resultado.schema,

                namespace:
                    resultado.namespace,

                quantidadeXsd:
                    resultado.quantidadeXsd,

                erros:
                    resultado.erros
            });


        } catch (error) {

            console.error(
                '❌ Erro na validação XSD:',
                error?.message ||
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error?.message ||
                        String(error)
                });
        }
    }
);

router.post(
    '/enviar-evento-esocial/:id',

    async (
        req,
        res
    ) => {

        try {

            const id =
                String(
                    req.params.id ||
                    ''
                ).trim();


            if (
                !id
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'ID do evento não informado.'
                    });
            }


            const ambiente =
                obterAmbienteEsocialConfigurado();


            // ====================================================
            // BUSCAR EVENTO ATUAL
            // ====================================================

            const {
                data:
                    evento,

                error:
                    erroBusca
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .select('*')
                    .eq(
                        'id',
                        id
                    )
                    .single();


            if (
                erroBusca
            ) {

                throw erroBusca;
            }


            if (
                !evento
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        error:
                            'Evento não encontrado.'
                    });
            }


            // ====================================================
            // SOMENTE S-2220
            // ====================================================

            const tipoEvento =
                String(
                    evento.tipo_evento ||
                    ''
                )
                    .trim()
                    .toUpperCase();


            if (
                tipoEvento !==
                'S-2220'
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'O envio direto está liberado somente para S-2220 nesta etapa.'
                    });
            }


            // ====================================================
            // PRODUÇÃO:
            //
            // PRIMEIRO verifica o eSocial real.
            // Nenhum XML é gerado e nenhum lote é transmitido
            // antes desta proteção.
            // ====================================================

            let verificacaoBx =
                null;


            if (
                ambiente === 1
            ) {

                verificacaoBx =
                    await verificarEventoExistenteNoEsocialAntesDoEnvio(
                        evento
                    );


                // ================================================
                // EVENTO JÁ EXISTE
                // ================================================

                if (
                    verificacaoBx.jaExisteNoEsocial
                ) {

                    return res
                        .status(409)
                        .json({

                            success:
                                false,

                            bloqueado:
                                true,

                            podeEnviar:
                                false,

                            ambiente:
                                1,

                            motivo:
                                'EVENTO_JA_EXISTE_NO_ESOCIAL',

                            error:
                                'Evento já existe no eSocial de Produção. Não pode ser reenviado.',

                            origemVerificacao:
                                verificacaoBx.origem,

                            idEventoExistente:
                                verificacaoBx.correspondente?.idEvento ||
                                null,

                            numeroReciboExistente:
                                verificacaoBx.correspondente?.numeroRecibo ||
                                null,

                            eventoCorrespondente:
                                verificacaoBx.correspondente ||
                                null
                        });
                }


                // ================================================
                // NÃO CONSEGUIU FAZER A CONSULTA
                // ================================================

                if (
                    verificacaoBx.success !==
                    true
                ) {

                    return res
                        .status(503)
                        .json({

                            success:
                                false,

                            bloqueado:
                                true,

                            podeEnviar:
                                false,

                            ambiente:
                                1,

                            motivo:
                                'VERIFICACAO_ESOCIAL_FALHOU',

                            etapa:
                                verificacaoBx.etapa ||
                                null,

                            cdResposta:
                                verificacaoBx.cdResposta ||
                                null,

                            descResposta:
                                verificacaoBx.descResposta ||
                                null,

                            error:
                                verificacaoBx.error ||
                                'Não foi possível concluir a verificação no eSocial. O envio foi bloqueado.'
                        });
                }


                // ================================================
                // NÃO ENCONTROU, MAS A VERIFICAÇÃO FICOU INCOMPLETA
                // ================================================

                if (
                    verificacaoBx.verificacaoCompleta !==
                    true
                ) {

                    return res
                        .status(409)
                        .json({

                            success:
                                false,

                            bloqueado:
                                true,

                            podeEnviar:
                                false,

                            ambiente:
                                1,

                            motivo:
                                'VERIFICACAO_ESOCIAL_INCOMPLETA',

                            error:
                                'A verificação dos eventos existentes não terminou completamente. O envio foi bloqueado.',

                            consulta:
                                verificacaoBx.consulta ||
                                null,

                            download:
                                verificacaoBx.download ||
                                null
                        });
                }


                // ================================================
                // EVENTO ANTIGO
                //
                // Ainda não temos sincronização histórica completa.
                // Portanto não assumimos que "não achei em 30 dias"
                // significa "nunca foi enviado".
                // ================================================

                if (
                    verificacaoBx.eventoForaJanelaSegura
                ) {

                    return res
                        .status(409)
                        .json({

                            success:
                                false,

                            bloqueado:
                                true,

                            podeEnviar:
                                false,

                            ambiente:
                                1,

                            motivo:
                                'EVENTO_FORA_JANELA_SEGURA_BX',

                            dataReferencia:
                                verificacaoBx.dataReferencia,

                            error:
                                'O evento é antigo demais para ser liberado apenas pela consulta BX dos últimos 30 dias. Será necessária sincronização histórica antes de transmitir.'
                        });
                }


                // ================================================
                // SEGUNDA TRAVA
                //
                // IMPORTANTE:
                // fica DEPOIS da verificação BX para conseguirmos
                // testar a proteção sem liberar transmissão real.
                // ================================================

                if (
                    !producaoEsocialExplicitamentePermitida()
                ) {

                    return res
                        .status(403)
                        .json({

                            success:
                                false,

                            bloqueado:
                                true,

                            podeEnviar:
                                false,

                            ambiente:
                                1,

                            motivo:
                                'PRODUCAO_NAO_AUTORIZADA',

                            error:
                                'A verificação no eSocial terminou, mas a transmissão em Produção continua travada. ESOCIAL_PERMITIR_PRODUCAO ainda não está habilitado.'
                        });
                }
            }


            // ====================================================
            // NÃO SOBRESCREVER TENTATIVA ANTERIOR
            // ====================================================

            if (
                evento.numero_recibo
            ) {

                return res
                    .status(409)
                    .json({

                        success:
                            false,

                        bloqueado:
                            true,

                        podeEnviar:
                            false,

                        motivo:
                            'EVENTO_LOCAL_JA_POSSUI_RECIBO',

                        error:
                            'Este evento local já possui recibo eSocial.',

                        numeroRecibo:
                            evento.numero_recibo,

                        ambienteAnterior:
                            evento.ambiente_esocial ||
                            null
                    });
            }


            if (
                evento.protocolo_envio
            ) {

                return res
                    .status(409)
                    .json({

                        success:
                            false,

                        bloqueado:
                            true,

                        podeEnviar:
                            false,

                        motivo:
                            'EVENTO_LOCAL_JA_POSSUI_PROTOCOLO',

                        error:
                            'Este evento local já possui protocolo de envio. A tentativa existente deve ser consultada e não será sobrescrita.',

                        protocoloEnvio:
                            evento.protocolo_envio,

                        ambienteAnterior:
                            evento.ambiente_esocial ||
                            null
                    });
            }


            if (
                String(
                    evento.status ||
                    ''
                )
                    .trim()
                    .toLowerCase() ===
                'envio_incerto'
            ) {

                return res
                    .status(409)
                    .json({

                        success:
                            false,

                        bloqueado:
                            true,

                        podeEnviar:
                            false,

                        motivo:
                            'ENVIO_ANTERIOR_INCERTO',

                        error:
                            'Existe uma tentativa anterior com resultado incerto. Não será feito novo envio até essa tentativa ser verificada.'
                    });
            }


            // ====================================================
            // GERAR XML NOVO
            //
            // Não reutiliza xml_gerado/xml_assinado antigo.
            // ====================================================

            const resultadoXml =
                gerarXmlS2220(
                    evento,
                    {
                        ambiente
                    }
                );


            if (
                Number(
                    resultadoXml.ambiente
                ) !==
                ambiente
            ) {

                throw new Error(
                    'O tpAmb do XML gerado não corresponde ao ambiente configurado.'
                );
            }


            const resultadoAssinatura =
                assinarXmlEsocial(
                    resultadoXml.xml
                );


            // ====================================================
            // VALIDAR ASSINATURA
            // ====================================================

            const certificado =
                carregarCertificadoEsocial();


            validarAssinaturaXmlEsocial(
                resultadoAssinatura.xmlAssinado,
                certificado.publicCertPem
            );


            // ====================================================
            // VALIDAR XSD
            // ====================================================

            const validacaoXsd =
                await validarXmlS2220ContraXsd(
                    resultadoAssinatura.xmlAssinado
                );


            if (
                !validacaoXsd.valido
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        bloqueado:
                            true,

                        podeEnviar:
                            false,

                        motivo:
                            'XML_INVALIDO_XSD',

                        error:
                            'O XML recém-gerado não passou na validação XSD.',

                        erros:
                            validacaoXsd.erros
                    });
            }


            const eventoPreparado = {

                ...evento,

                id_evento_esocial:
                    resultadoXml.idEvento,

                xml_gerado:
                    resultadoXml.xml,

                xml_assinado:
                    resultadoAssinatura.xmlAssinado,

                ambiente_esocial:
                    ambiente
            };


            // ====================================================
            // SALVAR O XML EXATO QUE SERÁ ENVIADO
            // ====================================================

            const agoraPreparacao =
                new Date()
                    .toISOString();


            const {
                error:
                    erroPreparacao
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        id_evento_esocial:
                            resultadoXml.idEvento,

                        xml_gerado:
                            resultadoXml.xml,

                        xml_assinado:
                            resultadoAssinatura.xmlAssinado,

                        ambiente_esocial:
                            ambiente,

                        status:
                            'pronto_envio',

                        erro_esocial:
                            null,

                        codigo_erro_esocial:
                            null,

                        updated_at:
                            agoraPreparacao
                    })
                    .eq(
                        'id',
                        evento.id
                    );


            if (
                erroPreparacao
            ) {

                throw erroPreparacao;
            }


            // ====================================================
            // MONTAR LOTE
            // ====================================================

            const transmissor =
                carregarIdentificacaoTransmissorDoA1();


            const lote =
                montarLoteEsocial({

                    eventos: [
                        eventoPreparado
                    ],

                    transmissor
                });


            console.log(
                '📤 Enviando lote eSocial:',
                {

                    eventoId:
                        evento.id,

                    idEvento:
                        resultadoXml.idEvento,

                    tipoEvento:
                        evento.tipo_evento,

                    grupo:
                        lote.grupo,

                    quantidade:
                        lote.quantidadeEventos,

                    ambiente
                }
            );


            // ====================================================
            // TRANSMITIR
            //
            // Se a rede falhar, NÃO fazemos retry automático.
            // ====================================================

            let retorno;


            try {

                retorno =
                    await enviarLoteEsocial(
                        lote.xml,
                        ambiente
                    );

            } catch (
                erroTransmissao
            ) {

                const agoraErro =
                    new Date()
                        .toISOString();


                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        data_envio:
                            agoraErro,

                        ambiente_esocial:
                            ambiente,

                        status:
                            'envio_incerto',

                        erro_esocial:
                            erroTransmissao?.message ||
                            String(
                                erroTransmissao
                            ),

                        codigo_erro_esocial:
                            'ENVIO_INCERTO',

                        updated_at:
                            agoraErro
                    })
                    .eq(
                        'id',
                        evento.id
                    );


                return res
                    .status(502)
                    .json({

                        success:
                            false,

                        enviadoAoEsocial:
                            'incerto',

                        bloqueado:
                            true,

                        podeReenviar:
                            false,

                        ambiente,

                        eventoId:
                            evento.id,

                        idEvento:
                            resultadoXml.idEvento,

                        motivo:
                            'ENVIO_INCERTO',

                        error:
                            'A comunicação falhou durante a transmissão. Como o eSocial pode ter recebido o lote, o evento foi bloqueado para novo envio até ser verificado.',

                        detalhe:
                            erroTransmissao?.message ||
                            String(
                                erroTransmissao
                            )
                    });
            }


            // ====================================================
            // SOAP FAULT
            // ====================================================

            if (
                retorno.soapFault
            ) {

                const agoraFault =
                    new Date()
                        .toISOString();


                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        retorno_envio:
                            retorno.rawXml,

                        erro_esocial:
                            retorno.faultString ||
                            'SOAP Fault',

                        codigo_erro_esocial:
                            retorno.faultCode ||
                            null,

                        data_envio:
                            agoraFault,

                        ambiente_esocial:
                            ambiente,

                        status:
                            'erro',

                        updated_at:
                            agoraFault
                    })
                    .eq(
                        'id',
                        evento.id
                    );


                return res
                    .status(502)
                    .json({

                        success:
                            false,

                        enviadoAoEsocial:
                            true,

                        ambiente,

                        soapFault:
                            true,

                        faultCode:
                            retorno.faultCode,

                        error:
                            retorno.faultString
                    });
            }


            // ====================================================
            // VERIFICAR SE O LOTE FOI RECEBIDO
            // ====================================================

            const recebeuProtocolo =
                Boolean(
                    retorno.protocoloEnvio
                );


            const codigosRecepcao =
                new Set([
                    '201',
                    '202',
                    '203'
                ]);


            const loteRecebido =
                codigosRecepcao.has(
                    String(
                        retorno.cdResposta ||
                        ''
                    )
                ) &&
                recebeuProtocolo;


            const ocorrenciasRetorno =
                Array.isArray(
                    retorno.ocorrencias
                )
                    ? retorno.ocorrencias
                    : [];


            const textoOcorrencias =
                ocorrenciasRetorno
                    .map(
                        item =>
                            [
                                item.codigo,
                                item.descricao
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


            const erroEsocial =
                loteRecebido
                    ? null
                    : (
                        textoOcorrencias ||
                        retorno.descResposta ||
                        'Lote não recebido pelo eSocial.'
                    );


            // ====================================================
            // SALVAR RETORNO
            // ====================================================

            const agoraEnvio =
                new Date()
                    .toISOString();


            const {
                error:
                    erroUpdate
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        protocolo_envio:
                            retorno.protocoloEnvio ||
                            null,

                        retorno_envio:
                            retorno.rawXml,

                        data_envio:
                            agoraEnvio,

                        ambiente_esocial:
                            ambiente,

                        status:
                            loteRecebido
                                ? 'pendente'
                                : 'erro',

                        erro_esocial:
                            erroEsocial,

                        codigo_erro_esocial:
                            loteRecebido
                                ? null
                                : (
                                    retorno.cdResposta ||
                                    null
                                ),

                        updated_at:
                            agoraEnvio
                    })
                    .eq(
                        'id',
                        evento.id
                    );


            if (
                erroUpdate
            ) {

                throw erroUpdate;
            }


            // ====================================================
            // LOTE NÃO RECEBIDO
            // ====================================================

            if (
                !loteRecebido
            ) {

                return res
                    .status(422)
                    .json({

                        success:
                            false,

                        enviadoAoEsocial:
                            true,

                        ambiente,

                        eventoId:
                            evento.id,

                        idEvento:
                            resultadoXml.idEvento,

                        httpStatus:
                            retorno.httpStatus,

                        cdResposta:
                            retorno.cdResposta,

                        descResposta:
                            retorno.descResposta,

                        ocorrencias:
                            ocorrenciasRetorno
                    });
            }


            // ====================================================
            // LOTE RECEBIDO
            // ====================================================

            return res.json({

                success:
                    true,

                enviadoAoEsocial:
                    true,

                ambiente,

                eventoId:
                    evento.id,

                idEvento:
                    resultadoXml.idEvento,

                grupo:
                    lote.grupo,

                quantidadeEventos:
                    lote.quantidadeEventos,

                httpStatus:
                    retorno.httpStatus,

                cdResposta:
                    retorno.cdResposta,

                descResposta:
                    retorno.descResposta,

                protocoloEnvio:
                    retorno.protocoloEnvio,

                dhRecepcao:
                    retorno.dhRecepcao,

                ocorrencias:
                    ocorrenciasRetorno,

                verificacaoBx:
                    ambiente === 1
                        ? {

                            concluida:
                                verificacaoBx?.verificacaoCompleta === true,

                            jaExisteNoEsocial:
                                false
                        }
                        : null
            });


        } catch (
            error
        ) {

            console.error(
                '❌ Erro ao enviar evento ao eSocial:',
                error?.message ||
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error?.message ||
                        String(
                            error
                        )
                });
        }
    }
);

// ============================================================
// CONSULTAR RESULTADO DO LOTE E-SOCIAL
// ============================================================

router.post(
    '/consultar-lote-esocial/:id',

    async (
        req,
        res
    ) => {

        try {

            const id =
                String(
                    req.params.id ||
                    ''
                ).trim();


            if (
                !id
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'ID do evento não informado.'
                    });
            }


            // ====================================================
            // BUSCAR EVENTO
            // ====================================================

            const {
                data:
                    evento,

                error:
                    erroBusca
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .select('*')
                    .eq(
                        'id',
                        id
                    )
                    .single();


            if (
                erroBusca
            ) {

                throw erroBusca;
            }


            if (
                !evento
            ) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        error:
                            'Evento não encontrado.'
                    });
            }


            // ====================================================
            // PROTOCOLO
            // ====================================================

            const protocoloEnvio =
                String(
                    evento.protocolo_envio ||
                    ''
                ).trim();


            if (
                !protocoloEnvio
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'Este evento ainda não possui protocolo de envio.'
                    });
            }


            // ====================================================
            // AMBIENTE DO PRÓPRIO ENVIO
            //
            // IMPORTANTE:
            // Não usamos ESOCIAL_AMBIENTE aqui.
            //
            // Um protocolo criado na Produção Restrita precisa ser
            // consultado na Produção Restrita mesmo que o sistema
            // atualmente esteja configurado para Produção.
            // ====================================================

            const ambiente =
                Number(
                    evento.ambiente_esocial
                );


            if (
                ambiente !== 1 &&
                ambiente !== 2
            ) {

                return res
                    .status(409)
                    .json({

                        success:
                            false,

                        bloqueado:
                            true,

                        motivo:
                            'AMBIENTE_PROTOCOLO_DESCONHECIDO',

                        error:
                            'Não foi possível identificar em qual ambiente este protocolo foi enviado. A consulta foi bloqueada para não consultar o ambiente errado.',

                        protocoloEnvio
                    });
            }


            // ====================================================
            // JÁ POSSUI RECIBO
            // ====================================================

            if (
                evento.numero_recibo
            ) {

                return res.json({

                    success:
                        true,

                    processado:
                        true,

                    jaConsultado:
                        true,

                    eventoAceito:
                        true,

                    ambiente,

                    ambienteDescricao:
                        ambiente === 1
                            ? 'Produção'
                            : 'Produção Restrita',

                    eventoId:
                        evento.id,

                    idEvento:
                        evento.id_evento_esocial,

                    protocoloEnvio,

                    numeroRecibo:
                        evento.numero_recibo,

                    status:
                        evento.status
                });
            }


            // ====================================================
            // CONSULTAR
            // ====================================================

            console.log(
                '🔎 Consultando protocolo eSocial:',
                {

                    eventoId:
                        evento.id,

                    protocoloEnvio,

                    ambiente,

                    ambienteDescricao:
                        ambiente === 1
                            ? 'Produção'
                            : 'Produção Restrita'
                }
            );


            const retorno =
                await consultarLoteEsocial(
                    protocoloEnvio,
                    ambiente
                );


            // ====================================================
            // SOAP FAULT
            // ====================================================

            if (
                retorno.soapFault
            ) {

                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        retorno_processamento:
                            retorno.rawXml,

                        erro_esocial:
                            retorno.faultString ||
                            'SOAP Fault',

                        codigo_erro_esocial:
                            retorno.faultCode ||
                            null,

                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        'id',
                        evento.id
                    );


                return res
                    .status(502)
                    .json({

                        success:
                            false,

                        ambiente,

                        soapFault:
                            true,

                        error:
                            retorno.faultString,

                        faultCode:
                            retorno.faultCode
                    });
            }


            const cdLote =
                String(
                    retorno.cdResposta ||
                    ''
                ).trim();


            // ====================================================
            // AINDA PROCESSANDO
            // ====================================================

            if (
                cdLote === '101'
            ) {

                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        retorno_processamento:
                            retorno.rawXml,

                        status:
                            'pendente',

                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        'id',
                        evento.id
                    );


                return res.json({

                    success:
                        true,

                    processado:
                        false,

                    aguardandoProcessamento:
                        true,

                    ambiente,

                    eventoId:
                        evento.id,

                    protocoloEnvio,

                    cdRespostaLote:
                        retorno.cdResposta,

                    descRespostaLote:
                        retorno.descResposta,

                    tempoEstimadoConclusao:
                        retorno.tempoEstimadoConclusao ||
                        null
                });
            }


            // ====================================================
            // ERRO NO LOTE
            // ====================================================

            if (
                ![
                    '201',
                    '202'
                ].includes(
                    cdLote
                )
            ) {

                const ocorrencias =
                    Array.isArray(
                        retorno.ocorrencias
                    )
                        ? retorno.ocorrencias
                        : [];


                const textoOcorrencias =
                    ocorrencias
                        .map(
                            item =>
                                [
                                    item.codigo,
                                    item.descricao
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


                const mensagemErro =
                    textoOcorrencias ||
                    retorno.descResposta ||
                    'Erro na consulta do lote.';


                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        retorno_processamento:
                            retorno.rawXml,

                        erro_esocial:
                            mensagemErro,

                        codigo_erro_esocial:
                            retorno.cdResposta ||
                            null,

                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        'id',
                        evento.id
                    );


                return res
                    .status(422)
                    .json({

                        success:
                            false,

                        processado:
                            false,

                        ambiente,

                        cdRespostaLote:
                            retorno.cdResposta,

                        descRespostaLote:
                            retorno.descResposta,

                        ocorrencias
                    });
            }


            // ====================================================
            // LOCALIZAR NOSSO EVENTO
            // ====================================================

            const idEventoEsperado =
                String(
                    evento.id_evento_esocial ||
                    ''
                ).trim();


            const eventosRetorno =
                Array.isArray(
                    retorno.eventos
                )
                    ? retorno.eventos
                    : [];


            const retornoEvento =
                eventosRetorno.find(
                    item =>
                        String(
                            item.idEvento ||
                            ''
                        ).trim() ===
                        idEventoEsperado
                );


            if (
                !retornoEvento
            ) {

                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        retorno_processamento:
                            retorno.rawXml,

                        erro_esocial:
                            'Lote processado, mas o retorno do evento não foi localizado.',

                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        'id',
                        evento.id
                    );


                return res
                    .status(422)
                    .json({

                        success:
                            false,

                        processado:
                            true,

                        ambiente,

                        cdRespostaLote:
                            retorno.cdResposta,

                        descRespostaLote:
                            retorno.descResposta,

                        error:
                            'O lote foi processado, mas o evento não foi localizado no retorno.'
                    });
            }


            // ====================================================
            // RESULTADO DO EVENTO
            // ====================================================

            const cdEvento =
                String(
                    retornoEvento.cdResposta ||
                    ''
                ).trim();


            const eventoAceito =
                [
                    '201',
                    '202'
                ].includes(
                    cdEvento
                ) &&
                Boolean(
                    retornoEvento.nrRecibo
                );


            // ====================================================
            // EVENTO ACEITO
            // ====================================================

            if (
                eventoAceito
            ) {

                const {
                    error:
                        erroUpdate
                } =
                    await getSupabase()
                        .from(
                            'esocial_eventos'
                        )
                        .update({

                            numero_recibo:
                                retornoEvento.nrRecibo,

                            retorno_processamento:
                                retorno.rawXml,

                            status:
                                'sucesso',

                            erro_esocial:
                                null,

                            codigo_erro_esocial:
                                null,

                            updated_at:
                                new Date()
                                    .toISOString()
                        })
                        .eq(
                            'id',
                            evento.id
                        );


                if (
                    erroUpdate
                ) {

                    throw erroUpdate;
                }


                return res.json({

                    success:
                        true,

                    processado:
                        true,

                    eventoAceito:
                        true,

                    ambiente,

                    ambienteDescricao:
                        ambiente === 1
                            ? 'Produção'
                            : 'Produção Restrita',

                    eventoId:
                        evento.id,

                    idEvento:
                        idEventoEsperado,

                    protocoloEnvio,

                    cdRespostaLote:
                        retorno.cdResposta,

                    descRespostaLote:
                        retorno.descResposta,

                    cdRespostaEvento:
                        retornoEvento.cdResposta,

                    descRespostaEvento:
                        retornoEvento.descResposta,

                    numeroRecibo:
                        retornoEvento.nrRecibo,

                    eventoDuplicado:
                        retornoEvento.evtDupl,

                    dhProcessamento:
                        retornoEvento.dhProcessamento,

                    ocorrencias:
                        retornoEvento.ocorrencias
                });
            }


            // ====================================================
            // EVENTO REJEITADO
            // ====================================================

            const ocorrenciasEvento =
                Array.isArray(
                    retornoEvento.ocorrencias
                )
                    ? retornoEvento.ocorrencias
                    : [];


            const textoOcorrenciasEvento =
                ocorrenciasEvento
                    .map(
                        item =>
                            [
                                item.codigo,
                                item.descricao,
                                item.localizacao
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


            const mensagemErroEvento =
                textoOcorrenciasEvento ||
                retornoEvento.descResposta ||
                'Evento rejeitado pelo eSocial.';


            const {
                error:
                    erroUpdate
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        retorno_processamento:
                            retorno.rawXml,

                        status:
                            'erro',

                        erro_esocial:
                            mensagemErroEvento,

                        codigo_erro_esocial:
                            retornoEvento.cdResposta ||
                            null,

                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        'id',
                        evento.id
                    );


            if (
                erroUpdate
            ) {

                throw erroUpdate;
            }


            return res
                .status(422)
                .json({

                    success:
                        false,

                    processado:
                        true,

                    eventoAceito:
                        false,

                    ambiente,

                    eventoId:
                        evento.id,

                    idEvento:
                        idEventoEsperado,

                    protocoloEnvio,

                    cdRespostaLote:
                        retorno.cdResposta,

                    descRespostaLote:
                        retorno.descResposta,

                    cdRespostaEvento:
                        retornoEvento.cdResposta,

                    descRespostaEvento:
                        retornoEvento.descResposta,

                    ocorrencias:
                        ocorrenciasEvento
                });


        } catch (
            error
        ) {

            console.error(
                '❌ Erro ao consultar lote eSocial:',
                error?.message ||
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error?.message ||
                        String(
                            error
                        )
                });
        }
    }
);


// ============================================================
// CONSULTA GENÉRICA EXPORTA DADOS
// ============================================================

router.post(
    '/exporta-dados',

    async (
        req,
        res
    ) => {

        try {

            const {

                tipo =
                    'teste',

                empresa,

                empresaTrabalho,

                filtros =
                    {}

            } =
                req.body ||
                {};


            const extracao =
                obterExtracao(
                    tipo
                );


            const dados =
                await exportarDadosSoc({

                    codigo:
                        extracao.codigo,

                    chave:
                        extracao.chave,

                    empresa,

                    empresaTrabalho,

                    filtros
                });


            const registros =
                localizarArray(
                    dados
                );


            return res.json({

                success:
                    true,

                tipo,

                empresa:
                    empresa ||
                    SOC_CONFIG
                        .empresaPrincipal,

                empresaTrabalho:
                    empresaTrabalho ||
                    null,

                quantidade:
                    registros.length,

                dados
            });


        } catch (error) {

            const detalhe =
                formatarErro(
                    error
                );


            console.error(
                '❌ Erro Exporta Dados:',
                detalhe
            );


            return res

                .status(
                    502
                )

                .json({

                    success:
                        false,

                    error:
                        detalhe.message,

                    details:
                        detalhe
                });
        }
    }
);


// ============================================================
// BUSCAR DADOS E-SOCIAL
// ============================================================

router.post(
    '/buscar-dados-esocial',

    async (
        req,
        res
    ) => {

        try {

            const {

                empresaId,

                holding,

                dataInicio,

                dataFim,

                parametrosSoc =
                    {},

                salvar =
                    true

            } =
                req.body ||
                {};


            // ====================================================
            // VALIDAR PERÍODO
            // ====================================================

            if (
                !dataInicio ||
                !dataFim
            ) {

                return res

                    .status(
                        400
                    )

                    .json({

                        success:
                            false,

                        error:
                            'dataInicio e dataFim são obrigatórios.'
                    });
            }


            const dataInicioSoc =
                converterDataParaSoc(
                    dataInicio
                );


            const dataFimSoc =
                converterDataParaSoc(
                    dataFim
                );


            console.log(
                '=============================================='
            );

            console.log(
                '🔎 INICIANDO CONSULTA E-SOCIAL NO SOC'
            );

            console.log(
                'Holding:',
                holding ||
                'Todas'
            );

            console.log(
                'Empresa ID:',
                empresaId ||
                'Todas'
            );

            console.log(
                'Período:',
                `${dataInicioSoc} até ${dataFimSoc}`
            );

            console.log(
                '=============================================='
            );


            // ====================================================
            // EMPRESAS
            // ====================================================

            const empresas =
                await buscarEmpresasSupabase({
                    holding,
                    empresaId
                });


            if (
                !empresas.length
            ) {

                return res.json({

                    success:
                        true,

                    message:
                        'Nenhuma empresa encontrada para os filtros informados.',

                    empresasProcessadas:
                        0,


                    s2220: {

                        empresasSocConsultadas:
                            [],

                        linhasRecebidas:
                            0,

                        asosAgrupados:
                            0
                    },


                    s2240: {

                        configurado:
                            extracaoConfigurada(
                                's2240'
                            ),

                        consultado:
                            false,

                        geradosPorRegra:
                            0,

                        empresasSocConsultadas:
                            []
                    },


                    dados:
                        []
                });
            }


            console.log(
                `🏢 ${empresas.length} empresa(s) encontrada(s) no Supabase.`
            );


            const resultados =
                [];


            const avisos =
                [];


            const extracao2220 =
                obterExtracao(
                    's2220'
                );


            const filtros2220 =
                montarFiltrosS2220({

                    dataInicio:
                        dataInicioSoc,

                    dataFim:
                        dataFimSoc,

                    extrasComuns:
                        parametrosSoc
                            ?.comum ||
                        {},

                    extrasS2220:
                        parametrosSoc
                            ?.s2220 ||
                        {}
                });


            const todasLinhas2220 =
                [];


            const empresasSocConsultadas =
                [];


            const empresasSemCodigoSoc =
                [];


            const codigosSocJaConsultados =
                new Set();


            // ====================================================
            // CONSULTAR EMPRESAS SOC
            // ====================================================

            for (
                const empresaCadastro
                of empresas
            ) {

                const codigoSoc =
                    String(
                        empresaCadastro
                            .codigo_soc ||
                        ''
                    ).trim();


                if (
                    !codigoSoc
                ) {

                    console.warn(
                        `⚠️ Empresa sem codigo_soc: ${empresaCadastro.unidade}`
                    );


                    empresasSemCodigoSoc.push(
                        empresaCadastro.unidade
                    );


                    avisos.push(
                        `A empresa "${empresaCadastro.unidade}" ` +
                        'não possui codigo_soc cadastrado.'
                    );


                    continue;
                }


                if (
                    codigosSocJaConsultados.has(
                        codigoSoc
                    )
                ) {

                    console.log(
                        `⏭️ Código SOC ${codigoSoc} já consultado.`
                    );

                    continue;
                }


                codigosSocJaConsultados.add(
                    codigoSoc
                );


                console.log(
                    '----------------------------------------------'
                );

                console.log(
                    '🔎 Consultando S-2220'
                );

                console.log(
                    'Empresa:',
                    empresaCadastro.unidade
                );

                console.log(
                    'Holding:',
                    empresaCadastro.holding ||
                    'N/A'
                );

                console.log(
                    'Código SOC:',
                    codigoSoc
                );

                console.log(
                    '----------------------------------------------'
                );


                try {

                    // ============================================
                    // S-2220:
                    //
                    // codigo_soc entra em "empresa".
                    // ============================================

                    const retornoEmpresa =
                        await exportarDadosSoc({

                            codigo:
                                extracao2220
                                    .codigo,

                            chave:
                                extracao2220
                                    .chave,

                            empresa:
                                codigoSoc,

                            filtros:
                                filtros2220
                        });


                    const linhasEmpresa =
                        localizarArray(
                            retornoEmpresa
                        );


                    console.log(
                        `✅ ${empresaCadastro.unidade}: ` +
                        `${linhasEmpresa.length} linha(s) recebida(s).`
                    );


                    empresasSocConsultadas.push({

                        id:
                            empresaCadastro.id,

                        holding:
                            empresaCadastro.holding ||
                            null,

                        unidade:
                            empresaCadastro.unidade,

                        codigoSoc,

                        linhasRecebidas:
                            linhasEmpresa.length
                    });


                    if (
                        linhasEmpresa.length >
                        0
                    ) {

                        todasLinhas2220.push(
                            ...linhasEmpresa
                        );
                    }


                } catch (erroEmpresa) {

                    const detalheEmpresa =
                        formatarErro(
                            erroEmpresa
                        );


                    console.error(
                        `❌ Erro S-2220 - ${empresaCadastro.unidade} ` +
                        `(SOC ${codigoSoc}):`,
                        detalheEmpresa
                    );


                    empresasSocConsultadas.push({

                        id:
                            empresaCadastro.id,

                        holding:
                            empresaCadastro.holding ||
                            null,

                        unidade:
                            empresaCadastro.unidade,

                        codigoSoc,

                        linhasRecebidas:
                            0,

                        erro:
                            detalheEmpresa.message
                    });


                    avisos.push(
                        `Erro ao consultar "${empresaCadastro.unidade}" ` +
                        `(SOC ${codigoSoc}): ${detalheEmpresa.message}`
                    );
                }
            }


            console.log(
                '=============================================='
            );

            console.log(
                `📥 TOTAL S-2220: ${todasLinhas2220.length} ` +
                'linha(s) recebida(s) do SOC.'
            );

            console.log(
                '=============================================='
            );


            // ====================================================
            // 1. AGRUPAR S-2220
            // ====================================================

            const eventos2220 =
                agruparRegistrosS2220(
                    todasLinhas2220,
                    empresas,
                    {
                        exigirEmpresaMapeada:
                            false
                    }
                );

                console.log('');
console.log('==============================================');
console.log('🧪 TESTE EVENTO AGRUPADO S-2220');
console.log('==============================================');

if (eventos2220.length > 0) {

    const teste = eventos2220[0];

    console.log({
        idFicha:
            teste.idFicha,

        colaborador:
            teste.colaborador,

        tpInscEmpregador:
            teste.tpInscEmpregador,

        nrInscEmpregador:
            teste.nrInscEmpregador,

        matricula:
            teste.matricula,

        codCateg:
            teste.codCateg,

        tpExameOcup:
            teste.tpExameOcup,

        exames:
            teste.exames,

        responsavel:
            teste.responsavel,

        cpfResponsavel:
            teste.cpfResponsavel,

        conselhoResponsavel:
            teste.conselhoResponsavel,

        ufConselhoResponsavel:
            teste.ufConselhoResponsavel
    });
}

console.log('==============================================');
console.log('');


// ============================================================
// 1. COMPLEMENTAR COM ASO 29169
// Cargo / setor / aptidão / riscos
// ============================================================

const eventos2220Complementados =
    await complementarEventosComAso29169(
        eventos2220
    );


// ============================================================
// 2. CONSULTAR GED 1858
// Assinatura digital do documento ASO
// ============================================================

const eventos2220ComAssinatura =
    await complementarEventosComGed1858(
        eventos2220Complementados
    );


// ============================================================
// 3. APLICAR REGRA S-2220 / S-2240
// ============================================================
//
// Todos -> S-2220
//
// Admissional e mudança ->
// S-2220 + S-2240
//
// ============================================================

const eventosGerados =
    aplicarRegraEventosEsocial(
        eventos2220ComAssinatura
    );


// ============================================================
// 4. CONSULTAR STATUS REAL - 6603
// ============================================================

const eventosComStatus =
    await complementarEventosComStatus6603(
        eventosGerados,
        {
            dataInicio,
            dataFim
        }
    );


// ============================================================
// 5. RESULTADO
// ============================================================

resultados.push(
    ...eventosComStatus
);


            const eventos2240Gerados =
                eventosGerados.filter(
                    item =>
                        item &&
                        item.tipoEvento ===
                            'S-2240'
                );


            console.log(
                `✅ S-2220: ${todasLinhas2220.length} linha(s) SOC -> ` +
                `${eventos2220.length} ASO(s) agrupado(s).`
            );


            console.log(
                `📌 S-2240 gerados pela regra: ` +
                `${eventos2240Gerados.length} evento(s).`
            );


            // ====================================================
            // NÃO CONSULTAMOS SEGUNDO S-2240 NESTE FLUXO
            // ====================================================

            if (
                extracaoConfigurada(
                    's2240'
                )
            ) {

                avisos.push(
                    'A extração S-2240 está configurada, mas não foi consultada ' +
                    'neste fluxo para evitar duplicidade. Os S-2240 foram gerados ' +
                    'pela regra operacional de Admissional/Mudança.'
                );
            }


            // ====================================================
            // SALVAR
            // ====================================================

            let dadosFinais;


            if (
                salvar
            ) {

                console.log(
                    `💾 Salvando ${resultados.length} evento(s) no Supabase...`
                );


                dadosFinais =
                    await salvarEventos(
                        resultados
                    );


                console.log(
                    `✅ ${dadosFinais.length} evento(s) processado(s) no Supabase.`
                );


            } else {

                dadosFinais =
                    resultados;
            }


            // ====================================================
            // RESPOSTA
            // ====================================================

            return res.json({

                success:
                    true,


                message:
                    `${dadosFinais.length} evento(s) processado(s).`,


                periodo: {

                    dataInicio:
                        dataInicioSoc,

                    dataFim:
                        dataFimSoc
                },


                filtro: {

                    holding:
                        holding ||
                        null,

                    empresaId:
                        empresaId ||
                        null
                },


                empresasEncontradas:
                    empresas.length,


                empresasSemCodigoSoc,


                s2220: {

                    empresasSocConsultadas,


                    quantidadeEmpresasSocConsultadas:
                        empresasSocConsultadas.length,


                    linhasRecebidas:
                        todasLinhas2220.length,


                    asosAgrupados:
                        eventos2220.length
                },


                s2240: {

                    configurado:
                        extracaoConfigurada(
                            's2240'
                        ),


                    consultado:
                        false,


                    geradosPorRegra:
                        eventos2240Gerados.length,


                    empresasSocConsultadas:
                        []
                },


                salvosNoSupabase:
                    Boolean(
                        salvar
                    ),


                avisos,


                dados:
                    dadosFinais
            });


        } catch (error) {

            const detalhe =
                formatarErro(
                    error
                );


            console.error(
                '❌ Erro geral ao buscar dados eSocial:',
                detalhe
            );


            return res

                .status(
                    500
                )

                .json({

                    success:
                        false,

                    error:
                        detalhe.message,

                    details:
                        detalhe
                });
        }
    }
);

// ============================================================
// XML E-SOCIAL
// ============================================================

const ESOCIAL_NAMESPACE_S2220 =
    'http://www.esocial.gov.br/schema/evt/evtMonit/v_S_01_03_00';


// ============================================================
// ESCAPAR XML
// ============================================================

function escaparXmlEsocial(valor) {

    return String(
        valor ?? ''
    )
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}


// ============================================================
// NORMALIZAR ARRAY JSON
// ============================================================

function normalizarArrayEsocial(valor) {

    if (
        Array.isArray(valor)
    ) {
        return valor;
    }


    if (
        valor &&
        typeof valor === 'object'
    ) {
        return [valor];
    }


    if (
        typeof valor === 'string' &&
        valor.trim()
    ) {

        try {

            const parsed =
                JSON.parse(valor);


            if (
                Array.isArray(parsed)
            ) {
                return parsed;
            }


            if (
                parsed &&
                typeof parsed === 'object'
            ) {
                return [parsed];
            }

        } catch (error) {

            return [];
        }
    }


    return [];
}


// ============================================================
// DATA/HORA BRASIL PARA ID E-SOCIAL
// ============================================================

function obterDataHoraIdEsocial(
    data = new Date()
) {

    const partes =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                timeZone:
                    'America/Sao_Paulo',

                year:
                    'numeric',

                month:
                    '2-digit',

                day:
                    '2-digit',

                hour:
                    '2-digit',

                minute:
                    '2-digit',

                second:
                    '2-digit',

                hourCycle:
                    'h23'
            }
        )
            .formatToParts(data);


    const mapa = {};


    for (
        const parte
        of partes
    ) {

        if (
            parte.type !==
            'literal'
        ) {

            mapa[
                parte.type
            ] =
                parte.value;
        }
    }


    return {

        data:
            `${mapa.year}${mapa.month}${mapa.day}`,

        hora:
            `${mapa.hour}${mapa.minute}${mapa.second}`
    };
}


// ============================================================
// CONTROLE DE SEQUENCIAL DO ID
// ============================================================

const sequenciaisIdEsocial =
    new Map();


function proximoSequencialIdEsocial(
    chave
) {

    const atual =
        sequenciaisIdEsocial.get(
            chave
        ) || 0;


    const proximo =
        atual + 1;


    sequenciaisIdEsocial.set(
        chave,
        proximo
    );


    /*
     * Evitar crescimento indefinido.
     */

    if (
        sequenciaisIdEsocial.size >
        1000
    ) {

        sequenciaisIdEsocial.clear();

        sequenciaisIdEsocial.set(
            chave,
            proximo
        );
    }


    return proximo;
}


// ============================================================
// GERAR ID OFICIAL DO EVENTO
// ============================================================
//
// FORMATO:
//
// IDTNNNNNNNNNNNNNNAAAAMMDDHHMMSSQQQQQ
//
// ============================================================

function gerarIdEventoEsocial({
    tpInsc,
    nrInsc
}) {

    const tipo =
        String(
            tpInsc ||
            ''
        ).trim();


    const inscricao =
        String(
            nrInsc ||
            ''
        )
            .replace(
                /[^0-9A-Za-z]/g,
                ''
            )
            .toUpperCase();


    if (
        !['1', '2'].includes(
            tipo
        )
    ) {

        throw new Error(
            'tpInsc do empregador inválido para geração do Id.'
        );
    }


    if (
        !inscricao
    ) {

        throw new Error(
            'nrInsc do empregador não informado.'
        );
    }


    /*
     * O bloco N do ID possui 14 posições.
     *
     * Para CNPJ raiz com 8 posições:
     *
     * 10289547
     *
     * vira:
     *
     * 10289547000000
     *
     * Os zeros são adicionados À DIREITA.
     */

    const inscricaoId =
        inscricao
            .padEnd(
                14,
                '0'
            )
            .substring(
                0,
                14
            );


    const momento =
        obterDataHoraIdEsocial();


    const chaveSequencial =
        [
            tipo,
            inscricaoId,
            momento.data,
            momento.hora
        ].join('|');


    const sequencial =
        proximoSequencialIdEsocial(
            chaveSequencial
        );


    if (
        sequencial >
        99999
    ) {

        throw new Error(
            'Limite de sequenciais do Id eSocial atingido para o mesmo segundo.'
        );
    }


    const sequencialTexto =
        String(
            sequencial
        )
            .padStart(
                5,
                '0'
            );


    const id =
        `ID` +
        `${tipo}` +
        `${inscricaoId}` +
        `${momento.data}` +
        `${momento.hora}` +
        `${sequencialTexto}`;


    if (
        id.length !== 36
    ) {

        throw new Error(
            `Id eSocial inválido. Esperado 36 caracteres, obtido ${id.length}.`
        );
    }


    return id;
}


// ============================================================
// VALIDAR DATA AAAA-MM-DD
// ============================================================

function validarDataEsocial(
    valor
) {

    const texto =
        String(
            valor ||
            ''
        ).trim();


    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
            texto
        )
    ) {

        return false;
    }


    const data =
        new Date(
            `${texto}T00:00:00Z`
        );


    return (
        !Number.isNaN(
            data.getTime()
        )
    );
}


// ============================================================
// GERAR XML S-2220
// ============================================================

function gerarXmlS2220(
    evento,
    opcoes = {}
) {

    if (
        !evento ||
        typeof evento !== 'object'
    ) {

        throw new Error(
            'Evento S-2220 não informado.'
        );
    }


    // ========================================================
    // AMBIENTE
    // ========================================================

    const ambiente =
        Number(
            opcoes.ambiente ??
            process.env.ESOCIAL_AMBIENTE ??
            2
        );


    if (
        ambiente !== 1 &&
        ambiente !== 2
    ) {

        throw new Error(
            'ESOCIAL_AMBIENTE deve ser 1 ou 2.'
        );
    }


    // ========================================================
    // VERSÃO DO APLICATIVO
    // ========================================================

    const versaoAplicativo =
        String(
            opcoes.versaoAplicativo ||
            process.env.ESOCIAL_VERSAO_APLICATIVO ||
            '1.0.0'
        )
            .trim()
            .substring(
                0,
                20
            );


    // ========================================================
    // EMPREGADOR
    // ========================================================

    const tpInsc =
        String(
            evento.tp_insc_empregador ||
            evento.tpInscEmpregador ||
            ''
        ).trim();


    const nrInsc =
        String(
            evento.nr_insc_empregador ||
            evento.nrInscEmpregador ||
            ''
        )
            .replace(
                /[^0-9A-Za-z]/g,
                ''
            )
            .toUpperCase();


    if (
        !['1', '2'].includes(
            tpInsc
        )
    ) {

        throw new Error(
            'Tipo de inscrição do empregador não informado ou inválido.'
        );
    }


    if (
        tpInsc === '1' &&
        ![8, 14].includes(
            nrInsc.length
        )
    ) {

        throw new Error(
            `nrInsc CNPJ inválido: ${nrInsc.length} posições.`
        );
    }


    if (
        tpInsc === '2' &&
        nrInsc.length !== 11
    ) {

        throw new Error(
            'nrInsc CPF do empregador deve possuir 11 posições.'
        );
    }


    // ========================================================
    // TRABALHADOR
    // ========================================================

    const cpfTrab =
        String(
            evento.cpf ||
            ''
        )
            .replace(
                /\D/g,
                ''
            );


    if (
        cpfTrab.length !== 11
    ) {

        throw new Error(
            'CPF do trabalhador deve possuir 11 dígitos.'
        );
    }


    const matricula =
        String(
            evento.matricula ||
            ''
        ).trim();


    const codCateg =
        String(
            evento.cod_categ ||
            evento.codCateg ||
            ''
        ).trim();


    if (
        !matricula &&
        !codCateg
    ) {

        throw new Error(
            'O evento precisa possuir matrícula ou codCateg.'
        );
    }


    if (
        matricula &&
        matricula.length > 30
    ) {

        throw new Error(
            'A matrícula possui mais de 30 caracteres.'
        );
    }


    /*
     * REGRA:
     *
     * Se houver matrícula:
     *
     * envia matrícula
     * NÃO envia codCateg.
     *
     * codCateg é usado somente em TSVE
     * sem matrícula.
     */

    let xmlVinculo = '';


    if (
        matricula
    ) {

        xmlVinculo =
            `        <matricula>${escaparXmlEsocial(matricula)}</matricula>\n`;

    } else {

        if (
            !/^\d{3}$/.test(
                codCateg
            )
        ) {

            throw new Error(
                'codCateg deve possuir 3 dígitos.'
            );
        }


        xmlVinculo =
            `        <codCateg>${escaparXmlEsocial(codCateg)}</codCateg>\n`;
    }


    // ========================================================
    // TIPO DE EXAME
    // ========================================================

    const tpExameOcup =
        String(
            evento.tp_exame_ocup ??
            evento.tpExameOcup ??
            ''
        ).trim();


    if (
        ![
            '0',
            '1',
            '2',
            '3',
            '4',
            '9'
        ].includes(
            tpExameOcup
        )
    ) {

        throw new Error(
            `tpExameOcup inválido: "${tpExameOcup}".`
        );
    }


    // ========================================================
    // ASO
    // ========================================================

    const dtAso =
        String(
            evento.data_emissao_aso ||
            evento.dataEmissaoAso ||
            evento.data_exame ||
            evento.dataExame ||
            ''
        ).trim();


    if (
        !validarDataEsocial(
            dtAso
        )
    ) {

        throw new Error(
            `Data do ASO inválida: "${dtAso}".`
        );
    }


    // ========================================================
    // RESULTADO ASO
    // ========================================================

    let resAso =
        String(
            evento.resultadoAsoCodigo ||
            evento.resultado_aso_codigo ||
            ''
        ).trim();


    if (
        !['1', '2'].includes(
            resAso
        )
    ) {

        if (
            evento.aso_apto === true ||
            evento.asoApto === true
        ) {

            resAso =
                '1';

        } else if (
            evento.aso_apto === false ||
            evento.asoApto === false
        ) {

            resAso =
                '2';

        } else {

            const resultadoTexto =
                String(
                    evento.resultado_aso ||
                    evento.resultadoAso ||
                    ''
                )
                    .trim()
                    .toLowerCase();


            if (
                resultadoTexto ===
                'apto'
            ) {

                resAso =
                    '1';

            } else if (
                resultadoTexto ===
                'inapto'
            ) {

                resAso =
                    '2';

            } else {

                resAso =
                    '';
            }
        }
    }


    // ========================================================
    // EXAMES
    // ========================================================

    const exames =
        normalizarArrayEsocial(
            evento.exames_aso ||
            evento.examesAso ||
            evento.exames ||
            []
        );


    if (
        exames.length === 0
    ) {

        throw new Error(
            'Nenhum exame foi encontrado para o S-2220.'
        );
    }


    let xmlExames = '';


    const procedimentosQueExigemObs =
        new Set([
            '0583',
            '0998',
            '0999',
            '1128',
            '1230',
            '1992',
            '1993',
            '1994',
            '1995',
            '1996',
            '1997',
            '1998',
            '1999',
            '9999'
        ]);


    for (
        const exame
        of exames
    ) {

        const dtExm =
            String(
                exame.dtExm ||
                exame.data ||
                exame.data_exame ||
                ''
            ).trim();


        const procRealizado =
            String(
                exame.procRealizado ||
                exame.procedimentoEsocial ||
                exame.codigo_exame_s5 ||
                ''
            )
                .replace(
                    /\D/g,
                    ''
                )
                .padStart(
                    4,
                    '0'
                );


        const obsProc =
            String(
                exame.obsProc ||
                exame.observacao ||
                ''
            ).trim();


        const ordExame =
            String(
                exame.ordExame ||
                exame.ordem ||
                ''
            ).trim();


        if (
            !validarDataEsocial(
                dtExm
            )
        ) {

            throw new Error(
                `Data de exame inválida: "${dtExm}".`
            );
        }


        if (
            dtExm > dtAso
        ) {

            throw new Error(
                `Data do exame ${dtExm} é posterior ao ASO ${dtAso}.`
            );
        }


        if (
            !/^\d{4}$/.test(
                procRealizado
            )
        ) {

            throw new Error(
                `Código do procedimento inválido: "${procRealizado}".`
            );
        }


        if (
            procedimentosQueExigemObs.has(
                procRealizado
            ) &&
            !obsProc
        ) {

            throw new Error(
                `O procedimento ${procRealizado} exige obsProc.`
            );
        }


        if (
            procRealizado === '0281' &&
            !['1', '2'].includes(
                ordExame
            )
        ) {

            throw new Error(
                'O procedimento 0281 exige ordExame 1 ou 2.'
            );
        }


        xmlExames +=
            `        <exame>\n`;

        xmlExames +=
            `          <dtExm>${escaparXmlEsocial(dtExm)}</dtExm>\n`;

        xmlExames +=
            `          <procRealizado>${escaparXmlEsocial(procRealizado)}</procRealizado>\n`;


        /*
         * Só enviamos obsProc automaticamente
         * quando ela é necessária.
         *
         * Isso evita enviar o OBSPROC "295"
         * que o SOC retornou como metadado do
         * procedimento 0295.
         */

        if (
            procedimentosQueExigemObs.has(
                procRealizado
            ) &&
            obsProc
        ) {

            xmlExames +=
                `          <obsProc>${escaparXmlEsocial(obsProc)}</obsProc>\n`;
        }


        /*
         * ordExame somente é essencial para 0281.
         */

        if (
            procRealizado === '0281'
        ) {

            xmlExames +=
                `          <ordExame>${escaparXmlEsocial(ordExame)}</ordExame>\n`;
        }


        xmlExames +=
            `        </exame>\n`;
    }


    // ========================================================
    // MÉDICO EMITENTE
    // ========================================================

    const nmMed =
        String(
            evento.medico_emitente ||
            evento.medicoEmitente ||
            ''
        ).trim();


    const nrCRM =
        String(
            evento.medico_crm ||
            evento.medicoCrm ||
            ''
        ).trim();


    const ufCRM =
        String(
            evento.medico_uf_crm ||
            evento.medicoUfCrm ||
            ''
        )
            .trim()
            .toUpperCase();


    if (
        nmMed.length < 2
    ) {

        throw new Error(
            'Nome do médico emitente não informado.'
        );
    }


    if (
        !nrCRM
    ) {

        throw new Error(
            'CRM do médico emitente não informado.'
        );
    }


    if (
        !/^[A-Z]{2}$/.test(
            ufCRM
        )
    ) {

        throw new Error(
            'UF do CRM do médico emitente inválida.'
        );
    }


    // ========================================================
    // RESPONSÁVEL PCMSO
    // ========================================================

    const nmResp =
        String(
            evento.responsavel_pcmso ||
            evento.responsavel ||
            ''
        ).trim();


    const cpfResp =
        String(
            evento.cpf_responsavel_pcmso ||
            evento.cpfResponsavel ||
            ''
        )
            .replace(
                /\D/g,
                ''
            );


    const nrCrmResp =
        String(
            evento.crm_responsavel_pcmso ||
            evento.conselhoResponsavel ||
            ''
        ).trim();


    const ufCrmResp =
        String(
            evento.uf_crm_responsavel_pcmso ||
            evento.ufConselhoResponsavel ||
            ''
        )
            .trim()
            .toUpperCase();


    let xmlResponsavel =
        '';


    /*
     * respMonit é um grupo opcional.
     *
     * Só o incluímos quando temos todos os campos
     * obrigatórios do grupo.
     */

    if (
        nmResp &&
        nrCrmResp &&
        ufCrmResp
    ) {

        xmlResponsavel +=
            `      <respMonit>\n`;


        if (
            cpfResp.length === 11
        ) {

            xmlResponsavel +=
                `        <cpfResp>${escaparXmlEsocial(cpfResp)}</cpfResp>\n`;
        }


        xmlResponsavel +=
            `        <nmResp>${escaparXmlEsocial(nmResp)}</nmResp>\n`;

        xmlResponsavel +=
            `        <nrCRM>${escaparXmlEsocial(nrCrmResp)}</nrCRM>\n`;

        xmlResponsavel +=
            `        <ufCRM>${escaparXmlEsocial(ufCrmResp)}</ufCRM>\n`;

        xmlResponsavel +=
            `      </respMonit>\n`;
    }


    // ========================================================
    // ID
    // ========================================================

    const idEvento =
        String(
            evento.id_evento_esocial ||
            evento.idEventoEsocial ||
            ''
        ).trim() ||

        gerarIdEventoEsocial({
            tpInsc,
            nrInsc
        });


    // ========================================================
    // XML
    // ========================================================

    let xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n';


    xml +=
        `<eSocial xmlns="${ESOCIAL_NAMESPACE_S2220}">\n`;


    xml +=
        `  <evtMonit Id="${escaparXmlEsocial(idEvento)}">\n`;


    // --------------------------------------------------------
    // ideEvento
    // --------------------------------------------------------

    xml +=
        `    <ideEvento>\n`;

    xml +=
        `      <indRetif>1</indRetif>\n`;

    xml +=
        `      <tpAmb>${ambiente}</tpAmb>\n`;

    xml +=
        `      <procEmi>1</procEmi>\n`;

    xml +=
        `      <verProc>${escaparXmlEsocial(versaoAplicativo)}</verProc>\n`;

    xml +=
        `    </ideEvento>\n`;


    // --------------------------------------------------------
    // ideEmpregador
    // --------------------------------------------------------

    xml +=
        `    <ideEmpregador>\n`;

    xml +=
        `      <tpInsc>${escaparXmlEsocial(tpInsc)}</tpInsc>\n`;

    xml +=
        `      <nrInsc>${escaparXmlEsocial(nrInsc)}</nrInsc>\n`;

    xml +=
        `    </ideEmpregador>\n`;


    // --------------------------------------------------------
    // ideVinculo
    // --------------------------------------------------------

    xml +=
        `    <ideVinculo>\n`;

    xml +=
        `      <cpfTrab>${escaparXmlEsocial(cpfTrab)}</cpfTrab>\n`;

    xml +=
        xmlVinculo;

    xml +=
        `    </ideVinculo>\n`;


    // --------------------------------------------------------
    // exMedOcup
    // --------------------------------------------------------

    xml +=
        `    <exMedOcup>\n`;

    xml +=
        `      <tpExameOcup>${escaparXmlEsocial(tpExameOcup)}</tpExameOcup>\n`;


    // --------------------------------------------------------
    // ASO
    // --------------------------------------------------------

    xml +=
        `      <aso>\n`;

    xml +=
        `        <dtAso>${escaparXmlEsocial(dtAso)}</dtAso>\n`;


    if (
        resAso
    ) {

        xml +=
            `        <resAso>${escaparXmlEsocial(resAso)}</resAso>\n`;
    }


    xml +=
        xmlExames;


    // --------------------------------------------------------
    // Médico
    // --------------------------------------------------------

    xml +=
        `        <medico>\n`;

    xml +=
        `          <nmMed>${escaparXmlEsocial(nmMed)}</nmMed>\n`;

    xml +=
        `          <nrCRM>${escaparXmlEsocial(nrCRM)}</nrCRM>\n`;

    xml +=
        `          <ufCRM>${escaparXmlEsocial(ufCRM)}</ufCRM>\n`;

    xml +=
        `        </medico>\n`;


    xml +=
        `      </aso>\n`;


    // --------------------------------------------------------
    // Responsável PCMSO
    // --------------------------------------------------------

    xml +=
        xmlResponsavel;


    xml +=
        `    </exMedOcup>\n`;

    xml +=
        `  </evtMonit>\n`;

    xml +=
        `</eSocial>`;


    return {

        idEvento,

        ambiente,

        namespace:
            ESOCIAL_NAMESPACE_S2220,

        xml
    };
}


// ============================================================
// EVENTOS SALVOS
// ============================================================

router.get(
    '/eventos-salvos',

    async (
        req,
        res
    ) => {

        try {

            const empresaId =
                req.query.empresaId ||
                '';


            const status =
                req.query.status ||
                '';


            const tipoEvento =

                req.query.tipoEvento ||

                req.query.tipo_evento ||

                '';


            const dataInicio =

                req.query.dataInicio ||

                req.query.data_inicio ||

                '';


            const dataFim =

                req.query.dataFim ||

                req.query.data_fim ||

                '';


            let query =
                getSupabase()

                    .from(
                        'esocial_eventos'
                    )

                    .select(
                        '*'
                    )

                    .order(
                        'created_at',
                        {
                            ascending:
                                false
                        }
                    );


            if (
                empresaId
            ) {

                query =
                    query.eq(
                        'codigo_empresa',
                        empresaId
                    );
            }


            if (
                status
            ) {

                query =
                    query.eq(
                        'status',
                        status
                    );
            }


            if (
                tipoEvento
            ) {

                query =
                    query.eq(
                        'tipo_evento',
                        tipoEvento
                    );
            }


            if (
                dataInicio
            ) {

                query =
                    query.gte(
                        'data_exame',
                        normalizarData(
                            dataInicio
                        )
                    );
            }


            if (
                dataFim
            ) {

                query =
                    query.lte(
                        'data_exame',
                        normalizarData(
                            dataFim
                        )
                    );
            }


            const {
                data,
                error
            } =
                await query;


            if (
                error
            ) {

                throw error;
            }


            return res.json({

                success:
                    true,

                eventos:
                    data ||
                    []
            });


        } catch (error) {

            console.error(
                '❌ Erro eventos salvos:',
                error
            );


            return res

                .status(
                    500
                )

                .json({

                    success:
                        false,

                    error:
                        error.message
                });
        }
    }
);


// ============================================================
// GERAR / VISUALIZAR XML S-2220
// ============================================================

router.get(
    '/evento-xml/:id',

    async (
        req,
        res
    ) => {

        try {

            const id =
                String(
                    req.params.id ||
                    ''
                ).trim();


            if (!id) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,

                        error:
                            'ID do evento não informado.'
                    });
            }


            // ====================================================
            // BUSCAR EVENTO
            // ====================================================

            const {
                data:
                    evento,

                error
            } =

                await getSupabase()

                    .from(
                        'esocial_eventos'
                    )

                    .select('*')

                    .eq(
                        'id',
                        id
                    )

                    .single();


            if (error) {

                throw error;
            }


            if (!evento) {

                return res
                    .status(404)
                    .json({
                        success:
                            false,

                        error:
                            'Evento não encontrado.'
                    });
            }


            // ====================================================
            // SOMENTE S-2220
            // ====================================================

            const tipoEvento =
                String(
                    evento.tipo_evento ||
                    ''
                )
                    .trim()
                    .toUpperCase();


            if (
                tipoEvento !==
                'S-2220'
            ) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,

                        error:
                            'A geração direta de XML está implementada somente para S-2220 neste momento.'
                    });
            }


            // ====================================================
            // EVENTO JÁ CONCLUÍDO
            // ====================================================

            if (
                evento.numero_recibo &&
                !evento.xml_gerado
            ) {

                return res
                    .status(409)
                    .json({
                        success:
                            false,

                        error:
                            'Este evento já possui número de recibo. ' +
                            'Não será gerado um novo evento original.'
                    });
            }


            // ====================================================
            // SE JÁ TEM XML + ID, REUTILIZAR
            // ====================================================

            if (
                evento.xml_gerado &&
                evento.id_evento_esocial
            ) {

                return res.json({

                    success:
                        true,

                    tipoEvento:
                        'S-2220',

                    ambiente:
                        Number(
                            evento.ambiente_esocial ||
                            2
                        ),

                    idEvento:
                        evento.id_evento_esocial,

                    namespace:
                        ESOCIAL_NAMESPACE_S2220,

                    jaExistia:
                        true,

                    xml:
                        evento.xml_gerado
                });
            }


            // ====================================================
            // GERAR XML
            // ====================================================

            const resultado =
                gerarXmlS2220(
                    evento,
                    {
                        ambiente:
                            2
                    }
                );


            // ====================================================
            // SALVAR
            // ====================================================

            const {
                error:
                    erroUpdate
            } =

                await getSupabase()

                    .from(
                        'esocial_eventos'
                    )

                    .update({

                        id_evento_esocial:
                            resultado.idEvento,

                        xml_gerado:
                            resultado.xml,

                        ambiente_esocial:
                            resultado.ambiente,

                        updated_at:
                            new Date()
                                .toISOString()
                    })

                    .eq(
                        'id',
                        id
                    );


            if (
                erroUpdate
            ) {

                throw erroUpdate;
            }


            // ====================================================
            // RETORNO
            // ====================================================

            return res.json({

                success:
                    true,

                tipoEvento:
                    'S-2220',

                ambiente:
                    resultado.ambiente,

                idEvento:
                    resultado.idEvento,

                namespace:
                    resultado.namespace,

                jaExistia:
                    false,

                xml:
                    resultado.xml
            });


        } catch (error) {

            console.error(
                '❌ Erro ao gerar XML S-2220:',
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error?.message ||
                        String(error)
                });
        }
    }
);


// ============================================================
// CANCELAR EVENTO LOCAL
// ============================================================

router.post(
    '/cancelar-evento/:id',

    async (
        req,
        res
    ) => {

        try {

            const {
                data,
                error
            } =

                await getSupabase()

                    .from(
                        'esocial_eventos'
                    )

                    .update({

                        status:
                            'cancelado',

                        updated_at:
                            new Date()
                                .toISOString()
                    })

                    .eq(
                        'id',
                        req.params.id
                    )

                    .select();


            if (
                error
            ) {

                throw error;
            }


            return res.json({

                success:
                    true,

                message:
                    'Evento marcado como cancelado no sistema local.',

                evento:
                    data?.[0] ||
                    null
            });


        } catch (error) {

            return res

                .status(
                    500
                )

                .json({

                    success:
                        false,

                    error:
                        error.message
                });
        }
    }
);


// ============================================================
// ENVIO PARA O E-SOCIAL
// ============================================================
//
// Ainda bloqueado:
// Exporta Dados consulta, não transmite.
//
// ============================================================

router.post(
    '/enviar-eventos-esocial',

    async (
        req,
        res
    ) => {

        return res

            .status(
                501
            )

            .json({

                success:
                    false,

                error:
                    'Esta rota ainda não envia eventos ao eSocial. ' +
                    'O Web Service Exporta Dados somente consulta informações do SOC. ' +
                    'É necessário integrar a mensageria oficial antes de marcar ' +
                    'eventos como enviados.'
            });
    }
);


// ============================================================
// EXPORTAR ROUTER
// ============================================================

module.exports =
    router;