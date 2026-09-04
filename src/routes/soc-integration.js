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
    validarXmlS2220ContraXsd,
    validarXmlS2240ContraXsd
} = require('../services/esocial-xsd');
// ============================================================
// IMPORTAÇÃO DE HISTÓRICO E-SOCIAL POR ZIP
// ============================================================

const AdmZipEsocial =
    require(
        'adm-zip'
    );


const multerZipEsocial =
    require(
        'multer'
    );


const uploadZipEsocial =
    multerZipEsocial({

        storage:
            multerZipEsocial.memoryStorage(),

        limits: {

            // 150 MB por ZIP
            fileSize:
                150 *
                1024 *
                1024,

            files:
                1
        }
    });

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


    riscos_funcionario: {

        codigo:
            env(
                'SOC_EXPORTA_RISCOS_FUNCIONARIO_CODIGO'
            ),

        chave:
            env(
                'SOC_EXPORTA_RISCOS_FUNCIONARIO_CHAVE'
            )
    },

    riscos_exames_empresa: {

    codigo:
        env(
            'SOC_EXPORTA_RISCOS_EXAMES_EMPRESA_CODIGO'
        ),

    chave:
        env(
            'SOC_EXPORTA_RISCOS_EXAMES_EMPRESA_CHAVE'
        )
},

caracteristica_risco_ghe: {
    codigo: env('SOC_EXPORTA_CARACTERISTICA_RISCO_GHE_CODIGO'),
    chave: env('SOC_EXPORTA_CARACTERISTICA_RISCO_GHE_CHAVE')
},

caracteristica_risco_ghe_7541: {
    codigo: env('SOC_EXPORTA_CARACTERISTICA_RISCO_GHE_7541_CODIGO'),
    chave: env('SOC_EXPORTA_CARACTERISTICA_RISCO_GHE_7541_CHAVE')
},

caracteristica_risco_ghe_219605: {

    codigo:
        env(
            'SOC_EXPORTA_CARACTERISTICA_RISCO_GHE_219605_CODIGO'
        ),

    chave:
        env(
            'SOC_EXPORTA_CARACTERISTICA_RISCO_GHE_219605_CHAVE'
        )
},

agentes_nocivos_s2240: {
    codigo: env('SOC_EXPORTA_AGENTES_NOCIVOS_S2240_CODIGO'),
    chave: env('SOC_EXPORTA_AGENTES_NOCIVOS_S2240_CHAVE')
},

hierarquias_ghe: {
    codigo: env('SOC_EXPORTA_HIERARQUIAS_GHE_CODIGO'),
    chave: env('SOC_EXPORTA_HIERARQUIAS_GHE_CHAVE')
},

ultima_medicao_ghe: {
    codigo: env('SOC_EXPORTA_ULTIMA_MEDICAO_GHE_CODIGO'),
    chave: env('SOC_EXPORTA_ULTIMA_MEDICAO_GHE_CHAVE')
},
pcmso_ghe_7540: {
    codigo: env('SOC_EXPORTA_PCMSO_GHE_7540_CODIGO'),
    chave: env('SOC_EXPORTA_PCMSO_GHE_7540_CHAVE')
},
inconsistencias_s2240: {
    codigo: env('SOC_EXPORTA_INCONSISTENCIAS_S2240_CODIGO'),
    chave: env('SOC_EXPORTA_INCONSISTENCIAS_S2240_CHAVE')
},
caracteristica_risco_ghe_219605: {
    codigo: env('SOC_EXPORTA_CARACTERISTICA_RISCO_GHE_219605_CODIGO'),
    chave: env('SOC_EXPORTA_CARACTERISTICA_RISCO_GHE_219605_CHAVE')
},
responsaveis_ppra: {
    codigo: env('SOC_EXPORTA_RESPONSAVEIS_PPRA_CODIGO'),
    chave: env('SOC_EXPORTA_RESPONSAVEIS_PPRA_CHAVE')
},
pessoas_usuarios: {
    codigo: env('SOC_EXPORTA_PESSOAS_USUARIOS_CODIGO'),
    chave: env('SOC_EXPORTA_PESSOAS_USUARIOS_CHAVE')
},
funcionario_cpf: {
    codigo: env('SOC_EXPORTA_FUNCIONARIO_CPF_CODIGO'),
    chave: env('SOC_EXPORTA_FUNCIONARIO_CPF_CHAVE')
},

    epis_recomendados: {

    codigo:
        env(
            'SOC_EXPORTA_EPIS_RECOMENDADOS_CODIGO'
        ),

    chave:
        env(
            'SOC_EXPORTA_EPIS_RECOMENDADOS_CHAVE'
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
    valor
) {

    if (
        valor === true
    ) {

        return true;
    }


    if (
        valor === false ||
        valor === null ||
        valor === undefined
    ) {

        return false;
    }


    const texto =
        String(
            valor
        )
            .trim()
            .toLowerCase()
            .normalize(
                'NFD'
            )
            .replace(
                /[\u0300-\u036f]/g,
                ''
            );


    if (
        [
            '1',
            'true',
            'sim',
            's',
            'yes',
            'y',
            'on'
        ].includes(
            texto
        )
    ) {

        return true;
    }


    if (
        [
            '',
            '0',
            'false',
            'nao',
            'n',
            'no',
            'off'
        ].includes(
            texto
        )
    ) {

        return false;
    }


    return false;
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


function montarParametrosExportaDados({
    codigo,
    chave,
    empresa,
    empresaTrabalho,
    filtros = {},
    tipoSaida
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
        typeof filtros === 'object' &&
        !Array.isArray(filtros)
            ? filtros
            : {};


    const empresaConsulta =
        String(
            empresa ||
            SOC_CONFIG.empresaPrincipal ||
            ''
        ).trim();


    if (
        !empresaConsulta
    ) {

        throw new Error(
            'Nenhuma empresa SOC foi informada para a consulta.'
        );
    }


    const tipoSaidaFinal =
        String(
            tipoSaida ||
            filtrosValidos.tipoSaida ||
            SOC_CONFIG.tipoSaida ||
            'json'
        )
            .trim()
            .toLowerCase();


    /*
     * Não deixar tipoSaida duplicado dentro dos filtros.
     */
    const {
        tipoSaida: _tipoSaidaIgnorado,
        ...demaisFiltros
    } =
        filtrosValidos;


    const parametros = {

        ...SOC_CONFIG.parametrosFixos,

        ...demaisFiltros,

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
            tipoSaidaFinal
    };


    if (
        empresaTrabalho !== undefined &&
        empresaTrabalho !== null &&
        String(
            empresaTrabalho
        ).trim() !== ''
    ) {

        parametros.empresaTrabalho =
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
    filtros = {},
    tipoSaida
}) {

    const client =
        await getSocClient();


    if (
        typeof client.exportaDadosWsAsync !==
        'function'
    ) {

        const metodos =
            Object.keys(
                client
            )
                .filter(
                    key =>
                        typeof client[key] ===
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

            filtros,

            tipoSaida
        });


    console.log(
        '📤 Consultando SOC:',
        {

            codigo:
                String(
                    codigo
                ),

            empresa:
                parametros.empresa,

            empresaTrabalho:
                parametros.empresaTrabalho ||
                null,

            tipoSaida:
                parametros.tipoSaida
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
        await client.exportaDadosWsAsync(
            argumentos,
            {
                timeout:
                    SOC_CONFIG.timeout
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

// ============================================================
// XML DO EXPORTA DADOS SOC
// ============================================================

function decodificarEntidadesXmlSoc(
    valor
) {

    return String(
        valor ??
        ''
    )
        .replace(
            /<!\[CDATA\[([\s\S]*?)\]\]>/g,
            '$1'
        )
        .replace(
            /&#x([0-9a-fA-F]+);/g,
            (
                _,
                codigo
            ) =>
                String.fromCodePoint(
                    parseInt(
                        codigo,
                        16
                    )
                )
        )
        .replace(
            /&#(\d+);/g,
            (
                _,
                codigo
            ) =>
                String.fromCodePoint(
                    Number(
                        codigo
                    )
                )
        )
        .replace(
            /&lt;/g,
            '<'
        )
        .replace(
            /&gt;/g,
            '>'
        )
        .replace(
            /&quot;/g,
            '"'
        )
        .replace(
            /&apos;/g,
            "'"
        )
        .replace(
            /&amp;/g,
            '&'
        )
        .trim();
}


// ============================================================
// CONVERTER XML <record>...</record> EM ARRAY
// ============================================================

function converterXmlExportaDadosEmRegistros(
    xml
) {

    const textoXml =
        String(
            xml ||
            ''
        ).trim();


    if (
        !textoXml ||
        !/<record\b/i.test(
            textoXml
        )
    ) {

        return [];
    }


    const registros =
        [];


    const regexRegistro =
        /<record\b[^>]*>([\s\S]*?)<\/record>/gi;


    let matchRegistro;


    while (
        (
            matchRegistro =
                regexRegistro.exec(
                    textoXml
                )
        ) !==
        null
    ) {

        const conteudoRegistro =
            matchRegistro[1];


        const registro =
            {};


        const regexCampo =
            /<([A-Za-z_][A-Za-z0-9_.:-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;


        let matchCampo;


        while (
            (
                matchCampo =
                    regexCampo.exec(
                        conteudoRegistro
                    )
            ) !==
            null
        ) {

            const nomeCampo =
                String(
                    matchCampo[1] ||
                    ''
                ).trim();


            let valorCampo =
                String(
                    matchCampo[2] ??
                    ''
                );


            valorCampo =
                valorCampo.replace(
                    /<[^>]+>/g,
                    ''
                );


            registro[
                nomeCampo
            ] =
                decodificarEntidadesXmlSoc(
                    valorCampo
                );
        }


        if (
            Object.keys(
                registro
            ).length
        ) {

            registros.push(
                registro
            );
        }
    }


    return registros;
}


function localizarRegistrosExportaDados(
    dados
) {

    if (
        dados === undefined ||
        dados === null
    ) {

        return [];
    }


    // ========================================================
    // RETORNO XML
    // ========================================================

    if (
        typeof dados ===
        'string'
    ) {

        const texto =
            dados.trim();


        if (
            !texto
        ) {

            return [];
        }


        if (
            texto.startsWith(
                '<?xml'
            ) ||
            texto.startsWith(
                '<root'
            ) ||
            /<record\b/i.test(
                texto
            )
        ) {

            const registrosXml =
                converterXmlExportaDadosEmRegistros(
                    texto
                );


            if (
                registrosXml.length
            ) {

                /*
                 * Alguns Exporta Dados do SOC retornam:
                 *
                 * <record>
                 *   <mensagemRetorno>Sem dados de Saida</mensagemRetorno>
                 * </record>
                 *
                 * Isso NÃO representa um registro real.
                 */
                const registrosValidos =
                    registrosXml.filter(
                        registro => {

                            if (
                                !registro ||
                                typeof registro !==
                                    'object'
                            ) {

                                return false;
                            }


                            const mensagem =
                                String(
                                    registro.mensagemRetorno ||
                                    registro.MENSAGEMRETORNO ||
                                    registro.mensagem_retorno ||
                                    ''
                                )
                                    .trim()
                                    .toLowerCase()
                                    .normalize(
                                        'NFD'
                                    )
                                    .replace(
                                        /[\u0300-\u036f]/g,
                                        ''
                                    );


                            if (
                                mensagem.includes(
                                    'sem dados de saida'
                                ) ||
                                mensagem.includes(
                                    'sem dados de saída'
                                ) ||
                                mensagem ===
                                    'sem dados'
                            ) {

                                return false;
                            }


                            return true;
                        }
                    );


                return registrosValidos;
            }


            return [];
        }
    }


    // ========================================================
    // RETORNO JSON / OBJETO
    // ========================================================

    const registros =
        localizarArray(
            dados
        );


    return registros.filter(
        registro => {

            if (
                !registro ||
                typeof registro !==
                    'object'
            ) {

                return false;
            }


            const mensagem =
                String(
                    registro.mensagemRetorno ||
                    registro.MENSAGEMRETORNO ||
                    registro.mensagem_retorno ||
                    ''
                )
                    .trim()
                    .toLowerCase()
                    .normalize(
                        'NFD'
                    )
                    .replace(
                        /[\u0300-\u036f]/g,
                        ''
                    );


            if (
                mensagem.includes(
                    'sem dados de saida'
                ) ||
                mensagem ===
                    'sem dados'
            ) {

                return false;
            }


            return true;
        }
    );
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

function normalizarDataComparacaoSoc(
    valor
) {

    const texto =
        String(
            valor || ''
        ).trim();


    if (
        !texto
    ) {

        return '';
    }


    const iso =
        texto.match(
            /^(\d{4})-(\d{2})-(\d{2})/
        );


    if (
        iso
    ) {

        return (
            `${iso[1]}-${iso[2]}-${iso[3]}`
        );
    }


    const br =
        texto.match(
            /^(\d{2})\/(\d{2})\/(\d{4})$/
        );


    if (
        br
    ) {

        return (
            `${br[3]}-${br[2]}-${br[1]}`
        );
    }


    return '';
}


function obterDataReferenciaEventoS2240(
    evento
) {

    return (
        normalizarDataComparacaoSoc(
            evento?.dataInicioCondicao
        )
        ||
        normalizarDataComparacaoSoc(
            evento?.data_inicio_condicao
        )
        ||
        normalizarDataComparacaoSoc(
            evento?.dataExame
        )
        ||
        normalizarDataComparacaoSoc(
            evento?.data_exame
        )
        ||
        normalizarDataComparacaoSoc(
            evento?.dataEmissaoAso
        )
        ||
        normalizarDataComparacaoSoc(
            evento?.data_emissao_aso
        )
        ||
        ''
    );
}

function normalizarFuncionarioCpf219968(
    registro
) {

    return {

        codigoEmpresa:
            String(
                registro?.CODIGOEMPRESA ||
                registro?.codigoEmpresa ||
                ''
            ).trim(),

        nomeEmpresa:
            String(
                registro?.NOMEEMPRESA ||
                registro?.nomeEmpresa ||
                ''
            ).trim(),

        codigoFuncionario:
            String(
                registro?.CODIGO ||
                registro?.CODIGOFUNCIONARIO ||
                registro?.codigoFuncionario ||
                ''
            ).trim(),

        nomeFuncionario:
            String(
                registro?.NOME ||
                registro?.nome ||
                ''
            ).trim(),

        codigoUnidade:
            String(
                registro?.CODIGOUNIDADE ||
                registro?.codigoUnidade ||
                ''
            ).trim(),

        nomeUnidade:
            String(
                registro?.NOMEUNIDADE ||
                registro?.nomeUnidade ||
                ''
            ).trim(),

        codigoSetor:
            String(
                registro?.CODIGOSETOR ||
                registro?.codigoSetor ||
                ''
            ).trim(),

        nomeSetor:
            String(
                registro?.NOMESETOR ||
                registro?.nomeSetor ||
                ''
            ).trim(),

        codigoCargo:
            String(
                registro?.CODIGOCARGO ||
                registro?.codigoCargo ||
                ''
            ).trim(),

        nomeCargo:
            String(
                registro?.NOMECARGO ||
                registro?.nomeCargo ||
                ''
            ).trim(),

        cboCargo:
            String(
                registro?.CBOCARGO ||
                registro?.cboCargo ||
                ''
            ).trim(),

        matricula:
            String(
                registro?.MATRICULAFUNCIONARIO ||
                registro?.matriculaFuncionario ||
                ''
            ).trim(),

        cpf:
            normalizarCpf(
                registro?.CPFFUNCIONARIO ||
                registro?.cpfFuncionario ||
                registro?.CPF ||
                registro?.cpf ||
                ''
            ),

        situacao:
            String(
                registro?.SITUACAO ||
                registro?.situacao ||
                ''
            ).trim(),

        dataAdmissao:
            normalizarDataComparacaoSoc(
                registro?.DATA_ADMISSAO ||
                registro?.dataAdmissao
            ),

        dataDemissao:
            normalizarDataComparacaoSoc(
                registro?.DATA_DEMISSAO ||
                registro?.dataDemissao
            ),

        dataInativacao:
            normalizarDataComparacaoSoc(
                registro?.DATA_INATIVACAO ||
                registro?.dataInativacao
            ),

        raw:
            registro
    };
}


async function consultarFuncionarioCpf219968(
    evento
) {

    const extracao =
        SOC_EXTRACOES
            .funcionario_cpf;


    if (
        !extracao?.codigo ||
        !extracao?.chave
    ) {

        throw new Error(
            'Exporta Dados 219968 - Cadastro de funcionário por CPF não configurado.'
        );
    }


    const cpf =
        normalizarCpf(
            evento?.cpf ||
            evento?.cpfFuncionario ||
            evento?.cpf_funcionario ||
            ''
        );


    const codigoEmpresa =
        String(
            evento?.codigoEmpresa ||
            evento?.codigo_empresa ||
            ''
        ).trim();


    const codigoFuncionario =
        String(
            evento?.codigoFuncionario ||
            evento?.codigo_funcionario ||
            ''
        ).trim();


    if (
        !cpf
    ) {

        throw new Error(
            'CPF do funcionário ausente para consulta do Exporta Dados 219968.'
        );
    }


    const dados =
        await exportarDadosSoc({

            empresa:
                SOC_CONFIG
                    .empresaPrincipal,

            codigo:
                extracao.codigo,

            chave:
                extracao.chave,

            tipoSaida:
                'json',

            filtros: {

                cpf:
                    cpf
            }
        });


    const registros =
        localizarRegistrosExportaDados(
            dados
        )
            .map(
                normalizarFuncionarioCpf219968
            )
            .filter(
                item =>
                    item.cpf ===
                    cpf
            );


    if (
        registros.length ===
        0
    ) {

        return null;
    }


    /*
     * Primeiro tenta casar:
     * empresa + código do funcionário.
     */
    const correspondenciaExata =
        registros.find(
            item =>
                (
                    !codigoEmpresa ||
                    item.codigoEmpresa ===
                        codigoEmpresa
                )
                &&
                (
                    !codigoFuncionario ||
                    item.codigoFuncionario ===
                        codigoFuncionario
                )
        );


    if (
        correspondenciaExata
    ) {

        return correspondenciaExata;
    }


    /*
     * Segundo nível:
     * mesma empresa.
     */
    const mesmaEmpresa =
        registros.find(
            item =>
                codigoEmpresa &&
                item.codigoEmpresa ===
                    codigoEmpresa
        );


    if (
        mesmaEmpresa
    ) {

        return mesmaEmpresa;
    }


    /*
     * Não usa registro de outra empresa automaticamente.
     */
    return null;
}

function normalizarHierarquiaGhe11573(
    registro
) {

    return {

        codigoGhe:
            String(
                registro?.CODIGO_GHE ||
                registro?.codigoGhe ||
                ''
            ).trim(),

        nomeGhe:
            String(
                registro?.NOME_GHE ||
                registro?.nomeGhe ||
                ''
            ).trim(),

        origemAplicacao:
            String(
                registro?.ORIGEM_APLICACAO ||
                registro?.origemAplicacao ||
                ''
            ).trim(),

        codigoUnidade:
            String(
                registro?.CODIGO_UNIDADE ||
                registro?.codigoUnidade ||
                ''
            ).trim(),

        codigoRhUnidade:
            String(
                registro?.CODIGO_RH_UNIDADE ||
                registro?.codigoRhUnidade ||
                ''
            ).trim(),

        nomeUnidade:
            String(
                registro?.NOME_UNIDADE ||
                registro?.nomeUnidade ||
                ''
            ).trim(),

        codigoSetor:
            String(
                registro?.CODIGO_SETOR ||
                registro?.codigoSetor ||
                ''
            ).trim(),

        codigoRhSetor:
            String(
                registro?.CODIGO_RH_SETOR ||
                registro?.codigoRhSetor ||
                ''
            ).trim(),

        nomeSetor:
            String(
                registro?.NOME_SETOR ||
                registro?.nomeSetor ||
                ''
            ).trim(),

        codigoCargo:
            String(
                registro?.CODIGO_CARGO ||
                registro?.codigoCargo ||
                ''
            ).trim(),

        codigoRhCargo:
            String(
                registro?.CODIGO_RH_CARGO ||
                registro?.codigoRhCargo ||
                ''
            ).trim(),

        nomeCargo:
            String(
                registro?.NOME_CARGO ||
                registro?.nomeCargo ||
                ''
            ).trim(),

        codigoFuncionario:
            String(
                registro?.CODIGO_FUNCIONARIO ||
                registro?.codigoFuncionario ||
                ''
            ).trim(),

        nomeFuncionario:
            String(
                registro?.NOME_FUNCIONARIO ||
                registro?.nomeFuncionario ||
                ''
            ).trim(),

        dataInicial:
            normalizarDataComparacaoSoc(
                registro?.DATA_INICIAL ||
                registro?.dataInicial
            ),

        dataFinal:
            normalizarDataComparacaoSoc(
                registro?.DATA_FINAL ||
                registro?.dataFinal
            ),

        codigoEmpresa:
            String(
                registro?.CODIGOEMPRESA ||
                registro?.codigoEmpresa ||
                ''
            ).trim(),

        nomeEmpresa:
            String(
                registro?.NOMEEMPRESA ||
                registro?.nomeEmpresa ||
                ''
            ).trim(),

        raw:
            registro
    };
}


async function consultarHierarquiasGhe11573(
    codigoEmpresa
) {

    const extracao =
        SOC_EXTRACOES
            .hierarquias_ghe;


    if (
        !extracao?.codigo ||
        !extracao?.chave
    ) {

        throw new Error(
            'Exporta Dados 11573 - Hierarquias do GHE não configurado.'
        );
    }


    const dados =
        await exportarDadosSoc({

            empresa:
                SOC_CONFIG
                    .empresaPrincipal,

            codigo:
                extracao.codigo,

            chave:
                extracao.chave,

            tipoSaida:
                'json',

            empresaTrabalho:
                codigoEmpresa,

            filtros: {
                ghe:
                    ''
            }
        });


    const registros =
        localizarRegistrosExportaDados(
            dados
        );


    return registros
        .map(
            normalizarHierarquiaGhe11573
        )
        .filter(
            item =>
                item.codigoGhe
        );
}


function determinarGhesAplicaveisFuncionario11573(
    evento,
    hierarquias,
    funcionarioCadastro = null
) {

    const codigoFuncionario =
        String(
            evento?.codigoFuncionario ||
            evento?.codigo_funcionario ||
            ''
        ).trim();


    const codigoEmpresa =
        String(
            evento?.codigoEmpresa ||
            evento?.codigo_empresa ||
            ''
        ).trim();


    const dataReferencia =
        obterDataReferenciaEventoS2240(
            evento
        );


    if (
        !codigoFuncionario ||
        !Array.isArray(
            hierarquias
        )
    ) {

        return [];
    }


    // ========================================================
    // FUNÇÃO LOCAL - REGISTRO VÁLIDO NA DATA DO EVENTO
    // ========================================================

    function registroValidoNaData(
        item
    ) {

        if (
            !dataReferencia
        ) {

            return true;
        }


        if (
            item?.dataInicial &&
            item.dataInicial >
                dataReferencia
        ) {

            return false;
        }


        if (
            item?.dataFinal &&
            item.dataFinal <
                dataReferencia
        ) {

            return false;
        }


        return true;
    }


    // ========================================================
    // 1. TENTATIVA PRINCIPAL:
    //    POSIÇÃO DIRETA PELO 11573
    // ========================================================

    const hierarquiasDiretas =
        hierarquias.filter(
            item => {

                if (
                    String(
                        item?.codigoFuncionario ||
                        ''
                    ).trim() !==
                    codigoFuncionario
                ) {

                    return false;
                }


                return registroValidoNaData(
                    item
                );
            }
        );


    let basesHierarquicas =
        [];


    let origemPosicao =
        '';


    if (
        hierarquiasDiretas.length >
        0
    ) {

        /*
         * Melhor cenário:
         *
         * o próprio funcionário aparece no 11573.
         *
         * Mantemos essa informação como prioridade.
         */
        basesHierarquicas =
            hierarquiasDiretas;


        origemPosicao =
            '11573_direto';

    } else {

        // ====================================================
        // 2. FALLBACK:
        //    CADASTRO DO FUNCIONÁRIO PELO 219968
        // ====================================================

        if (
            !funcionarioCadastro
        ) {

            return [];
        }


        const cadastroEmpresa =
            String(
                funcionarioCadastro?.codigoEmpresa ||
                ''
            ).trim();


        const cadastroFuncionario =
            String(
                funcionarioCadastro?.codigoFuncionario ||
                ''
            ).trim();


        const cadastroCpf =
            normalizarCpf(
                funcionarioCadastro?.cpf ||
                ''
            );


        const cpfEvento =
            normalizarCpf(
                evento?.cpf ||
                evento?.cpfFuncionario ||
                evento?.cpf_funcionario ||
                ''
            );


        /*
         * Se o 219968 informar outra empresa,
         * não usamos o cadastro.
         */
        if (
            codigoEmpresa &&
            cadastroEmpresa &&
            cadastroEmpresa !==
                codigoEmpresa
        ) {

            return [];
        }


        /*
         * Se ambos tiverem código de funcionário,
         * precisam coincidir.
         */
        if (
            cadastroFuncionario &&
            cadastroFuncionario !==
                codigoFuncionario
        ) {

            return [];
        }


        /*
         * Se houver CPF dos dois lados,
         * também precisam coincidir.
         */
        if (
            cpfEvento &&
            cadastroCpf &&
            cadastroCpf !==
                cpfEvento
        ) {

            return [];
        }


        const codigoUnidade =
            String(
                funcionarioCadastro?.codigoUnidade ||
                ''
            ).trim();


        const codigoSetor =
            String(
                funcionarioCadastro?.codigoSetor ||
                ''
            ).trim();


        const codigoCargo =
            String(
                funcionarioCadastro?.codigoCargo ||
                ''
            ).trim();


        /*
         * Não vamos determinar GHE apenas pelo nome.
         *
         * Precisamos de pelo menos uma posição
         * hierárquica codificada.
         */
        if (
            !codigoUnidade &&
            !codigoSetor &&
            !codigoCargo
        ) {

            return [];
        }


        basesHierarquicas = [
            {

                codigoEmpresa:
                    cadastroEmpresa ||
                    codigoEmpresa,

                codigoFuncionario:
                    codigoFuncionario,

                codigoUnidade,

                codigoSetor,

                codigoCargo,

                nomeUnidade:
                    String(
                        funcionarioCadastro?.nomeUnidade ||
                        ''
                    ).trim(),

                nomeSetor:
                    String(
                        funcionarioCadastro?.nomeSetor ||
                        ''
                    ).trim(),

                nomeCargo:
                    String(
                        funcionarioCadastro?.nomeCargo ||
                        ''
                    ).trim(),

                dataInicial:
                    normalizarDataComparacaoSoc(
                        funcionarioCadastro?.dataAdmissao ||
                        ''
                    ),

                dataFinal:
                    normalizarDataComparacaoSoc(
                        funcionarioCadastro?.dataDemissao ||
                        funcionarioCadastro?.dataInativacao ||
                        ''
                    )
            }
        ];


        origemPosicao =
            '219968';
    }


    // ========================================================
    // 3. LOCALIZAR TODOS OS GHEs APLICÁVEIS
    // ========================================================

    const aplicaveis =
        hierarquias.filter(
            candidato => {

                if (
                    !registroValidoNaData(
                        candidato
                    )
                ) {

                    return false;
                }


                /*
                 * Se o GHE estiver vinculado a um funcionário
                 * específico, precisa ser o funcionário atual.
                 */
                if (
                    candidato.codigoFuncionario &&
                    candidato.codigoFuncionario !==
                        codigoFuncionario
                ) {

                    return false;
                }


                return basesHierarquicas.some(
                    base => {

                        /*
                         * Todo nível preenchido no GHE
                         * precisa coincidir com a posição
                         * real do funcionário.
                         *
                         * Exemplos aceitos:
                         *
                         * Unidade
                         * Setor
                         * Cargo
                         * Funcionário
                         * Unidade/Setor
                         * Unidade/Cargo
                         * Setor/Cargo
                         * Unidade/Setor/Cargo
                         */

                        if (
                            candidato.codigoUnidade &&
                            candidato.codigoUnidade !==
                                base.codigoUnidade
                        ) {

                            return false;
                        }


                        if (
                            candidato.codigoSetor &&
                            candidato.codigoSetor !==
                                base.codigoSetor
                        ) {

                            return false;
                        }


                        if (
                            candidato.codigoCargo &&
                            candidato.codigoCargo !==
                                base.codigoCargo
                        ) {

                            return false;
                        }


                        if (
                            candidato.codigoFuncionario &&
                            candidato.codigoFuncionario !==
                                codigoFuncionario
                        ) {

                            return false;
                        }


                        return true;
                    }
                );
            }
        );


    // ========================================================
    // 4. REMOVER GHEs DUPLICADOS
    // ========================================================

    const unicos =
        new Map();


    for (
        const item
        of aplicaveis
    ) {

        if (
            !item.codigoGhe
        ) {

            continue;
        }


        if (
            !unicos.has(
                item.codigoGhe
            )
        ) {

            unicos.set(
                item.codigoGhe,
                {

                    ...item,

                    origemDeterminacaoPosicao:
                        origemPosicao
                }
            );
        }
    }


    return Array.from(
        unicos.values()
    );
}


function normalizarCaracteristicaRisco7541(
    registro
) {

    return {

        codigoEmpresa:
            String(
                registro?.EMPRESA ||
                ''
            ).trim(),

        codRisco:
            String(
                registro?.CODRISCO ||
                ''
            ).trim(),

        nomeRisco:
            String(
                registro?.NOMERISCO ||
                ''
            ).trim(),

        grupo:
            String(
                registro?.GRUPO ||
                ''
            ).trim(),

        meioPropagacao:
            String(
                registro?.MEIOPROPAGACAO ||
                ''
            ).trim(),

        unidadeMedida:
            String(
                registro?.UNIDADEMEDIDA ||
                ''
            ).trim(),

        ppp:
            valorBooleanoSoc(
                registro?.PPP
            ),

        ppra:
            valorBooleanoSoc(
                registro?.PPRA
            ),

        pcmso:
            valorBooleanoSoc(
                registro?.PCMSO
            ),

        classificacao:
            String(
                registro?.CLASSIFICACAO ||
                ''
            ).trim(),

        classificacaoEfeito:
            String(
                registro?.CLASSIFICACAOEFEITO ||
                ''
            ).trim(),

        horasExposicao:
            String(
                registro?.HR_EXPOSICAO ||
                ''
            ).trim(),

        descricaoEfeito:
            String(
                registro?.DS_EFEITO ||
                ''
            ).trim(),

        descricaoOrientacao:
            String(
                registro?.DS_ORIENTACAO ||
                ''
            ).trim(),

        conclusao:
            String(
                registro?.CONCLUSAO ||
                ''
            ).trim(),

        epiEficaz:
            valorBooleanoSoc(
                registro?.EPIEFICAZ
            ),

        epcEficaz:
            valorBooleanoSoc(
                registro?.EPCEFICAZ
            ),

        caEpi:
            String(
                registro?.CAEPI ||
                ''
            ).trim(),

        fonteGeradora:
            String(
                registro?.FONTE_GERADORA ||
                ''
            ).trim(),

        nomeFonte:
            String(
                registro?.NOME_FONTE ||
                ''
            ).trim(),

        origem:
            String(
                registro?.ORIGEM ||
                ''
            ).trim(),

        codigoUnidade:
            String(
                registro?.UNIDADE ||
                ''
            ).trim(),

        codigoSetor:
            String(
                registro?.SETOR ||
                ''
            ).trim(),

        codigoCargo:
            String(
                registro?.CARGO ||
                ''
            ).trim(),

        codigoFuncionario:
            String(
                registro?.FUNCIONA ||
                ''
            ).trim(),

        codigoGhe:
            String(
                registro?.GHE ||
                ''
            ).trim(),

        grauInsalubridade:
            String(
                registro?.GRAU_INSALUBRIDADE_CA ||
                ''
            ).trim(),

        classificacaoCa:
            String(
                registro?.CLASSIFICACAO_CA ||
                ''
            ).trim(),

        frequencia:
            String(
                registro?.FREQUENCIA_CA ||
                ''
            ).trim(),

        insalubridade:
            String(
                registro?.INSALUBRIDADE ||
                ''
            ).trim(),

        periculosidade:
            String(
                registro?.PERICULOSIDADE ||
                ''
            ).trim(),

        /*
         * O retorno real do SOC mostrou
         * CDFATORTABELA24.
         *
         * Mantemos o fallback TABELA23 apenas
         * para tolerar eventual versão antiga.
         */
        codigoAgenteNocivo:
            String(
                registro?.CDFATORTABELA24 ||
                registro?.CDFATORTABELA23 ||
                ''
            ).trim(),

        codigoEsocialTabela28:
            String(
                registro?.CDESOCIALTABELA28 ||
                ''
            ).trim(),

        raw:
            registro
    };
}


async function consultarCaracteristicasRiscoGhe7541(
    codigoEmpresa,
    codigoGhe
) {

    const extracao =
        SOC_EXTRACOES
            .caracteristica_risco_ghe_7541;


    if (
        !extracao?.codigo ||
        !extracao?.chave
    ) {

        throw new Error(
            'Exporta Dados 7541 - Característica do Risco com Fonte Geradora não configurado.'
        );
    }


    const dados =
        await exportarDadosSoc({

            empresa:
                codigoEmpresa,

            codigo:
                extracao.codigo,

            chave:
                extracao.chave,

            tipoSaida:
                'json',

            filtros: {

                tipoBusca:
                    '2',

                codigoGhe:
                    codigoGhe,

                codigoUnidade:
                    ''
            }
        });


    const registros =
        localizarRegistrosExportaDados(
            dados
        );


    return registros
        .map(
            normalizarCaracteristicaRisco7541
        )
        .filter(
            item =>
                item.codRisco
        );
}

// ============================================================
// NORMALIZAÇÃO - 219605
// CARACTERIZAÇÃO TÉCNICA / EPC / EPI
// ============================================================

function normalizarCaracteristicaRisco219605(
    registro
) {

    const gheTexto =
        String(
            registro?.GHE ||
            ''
        ).trim();


    const matchCodigoGhe =
        gheTexto.match(
            /^\s*(\d+)/
        );


    const codigoGhe =
        matchCodigoGhe
            ? matchCodigoGhe[1]
            : '';


    const nomeGhe =
        gheTexto
            .replace(
                /^\s*\d+\s*-\s*/,
                ''
            )
            .trim();


    const normalizarTextoComparacao =
        valor =>
            String(
                valor ||
                ''
            )
                .normalize(
                    'NFD'
                )
                .replace(
                    /[\u0300-\u036f]/g,
                    ''
                )
                .toUpperCase()
                .replace(
                    /\s+/g,
                    ' '
                )
                .trim();


    const converterUtilizacaoEpc =
        valor => {

            const texto =
                normalizarTextoComparacao(
                    valor
                );


            if (
                !texto
            ) {
                return '';
            }


            if (
                texto ===
                'NAO SE APLICA'
            ) {
                return '0';
            }


            if (
                texto.includes(
                    'NAO IMPLEMENTA'
                )
            ) {
                return '1';
            }


            if (
                texto ===
                    'IMPLEMENTA' ||
                texto.includes(
                    'IMPLEMENTADO'
                )
            ) {
                return '2';
            }


            return '';
        };


    const converterUtilizacaoEpi =
        valor => {

            const texto =
                normalizarTextoComparacao(
                    valor
                );


            if (
                !texto
            ) {
                return '';
            }


            if (
                texto ===
                'NAO SE APLICA'
            ) {
                return '0';
            }


            if (
                texto.includes(
                    'NAO UTILIZADO'
                ) ||
                texto ===
                    'NAO UTILIZA'
            ) {
                return '1';
            }


            if (
                texto ===
                    'UTILIZADO' ||
                texto ===
                    'UTILIZA' ||
                texto.includes(
                    'UTILIZADO'
                )
            ) {
                return '2';
            }


            return '';
        };


    const converterSimNao =
        valor => {

            const texto =
                normalizarTextoComparacao(
                    valor
                );


            if (
                texto ===
                'SIM'
            ) {
                return 'S';
            }


            if (
                texto ===
                'NAO'
            ) {
                return 'N';
            }


            /*
             * "Não se aplica" não vira S nem N.
             * O campo simplesmente não será enviado
             * quando a utilização for 0/1.
             */
            return '';
        };


    const perigoFatorRisco =
        String(
            registro?.PERIGO_FATOR_RISCO ||
            ''
        ).trim();


    return {

        codigoGhe,

        nomeGhe,

        perigoFatorRisco,

        perigoFatorRiscoNormalizado:
            normalizarTextoComparacao(
                perigoFatorRisco
            ),

        versao:
            String(
                registro?.VERSAO ||
                ''
            ).trim(),

        descricao:
            String(
                registro?.DESCRICAO ||
                ''
            ).trim(),

        descricaoMetodologia:
            String(
                registro?.DESCRICAO_METODOLOGIA ||
                ''
            ).trim(),

        criterio:
            String(
                registro?.CRITERIO ||
                ''
            ).trim(),

        tipoExposicao:
            String(
                registro?.TIPO_EXPOSICAO ||
                ''
            ).trim(),

        utilizaEPC:
            converterUtilizacaoEpc(
                registro?.UTILIZA_EPC
            ),

        eficEpc:
            converterSimNao(
                registro?.EPC_EFICAZ
            ),

        medidasColetivasEpc:
            String(
                registro?.MEDIDAS_COLETIVAS_EPC ||
                ''
            ).trim(),

        utilizaEPI:
            converterUtilizacaoEpi(
                registro?.UTILIZA_EPI
            ),

        eficEpi:
            converterSimNao(
                registro?.EPI_EFICAZ
            ),

        medidasIndividuaisEpi:
            String(
                registro?.MEDIDAS_INDIVIDUAIS_EPI ||
                ''
            ).trim(),

        caEpi:
            String(
                registro?.CA_EPI ||
                ''
            ).trim(),

        observacoes:
            String(
                registro?.OBSERVACOES ||
                ''
            ).trim(),

        observacoesRegistrosAmbientais:
            String(
                registro?.OBS_REGISTROS_AMBIENTAIS ||
                ''
            ).trim(),

        raw:
            registro
    };
}


// ============================================================
// CONSULTA 219605
// CARACTERIZAÇÃO TÉCNICA / EPC / EPI
// ============================================================

async function consultarCaracteristicasRiscoGhe219605(
    codigoEmpresa,
    codigoUnidade,
    codigoGhe
) {

    const extracao =
        SOC_EXTRACOES
            .caracteristica_risco_ghe_219605;


    if (
        !extracao?.codigo ||
        !extracao?.chave
    ) {

        throw new Error(
            'Exporta Dados 219605 - Caracterização técnica / EPC / EPI não configurado.'
        );
    }


    if (
        !codigoEmpresa
    ) {

        throw new Error(
            'Código da empresa não informado para consulta 219605.'
        );
    }


    if (
        !codigoUnidade
    ) {

        throw new Error(
            'Código da unidade não informado para consulta 219605.'
        );
    }


    if (
        !codigoGhe
    ) {

        throw new Error(
            'Código do GHE não informado para consulta 219605.'
        );
    }


    const dados =
        await exportarDadosSoc({

            empresa:
                codigoEmpresa,

            codigo:
                extracao.codigo,

            chave:
                extracao.chave,

            tipoSaida:
                'json',

            filtros: {

                tipoBusca:
                    '2',

                unidade:
                    String(
                        codigoUnidade
                    ).trim(),

                codigoGhe:
                    String(
                        codigoGhe
                    ).trim()
            }
        });


    const registros =
        localizarRegistrosExportaDados(
            dados
        );


    /*
     * A 219605 pode devolver outros GHEs da unidade.
     *
     * Portanto, NÃO confiamos apenas no filtro enviado
     * ao SOC. Filtramos novamente após receber os dados.
     */

    return registros
        .map(
            normalizarCaracteristicaRisco219605
        )
        .filter(
            item =>
                item.codigoGhe ===
                String(
                    codigoGhe
                ).trim()
        );
}

// ============================================================
// S-2240 - RESPONSÁVEIS PELOS REGISTROS AMBIENTAIS
// ============================================================

function normalizarTextoComparacaoSoc(
    valor
) {

    return String(
        valor ||
        ''
    )
        .normalize(
            'NFD'
        )
        .replace(
            /[\u0300-\u036f]/g,
            ''
        )
        .toUpperCase()
        .replace(
            /\s+/g,
            ' '
        )
        .trim();
}


// ============================================================
// CONVERTER DATA SOC DD/MM/AAAA -> AAAA-MM-DD
// ============================================================

function converterDataSocParaIsoS2240(
    valor
) {

    const textoData =
        String(
            valor ||
            ''
        ).trim();


    if (
        !textoData
    ) {

        return '';
    }


    if (
        /^\d{4}-\d{2}-\d{2}$/.test(
            textoData
        )
    ) {

        return textoData;
    }


    const match =
        textoData.match(
            /^(\d{2})\/(\d{2})\/(\d{4})$/
        );


    if (
        !match
    ) {

        return '';
    }


    return (
        `${match[3]}-` +
        `${match[2]}-` +
        `${match[1]}`
    );
}


// ============================================================
// MAPEAR ÓRGÃO DE CLASSE PARA ideOC DO S-2240
//
// 1 = CRM
// 4 = CREA
// 9 = outros
// ============================================================

function mapearIdeOcResponsavelS2240(
    nomeConselho
) {

    const conselho =
        normalizarTextoComparacaoSoc(
            nomeConselho
        );


    if (
        conselho === 'CRM' ||
        conselho.includes(
            'CONSELHO REGIONAL DE MEDICINA'
        )
    ) {

        return '1';
    }


    if (
        conselho === 'CREA' ||
        conselho.includes(
            'CONSELHO REGIONAL DE ENGENHARIA'
        )
    ) {

        return '4';
    }


    return '9';
}


// ============================================================
// CONSULTAR PESSOAS / USUÁRIOS DO SOC
//
// Fonte do CPF do responsável.
// ============================================================

async function consultarPessoasUsuariosSoc() {

    const extracao =
        obterExtracao(
            'pessoas_usuarios'
        );


    const retorno =
        await exportarDadosSoc({

            codigo:
                extracao.codigo,

            chave:
                extracao.chave,

            empresa:
                SOC_CONFIG
                    .empresaPrincipal,

            empresaTrabalho:
                SOC_CONFIG
                    .empresaPrincipal,

            filtros:
                {}
        });


    return localizarArray(
        retorno
    );
}


// ============================================================
// LOCALIZAR PESSOA PELO RESPONSÁVEL DO PPRA
// ============================================================

function localizarPessoaResponsavelSoc(
    responsavelPpra,
    pessoas
) {

    const nomeResponsavel =
        normalizarTextoComparacaoSoc(
            responsavelPpra
                ?.NOMERESPONSAVEL
        );


    const emailResponsavel =
        String(
            responsavelPpra
                ?.EMAIL ||
            ''
        )
            .trim()
            .toLowerCase();


    const lista =
        Array.isArray(
            pessoas
        )
            ? pessoas
            : [];


    // --------------------------------------------------------
    // PRIMEIRO: NOME + E-MAIL
    // --------------------------------------------------------

    let pessoa =
        lista.find(
            item => {

                const mesmoNome =
                    normalizarTextoComparacaoSoc(
                        item?.NOME
                    ) ===
                    nomeResponsavel;


                const mesmoEmail =
                    emailResponsavel &&
                    String(
                        item?.EMAIL ||
                        ''
                    )
                        .trim()
                        .toLowerCase() ===
                    emailResponsavel;


                return (
                    mesmoNome &&
                    mesmoEmail
                );
            }
        );


    if (
        pessoa
    ) {

        return pessoa;
    }


    // --------------------------------------------------------
    // SEGUNDO: NOME
    // --------------------------------------------------------

    pessoa =
        lista.find(
            item =>
                normalizarTextoComparacaoSoc(
                    item?.NOME
                ) ===
                nomeResponsavel
        );


    if (
        pessoa
    ) {

        return pessoa;
    }


    // --------------------------------------------------------
    // TERCEIRO: E-MAIL
    // --------------------------------------------------------

    if (
        emailResponsavel
    ) {

        pessoa =
            lista.find(
                item =>
                    String(
                        item?.EMAIL ||
                        ''
                    )
                        .trim()
                        .toLowerCase() ===
                    emailResponsavel
            );
    }


    return (
        pessoa ||
        null
    );
}


// ============================================================
// NORMALIZAR RESPONSÁVEL PARA respReg DO E-SOCIAL
// ============================================================

function normalizarResponsavelAmbientalS2240(
    responsavelPpra,
    pessoaSoc
) {

    const nomeConselho =
        String(
            responsavelPpra
                ?.NOMECONSELHO ||
            ''
        ).trim();


    const ideOC =
        mapearIdeOcResponsavelS2240(
            nomeConselho
        );


    const cpfResp =
        String(
            pessoaSoc?.CPF ||
            ''
        )
            .replace(
                /\D/g,
                ''
            );


    const nrOC =
        String(
            responsavelPpra
                ?.CONSELHO ||

            pessoaSoc
                ?.CONSELHO_CLASSE ||

            ''
        ).trim();


    const ufOC =
        String(
            responsavelPpra
                ?.UFCONSELHO ||

            pessoaSoc
                ?.UF_CONSELHO ||

            ''
        )
            .trim()
            .toUpperCase();


    return {

        nome:
            String(
                responsavelPpra
                    ?.NOMERESPONSAVEL ||
                pessoaSoc
                    ?.NOME ||
                ''
            ).trim(),

        cpfResp,

        ideOC,

        dscOC:
            ideOC === '9'
                ? nomeConselho
                : '',

        nrOC,

        ufOC,

        codigoUnidade:
            String(
                responsavelPpra
                    ?.CODIGOUNIDADE ||
                ''
            ).trim(),

        nomeUnidade:
            String(
                responsavelPpra
                    ?.NOMEUNIDADE ||
                ''
            ).trim(),

        dataInicio:
            converterDataSocParaIsoS2240(
                responsavelPpra
                    ?.DATAINICIO
            ),

        dataFim:
            converterDataSocParaIsoS2240(
                responsavelPpra
                    ?.DATAFIM
            ),

        origem:
            'SOC_RESPONSAVEIS_PPRA_PESSOAS_USUARIOS'
    };
}


async function consultarResponsaveisAmbientaisS2240(
    empresaTrabalho,
    codigoUnidade,
    dataReferencia,
    pessoasSoc = null
) {

    // ========================================================
    // EMPRESA DE TRABALHO
    // ========================================================

    const empresaTrabalhoSoc =
        String(
            empresaTrabalho ||
            ''
        ).trim();


    if (
        !empresaTrabalhoSoc
    ) {

        throw new Error(
            'Empresa de trabalho não informada para consultar responsável ambiental.'
        );
    }


    // ========================================================
    // UNIDADE
    // ========================================================

    const unidade =
        String(
            codigoUnidade ||
            ''
        ).trim();


    if (
        !unidade
    ) {

        return [];
    }


    // ========================================================
    // DATA DE REFERÊNCIA
    // ========================================================

    const dataReferenciaIso =
        converterDataSocParaIsoS2240(
            dataReferencia
        );


    if (
        !dataReferenciaIso
    ) {

        throw new Error(
            'Data de referência inválida para consultar responsável ambiental.'
        );
    }


    // ========================================================
    // EXTRAÇÃO RESPONSÁVEIS PPRA
    // ========================================================

    const extracao =
        obterExtracao(
            'responsaveis_ppra'
        );


    // ========================================================
    // PESSOAS / USUÁRIOS
    //
    // Fonte usada para localizar principalmente o CPF.
    // Se já veio do cache, não consulta novamente.
    // ========================================================

    const pessoas =
        Array.isArray(
            pessoasSoc
        )
            ? pessoasSoc
            : await consultarPessoasUsuariosSoc();


    // ========================================================
    // DATA DE REFERÊNCIA COMO DATE
    // ========================================================

    const dataRef =
        new Date(
            `${dataReferenciaIso}T12:00:00Z`
        );


    if (
        Number.isNaN(
            dataRef.getTime()
        )
    ) {

        throw new Error(
            `Data de referência inválida para responsável ambiental: ${dataReferenciaIso}.`
        );
    }


    // ========================================================
    // BUSCA RETROATIVA
    //
    // O relatório RESPONSAVEIS_PPRA trabalha pela DATAINICIO
    // do vínculo do responsável.
    //
    // Exemplo:
    //
    // trabalhador inicia condição em 2026,
    // mas responsável iniciou em 2025 e continua vigente.
    //
    // Portanto precisamos procurar para trás até encontrar
    // o registro da unidade cuja vigência cubra a data do
    // S-2240.
    // ========================================================

    for (
        let mesesAtras = 0;
        mesesAtras < 60;
        mesesAtras++
    ) {

        // ----------------------------------------------------
        // CALCULAR MÊS CONSULTADO
        // ----------------------------------------------------

        const inicioMes =
            new Date(
                Date.UTC(
                    dataRef.getUTCFullYear(),
                    dataRef.getUTCMonth() -
                        mesesAtras,
                    1,
                    12,
                    0,
                    0
                )
            );


        const fimMes =
            new Date(
                Date.UTC(
                    inicioMes
                        .getUTCFullYear(),
                    inicioMes
                        .getUTCMonth() +
                        1,
                    0,
                    12,
                    0,
                    0
                )
            );


        /*
         * No mês correspondente à própria data de referência,
         * não consulta datas posteriores ao evento.
         */
        if (
            fimMes >
            dataRef
        ) {

            fimMes.setTime(
                dataRef.getTime()
            );
        }


        const dataInicioConsulta =
            inicioMes
                .toISOString()
                .substring(
                    0,
                    10
                );


        const dataFimConsulta =
            fimMes
                .toISOString()
                .substring(
                    0,
                    10
                );


        // ====================================================
        // CONSULTAR SOC
        //
        // IMPORTANTE:
        //
        // empresa = empresa principal/prestadora configurada
        //
        // empresaTrabalho = empresa do evento do funcionário
        //
        // NÃO usamos SOC_CONFIG.empresaPrincipal nos dois.
        // ====================================================

        const retorno =
            await exportarDadosSoc({

                codigo:
                    extracao.codigo,

                chave:
                    extracao.chave,

                empresa:
                    SOC_CONFIG
                        .empresaPrincipal,

                empresaTrabalho:
                    empresaTrabalhoSoc,

                filtros: {

                    dataInicio:
                        converterDataParaSoc(
                            dataInicioConsulta
                        ),

                    dataFim:
                        converterDataParaSoc(
                            dataFimConsulta
                        )
                }
            });


        // ====================================================
        // NORMALIZAR RETORNO
        // ====================================================

        const registros =
            localizarArray(
                retorno
            );


        if (
            !Array.isArray(
                registros
            ) ||
            registros.length ===
                0
        ) {

            continue;
        }


        // ====================================================
        // FILTRAR PELA UNIDADE
        //
        // Não dependemos do filtro "unidade" do Exporta Dados.
        // Filtramos localmente depois que o SOC responde.
        // ====================================================

        const registrosUnidade =
            registros.filter(
                item =>
                    String(
                        item?.CODIGOUNIDADE ||
                        item?.codigoUnidade ||
                        ''
                    ).trim() ===
                    unidade
            );


        if (
            registrosUnidade.length ===
            0
        ) {

            continue;
        }


        // ====================================================
        // VERIFICAR VIGÊNCIA
        // ====================================================

        const vigentes =
            registrosUnidade.filter(
                item => {

                    const inicio =
                        converterDataSocParaIsoS2240(
                            item?.DATAINICIO ||
                            item?.dataInicio
                        );


                    const fim =
                        converterDataSocParaIsoS2240(
                            item?.DATAFIM ||
                            item?.dataFim
                        );


                    // ----------------------------------------
                    // Sem início não dá para validar vigência.
                    // ----------------------------------------

                    if (
                        !inicio
                    ) {

                        return false;
                    }


                    // ----------------------------------------
                    // Responsável começou depois da condição.
                    // ----------------------------------------

                    if (
                        inicio >
                        dataReferenciaIso
                    ) {

                        return false;
                    }


                    // ----------------------------------------
                    // Responsável já havia encerrado.
                    // ----------------------------------------

                    if (
                        fim &&
                        fim <
                        dataReferenciaIso
                    ) {

                        return false;
                    }


                    return true;
                }
            );


        if (
            vigentes.length ===
            0
        ) {

            continue;
        }


        // ====================================================
        // CRUZAR RESPONSÁVEL PPRA COM PESSOAS_USUARIOS
        //
        // PPRA:
        // - nome
        // - e-mail
        // - conselho
        // - número
        // - UF
        //
        // PESSOAS_USUARIOS:
        // - CPF
        // ====================================================

        const normalizados =
            vigentes.map(
                responsavelPpra => {

                    const pessoaSoc =
                        localizarPessoaResponsavelSoc(
                            responsavelPpra,
                            pessoas
                        );


                    return normalizarResponsavelAmbientalS2240(
                        responsavelPpra,
                        pessoaSoc
                    );
                }
            );


        // ====================================================
        // REMOVER REGISTROS TOTALMENTE VAZIOS
        // ====================================================

        const responsaveisValidos =
            normalizados.filter(
                responsavel =>
                    responsavel &&
                    (
                        responsavel.cpfResp ||
                        responsavel.nrOC ||
                        responsavel.nome
                    )
            );


        // ====================================================
        // REMOVER DUPLICIDADES
        //
        // Um mesmo responsável pode aparecer repetido no SOC.
        // ====================================================

        const mapa =
            new Map();


        for (
            const responsavel
            of responsaveisValidos
        ) {

            const chave =
                [
                    responsavel.cpfResp,
                    responsavel.ideOC,
                    responsavel.dscOC,
                    responsavel.nrOC,
                    responsavel.ufOC
                ]
                    .map(
                        valor =>
                            String(
                                valor ||
                                ''
                            ).trim()
                    )
                    .join(
                        '|'
                    );


            if (
                !mapa.has(
                    chave
                )
            ) {

                mapa.set(
                    chave,
                    responsavel
                );
            }
        }


        const resultado =
            Array.from(
                mapa.values()
            );


        // ====================================================
        // ENCONTROU RESPONSÁVEL VIGENTE
        // ====================================================

        if (
            resultado.length >
            0
        ) {

            console.log(
                `✅ Responsável ambiental encontrado | ` +
                `empresa trabalho ${empresaTrabalhoSoc} | ` +
                `unidade ${unidade} | ` +
                `referência ${dataReferenciaIso} | ` +
                `${resultado.length} responsável(is).`
            );


            return resultado;
        }
    }


    // ========================================================
    // NENHUM RESPONSÁVEL ENCONTRADO
    // ========================================================

    console.warn(
        `⚠️ Nenhum responsável ambiental encontrado | ` +
        `empresa trabalho ${empresaTrabalhoSoc} | ` +
        `unidade ${unidade} | ` +
        `referência ${dataReferenciaIso}.`
    );


    return [];
}

async function aplicarRegraEventosEsocial(
    eventos2220
) {

    if (
        !Array.isArray(
            eventos2220
        ) ||
        eventos2220.length === 0
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


    // ============================================================
    // CACHES
    // ============================================================

    /*
     * 1875:
     * evita consultar riscos novamente para
     * o mesmo funcionário.
     */
    const cacheRiscos =
        new Map();


    /*
     * 11573:
     * uma única consulta retorna as hierarquias
     * da empresa inteira.
     */
    const cacheHierarquiasEmpresa =
        new Map();


    /*
     * 219968:
     * completa posição, matrícula e admissão do funcionário.
     */
    const cacheFuncionarioCpf =
        new Map();


    /*
     * 7541:
     * evita consultar duas vezes a mesma
     * empresa + GHE.
     */
    const cacheCaracteristicasGhe =
        new Map();


    /*
     * 219605:
     * evita consultar novamente a mesma
     * empresa + unidade + GHE.
     */
    const cacheCaracteristicas219605 =
        new Map();


    /*
     * Pessoas / usuários:
     * usado para localizar CPF do responsável ambiental.
     */
    let cachePessoasUsuariosSoc =
        null;


    /*
     * Responsável ambiental:
     *
     * IMPORTANTE:
     * agora a empresa de trabalho também participa
     * da chave do cache.
     */
    const cacheResponsaveisAmbientaisS2240 =
        new Map();


    // ============================================================
    // PROCESSAR EVENTOS
    // ============================================================

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


        // ========================================================
        // S-2220 SEMPRE
        // ========================================================

        resultado.push({

            ...eventoOriginal,

            tipoEvento:
                'S-2220'
        });


        // ========================================================
        // VERIFICA SE PRECISA CRIAR CANDIDATO S-2240
        // ========================================================

        const precisaS2240 =
            tpExameOcup === '0' ||
            tpExameOcup === '3';


        if (
            !precisaS2240
        ) {

            continue;
        }


        // ========================================================
        // IDENTIFICAÇÃO
        // ========================================================

        const codigoEmpresa =
            String(
                eventoOriginal
                    .codigoEmpresa ||

                eventoOriginal
                    .codigo_empresa ||

                ''
            ).trim();


        const codigoFuncionario =
            String(
                eventoOriginal
                    .codigoFuncionario ||

                eventoOriginal
                    .codigo_funcionario ||

                ''
            ).trim();


        const chaveCacheFuncionario =
            `${codigoEmpresa}|${codigoFuncionario}`;


        // ========================================================
        // CADASTRO DO FUNCIONÁRIO - EXPORTA DADOS 219968
        // ========================================================

        let funcionarioCadastro =
            null;


        try {

            const cpfFuncionario =
                normalizarCpf(
                    eventoOriginal.cpf ||
                    eventoOriginal.cpf_funcionario ||
                    ''
                );


            if (cpfFuncionario) {

                if (
                    cacheFuncionarioCpf.has(
                        cpfFuncionario
                    )
                ) {

                    funcionarioCadastro =
                        cacheFuncionarioCpf.get(
                            cpfFuncionario
                        );

                } else {

                    funcionarioCadastro =
                        await consultarFuncionarioCpf219968(
                            eventoOriginal
                        );


                    cacheFuncionarioCpf.set(
                        cpfFuncionario,
                        funcionarioCadastro
                    );
                }
            }


            if (funcionarioCadastro) {

                eventoOriginal.codigoUnidade =
                    eventoOriginal.codigoUnidade ||
                    eventoOriginal.codigo_unidade ||
                    funcionarioCadastro.codigoUnidade ||
                    '';

                eventoOriginal.codigo_unidade =
                    eventoOriginal.codigo_unidade ||
                    eventoOriginal.codigoUnidade ||
                    '';

                eventoOriginal.unidade =
                    eventoOriginal.unidade ||
                    funcionarioCadastro.nomeUnidade ||
                    '';

                eventoOriginal.matricula =
                    eventoOriginal.matricula ||
                    funcionarioCadastro.matricula ||
                    '';

                eventoOriginal.dataAdmissao =
                    eventoOriginal.dataAdmissao ||
                    eventoOriginal.data_admissao ||
                    funcionarioCadastro.dataAdmissao ||
                    '';

                eventoOriginal.data_admissao =
                    eventoOriginal.data_admissao ||
                    eventoOriginal.dataAdmissao ||
                    '';
            }

        } catch (error) {

            console.warn(
                `⚠️ 219968 - Não foi possível completar o cadastro de ` +
                `${eventoOriginal.colaborador || codigoFuncionario}:`,
                error?.message || error
            );
        }


        // ========================================================
        // VARIÁVEIS DO 1875
        // ========================================================

        let riscosFuncionario =
            [];


        let agentesNocivos =
            [];


        let consultaRiscosOk =
            false;


        let erroConsultaRiscos =
            '';


        // ========================================================
        // VARIÁVEIS DO 11573
        // ========================================================

        let hierarquiasEmpresa =
            [];


        let ghesAplicaveis =
            [];


        let consultaHierarquiasOk =
            false;


        let erroConsultaHierarquias =
            '';


        // ========================================================
        // VARIÁVEIS DO 7541
        // ========================================================

        let caracteristicasGhe =
            [];


        let caracteristicasRiscosFuncionario =
            [];


        let consultaCaracteristicasOk =
            false;


        let erroConsultaCaracteristicas =
            '';


        // ========================================================
        // VARIÁVEIS DO 219605
        // ========================================================

        let caracteristicasTecnicas219605 =
            [];


        let consultaCaracteristicas219605Ok =
            false;


        let erroConsultaCaracteristicas219605 =
            '';


        // ========================================================
        // 1. CONSULTA 1875
        // ========================================================

        try {

            if (
                cacheRiscos.has(
                    chaveCacheFuncionario
                )
            ) {

                riscosFuncionario =
                    cacheRiscos.get(
                        chaveCacheFuncionario
                    );

            } else {

                riscosFuncionario =
                    await consultarRiscosFuncionario1875(
                        eventoOriginal
                    );


                cacheRiscos.set(
                    chaveCacheFuncionario,
                    riscosFuncionario
                );
            }


            /*
             * Continua usando a lógica existente para:
             *
             * - APLICAESOCIAL
             * - CODIGOAGENTENOCIVO
             * - 05.01.001
             * - 09.01.001
             */
            agentesNocivos =
                montarAgentesNocivosEsocial1875(
                    riscosFuncionario
                );


            await salvarRiscosFuncionario1875(
                eventoOriginal,
                riscosFuncionario
            );


            consultaRiscosOk =
                true;


            console.log(
                `✅ 1875: ` +
                `${eventoOriginal.colaborador || codigoFuncionario} | ` +
                `${riscosFuncionario.length} risco(s) | ` +
                `${agentesNocivos.length} agente(s) eSocial.`
            );

        } catch (
            error
        ) {

            erroConsultaRiscos =
                error?.message ||
                String(
                    error
                );


            console.error(
                `❌ 1875 - Não foi possível consultar riscos para ` +
                `${eventoOriginal.colaborador || codigoFuncionario}:`,
                erroConsultaRiscos
            );
        }


        // ========================================================
        // 2. CONSULTA 11573
        // ========================================================

        if (
            codigoEmpresa &&
            codigoFuncionario
        ) {

            try {

                if (
                    cacheHierarquiasEmpresa.has(
                        codigoEmpresa
                    )
                ) {

                    hierarquiasEmpresa =
                        cacheHierarquiasEmpresa.get(
                            codigoEmpresa
                        );

                } else {

                    hierarquiasEmpresa =
                        await consultarHierarquiasGhe11573(
                            codigoEmpresa
                        );


                    cacheHierarquiasEmpresa.set(
                        codigoEmpresa,
                        hierarquiasEmpresa
                    );
                }


                ghesAplicaveis =
                    determinarGhesAplicaveisFuncionario11573(
                        eventoOriginal,
                        hierarquiasEmpresa,
                        funcionarioCadastro
                    );


                consultaHierarquiasOk =
                    true;


                console.log(
                    `✅ 11573: ` +
                    `${eventoOriginal.colaborador || codigoFuncionario} | ` +
                    `${ghesAplicaveis.length} GHE(s) aplicável(is): ` +
                    `${ghesAplicaveis
                        .map(
                            item =>
                                item.codigoGhe
                        )
                        .join(', ') || 'nenhum'}`
                );

            } catch (
                error
            ) {

                erroConsultaHierarquias =
                    error?.message ||
                    String(
                        error
                    );


                console.error(
                    `❌ 11573 - Não foi possível determinar os GHEs de ` +
                    `${eventoOriginal.colaborador || codigoFuncionario}:`,
                    erroConsultaHierarquias
                );
            }
        }


        // ========================================================
        // 3. CONSULTA 7541 PARA CADA GHE APLICÁVEL
        // ========================================================

        if (
            ghesAplicaveis.length >
            0
        ) {

            try {

                const acumulado =
                    [];


                for (
                    const ghe
                    of ghesAplicaveis
                ) {

                    const codigoGhe =
                        String(
                            ghe.codigoGhe ||
                            ''
                        ).trim();


                    if (
                        !codigoGhe
                    ) {

                        continue;
                    }


                    const chaveCacheGhe =
                        `${codigoEmpresa}|${codigoGhe}`;


                    let registrosGhe =
                        [];


                    if (
                        cacheCaracteristicasGhe.has(
                            chaveCacheGhe
                        )
                    ) {

                        registrosGhe =
                            cacheCaracteristicasGhe.get(
                                chaveCacheGhe
                            );

                    } else {

                        registrosGhe =
                            await consultarCaracteristicasRiscoGhe7541(
                                codigoEmpresa,
                                codigoGhe
                            );


                        cacheCaracteristicasGhe.set(
                            chaveCacheGhe,
                            registrosGhe
                        );
                    }


                    for (
                        const caracteristica
                        of registrosGhe
                    ) {

                        acumulado.push({

                            ...caracteristica,

                            gheAplicacao: {

                                codigoGhe:
                                    ghe.codigoGhe,

                                nomeGhe:
                                    ghe.nomeGhe,

                                origemAplicacao:
                                    ghe.origemAplicacao,

                                codigoUnidade:
                                    ghe.codigoUnidade,

                                codigoSetor:
                                    ghe.codigoSetor,

                                codigoCargo:
                                    ghe.codigoCargo,

                                codigoFuncionario:
                                    ghe.codigoFuncionario,

                                dataInicial:
                                    ghe.dataInicial,

                                dataFinal:
                                    ghe.dataFinal
                            }
                        });
                    }
                }


                caracteristicasGhe =
                    acumulado;


                consultaCaracteristicasOk =
                    true;


                console.log(
                    `✅ 7541: ` +
                    `${eventoOriginal.colaborador || codigoFuncionario} | ` +
                    `${caracteristicasGhe.length} característica(s) encontrada(s) ` +
                    `nos GHEs aplicáveis.`
                );

            } catch (
                error
            ) {

                erroConsultaCaracteristicas =
                    error?.message ||
                    String(
                        error
                    );


                console.error(
                    `❌ 7541 - Não foi possível consultar características de risco de ` +
                    `${eventoOriginal.colaborador || codigoFuncionario}:`,
                    erroConsultaCaracteristicas
                );
            }
        }


        // ========================================================
        // 3.1 CONSULTA 219605 PARA CADA GHE APLICÁVEL
        // ========================================================

        if (
            ghesAplicaveis.length >
            0
        ) {

            try {

                const acumulado219605 =
                    [];


                for (
                    const ghe
                    of ghesAplicaveis
                ) {

                    const codigoGhe =
                        String(
                            ghe.codigoGhe ||
                            ''
                        ).trim();


                    const codigoUnidade =
                        String(
                            ghe.codigoUnidade ||

                            eventoOriginal.codigoUnidade ||

                            eventoOriginal.codigo_unidade ||

                            ''
                        ).trim();


                    if (
                        !codigoGhe ||
                        !codigoUnidade
                    ) {

                        continue;
                    }


                    const chaveCache219605 =
                        `${codigoEmpresa}|${codigoUnidade}|${codigoGhe}`;


                    let registros219605 =
                        [];


                    if (
                        cacheCaracteristicas219605.has(
                            chaveCache219605
                        )
                    ) {

                        registros219605 =
                            cacheCaracteristicas219605.get(
                                chaveCache219605
                            );

                    } else {

                        registros219605 =
                            await consultarCaracteristicasRiscoGhe219605(
                                codigoEmpresa,
                                codigoUnidade,
                                codigoGhe
                            );


                        cacheCaracteristicas219605.set(
                            chaveCache219605,
                            registros219605
                        );
                    }


                    for (
                        const registro219605
                        of registros219605
                    ) {

                        acumulado219605.push({

                            ...registro219605,

                            gheAplicacao: {

                                codigoGhe:
                                    ghe.codigoGhe,

                                nomeGhe:
                                    ghe.nomeGhe,

                                origemAplicacao:
                                    ghe.origemAplicacao,

                                codigoUnidade:
                                    ghe.codigoUnidade,

                                codigoSetor:
                                    ghe.codigoSetor,

                                codigoCargo:
                                    ghe.codigoCargo,

                                codigoFuncionario:
                                    ghe.codigoFuncionario,

                                dataInicial:
                                    ghe.dataInicial,

                                dataFinal:
                                    ghe.dataFinal
                            }
                        });
                    }
                }


                caracteristicasTecnicas219605 =
                    acumulado219605;


                consultaCaracteristicas219605Ok =
                    true;


                console.log(
                    `✅ 219605: ` +
                    `${eventoOriginal.colaborador || codigoFuncionario} | ` +
                    `${caracteristicasTecnicas219605.length} caracterização(ões) técnica(s) encontrada(s).`
                );

            } catch (
                error
            ) {

                erroConsultaCaracteristicas219605 =
                    error?.message ||
                    String(
                        error
                    );


                console.error(
                    `❌ 219605 - Não foi possível consultar caracterização técnica de ` +
                    `${eventoOriginal.colaborador || codigoFuncionario}:`,
                    erroConsultaCaracteristicas219605
                );
            }
        }


        // ========================================================
        // 4. CRUZA 1875 X 11573 X 7541
        // ========================================================

        const mapaRiscosFuncionario =
            new Map();


        for (
            const risco
            of riscosFuncionario
        ) {

            const codRisco =
                String(
                    risco?.codRisco ||

                    risco?.codigoRisco ||

                    risco?.CODRISCO ||

                    ''
                ).trim();


            if (
                !codRisco
            ) {

                continue;
            }


            mapaRiscosFuncionario.set(
                codRisco,
                risco
            );
        }


        caracteristicasRiscosFuncionario =
            caracteristicasGhe
                .filter(
                    caracteristica =>
                        mapaRiscosFuncionario.has(
                            String(
                                caracteristica.codRisco
                            )
                        )
                )
                .map(
                    caracteristica => {

                        const risco1875 =
                            mapaRiscosFuncionario.get(
                                String(
                                    caracteristica.codRisco
                                )
                            );


                        const codigoAgente1875 =
                            String(
                                risco1875
                                    ?.codigoAgenteNocivo ||
                                ''
                            ).trim();


                        const codigoAgente7541 =
                            String(
                                caracteristica
                                    ?.codigoAgenteNocivo ||
                                ''
                            ).trim();


                        let validacaoCodigoAgente =
                            'sem_codigo';


                        if (
                            codigoAgente1875 &&
                            codigoAgente7541
                        ) {

                            validacaoCodigoAgente =
                                codigoAgente1875 ===
                                codigoAgente7541
                                    ? 'confere'
                                    : 'divergente';

                        } else if (
                            codigoAgente1875 &&
                            !codigoAgente7541
                        ) {

                            validacaoCodigoAgente =
                                'somente_1875';

                        } else if (
                            !codigoAgente1875 &&
                            codigoAgente7541
                        ) {

                            validacaoCodigoAgente =
                                'somente_7541';
                        }


                        return {

                            ...caracteristica,

                            aplicaEsocial1875:
                                risco1875
                                    ?.aplicaEsocial ===
                                true,

                            codigoAgenteNocivo1875:
                                codigoAgente1875,

                            codigoAgenteNocivo7541:
                                codigoAgente7541,

                            validacaoCodigoAgente,

                            riscoFuncionario1875:
                                risco1875
                        };
                    }
                );


        // ========================================================
        // 5. IDENTIFICA RISCOS SEM CARACTERÍSTICA TÉCNICA
        // ========================================================

        const codigosComCaracteristica =
            new Set(
                caracteristicasRiscosFuncionario
                    .map(
                        item =>
                            String(
                                item.codRisco
                            )
                    )
            );


        const riscosSemCaracteristicaGhe =
            riscosFuncionario.filter(
                risco => {

                    const codRisco =
                        String(
                            risco?.codRisco ||

                            risco?.codigoRisco ||

                            risco?.CODRISCO ||

                            ''
                        ).trim();


                    return (
                        codRisco &&
                        !codigosComCaracteristica.has(
                            codRisco
                        )
                    );
                }
            );


        // ========================================================
        // 6. PROCURA DIVERGÊNCIAS ENTRE 1875 E 7541
        // ========================================================

        const divergenciasAgente =
            caracteristicasRiscosFuncionario
                .filter(
                    item =>
                        item.validacaoCodigoAgente ===
                        'divergente'
                );


        if (
            divergenciasAgente.length >
            0
        ) {

            console.warn(
                `⚠️ Divergência 1875 x 7541 para ` +
                `${eventoOriginal.colaborador || codigoFuncionario}:`,

                divergenciasAgente.map(
                    item => ({

                        codRisco:
                            item.codRisco,

                        agente1875:
                            item.codigoAgenteNocivo1875,

                        agente7541:
                            item.codigoAgenteNocivo7541,

                        ghe:
                            item.codigoGhe
                    })
                )
            );
        }


        // ========================================================
        // 7. CRUZA AGENTE x 7541 x 219605
        // ========================================================

        const normalizarNomeRiscoS2240 =
            valor =>

                String(
                    valor ||
                    ''
                )
                    .normalize(
                        'NFD'
                    )
                    .replace(
                        /[\u0300-\u036f]/g,
                        ''
                    )
                    .toUpperCase()
                    .replace(
                        /[^A-Z0-9]+/g,
                        ' '
                    )
                    .replace(
                        /\s+/g,
                        ' '
                    )
                    .trim();


        // ========================================================
        // LOCALIZAR CARACTERIZAÇÃO 219605
        // ========================================================

        const localizarTecnica219605 =
            caracteristica7541 => {

                const codigoGhe7541 =
                    String(
                        caracteristica7541
                            ?.gheAplicacao
                            ?.codigoGhe ||

                        caracteristica7541
                            ?.codigoGhe ||

                        ''
                    ).trim();


                const nomeRisco7541 =
                    normalizarNomeRiscoS2240(
                        caracteristica7541
                            ?.nomeRisco
                    );


                if (
                    !codigoGhe7541 ||
                    !nomeRisco7541
                ) {

                    return null;
                }


                // ------------------------------------------------
                // PRIMEIRO: CORRESPONDÊNCIA EXATA
                // ------------------------------------------------

                const exata =
                    caracteristicasTecnicas219605.find(
                        tecnica => {

                            const mesmoGhe =
                                String(
                                    tecnica?.codigoGhe ||

                                    tecnica
                                        ?.gheAplicacao
                                        ?.codigoGhe ||

                                    ''
                                ).trim() ===
                                codigoGhe7541;


                            if (
                                !mesmoGhe
                            ) {

                                return false;
                            }


                            const nomeTecnica =
                                normalizarNomeRiscoS2240(

                                    tecnica?.perigoFatorRisco ||

                                    tecnica?.perigoFatorRiscoNormalizado ||

                                    ''
                                );


                            return (
                                nomeTecnica ===
                                nomeRisco7541
                            );
                        }
                    );


                if (
                    exata
                ) {

                    return exata;
                }


                // ------------------------------------------------
                // FALLBACK PARA PEQUENA DIFERENÇA DE TEXTO
                // ------------------------------------------------

                const candidatos =
                    caracteristicasTecnicas219605
                        .filter(
                            tecnica => {

                                const mesmoGhe =
                                    String(
                                        tecnica?.codigoGhe ||

                                        tecnica
                                            ?.gheAplicacao
                                            ?.codigoGhe ||

                                        ''
                                    ).trim() ===
                                    codigoGhe7541;


                                if (
                                    !mesmoGhe
                                ) {

                                    return false;
                                }


                                const nomeTecnica =
                                    normalizarNomeRiscoS2240(

                                        tecnica?.perigoFatorRisco ||

                                        tecnica?.perigoFatorRiscoNormalizado ||

                                        ''
                                    );


                                if (
                                    !nomeTecnica ||
                                    nomeTecnica.length < 10 ||
                                    nomeRisco7541.length < 10
                                ) {

                                    return false;
                                }


                                return (
                                    nomeTecnica.includes(
                                        nomeRisco7541
                                    ) ||

                                    nomeRisco7541.includes(
                                        nomeTecnica
                                    )
                                );
                            }
                        );


                return (
                    candidatos.length ===
                    1
                )
                    ? candidatos[0]
                    : null;
            };


        // ========================================================
        // AGREGAÇÃO EPC/EPI POR AGENTE
        // ========================================================

        const agregarUtilizacao =
            valores => {

                const lista =
                    valores
                        .map(
                            valor =>
                                String(
                                    valor ||
                                    ''
                                ).trim()
                        )
                        .filter(
                            Boolean
                        );


                if (
                    lista.includes(
                        '2'
                    )
                ) {

                    return '2';
                }


                if (
                    lista.includes(
                        '1'
                    )
                ) {

                    return '1';
                }


                if (
                    lista.includes(
                        '0'
                    )
                ) {

                    return '0';
                }


                return '';
            };


        const agregarEficacia =
            (
                registros,
                campoUtilizacao,
                campoEficacia
            ) => {

                const aplicaveis =
                    registros.filter(
                        registro =>
                            String(
                                registro?.[
                                    campoUtilizacao
                                ] ||
                                ''
                            ) ===
                            '2'
                    );


                if (
                    aplicaveis.length ===
                    0
                ) {

                    return '';
                }


                const eficacias =
                    aplicaveis
                        .map(
                            registro =>
                                String(
                                    registro?.[
                                        campoEficacia
                                    ] ||
                                    ''
                                )
                                    .trim()
                                    .toUpperCase()
                        )
                        .filter(
                            Boolean
                        );


                if (
                    eficacias.includes(
                        'N'
                    )
                ) {

                    return 'N';
                }


                if (
                    eficacias.includes(
                        'S'
                    )
                ) {

                    return 'S';
                }


                return '';
            };


        // ========================================================
        // AGENTES DETALHADOS
        // ========================================================

        const agentesNocivosDetalhados =
            agentesNocivos.flatMap(
                agente => {

                    const codigoAgente =
                        String(
                            agente?.codigoAgenteNocivo ||

                            agente?.codigo ||

                            agente?.codAgNoc ||

                            ''
                        ).trim();


                    const riscosOriginais =
                        Array.isArray(
                            agente?.riscos
                        )
                            ? agente.riscos
                            : [];


                    // ====================================================
                    // CARACTERÍSTICAS 7541 DO AGENTE
                    // ====================================================

                    const caracteristicas =
                        caracteristicasRiscosFuncionario
                            .filter(
                                item => {

                                    if (
                                        item.aplicaEsocial1875 !==
                                        true
                                    ) {

                                        return false;
                                    }


                                    return (
                                        String(
                                            item
                                                .codigoAgenteNocivo1875 ||
                                            ''
                                        ).trim() ===
                                        codigoAgente
                                    );
                                }
                            );


                    // ====================================================
                    // MONTA UM AGENTE DETALHADO
                    // ====================================================

                    const montarDetalhado =
                        (
                            caracteristicasSelecionadas,
                            riscosSelecionados,
                            dscAgNoc = ''
                        ) => {

                            // ============================================
                            // CRUZA 7541 x 219605
                            // ============================================

                            const caracteristicasEnriquecidas =
                                caracteristicasSelecionadas.map(
                                    caracteristica => {

                                        const tecnica219605 =
                                            localizarTecnica219605(
                                                caracteristica
                                            );


                                        return {

                                            ...caracteristica,

                                            caracteristicaTecnica219605:
                                                tecnica219605
                                        };
                                    }
                                );


                            const tecnicasRelacionadas =
                                caracteristicasEnriquecidas
                                    .map(
                                        item =>
                                            item
                                                .caracteristicaTecnica219605
                                    )
                                    .filter(
                                        Boolean
                                    );


                            // ============================================
                            // EPC
                            // ============================================

                            const utilizEPC =
                                agregarUtilizacao(
                                    tecnicasRelacionadas.map(
                                        item =>
                                            item.utilizaEPC
                                    )
                                );


                            const eficEpc =
                                agregarEficacia(
                                    tecnicasRelacionadas,
                                    'utilizaEPC',
                                    'eficEpc'
                                );


                            // ============================================
                            // EPI
                            // ============================================

                            const utilizEPI =
                                agregarUtilizacao(
                                    tecnicasRelacionadas.map(
                                        item =>
                                            item.utilizaEPI
                                    )
                                );


                            const eficEpi =
                                agregarEficacia(
                                    tecnicasRelacionadas,
                                    'utilizaEPI',
                                    'eficEpi'
                                );


                            // ============================================
                            // CA / DOCUMENTOS EPI
                            // ============================================

                            const documentosEpi =
                                Array.from(
                                    new Set(

                                        tecnicasRelacionadas
                                            .flatMap(
                                                item =>

                                                    String(
                                                        item.caEpi ||
                                                        ''
                                                    )
                                                        .split(
                                                            ','
                                                        )
                                                        .map(
                                                            valor =>
                                                                valor.trim()
                                                        )
                                                        .filter(
                                                            Boolean
                                                        )
                                            )
                                    )
                                );


                            return {

                                ...agente,

                                /*
                                 * Cada agente detalhado carrega
                                 * somente os riscos pertencentes
                                 * àquela entrada.
                                 */
                                riscos:
                                    riscosSelecionados,


                                /*
                                 * 05.01.001 é código genérico.
                                 * Cada entrada recebe sua
                                 * descrição específica.
                                 */
                                ...(
                                    dscAgNoc
                                        ? {
                                            dscAgNoc:
                                                dscAgNoc
                                        }
                                        : {}
                                ),


                                // ----------------------------------------
                                // 7541 + 219605
                                // ----------------------------------------

                                caracteristicasGhe:
                                    caracteristicasEnriquecidas,

                                caracteristicasTecnicas219605:
                                    tecnicasRelacionadas,


                                // ----------------------------------------
                                // CAMPOS S-2240
                                // ----------------------------------------

                                utilizEPC,

                                eficEpc,

                                utilizEPI,

                                eficEpi,

                                documentosEpi,

                                caEpi:
                                    documentosEpi.join(
                                        ', '
                                    ),

                                cruzamento219605Ok:
                                    tecnicasRelacionadas.length >
                                    0
                            };
                        };


                    // ====================================================
                    // 05.01.001
                    //
                    // NÃO AGRUPA RISCOS DIFERENTES EM UMA ÚNICA
                    // DESCRIÇÃO.
                    //
                    // Cria uma entrada para cada risco.
                    // ====================================================

                    if (
                        codigoAgente ===
                        '05.01.001'
                    ) {

                        // --------------------------------------------
                        // SITUAÇÃO NORMAL:
                        // TEMOS OS RISCOS DO 1875
                        // --------------------------------------------

                        if (
                            riscosOriginais.length >
                            0
                        ) {

                            return riscosOriginais.map(
                                risco => {

                                    const codRisco =
                                        String(
                                            risco?.codRisco ||
                                            ''
                                        ).trim();


                                    const nomeRisco =
                                        String(
                                            risco?.risco ||

                                            risco?.nomeRisco ||

                                            ''
                                        ).trim();


                                    const nomeRiscoNormalizado =
                                        normalizarNomeRiscoS2240(
                                            nomeRisco
                                        );


                                    // ====================================
                                    // PROCURA 7541 DO MESMO RISCO
                                    // ====================================

                                    let caracteristicasDoRisco =
                                        caracteristicas.filter(
                                            item =>

                                                codRisco &&

                                                String(
                                                    item?.codRisco ||
                                                    ''
                                                ).trim() ===
                                                codRisco
                                        );


                                    // ====================================
                                    // FALLBACK PELO NOME
                                    // ====================================

                                    if (
                                        caracteristicasDoRisco.length ===
                                            0 &&
                                        nomeRiscoNormalizado
                                    ) {

                                        caracteristicasDoRisco =
                                            caracteristicas.filter(
                                                item =>

                                                    normalizarNomeRiscoS2240(
                                                        item?.nomeRisco ||
                                                        ''
                                                    ) ===
                                                    nomeRiscoNormalizado
                                            );
                                    }


                                    const descricaoAgente =
                                        nomeRisco ||

                                        String(
                                            caracteristicasDoRisco[0]
                                                ?.nomeRisco ||
                                            ''
                                        ).trim();


                                    return montarDetalhado(
                                        caracteristicasDoRisco,
                                        [
                                            risco
                                        ],
                                        descricaoAgente
                                    );
                                }
                            );
                        }


                        // --------------------------------------------
                        // FALLBACK:
                        // 1875 SEM ARRAY DE RISCOS
                        //
                        // SEPARA PELAS CARACTERÍSTICAS DA 7541.
                        // --------------------------------------------

                        return caracteristicas.map(
                            caracteristica => {

                                const descricaoAgente =
                                    String(
                                        caracteristica
                                            ?.nomeRisco ||
                                        ''
                                    ).trim();


                                return montarDetalhado(
                                    [
                                        caracteristica
                                    ],
                                    [],
                                    descricaoAgente
                                );
                            }
                        );
                    }


                    // ====================================================
                    // OUTROS AGENTES
                    //
                    // 03.01.001, por exemplo, continua agrupando
                    // os riscos biológicos.
                    // ====================================================

                    return [
                        montarDetalhado(
                            caracteristicas,
                            riscosOriginais
                        )
                    ];
                }
            );


        // ========================================================
        // 7.1 RESPONSÁVEL PELOS REGISTROS AMBIENTAIS
        // ========================================================

        let responsaveisAmbientaisSoc =
            [];


        let consultaResponsaveisAmbientaisOk =
            false;


        let erroConsultaResponsaveisAmbientais =
            '';


        // --------------------------------------------------------
        // GHE PRINCIPAL DO FUNCIONÁRIO
        // --------------------------------------------------------

        const ghePrincipalResponsavel =
            ghesAplicaveis.find(
                item =>
                    normalizarTextoComparacaoSoc(
                        item?.origemAplicacao
                    ) ===
                    'FUNCIONARIO'
            ) ||

            ghesAplicaveis[0] ||

            {};


        // --------------------------------------------------------
        // UNIDADE
        // --------------------------------------------------------

        const codigoUnidadeResponsavel =
            String(
                ghePrincipalResponsavel
                    ?.codigoUnidade ||

                eventoOriginal
                    ?.codigoUnidade ||

                eventoOriginal
                    ?.codigo_unidade ||

                ''
            ).trim();


        // --------------------------------------------------------
        // DATA DE REFERÊNCIA
        // --------------------------------------------------------

        const dataReferenciaResponsavel =
            String(
                ghePrincipalResponsavel
                    ?.dataInicial ||

                eventoOriginal
                    ?.dataAdmissao ||

                eventoOriginal
                    ?.data_admissao ||

                eventoOriginal
                    ?.dataAso ||

                eventoOriginal
                    ?.data_aso ||

                eventoOriginal
                    ?.dataExame ||

                eventoOriginal
                    ?.data_exame ||

                ''
            ).trim();


        try {

            if (
                !codigoEmpresa
            ) {

                throw new Error(
                    'Não foi possível identificar a empresa de trabalho para consultar o responsável ambiental.'
                );
            }


            if (
                !codigoUnidadeResponsavel
            ) {

                throw new Error(
                    'Não foi possível identificar a unidade para consultar o responsável ambiental.'
                );
            }


            if (
                !dataReferenciaResponsavel
            ) {

                throw new Error(
                    'Não foi possível identificar a data de referência do responsável ambiental.'
                );
            }


            // ----------------------------------------------------
            // PESSOAS / USUÁRIOS
            //
            // Carrega uma única vez por processamento.
            // ----------------------------------------------------

            if (
                !Array.isArray(
                    cachePessoasUsuariosSoc
                )
            ) {

                cachePessoasUsuariosSoc =
                    await consultarPessoasUsuariosSoc();
            }


            // ----------------------------------------------------
            // CACHE
            //
            // Agora inclui a EMPRESA DE TRABALHO.
            // ----------------------------------------------------

            const chaveCacheResponsavel =
                [
                    codigoEmpresa,
                    codigoUnidadeResponsavel,
                    dataReferenciaResponsavel
                ].join(
                    '|'
                );


            if (
                cacheResponsaveisAmbientaisS2240.has(
                    chaveCacheResponsavel
                )
            ) {

                responsaveisAmbientaisSoc =
                    cacheResponsaveisAmbientaisS2240.get(
                        chaveCacheResponsavel
                    );

            } else {

                /*
                 * ORDEM DOS ARGUMENTOS:
                 *
                 * 1. empresaTrabalho
                 * 2. codigoUnidade
                 * 3. dataReferencia
                 * 4. pessoasSoc
                 */
                responsaveisAmbientaisSoc =
                    await consultarResponsaveisAmbientaisS2240(
                        codigoEmpresa,
                        codigoUnidadeResponsavel,
                        dataReferenciaResponsavel,
                        cachePessoasUsuariosSoc
                    );


                cacheResponsaveisAmbientaisS2240.set(
                    chaveCacheResponsavel,
                    responsaveisAmbientaisSoc
                );
            }


            consultaResponsaveisAmbientaisOk =
                true;


            if (
                responsaveisAmbientaisSoc.length ===
                0
            ) {

                erroConsultaResponsaveisAmbientais =
                    `Nenhum responsável ambiental vigente encontrado ` +
                    `para a empresa ${codigoEmpresa}, ` +
                    `unidade ${codigoUnidadeResponsavel}, ` +
                    `na data ${dataReferenciaResponsavel}.`;


                console.warn(
                    '⚠️ S-2240:',
                    erroConsultaResponsaveisAmbientais
                );

            } else {

                console.log(
                    `✅ Responsável ambiental S-2240: ` +
                    `${eventoOriginal.colaborador || codigoFuncionario} | ` +
                    `empresa ${codigoEmpresa} | ` +
                    `unidade ${codigoUnidadeResponsavel} | ` +
                    `${responsaveisAmbientaisSoc.length} responsável(is).`
                );
            }

        } catch (
            error
        ) {

            consultaResponsaveisAmbientaisOk =
                false;


            erroConsultaResponsaveisAmbientais =
                error?.message ||
                String(
                    error
                );


            console.error(
                `❌ Responsável ambiental S-2240 - ` +
                `${eventoOriginal.colaborador || codigoFuncionario}:`,
                erroConsultaResponsaveisAmbientais
            );
        }


        // ========================================================
        // 8. CRIA EVENTO S-2240
        // ========================================================

        const ghePrincipalS2240 =
            ghesAplicaveis.find(
                item =>
                    normalizarTextoComparacaoSoc(
                        item?.origemAplicacao
                    ) === 'FUNCIONARIO'
            ) ||
            ghesAplicaveis[0] ||
            {};


        const dataInicioCondicaoS2240 =
            String(
                eventoOriginal.dataInicioCondicao ||
                eventoOriginal.data_inicio_condicao ||
                ghePrincipalS2240.dataInicial ||
                funcionarioCadastro?.dataAdmissao ||
                eventoOriginal.dataAdmissao ||
                eventoOriginal.data_admissao ||
                ''
            ).trim();

        resultado.push({

            ...eventoOriginal,

            tipoEvento:
                'S-2240',

            status:
                'pendente',

            numeroRecibo:
                '',

            geradoPorRegra2240:
                true,

            codigoUnidade:
                eventoOriginal.codigoUnidade ||
                funcionarioCadastro?.codigoUnidade ||
                '',

            matricula:
                eventoOriginal.matricula ||
                funcionarioCadastro?.matricula ||
                '',

            dataAdmissao:
                eventoOriginal.dataAdmissao ||
                funcionarioCadastro?.dataAdmissao ||
                '',

            dataInicioCondicao:
                dataInicioCondicaoS2240,

            data_inicio_condicao:
                dataInicioCondicaoS2240,


            // ====================================================
            // 1875
            // ====================================================

            riscosFuncionarioSoc:
                riscosFuncionario,

            agentesNocivosEsocial:
                agentesNocivos,

            agentesNocivosEsocialDetalhados:
                agentesNocivosDetalhados,

            consultaRiscosFuncionarioOk:
                consultaRiscosOk,

            erroConsultaRiscosFuncionario:
                erroConsultaRiscos,


            // ====================================================
            // 11573
            // ====================================================

            ghesAplicaveisSoc:
                ghesAplicaveis,

            consultaHierarquiasGheOk:
                consultaHierarquiasOk,

            erroConsultaHierarquiasGhe:
                erroConsultaHierarquias,


            // ====================================================
            // 7541
            // ====================================================

            caracteristicasRiscosGheSoc:
                caracteristicasRiscosFuncionario,

            riscosSemCaracteristicaGheSoc:
                riscosSemCaracteristicaGhe,

            consultaCaracteristicasGheOk:
                consultaCaracteristicasOk,

            erroConsultaCaracteristicasGhe:
                erroConsultaCaracteristicas,

            divergenciasCodigoAgenteSoc:
                divergenciasAgente,


            // ====================================================
            // 219605
            // ====================================================

            consultaCaracteristicas219605Ok:
                consultaCaracteristicas219605Ok,

            erroConsultaCaracteristicas219605:
                erroConsultaCaracteristicas219605,


            // ====================================================
            // RESPONSÁVEL AMBIENTAL / respReg
            // ====================================================

            responsaveisAmbientaisSoc,

            consultaResponsaveisAmbientaisOk,

            erroConsultaResponsaveisAmbientais,


            /*
             * IMPORTANTE:
             *
             * ainda não estamos autorizando transmissão
             * automática do S-2240.
             */
            s2240ProntoParaEmissao:
                false,

            bloqueioEmissaoS2240:
                'S-2240 ainda em fase de montagem e validação técnica.'
        });


        console.log(
            `➕ S-2240 necessário: ` +
            `${eventoOriginal.colaborador || 'Funcionário'} | ` +
            `Ficha ${eventoOriginal.idFicha || eventoOriginal.id_ficha_soc || '-'} | ` +
            `Tipo SOC ${tpExameOcup} | ` +
            `GHEs ${ghesAplicaveis
                .map(
                    item =>
                        item.codigoGhe
                )
                .join(', ') || '-'}`
        );
    }


    // ============================================================
    // RESUMO
    // ============================================================

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
        !Array.isArray(
            eventos
        ) ||
        eventos.length ===
            0
    ) {

        return salvos;
    }


    // ========================================================
    // AUXILIAR JSON ARRAY
    // ========================================================

    const normalizarListaJson =
        valor => {

            if (
                Array.isArray(
                    valor
                )
            ) {

                return valor;
            }


            if (
                valor &&
                typeof valor ===
                    'object'
            ) {

                return [
                    valor
                ];
            }


            if (
                typeof valor ===
                    'string' &&
                valor.trim()
            ) {

                try {

                    const parsed =
                        JSON.parse(
                            valor
                        );


                    if (
                        Array.isArray(
                            parsed
                        )
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

                } catch (
                    error
                ) {

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
                typeof valor ===
                    'string'
            ) {

                return valor;
            }


            try {

                return JSON.stringify(
                    valor
                );

            } catch (
                error
            ) {

                return String(
                    valor
                );
            }
        };


    // ========================================================
    // AUXILIAR - SABER SE ITEM RECEBEU UM CAMPO
    // ========================================================

    const possuiCampo =
        (
            objeto,
            nomes
        ) => {

            if (
                !objeto ||
                typeof objeto !==
                    'object'
            ) {

                return false;
            }


            return nomes.some(
                nome =>
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            objeto,
                            nome
                        )
            );
        };


    // ========================================================
    // AUXILIAR BOOLEANO NULLABLE
    // ========================================================

    const normalizarBooleanoNullable =
        valor => {

            if (
                valor === undefined ||
                valor === null ||
                valor === ''
            ) {

                return null;
            }


            if (
                valor === true
            ) {

                return true;
            }


            if (
                valor === false
            ) {

                return false;
            }


            return valorBooleanoSoc(
                valor
            );
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
            typeof item !==
                'object'
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


            const ehS2240 =
                tipoEvento ===
                'S-2240';


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


            const dataAdmissao =
                normalizarDataAdmissaoEsocial(
                    item.dataAdmissao ||
                    item.data_admissao ||
                    ''
                ) ||
                null;


            // ====================================================
            // DATA INÍCIO CONDIÇÃO S-2240
            // ====================================================

            const dataInicioCondicaoValor =
                item.dataInicioCondicao ||
                item.data_inicio_condicao ||
                '';


            const dataInicioCondicaoNova =
                dataInicioCondicaoValor
                    ? normalizarData(
                        dataInicioCondicaoValor
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

                    'matricula',
                    'matricula_soc',
                    'cod_categ',
                    'matricula_origem',
                    'matricula_oficial_atualizada_em',
                    'data_admissao',

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
                    'ambiente_esocial',

                    'data_inicio_condicao',

                    'gerado_por_regra_2240',

                    'riscos_funcionario_soc',
                    'agentes_nocivos_esocial',
                    'agentes_nocivos_esocial_detalhados',

                    'consulta_riscos_funcionario_ok',
                    'erro_consulta_riscos_funcionario',

                    'ghes_aplicaveis_soc',
                    'consulta_hierarquias_ghe_ok',
                    'erro_consulta_hierarquias_ghe',

                    'caracteristicas_riscos_ghe_soc',
                    'riscos_sem_caracteristica_ghe_soc',

                    'consulta_caracteristicas_ghe_ok',
                    'erro_consulta_caracteristicas_ghe',

                    'divergencias_codigo_agente_soc',

                    's2240_pronto_para_emissao',
                    'bloqueio_emissao_s2240'
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


            const dataInicioCondicaoFinal =
                dataInicioCondicaoNova ||
                existente?.data_inicio_condicao ||
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
                    .normalize(
                        'NFD'
                    )
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
            // S-2240 - RESOLVER JSONs
            // ====================================================

            const resolverListaS2240 =
                (
                    nomesItem,
                    colunaBanco
                ) => {

                    if (
                        !ehS2240
                    ) {

                        return null;
                    }


                    for (
                        const nome
                        of nomesItem
                    ) {

                        if (
                            Object.prototype
                                .hasOwnProperty
                                .call(
                                    item,
                                    nome
                                )
                        ) {

                            return normalizarListaJson(
                                item[
                                    nome
                                ]
                            );
                        }
                    }


                    if (
                        existente &&
                        existente[
                            colunaBanco
                        ] !== undefined &&
                        existente[
                            colunaBanco
                        ] !== null
                    ) {

                        return normalizarListaJson(
                            existente[
                                colunaBanco
                            ]
                        );
                    }


                    return null;
                };


            const riscosFuncionarioSocFinal =
                resolverListaS2240(
                    [
                        'riscosFuncionarioSoc',
                        'riscos_funcionario_soc'
                    ],
                    'riscos_funcionario_soc'
                );


            const agentesNocivosEsocialFinal =
                resolverListaS2240(
                    [
                        'agentesNocivosEsocial',
                        'agentes_nocivos_esocial'
                    ],
                    'agentes_nocivos_esocial'
                );


            const agentesNocivosDetalhadosFinal =
                resolverListaS2240(
                    [
                        'agentesNocivosEsocialDetalhados',
                        'agentes_nocivos_esocial_detalhados'
                    ],
                    'agentes_nocivos_esocial_detalhados'
                );


            const ghesAplicaveisSocFinal =
                resolverListaS2240(
                    [
                        'ghesAplicaveisSoc',
                        'ghes_aplicaveis_soc'
                    ],
                    'ghes_aplicaveis_soc'
                );


            const caracteristicasRiscosGheSocFinal =
                resolverListaS2240(
                    [
                        'caracteristicasRiscosGheSoc',
                        'caracteristicas_riscos_ghe_soc'
                    ],
                    'caracteristicas_riscos_ghe_soc'
                );


            const riscosSemCaracteristicaGheSocFinal =
                resolverListaS2240(
                    [
                        'riscosSemCaracteristicaGheSoc',
                        'riscos_sem_caracteristica_ghe_soc'
                    ],
                    'riscos_sem_caracteristica_ghe_soc'
                );


            const divergenciasCodigoAgenteSocFinal =
                resolverListaS2240(
                    [
                        'divergenciasCodigoAgenteSoc',
                        'divergencias_codigo_agente_soc'
                    ],
                    'divergencias_codigo_agente_soc'
                );


            // ====================================================
            // S-2240 - RESOLVER BOOLEANOS
            // ====================================================

            const resolverBooleanoS2240 =
                (
                    nomesItem,
                    colunaBanco
                ) => {

                    if (
                        !ehS2240
                    ) {

                        return null;
                    }


                    for (
                        const nome
                        of nomesItem
                    ) {

                        if (
                            Object.prototype
                                .hasOwnProperty
                                .call(
                                    item,
                                    nome
                                )
                        ) {

                            return normalizarBooleanoNullable(
                                item[
                                    nome
                                ]
                            );
                        }
                    }


                    return (
                        existente?.[
                            colunaBanco
                        ] ??
                        null
                    );
                };


            const geradoPorRegra2240Final =
                resolverBooleanoS2240(
                    [
                        'geradoPorRegra2240',
                        'gerado_por_regra_2240'
                    ],
                    'gerado_por_regra_2240'
                );


            const consultaRiscosFuncionarioOkFinal =
                resolverBooleanoS2240(
                    [
                        'consultaRiscosFuncionarioOk',
                        'consulta_riscos_funcionario_ok'
                    ],
                    'consulta_riscos_funcionario_ok'
                );


            const consultaHierarquiasGheOkFinal =
                resolverBooleanoS2240(
                    [
                        'consultaHierarquiasGheOk',
                        'consulta_hierarquias_ghe_ok'
                    ],
                    'consulta_hierarquias_ghe_ok'
                );


            const consultaCaracteristicasGheOkFinal =
                resolverBooleanoS2240(
                    [
                        'consultaCaracteristicasGheOk',
                        'consulta_caracteristicas_ghe_ok'
                    ],
                    'consulta_caracteristicas_ghe_ok'
                );


            const s2240ProntoParaEmissaoFinal =
                resolverBooleanoS2240(
                    [
                        's2240ProntoParaEmissao',
                        's2240_pronto_para_emissao'
                    ],
                    's2240_pronto_para_emissao'
                );


            // ====================================================
            // S-2240 - RESOLVER TEXTOS
            // ====================================================

            const resolverTextoS2240 =
                (
                    nomesItem,
                    colunaBanco
                ) => {

                    if (
                        !ehS2240
                    ) {

                        return null;
                    }


                    for (
                        const nome
                        of nomesItem
                    ) {

                        if (
                            Object.prototype
                                .hasOwnProperty
                                .call(
                                    item,
                                    nome
                                )
                        ) {

                            const valor =
                                item[
                                    nome
                                ];


                            if (
                                valor === undefined ||
                                valor === null
                            ) {

                                return null;
                            }


                            return (
                                String(
                                    valor
                                ).trim() ||
                                null
                            );
                        }
                    }


                    return (
                        existente?.[
                            colunaBanco
                        ] ||
                        null
                    );
                };


            const erroConsultaRiscosFuncionarioFinal =
                resolverTextoS2240(
                    [
                        'erroConsultaRiscosFuncionario',
                        'erro_consulta_riscos_funcionario'
                    ],
                    'erro_consulta_riscos_funcionario'
                );


            const erroConsultaHierarquiasGheFinal =
                resolverTextoS2240(
                    [
                        'erroConsultaHierarquiasGhe',
                        'erro_consulta_hierarquias_ghe'
                    ],
                    'erro_consulta_hierarquias_ghe'
                );


            const erroConsultaCaracteristicasGheFinal =
                resolverTextoS2240(
                    [
                        'erroConsultaCaracteristicasGhe',
                        'erro_consulta_caracteristicas_ghe'
                    ],
                    'erro_consulta_caracteristicas_ghe'
                );


            const bloqueioEmissaoS2240Final =
                resolverTextoS2240(
                    [
                        'bloqueioEmissaoS2240',
                        'bloqueio_emissao_s2240'
                    ],
                    'bloqueio_emissao_s2240'
                );


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

                // Matrícula recebida do SOC fica separada.
                // Ela NUNCA será usada diretamente no XML eSocial.
                matricula_soc:
                    matricula ||
                    null,

                // Preserva somente matrícula previamente confirmada
                // pelo BX/cache. Matrícula antiga sem origem confirmada
                // é considerada não confiável e será resolvida pela fila.
                matricula:
                    ESOCIAL_MATRICULA_ORIGENS_OFICIAIS.has(
                        String(
                            existente?.matricula_origem ||
                            ''
                        )
                            .trim()
                            .toLowerCase()
                    )
                        ? (
                            existente?.matricula ||
                            null
                          )
                        : null,

                cod_categ:
                    ESOCIAL_MATRICULA_ORIGENS_OFICIAIS.has(
                        String(
                            existente?.matricula_origem ||
                            ''
                        )
                            .trim()
                            .toLowerCase()
                    )
                        ? (
                            existente?.cod_categ ||
                            codCateg ||
                            null
                          )
                        : (
                            codCateg ||
                            null
                          ),

                matricula_origem:
                    ESOCIAL_MATRICULA_ORIGENS_OFICIAIS.has(
                        String(
                            existente?.matricula_origem ||
                            ''
                        )
                            .trim()
                            .toLowerCase()
                    )
                        ? existente.matricula_origem
                        : null,

                matricula_oficial_atualizada_em:
                    ESOCIAL_MATRICULA_ORIGENS_OFICIAIS.has(
                        String(
                            existente?.matricula_origem ||
                            ''
                        )
                            .trim()
                            .toLowerCase()
                    )
                        ? (
                            existente?.matricula_oficial_atualizada_em ||
                            null
                          )
                        : null,

                data_admissao:
                    dataAdmissao ||
                    existente?.data_admissao ||
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

                data_inicio_condicao:
                    dataInicioCondicaoFinal,

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
                // S-2240 - REGRA / RISCOS 1875
                // ------------------------------------------------

                gerado_por_regra_2240:
                    geradoPorRegra2240Final,

                riscos_funcionario_soc:
                    riscosFuncionarioSocFinal,

                agentes_nocivos_esocial:
                    agentesNocivosEsocialFinal,

                agentes_nocivos_esocial_detalhados:
                    agentesNocivosDetalhadosFinal,

                consulta_riscos_funcionario_ok:
                    consultaRiscosFuncionarioOkFinal,

                erro_consulta_riscos_funcionario:
                    erroConsultaRiscosFuncionarioFinal,


                // ------------------------------------------------
                // S-2240 - GHE 11573
                // ------------------------------------------------

                ghes_aplicaveis_soc:
                    ghesAplicaveisSocFinal,

                consulta_hierarquias_ghe_ok:
                    consultaHierarquiasGheOkFinal,

                erro_consulta_hierarquias_ghe:
                    erroConsultaHierarquiasGheFinal,


                // ------------------------------------------------
                // S-2240 - CARACTERÍSTICAS 7541
                // ------------------------------------------------

                caracteristicas_riscos_ghe_soc:
                    caracteristicasRiscosGheSocFinal,

                riscos_sem_caracteristica_ghe_soc:
                    riscosSemCaracteristicaGheSocFinal,

                consulta_caracteristicas_ghe_ok:
                    consultaCaracteristicasGheOkFinal,

                erro_consulta_caracteristicas_ghe:
                    erroConsultaCaracteristicasGheFinal,

                divergencias_codigo_agente_soc:
                    divergenciasCodigoAgenteSocFinal,


                // ------------------------------------------------
                // S-2240 - BLOQUEIO DE EMISSÃO
                // ------------------------------------------------

                s2240_pronto_para_emissao:
                    s2240ProntoParaEmissaoFinal,

                bloqueio_emissao_s2240:
                    bloqueioEmissaoS2240Final,


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


                // ================================================
                // MATRÍCULA OFICIAL: CACHE OU FILA AUTOMÁTICA
                // ================================================

                let resultadoMatriculaOficial =
                    null;


                try {

                    resultadoMatriculaOficial =
                        await garantirMatriculaOficialEvento({
                            id:
                                existente.id,
                            ...dadosBanco
                        });

                } catch (erroMatricula) {

                    console.warn(
                        '⚠️ Não foi possível preparar matrícula oficial do evento atualizado:',
                        erroMatricula?.message ||
                        erroMatricula
                    );
                }


                salvos.push({

                    ...item,

                    id:
                        existente.id,

                    tipoEvento,

                    tipo_evento:
                        tipoEvento,

                    matricula:
                        resultadoMatriculaOficial?.matricula ||
                        dadosBanco.matricula ||
                        null,

                    matriculaSoc:
                        matricula ||
                        null,

                    matricula_soc:
                        matricula ||
                        null,

                    codCateg:
                        resultadoMatriculaOficial?.codCateg ||
                        dadosBanco.cod_categ ||
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

                    dataInicioCondicao:
                        dataInicioCondicaoFinal,

                    data_inicio_condicao:
                        dataInicioCondicaoFinal,

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


            // ====================================================
            // MATRÍCULA OFICIAL: CACHE OU FILA AUTOMÁTICA
            // ====================================================

            let resultadoMatriculaOficial =
                null;


            try {

                resultadoMatriculaOficial =
                    await garantirMatriculaOficialEvento({
                        id:
                            inserido.id,
                        ...dadosBanco
                    });

            } catch (erroMatricula) {

                console.warn(
                    '⚠️ Não foi possível preparar matrícula oficial do novo evento:',
                    erroMatricula?.message ||
                    erroMatricula
                );
            }


            salvos.push({

                ...item,

                id:
                    inserido.id,

                tipoEvento,

                tipo_evento:
                    tipoEvento,

                matricula:
                    resultadoMatriculaOficial?.matricula ||
                    dadosBanco.matricula ||
                    null,

                matriculaSoc:
                    matricula ||
                    null,

                matricula_soc:
                    matricula ||
                    null,

                codCateg:
                    resultadoMatriculaOficial?.codCateg ||
                    dadosBanco.cod_categ ||
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

                dataInicioCondicao:
                    dataInicioCondicaoFinal,

                data_inicio_condicao:
                    dataInicioCondicaoFinal,

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


        } catch (
            error
        ) {

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
                ) ===
                'S-2220'
        ).length;


    const qtd2240 =
        salvos.filter(
            item =>
                (
                    item.tipoEvento ||
                    item.tipo_evento
                ) ===
                'S-2240'
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


const ESOCIAL_URL_ENVIO_RESTRITA =
    'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc';


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
            /<(?:(?:\w+):)?(?:evtMonit|evtExpRisco)\b[^>]*\bId="([^"]+)"/i
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

// ============================================================
// URLS DE CONSULTA DO LOTE E-SOCIAL
// ============================================================

const ESOCIAL_URL_CONSULTA_RESTRITA =
    'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc';


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
        ],

        [
            'evtAdmPrelim',
            'S-2190'
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


    // S-2200 não possui ideVinculo. CPF fica em trabalhador e
    // matrícula/categoria ficam em vinculo. No S-2190 os três
    // campos ficam em infoRegPrelim.
    const trabalhadorAdmissao =
        encontrarElementosPorLocalName(
            deteccao.noEvento,
            'trabalhador',
            []
        )[0] ||
        null;


    const vinculoAdmissao =
        encontrarElementosPorLocalName(
            deteccao.noEvento,
            'vinculo',
            []
        )[0] ||
        null;


    const infoRegPrelim =
        encontrarElementosPorLocalName(
            deteccao.noEvento,
            'infoRegPrelim',
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

    } else if (
        deteccao.tipoEvento === 'S-2200' ||
        deteccao.tipoEvento === 'S-2190'
    ) {

        dataReferencia =
            textoPrimeiroElemento(
                deteccao.noEvento,
                'dtAdm'
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
                : trabalhadorAdmissao
                    ? textoFilhoDireto(
                        trabalhadorAdmissao,
                        'cpfTrab'
                      )
                    : infoRegPrelim
                        ? textoFilhoDireto(
                            infoRegPrelim,
                            'cpfTrab'
                          )
                        : '',

        matricula:
            ideVinculo
                ? textoFilhoDireto(
                    ideVinculo,
                    'matricula'
                  )
                : vinculoAdmissao
                    ? textoFilhoDireto(
                        vinculoAdmissao,
                        'matricula'
                      )
                    : infoRegPrelim
                        ? textoFilhoDireto(
                            infoRegPrelim,
                            'matricula'
                          )
                        : '',

        codCateg:
            ideVinculo
                ? textoFilhoDireto(
                    ideVinculo,
                    'codCateg'
                  )
                : vinculoAdmissao
                    ? textoFilhoDireto(
                        vinculoAdmissao,
                        'codCateg'
                      )
                    : infoRegPrelim
                        ? textoFilhoDireto(
                            infoRegPrelim,
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


// ============================================================
// MATRÍCULA OFICIAL eSOCIAL - CACHE + FILA AUTOMÁTICA
// ============================================================
//
// OBJETIVO:
// - nunca usar a matrícula do SOC como matrícula de transmissão;
// - reaproveitar S-2200 / S-2190 já obtidos pelo BX;
// - manter cache permanente por empregador + CPF + vínculo;
// - colocar automaticamente vínculos desconhecidos em fila;
// - procurar o S-2200/S-2190 em janelas de até 31 dias;
// - respeitar bloqueio do BX entre os dias 1 e 7;
// - reservar parte do limite diário para outras operações.
// ============================================================

const ESOCIAL_MATRICULA_ORIGENS_OFICIAIS =
    new Set([
        'bx',
        'cache_esocial'
    ]);


let workerMatriculasEsocialRodando =
    false;


let timerWorkerMatriculasEsocial =
    null;


// ============================================================
// AUTOENVIO S-2220
//
// DESATIVADO por padrão.
// Para liberar:
//   ESOCIAL_AUTO_ENVIO_ATIVO=true
//
// Em Produção (tpAmb=1), continua obrigatório também:
//   ESOCIAL_PERMITIR_PRODUCAO=true
//
// O autoenvio é permitido SOMENTE para eventos posteriores à
// data de início do controle exclusivo do sistema. Histórico
// anterior continua sujeito às verificações BX existentes.
// ============================================================

let workerAutoEnvioEsocialRodando =
    false;


let workerConsultaLotesEsocialRodando =
    false;


let timerConsultaLotesEsocial =
    null;


const autoEnviosEsocialEmAndamento =
    new Set();


const consultasLotesEsocialEmAndamento =
    new Set();


function normalizarDataAdmissaoEsocial(
    valor
) {

    const normalizada =
        normalizarData(
            valor ||
            ''
        );


    if (
        !normalizada ||
        !/^\d{4}-\d{2}-\d{2}$/.test(
            normalizada
        ) ||
        normalizada.startsWith(
            '0001-'
        )
    ) {

        return '';
    }


    return normalizada;
}



function diferencaDiasDatasEsocial(
    dataA,
    dataB
) {

    const a =
        normalizarDataAdmissaoEsocial(
            dataA
        );


    const b =
        normalizarDataAdmissaoEsocial(
            dataB
        );


    if (
        !a ||
        !b
    ) {

        return null;
    }


    const msA =
        new Date(
            `${a}T12:00:00Z`
        ).getTime();


    const msB =
        new Date(
            `${b}T12:00:00Z`
        ).getTime();


    if (
        !Number.isFinite(
            msA
        ) ||
        !Number.isFinite(
            msB
        )
    ) {

        return null;
    }


    return Math.round(
        Math.abs(
            msA -
            msB
        ) /
        (
            24 *
            60 *
            60 *
            1000
        )
    );
}


function limiteDivergenciaAdmissaoMatriculaEsocial() {

    return Math.min(
        90,
        Math.max(
            0,
            envNumber(
                'ESOCIAL_MATRICULA_DIVERGENCIA_ADMISSAO_MAX_DIAS',
                31
            )
        )
    );
}


function escolherVinculoOficialBxParaPendencia(
    candidatos,
    dataAdmissaoSoc
) {

    const lista =
        (
            Array.isArray(
                candidatos
            )
                ? candidatos
                : []
        )
            .filter(
                item =>
                    [
                        'S-2200',
                        'S-2190'
                    ].includes(
                        String(
                            item?.tipoEvento ||
                            ''
                        ).toUpperCase()
                    ) &&
                    String(
                        item?.matricula ||
                        ''
                    ).trim()
            );


    if (
        !lista.length
    ) {

        return {
            vinculo:
                null,
            criterio:
                'SEM_CANDIDATOS',
            quantidadeMatriculas:
                0,
            divergenciaDias:
                null
        };
    }


    // ========================================================
    // 1) DATA EXATA CONTINUA SENDO A PRIMEIRA ESCOLHA
    // ========================================================

    const exato =
        lista.find(
            item =>
                normalizarDataAdmissaoEsocial(
                    item?.dataReferencia ||
                    item?.data_admissao ||
                    ''
                ) ===
                dataAdmissaoSoc
        ) ||
        null;


    if (
        exato
    ) {

        return {
            vinculo:
                exato,
            criterio:
                'DATA_ADMISSAO_EXATA',
            quantidadeMatriculas:
                new Set(
                    lista.map(
                        item =>
                            String(
                                item.matricula
                            ).trim()
                    )
                ).size,
            divergenciaDias:
                0
        };
    }


    // ========================================================
    // 2) SOC É REFERÊNCIA, NÃO FONTE OFICIAL DA dtAdm
    //
    // O BX já foi consultado usando:
    //   empregador + CPF
    //
    // Se a janela retorna somente UMA matrícula oficial
    // plausível para esse trabalhador/empregador, podemos usar
    // o vínculo mesmo que a dtAdm do SOC seja diferente.
    //
    // S-2190 e S-2200 do mesmo vínculo podem aparecer juntos,
    // por isso deduplicamos pela matrícula.
    // ========================================================

    const porMatricula =
        new Map();


    for (
        const item
        of lista
    ) {

        const matricula =
            String(
                item.matricula ||
                ''
            ).trim();


        if (
            !matricula
        ) {

            continue;
        }


        const atual =
            porMatricula.get(
                matricula
            );


        if (
            !atual
        ) {

            porMatricula.set(
                matricula,
                item
            );

            continue;
        }


        // Preferir S-2200 quando houver S-2190 + S-2200
        // representando a mesma matrícula.
        if (
            String(
                atual.tipoEvento ||
                ''
            ).toUpperCase() ===
                'S-2190' &&
            String(
                item.tipoEvento ||
                ''
            ).toUpperCase() ===
                'S-2200'
        ) {

            porMatricula.set(
                matricula,
                item
            );
        }
    }


    const unicos =
        Array.from(
            porMatricula.values()
        );


    if (
        unicos.length !== 1
    ) {

        return {
            vinculo:
                null,
            criterio:
                unicos.length > 1
                    ? 'MULTIPLOS_VINCULOS_PLAUSIVEIS'
                    : 'SEM_VINCULO_UNICO',
            quantidadeMatriculas:
                unicos.length,
            divergenciaDias:
                null
        };
    }


    const unico =
        unicos[0];


    const dataOficial =
        normalizarDataAdmissaoEsocial(
            unico?.dataReferencia ||
            unico?.data_admissao ||
            ''
        );


    const divergenciaDias =
        diferencaDiasDatasEsocial(
            dataAdmissaoSoc,
            dataOficial
        );


    const limiteDias =
        limiteDivergenciaAdmissaoMatriculaEsocial();


    if (
        divergenciaDias ===
            null ||
        divergenciaDias >
            limiteDias
    ) {

        return {
            vinculo:
                null,
            criterio:
                'VINCULO_UNICO_FORA_LIMITE_DIVERGENCIA',
            quantidadeMatriculas:
                1,
            divergenciaDias,
            dataAdmissaoOficial:
                dataOficial ||
                null,
            limiteDias
        };
    }


    return {
        vinculo:
            unico,
        criterio:
            'VINCULO_UNICO_CPF_EMPREGADOR',
        quantidadeMatriculas:
            1,
        divergenciaDias,
        dataAdmissaoOficial:
            dataOficial ||
            null,
        limiteDias
    };
}


function matriculaEventoEhOficial(
    evento
) {

    const origem =
        String(
            evento?.matricula_origem ||
            ''
        )
            .trim()
            .toLowerCase();


    const matricula =
        String(
            evento?.matricula ||
            ''
        ).trim();


    return Boolean(
        matricula &&
        ESOCIAL_MATRICULA_ORIGENS_OFICIAIS.has(
            origem
        )
    );
}


function dadosChaveVinculoMatricula(
    evento
) {

    const tpInsc =
        String(
            evento?.tp_insc_empregador ||
            evento?.tpInscEmpregador ||
            ''
        ).trim();


    const nrInsc =
        normalizarDocumentoEsocial(
            evento?.nr_insc_empregador ||
            evento?.nrInscEmpregador ||
            ''
        );


    const cpf =
        normalizarCpfEsocial(
            evento?.cpf ||
            ''
        );


    const dataAdmissao =
        normalizarDataAdmissaoEsocial(
            evento?.data_admissao ||
            evento?.dataAdmissao ||
            ''
        );


    const eventoId =
        String(
            evento?.id ||
            ''
        ).trim();


    const sufixo =
        dataAdmissao ||
        (
            eventoId
                ? `SEM_DATA:${eventoId}`
                : 'SEM_DATA'
        );


    return {
        tpInsc,
        nrInsc,
        cpf,
        dataAdmissao,
        chave:
            [
                tpInsc,
                nrInsc,
                cpf,
                sufixo
            ].join(
                '|'
            )
    };
}


async function buscarVinculoOficialCacheEsocial(
    evento
) {

    const chave =
        dadosChaveVinculoMatricula(
            evento
        );


    if (
        !chave.tpInsc ||
        !chave.nrInsc ||
        chave.cpf.length !== 11
    ) {

        return null;
    }


    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_vinculos'
            )
            .select(
                '*'
            )
            .eq(
                'tp_insc_empregador',
                chave.tpInsc
            )
            .eq(
                'nr_insc_empregador',
                chave.nrInsc
            )
            .eq(
                'cpf',
                chave.cpf
            )
            .order(
                'atualizado_em',
                {
                    ascending:
                        false
                }
            )
            .limit(
                20
            );


    if (
        error
    ) {

        throw error;
    }


    const vinculos =
        Array.isArray(
            data
        )
            ? data
            : [];


    if (
        !vinculos.length
    ) {

        return null;
    }


    // ========================================================
    // 1) MESMA DATA DE ADMISSÃO
    // ========================================================

    if (
        chave.dataAdmissao
    ) {

        const exato =
            vinculos.find(
                item =>
                    normalizarDataAdmissaoEsocial(
                        item?.data_admissao ||
                        ''
                    ) ===
                    chave.dataAdmissao
            );


        if (
            exato
        ) {

            return exato;
        }
    }


    // ========================================================
    // 2) SE SÓ EXISTE UM VÍNCULO, NÃO HÁ AMBIGUIDADE
    // ========================================================

    if (
        vinculos.length === 1
    ) {

        return vinculos[0];
    }


    // ========================================================
    // 3) SE O EVENTO JÁ TINHA MATRÍCULA OFICIAL, CASAR POR ELA
    // ========================================================

    if (
        matriculaEventoEhOficial(
            evento
        )
    ) {

        const matriculaAtual =
            String(
                evento.matricula ||
                ''
            ).trim();


        const mesmo =
            vinculos.find(
                item =>
                    String(
                        item?.matricula_esocial ||
                        ''
                    ).trim() ===
                    matriculaAtual
            );


        if (
            mesmo
        ) {

            return mesmo;
        }
    }


    // Mais de um vínculo e sem data exata: não arriscar.
    return null;
}


async function aplicarVinculoOficialNoEvento(
    evento,
    vinculo,
    origem = 'cache_esocial'
) {

    if (
        !evento ||
        !vinculo
    ) {

        return {
            encontrada:
                false,
            alterada:
                false,
            matricula:
                null
        };
    }


    const matriculaOficial =
        String(
            vinculo.matricula_esocial ||
            vinculo.matricula ||
            ''
        ).trim();


    if (
        !matriculaOficial
    ) {

        return {
            encontrada:
                false,
            alterada:
                false,
            matricula:
                null
        };
    }


    const codCategOficial =
        String(
            vinculo.cod_categ ||
            vinculo.codCateg ||
            ''
        ).trim();


    // Data oficial do vínculo vinda do eSocial/BX/cache.
    // Mantemos separada de data_admissao, que pode ter origem SOC.
    const dataAdmissaoOficial =
        normalizarDataAdmissaoEsocial(
            vinculo.data_admissao ||
            vinculo.dataReferencia ||
            ''
        );


    const matriculaAnterior =
        String(
            evento.matricula ||
            ''
        ).trim();


    const codCategAnterior =
        String(
            evento.cod_categ ||
            evento.codCateg ||
            ''
        ).trim();


    const matriculaAlterada =
        matriculaOficial !==
        matriculaAnterior;


    const categoriaAlterada =
        Boolean(
            codCategOficial &&
            codCategOficial !==
                codCategAnterior
        );


    const alterada =
        matriculaAlterada ||
        categoriaAlterada;


    // ========================================================
    // NÃO ALTERAR EVENTO JÁ CONCLUÍDO EM PRODUÇÃO
    // ========================================================

    const possuiReciboProducao =
        Number(
            evento.ambiente_esocial
        ) === 1 &&
        Boolean(
            String(
                evento.numero_recibo ||
                ''
            ).trim()
        );


    if (
        possuiReciboProducao &&
        alterada
    ) {

        return {
            encontrada:
                true,
            alterada:
                false,
            protegidoPorRecibo:
                true,
            matricula:
                matriculaAnterior ||
                matriculaOficial,
            matriculaCache:
                matriculaOficial
        };
    }


    const agora =
        new Date()
            .toISOString();


    const retornoAnterior =
        JSON.stringify(
            evento?.retorno_processamento ||
            evento?.erro_esocial ||
            ''
        );


    const rejeitadoPorMatricula =
        alterada &&
        String(
            evento?.status ||
            ''
        )
            .toLowerCase()
            .includes(
                'erro'
            ) &&
        retornoAnterior.includes(
            '1557'
        );


    const atualizacao = {
        matricula:
            matriculaOficial,

        cod_categ:
            codCategOficial ||
            codCategAnterior ||
            null,

        matricula_origem:
            origem === 'bx'
                ? 'bx'
                : 'cache_esocial',

        matricula_oficial_atualizada_em:
            agora,

        // Nunca substituir data_admissao do SOC pela data oficial.
        // As duas datas têm origens diferentes e podem divergir.
        data_admissao_esocial:
            dataAdmissaoOficial ||
            evento.data_admissao_esocial ||
            null,

        updated_at:
            agora
    };


    if (
        alterada
    ) {

        Object.assign(
            atualizacao,
            {
                xml_gerado:
                    null,
                xml_assinado:
                    null,
                id_evento_esocial:
                    null,
                verificacao_esocial_completa:
                    false,
                verificado_esocial_em:
                    null
            }
        );
    }


    if (
        rejeitadoPorMatricula
    ) {

        Object.assign(
            atualizacao,
            {
                protocolo_envio:
                    null,
                retorno_envio:
                    null,
                retorno_processamento:
                    null,
                data_envio:
                    null,
                numero_recibo:
                    null,
                status:
                    'pendente',
                erro_esocial:
                    null,
                codigo_erro_esocial:
                    null
            }
        );
    }


    const {
        error
    } =
        await getSupabase()
            .from(
                'esocial_eventos'
            )
            .update(
                atualizacao
            )
            .eq(
                'id',
                evento.id
            );


    if (
        error
    ) {

        throw error;
    }


    Object.assign(
        evento,
        atualizacao
    );


    return {
        encontrada:
            true,
        alterada,
        matricula:
            matriculaOficial,
        matriculaAnterior:
            matriculaAnterior ||
            null,
        codCateg:
            atualizacao.cod_categ,
        dataAdmissaoEsocial:
            atualizacao.data_admissao_esocial ||
            null,
        origem:
            atualizacao.matricula_origem,
        rejeicaoAnteriorLiberada:
            rejeitadoPorMatricula
    };
}


async function resolverEventosLocaisComVinculoEsocial(
    vinculo
) {

    const tpInsc =
        String(
            vinculo?.tp_insc_empregador ||
            vinculo?.tpInscEmpregador ||
            ''
        ).trim();


    const nrInsc =
        normalizarDocumentoEsocial(
            vinculo?.nr_insc_empregador ||
            vinculo?.nrInscEmpregador ||
            ''
        );


    const cpf =
        normalizarCpfEsocial(
            vinculo?.cpf ||
            ''
        );


    const dataAdmissao =
        normalizarDataAdmissaoEsocial(
            vinculo?.data_admissao ||
            vinculo?.dataReferencia ||
            ''
        );


    if (
        !tpInsc ||
        !nrInsc ||
        cpf.length !== 11
    ) {

        return 0;
    }


    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_eventos'
            )
            .select(
                '*'
            )
            .eq(
                'tp_insc_empregador',
                tpInsc
            )
            .eq(
                'nr_insc_empregador',
                nrInsc
            )
            .eq(
                'cpf',
                cpf
            )
            .in(
                'tipo_evento',
                [
                    'S-2220',
                    'S-2240'
                ]
            );


    if (
        error
    ) {

        throw error;
    }


    const candidatos =
        (
            Array.isArray(
                data
            )
                ? data
                : []
        )
            .filter(
                evento => {

                    if (
                        Number(
                            evento.ambiente_esocial
                        ) === 1 &&
                        String(
                            evento.numero_recibo ||
                            ''
                        ).trim()
                    ) {

                        return false;
                    }


                    if (
                        !dataAdmissao
                    ) {

                        return true;
                    }


                    const dataEvento =
                        normalizarDataAdmissaoEsocial(
                            evento.data_admissao ||
                            ''
                        );


                    return dataEvento ===
                        dataAdmissao;
                }
            );


    let atualizados =
        0;


    for (
        const evento
        of candidatos
    ) {

        const resultado =
            await aplicarVinculoOficialNoEvento(
                evento,
                vinculo,
                'cache_esocial'
            );


        if (
            resultado.encontrada
        ) {

            atualizados++;
        }
    }


    return atualizados;
}


async function salvarVinculoOficialEsocial(
    vinculo
) {

    const tipoEvento =
        String(
            vinculo?.tipoEvento ||
            vinculo?.tipo_evento ||
            ''
        )
            .trim()
            .toUpperCase();


    if (
        ![
            'S-2200',
            'S-2190'
        ].includes(
            tipoEvento
        )
    ) {

        return null;
    }


    const tpInsc =
        String(
            vinculo?.tpInscEmpregador ||
            vinculo?.tp_insc_empregador ||
            ''
        ).trim();


    const nrInsc =
        normalizarDocumentoEsocial(
            vinculo?.nrInscEmpregador ||
            vinculo?.nr_insc_empregador ||
            ''
        );


    const cpf =
        normalizarCpfEsocial(
            vinculo?.cpf ||
            ''
        );


    const matricula =
        String(
            vinculo?.matricula ||
            vinculo?.matricula_esocial ||
            ''
        ).trim();


    const codCateg =
        String(
            vinculo?.codCateg ||
            vinculo?.cod_categ ||
            ''
        ).trim();


    const dataAdmissao =
        normalizarDataAdmissaoEsocial(
            vinculo?.dataReferencia ||
            vinculo?.data_admissao ||
            ''
        );


    if (
        !tpInsc ||
        !nrInsc ||
        cpf.length !== 11 ||
        !matricula
    ) {

        return null;
    }


    const agora =
        new Date()
            .toISOString();


    const registro = {
        tp_insc_empregador:
            tpInsc,
        nr_insc_empregador:
            nrInsc,
        cpf,
        matricula_esocial:
            matricula,
        cod_categ:
            codCateg ||
            null,
        tipo_evento_origem:
            tipoEvento,
        id_evento_origem:
            String(
                vinculo?.idEvento ||
                vinculo?.id_evento_esocial ||
                ''
            ).trim() ||
            null,
        numero_recibo_origem:
            String(
                vinculo?.numeroRecibo ||
                vinculo?.numero_recibo ||
                ''
            ).trim() ||
            null,
        data_admissao:
            dataAdmissao ||
            null,
        fonte:
            'bx',
        atualizado_em:
            agora,
        updated_at:
            agora
    };


    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_vinculos'
            )
            .upsert(
                registro,
                {
                    onConflict:
                        'tp_insc_empregador,nr_insc_empregador,cpf,matricula_esocial'
                }
            )
            .select(
                '*'
            )
            .single();


    if (
        error
    ) {

        throw error;
    }


    await resolverEventosLocaisComVinculoEsocial(
        data ||
        registro
    );


    return data ||
        registro;
}


async function salvarVinculosOficiaisDoBx(
    eventosBx
) {

    const lista =
        Array.isArray(
            eventosBx
        )
            ? eventosBx
            : [];


    const salvos =
        [];


    for (
        const eventoBx
        of lista
    ) {

        if (
            ![
                'S-2200',
                'S-2190'
            ].includes(
                String(
                    eventoBx?.tipoEvento ||
                    ''
                ).toUpperCase()
            )
        ) {

            continue;
        }


        if (
            !String(
                eventoBx?.matricula ||
                ''
            ).trim()
        ) {

            continue;
        }


        const salvo =
            await salvarVinculoOficialEsocial(
                eventoBx
            );


        if (
            salvo
        ) {

            salvos.push(
                salvo
            );
        }
    }


    return salvos;
}


// ============================================================
// COMPLETAR DATA DE ADMISSÃO PELO SOC 219968
//
// IMPORTANTE:
// - não usa matrícula do SOC como matrícula eSocial;
// - usa somente DATA_ADMISSAO para identificar o vínculo correto;
// - salva a data no evento local para não consultar o SOC novamente.
// ============================================================

async function completarDataAdmissaoEventoEsocial(
    evento
) {

    if (
        !evento ||
        typeof evento !==
            'object'
    ) {

        return '';
    }


    let dataAdmissao =
        normalizarDataAdmissaoEsocial(
            evento?.data_admissao ||
            evento?.dataAdmissao ||
            ''
        );


    if (
        dataAdmissao
    ) {

        evento.data_admissao =
            dataAdmissao;

        evento.dataAdmissao =
            dataAdmissao;

        return dataAdmissao;
    }


    try {

        const funcionario =
            await consultarFuncionarioCpf219968(
                evento
            );


        dataAdmissao =
            normalizarDataAdmissaoEsocial(
                funcionario?.dataAdmissao ||
                ''
            );


        if (
            !dataAdmissao
        ) {

            return '';
        }


        if (
            evento?.id
        ) {

            const {
                error
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({
                        data_admissao:
                            dataAdmissao,
                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        'id',
                        evento.id
                    );


            if (
                error
            ) {

                throw error;
            }
        }


        evento.data_admissao =
            dataAdmissao;

        evento.dataAdmissao =
            dataAdmissao;


        console.log(
            '📅 Data de admissão recuperada do SOC 219968:',
            {
                eventoId:
                    evento?.id ||
                    null,
                codigoEmpresa:
                    evento?.codigo_empresa ||
                    evento?.codigoEmpresa ||
                    null,
                codigoFuncionario:
                    evento?.codigo_funcionario ||
                    evento?.codigoFuncionario ||
                    null,
                cpf:
                    normalizarCpfEsocial(
                        evento?.cpf ||
                        ''
                    ),
                dataAdmissao
            }
        );


        return dataAdmissao;

    } catch (
        error
    ) {

        console.warn(
            '⚠️ Não foi possível completar data de admissão pelo SOC 219968:',
            {
                eventoId:
                    evento?.id ||
                    null,
                cpf:
                    normalizarCpfEsocial(
                        evento?.cpf ||
                        ''
                    ),
                erro:
                    error?.message ||
                    String(
                        error
                    )
            }
        );


        return '';
    }
}


// ============================================================
// CRIAR / ATUALIZAR PENDÊNCIA DE MATRÍCULA
//
// Também migra automaticamente registros antigos criados como:
//   ...|SEM_DATA:<eventoId>
//
// Assim que a data de admissão é conhecida, a fila passa a usar:
//   tpInsc|nrInsc|cpf|AAAA-MM-DD
//
// Isso evita duas consultas BX para o mesmo vínculo.
// ============================================================

async function criarOuAtualizarPendenciaMatriculaEsocial(
    evento,
    motivo = 'MATRICULA_OFICIAL_NAO_LOCALIZADA'
) {

    const chave =
        dadosChaveVinculoMatricula(
            evento
        );


    if (
        !chave.tpInsc ||
        !chave.nrInsc ||
        chave.cpf.length !== 11
    ) {

        return null;
    }


    const db =
        getSupabase();


    const eventoId =
        String(
            evento?.id ||
            ''
        ).trim();


    // ========================================================
    // 1) PROCURAR PELA CHAVE ATUAL
    // ========================================================

    let {
        data:
            existente,
        error:
            erroBusca
    } =
        await db
            .from(
                'esocial_matriculas_pendentes'
            )
            .select(
                '*'
            )
            .eq(
                'chave_vinculo',
                chave.chave
            )
            .limit(
                1
            )
            .maybeSingle();


    if (
        erroBusca
    ) {

        throw erroBusca;
    }


    // ========================================================
    // 2) PROCURAR REGISTRO LEGADO DO MESMO EVENTO
    //
    // Antes da data de admissão ser conhecida, a fila usava:
    // SEM_DATA:<eventoId>.
    // ========================================================

    let legado =
        null;


    if (
        eventoId
    ) {

        const {
            data,
            error
        } =
            await db
                .from(
                    'esocial_matriculas_pendentes'
                )
                .select(
                    '*'
                )
                .eq(
                    'evento_exemplo_id',
                    eventoId
                )
                .order(
                    'created_at',
                    {
                        ascending:
                            true
                    }
                )
                .limit(
                    1
                )
                .maybeSingle();


        if (
            error
        ) {

            throw error;
        }


        legado =
            data ||
            null;
    }


    // ========================================================
    // 3) SE JÁ EXISTE A CHAVE DEFINITIVA E TAMBÉM EXISTE
    //    UM SEM_DATA DO MESMO EVENTO, REMOVER O DUPLICADO.
    // ========================================================

    if (
        existente &&
        legado &&
        String(
            legado.id
        ) !==
        String(
            existente.id
        )
    ) {

        const {
            error:
                erroDelete
        } =
            await db
                .from(
                    'esocial_matriculas_pendentes'
                )
                .delete()
                .eq(
                    'id',
                    legado.id
                );


        if (
            erroDelete
        ) {

            throw erroDelete;
        }


        console.log(
            '🧹 Pendência SEM_DATA duplicada removida:',
            {
                pendenciaRemovida:
                    legado.id,
                pendenciaMantida:
                    existente.id,
                chave:
                    chave.chave
            }
        );


        legado =
            null;
    }


    // ========================================================
    // 4) SE A CHAVE DEFINITIVA AINDA NÃO EXISTE, REUTILIZAR
    //    O REGISTRO LEGADO. O UPDATE ABAIXO ALTERARÁ A CHAVE.
    // ========================================================

    if (
        !existente &&
        legado
    ) {

        existente =
            legado;
    }


    const dados = {
        chave_vinculo:
            chave.chave,
        evento_exemplo_id:
            eventoId ||
            existente?.evento_exemplo_id ||
            null,
        codigo_empresa:
            String(
                evento?.codigo_empresa ||
                evento?.codigoEmpresa ||
                existente?.codigo_empresa ||
                ''
            ).trim() ||
            null,
        codigo_funcionario:
            String(
                evento?.codigo_funcionario ||
                evento?.codigoFuncionario ||
                existente?.codigo_funcionario ||
                ''
            ).trim() ||
            null,
        tp_insc_empregador:
            chave.tpInsc,
        nr_insc_empregador:
            chave.nrInsc,
        cpf:
            chave.cpf,
        data_admissao:
            chave.dataAdmissao ||
            existente?.data_admissao ||
            null,
        data_evento:
            normalizarData(
                evento?.data_exame ||
                evento?.dataExame ||
                evento?.data_emissao_aso ||
                ''
            ) ||
            existente?.data_evento ||
            null,
        status:
            'pendente',
        motivo:
            motivo ||
            existente?.motivo ||
            null,
        ultimo_erro:
            existente?.ultimo_erro ||
            null,
        janela_indice:
            Number(
                existente?.janela_indice ||
                0
            ),
        tentativas:
            Number(
                existente?.tentativas ||
                0
            ),
        updated_at:
            new Date()
                .toISOString()
    };


    if (
        existente
    ) {

        const {
            data,
            error
        } =
            await db
                .from(
                    'esocial_matriculas_pendentes'
                )
                .update(
                    dados
                )
                .eq(
                    'id',
                    existente.id
                )
                .select(
                    '*'
                )
                .single();


        if (
            error
        ) {

            throw error;
        }


        return data;
    }


    const {
        data,
        error
    } =
        await db
            .from(
                'esocial_matriculas_pendentes'
            )
            .insert([
                {
                    ...dados,
                    created_at:
                        new Date()
                            .toISOString()
                }
            ])
            .select(
                '*'
            )
            .single();


    if (
        error
    ) {

        throw error;
    }


    return data;
}


// ============================================================
// GARANTIR MATRÍCULA OFICIAL
// ============================================================

async function garantirMatriculaOficialEvento(
    evento,
    {
        criarPendencia = true
    } = {}
) {

    if (
        !evento ||
        typeof evento !== 'object'
    ) {

        return {
            encontrada:
                false,
            motivo:
                'EVENTO_INVALIDO'
        };
    }


    if (
        matriculaEventoEhOficial(
            evento
        )
    ) {

        return {
            encontrada:
                true,
            origem:
                String(
                    evento.matricula_origem ||
                    ''
                ),
            matricula:
                String(
                    evento.matricula ||
                    ''
                ),
            evento
        };
    }


    // ========================================================
    // DATA DE ADMISSÃO PRIMEIRO
    //
    // A matrícula continua vindo SOMENTE do eSocial/BX/cache.
    // O SOC é usado aqui apenas para obter a data de admissão
    // e diferenciar corretamente vínculos/recontratações.
    // ========================================================

    const dataAdmissao =
        await completarDataAdmissaoEventoEsocial(
            evento
        );


    // ========================================================
    // CACHE OFICIAL
    // ========================================================

    const cache =
        await buscarVinculoOficialCacheEsocial(
            evento
        );


    if (
        cache
    ) {

        const aplicado =
            await aplicarVinculoOficialNoEvento(
                evento,
                cache,
                'cache_esocial'
            );


        return {
            ...aplicado,
            origem:
                'cache_esocial',
            dataAdmissao:
                dataAdmissao ||
                null,
            evento
        };
    }


    // ========================================================
    // FILA
    // ========================================================

    if (
        criarPendencia
    ) {

        await criarOuAtualizarPendenciaMatriculaEsocial(
            evento
        );
    }


    return {
        encontrada:
            false,
        origem:
            null,
        matricula:
            null,
        dataAdmissao:
            dataAdmissao ||
            null,
        motivo:
            dataAdmissao
                ? 'MATRICULA_OFICIAL_PENDENTE'
                : 'MATRICULA_OFICIAL_PENDENTE_SEM_DATA_ADMISSAO',
        evento
    };
}


// ============================================================
// BACKFILL SEM CONSUMIR BX
// ============================================================

async function backfillVinculosDoCacheBxExistente() {

    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_eventos_bx'
            )
            .select(
                'tp_insc_empregador, nr_insc_empregador, cpf, matricula, cod_categ, tipo_evento, data_referencia, id_evento_esocial, numero_recibo'
            )
            .in(
                'tipo_evento',
                [
                    'S-2200',
                    'S-2190'
                ]
            );


    if (
        error
    ) {

        throw error;
    }


    const lista =
        Array.isArray(
            data
        )
            ? data
            : [];


    let total =
        0;


    for (
        const item
        of lista
    ) {

        if (
            !String(
                item?.matricula ||
                ''
            ).trim()
        ) {

            continue;
        }


        const salvo =
            await salvarVinculoOficialEsocial({
                tipoEvento:
                    item.tipo_evento,
                tpInscEmpregador:
                    item.tp_insc_empregador,
                nrInscEmpregador:
                    item.nr_insc_empregador,
                cpf:
                    item.cpf,
                matricula:
                    item.matricula,
                codCateg:
                    item.cod_categ,
                dataReferencia:
                    item.data_referencia,
                idEvento:
                    item.id_evento_esocial,
                numeroRecibo:
                    item.numero_recibo
            });


        if (
            salvo
        ) {

            total++;
        }
    }


    if (
        total > 0
    ) {

        console.log(
            `💾 Backfill matrícula eSocial: ${total} vínculo(s) recuperado(s) do cache BX local.`
        );
    }


    return total;
}


// ============================================================
// JANELA / LIMITE DO BX
// ============================================================

function partesDataBrasil(
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
                    '2-digit'
            }
        )
            .formatToParts(
                data
            );


    const mapa =
        Object.fromEntries(
            partes
                .filter(
                    item =>
                        item.type !== 'literal'
                )
                .map(
                    item => [
                        item.type,
                        item.value
                    ]
                )
        );


    return {
        ano:
            Number(
                mapa.year
            ),
        mes:
            Number(
                mapa.month
            ),
        dia:
            Number(
                mapa.day
            ),
        iso:
            `${mapa.year}-${mapa.month}-${mapa.day}`
    };
}


function bxBloqueadoPorCalendario() {

    const {
        dia
    } =
        partesDataBrasil();


    return dia >= 1 &&
        dia <= 7;
}


function limiteDiarioWorkerBx() {

    return Math.min(
        9,
        Math.max(
            1,
            envNumber(
                'ESOCIAL_BX_LIMITE_WORKER_DIA',
                6
            )
        )
    );
}


async function obterConsumoWorkerBxHoje(
    tpInsc,
    nrInsc
) {

    const hoje =
        partesDataBrasil()
            .iso;


    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_bx_consumo_diario'
            )
            .select(
                '*'
            )
            .eq(
                'data_referencia',
                hoje
            )
            .eq(
                'tp_insc_empregador',
                tpInsc
            )
            .eq(
                'nr_insc_empregador',
                nrInsc
            )
            .limit(
                1
            )
            .maybeSingle();


    if (
        error
    ) {

        throw error;
    }


    return data ||
        {
            data_referencia:
                hoje,
            tp_insc_empregador:
                tpInsc,
            nr_insc_empregador:
                nrInsc,
            quantidade:
                0
        };
}


async function registrarAcessoWorkerBx(
    tpInsc,
    nrInsc,
    tipo
) {

    const atual =
        await obterConsumoWorkerBxHoje(
            tpInsc,
            nrInsc
        );


    const agora =
        new Date()
            .toISOString();


    const novo = {
        data_referencia:
            atual.data_referencia,
        tp_insc_empregador:
            tpInsc,
        nr_insc_empregador:
            nrInsc,
        quantidade:
            Number(
                atual.quantidade ||
                0
            ) + 1,
        ultimo_tipo:
            tipo ||
            null,
        ultimo_acesso_em:
            agora,
        updated_at:
            agora
    };


    const {
        error
    } =
        await getSupabase()
            .from(
                'esocial_bx_consumo_diario'
            )
            .upsert(
                novo,
                {
                    onConflict:
                        'data_referencia,tp_insc_empregador,nr_insc_empregador'
                }
            );


    if (
        error
    ) {

        throw error;
    }


    return novo.quantidade;
}


async function workerPodeConsumirBx(
    tpInsc,
    nrInsc,
    quantidadeNecessaria = 1
) {

    if (
        bxBloqueadoPorCalendario()
    ) {

        return false;
    }


    const atual =
        await obterConsumoWorkerBxHoje(
            tpInsc,
            nrInsc
        );


    return (
        Number(
            atual.quantidade ||
            0
        ) +
        Number(
            quantidadeNecessaria ||
            0
        )
    ) <=
        limiteDiarioWorkerBx();
}


function deslocamentoJanelaMatricula(
    indice
) {

    const n =
        Math.max(
            0,
            Number(
                indice ||
                0
            )
        );


    if (
        n === 0
    ) {

        return 0;
    }


    const bloco =
        Math.ceil(
            n /
            2
        );


    const sinal =
        n % 2 === 1
            ? 1
            : -1;


    return bloco *
        30 *
        sinal;
}


function montarJanelaBxParaAdmissao(
    dataAdmissao,
    janelaIndice = 0
) {

    const adm =
        normalizarDataAdmissaoEsocial(
            dataAdmissao
        );


    if (
        !adm
    ) {

        return null;
    }


    const base =
        new Date(
            `${adm}T12:00:00Z`
        );


    if (
        Number.isNaN(
            base.getTime()
        )
    ) {

        return null;
    }


    const deslocamentoDias =
        deslocamentoJanelaMatricula(
            janelaIndice
        );


    const inicio =
        new Date(
            base.getTime() +
            (
                (
                    deslocamentoDias -
                    2
                ) *
                24 *
                60 *
                60 *
                1000
            )
        );


    let fim =
        new Date(
            inicio.getTime() +
            (
                30 *
                24 *
                60 *
                60 *
                1000
            )
        );


    const limiteFim =
        new Date(
            Date.now() -
            (
                2 *
                60 *
                60 *
                1000
            )
        );


    if (
        fim.getTime() >
        limiteFim.getTime()
    ) {

        fim =
            limiteFim;
    }


    if (
        inicio.getTime() >
        fim.getTime()
    ) {

        return null;
    }


    return {
        dtIni:
            inicio,
        dtFim:
            fim,
        deslocamentoDias
    };
}


async function baixarEventosBxEmLoteParaMatricula({
    tpInsc,
    nrInsc,
    identificadores
}) {

    const ids =
        Array.from(
            new Set(
                (
                    Array.isArray(
                        identificadores
                    )
                        ? identificadores
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
        )
            .slice(
                0,
                50
            );


    if (
        !ids.length
    ) {

        return {
            eventosInterpretados:
                [],
            retorno:
                null
        };
    }


    await aguardarEntreChamadasBx(
        2500
    );


    const retorno =
        await solicitarDownloadEventosPorIdBx({
            tpInsc,
            nrInsc,
            ids
        });


    if (
        retorno?.soapFault
    ) {

        throw new Error(
            retorno.faultString ||
            'SOAP Fault no download BX em lote.'
        );
    }


    if (
        String(
            retorno?.cdResposta ||
            ''
        ) !== '201'
    ) {

        throw new Error(
            retorno?.descResposta ||
            `Download BX em lote retornou código ${retorno?.cdResposta || '-'}.`
        );
    }


    const eventosInterpretados =
        [];


    for (
        const arquivo
        of (
            Array.isArray(
                retorno?.arquivos
            )
                ? retorno.arquivos
                : []
        )
    ) {

        if (
            !arquivo?.xmlEvento
    ) {

            continue;
        }


        const interpretado =
            interpretarEventoBaixadoBx(
                arquivo
            );


        if (
            interpretado
        ) {

            eventosInterpretados.push(
                interpretado
            );
        }
    }


    if (
        eventosInterpretados.length
    ) {

        await salvarEventosBxNoBanco(
            eventosInterpretados
        );
    }


    return {
        eventosInterpretados,
        retorno
    };
}


async function atualizarPendenciaMatricula(
    id,
    dados
) {

    const {
        error
    } =
        await getSupabase()
            .from(
                'esocial_matriculas_pendentes'
            )
            .update({
                ...dados,
                updated_at:
                    new Date()
                        .toISOString()
            })
            .eq(
                'id',
                id
            );


    if (
        error
    ) {

        throw error;
    }
}


async function obterEventoExemploPendencia(
    pendencia
) {

    const db =
        getSupabase();


    const id =
        String(
            pendencia?.evento_exemplo_id ||
            ''
        ).trim();


    if (
        id
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
                    '*'
                )
                .eq(
                    'id',
                    id
                )
                .limit(
                    1
                )
                .maybeSingle();


        if (
            error
        ) {

            throw error;
        }


        if (
            data
        ) {

            return data;
        }
    }


    const {
        data,
        error
    } =
        await db
            .from(
                'esocial_eventos'
            )
            .select(
                '*'
            )
            .eq(
                'tp_insc_empregador',
                pendencia.tp_insc_empregador
            )
            .eq(
                'nr_insc_empregador',
                pendencia.nr_insc_empregador
            )
            .eq(
                'cpf',
                pendencia.cpf
            )
            .eq(
                'tipo_evento',
                'S-2220'
            )
            .order(
                'created_at',
                {
                    ascending:
                        true
                }
            )
            .limit(
                1
            )
            .maybeSingle();


    if (
        error
    ) {

        throw error;
    }


    return data ||
        null;
}


async function completarDataAdmissaoPendencia(
    pendencia,
    evento
) {

    let dataAdmissao =
        normalizarDataAdmissaoEsocial(
            pendencia?.data_admissao ||
            evento?.data_admissao ||
            evento?.dataAdmissao ||
            ''
        );


    if (
        dataAdmissao
    ) {

        return dataAdmissao;
    }


    const funcionario =
        await consultarFuncionarioCpf219968(
            evento
        );


    dataAdmissao =
        normalizarDataAdmissaoEsocial(
            funcionario?.dataAdmissao ||
            ''
        );


    if (
        !dataAdmissao
    ) {

        return '';
    }


    await atualizarPendenciaMatricula(
        pendencia.id,
        {
            data_admissao:
                dataAdmissao
        }
    );


    if (
        evento?.id
    ) {

        const {
            error
        } =
            await getSupabase()
                .from(
                    'esocial_eventos'
                )
                .update({
                    data_admissao:
                        dataAdmissao,
                    updated_at:
                        new Date()
                            .toISOString()
                })
                .eq(
                    'id',
                    evento.id
                );


        if (
            error
        ) {

            throw error;
        }


        evento.data_admissao =
            dataAdmissao;
    }


    return dataAdmissao;
}


async function processarUmaPendenciaMatriculaEsocial(
    pendencia
) {

    const evento =
        await obterEventoExemploPendencia(
            pendencia
        );


    if (
        !evento
    ) {

        await atualizarPendenciaMatricula(
            pendencia.id,
            {
                status:
                    'erro',
                ultimo_erro:
                    'Evento local de referência não encontrado.',
                proxima_tentativa_em:
                    new Date(
                        Date.now() +
                        24 *
                        60 *
                        60 *
                        1000
                    ).toISOString()
            }
        );


        return {
            resolvida:
                false,
            motivo:
                'EVENTO_NAO_ENCONTRADO'
        };
    }


    // ========================================================
    // CACHE PRIMEIRO
    // ========================================================

    const cache =
        await buscarVinculoOficialCacheEsocial(
            evento
        );


    if (
        cache
    ) {

        await aplicarVinculoOficialNoEvento(
            evento,
            cache,
            'cache_esocial'
        );


        await atualizarPendenciaMatricula(
            pendencia.id,
            {
                status:
                    'resolvido',
                resolvido_em:
                    new Date()
                        .toISOString(),
                ultimo_erro:
                    null,
                proxima_tentativa_em:
                    null
            }
        );


        return {
            resolvida:
                true,
            origem:
                'cache_esocial',
            matricula:
                cache.matricula_esocial
        };
    }


    const dataAdmissao =
        await completarDataAdmissaoPendencia(
            pendencia,
            evento
        );


    if (
        !dataAdmissao
    ) {

        await atualizarPendenciaMatricula(
            pendencia.id,
            {
                status:
                    'erro',
                tentativas:
                    Number(
                        pendencia.tentativas ||
                        0
                    ) + 1,
                ultimo_erro:
                    'Data de admissão não localizada no evento nem no SOC 219968.',
                proxima_tentativa_em:
                    new Date(
                        Date.now() +
                        24 *
                        60 *
                        60 *
                        1000
                    ).toISOString()
            }
        );


        return {
            resolvida:
                false,
            motivo:
                'DATA_ADMISSAO_NAO_LOCALIZADA'
        };
    }


    const tpInsc =
        String(
            pendencia.tp_insc_empregador ||
            evento.tp_insc_empregador ||
            ''
        ).trim();


    const nrInsc =
        normalizarDocumentoEsocial(
            pendencia.nr_insc_empregador ||
            evento.nr_insc_empregador ||
            ''
        );


    const cpf =
        normalizarCpfEsocial(
            pendencia.cpf ||
            evento.cpf ||
            ''
        );


    if (
        bxBloqueadoPorCalendario()
    ) {

        return {
            resolvida:
                false,
            motivo:
                'BX_BLOQUEADO_DIAS_1_A_7'
        };
    }


    if (
        !await workerPodeConsumirBx(
            tpInsc,
            nrInsc,
            1
        )
    ) {

        return {
            resolvida:
                false,
            motivo:
                'LIMITE_DIARIO_WORKER_BX'
        };
    }


    const janela =
        montarJanelaBxParaAdmissao(
            dataAdmissao,
            pendencia.janela_indice ||
            0
        );


    if (
        !janela
    ) {

        await atualizarPendenciaMatricula(
            pendencia.id,
            {
                status:
                    'pendente',
                proxima_tentativa_em:
                    new Date(
                        Date.now() +
                        24 *
                        60 *
                        60 *
                        1000
                    ).toISOString(),
                ultimo_erro:
                    'A janela BX calculada ainda não está disponível.'
            }
        );


        return {
            resolvida:
                false,
            motivo:
                'JANELA_BX_NAO_DISPONIVEL'
        };
    }


    await registrarAcessoWorkerBx(
        tpInsc,
        nrInsc,
        'consultar-identificadores'
    );


    const consulta =
        await consultarIdentificadoresEventosTrabalhadorBx({
            tpInsc,
            nrInsc,
            cpf,
            dtIni:
                janela.dtIni,
            dtFim:
                janela.dtFim
        });


    if (
        consulta?.soapFault
    ) {

        throw new Error(
            consulta.faultString ||
            'SOAP Fault ao consultar identificadores BX.'
        );
    }


    const codigo =
        String(
            consulta?.cdResposta ||
            ''
        );


    if (
        ![
            '201',
            '203',
            '406'
        ].includes(
            codigo
        )
    ) {

        throw new Error(
            consulta?.descResposta ||
            `Consulta BX retornou código ${codigo || '-'}.`
        );
    }


    const identificadores =
        Array.isArray(
            consulta?.identificadores
        )
            ? consulta.identificadores
            : [];


    if (
        !identificadores.length
    ) {

        await atualizarPendenciaMatricula(
            pendencia.id,
            {
                status:
                    'pendente',
                tentativas:
                    Number(
                        pendencia.tentativas ||
                        0
                    ) + 1,
                janela_indice:
                    Number(
                        pendencia.janela_indice ||
                        0
                    ) + 1,
                ultimo_erro:
                    `Nenhum evento encontrado na janela BX (deslocamento ${janela.deslocamentoDias} dias).`,
                proxima_tentativa_em:
                    new Date(
                        Date.now() +
                        60 *
                        60 *
                        1000
                    ).toISOString()
            }
        );


        return {
            resolvida:
                false,
            motivo:
                'SEM_EVENTOS_NA_JANELA'
        };
    }


    if (
        !await workerPodeConsumirBx(
            tpInsc,
            nrInsc,
            1
        )
    ) {

        return {
            resolvida:
                false,
            motivo:
                'LIMITE_DIARIO_WORKER_BX_ANTES_DOWNLOAD'
        };
    }


    await registrarAcessoWorkerBx(
        tpInsc,
        nrInsc,
        'download-em-lote'
    );


    const download =
        await baixarEventosBxEmLoteParaMatricula({
            tpInsc,
            nrInsc,
            identificadores
        });


    const candidatos =
        (
            Array.isArray(
                download.eventosInterpretados
            )
                ? download.eventosInterpretados
                : []
        )
            .filter(
                item =>
                    [
                        'S-2200',
                        'S-2190'
                    ].includes(
                        item?.tipoEvento
                    ) &&
                    normalizarCpfEsocial(
                        item?.cpf
                    ) === cpf &&
                    String(
                        item?.matricula ||
                        ''
                    ).trim()
            );


    const selecaoVinculo =
        escolherVinculoOficialBxParaPendencia(
            candidatos,
            dataAdmissao
        );


    const vinculoEscolhido =
        selecaoVinculo.vinculo;


    if (
        vinculoEscolhido
    ) {

        const salvo =
            await salvarVinculoOficialEsocial(
                vinculoEscolhido
            );


        await aplicarVinculoOficialNoEvento(
            evento,
            salvo ||
            vinculoEscolhido,
            'bx'
        );


        const dataAdmissaoOficial =
            normalizarDataAdmissaoEsocial(
                vinculoEscolhido?.dataReferencia ||
                vinculoEscolhido?.data_admissao ||
                ''
            );


        const houveDivergencia =
            Boolean(
                dataAdmissaoOficial &&
                dataAdmissaoOficial !==
                    dataAdmissao
            );


        const motivoResolucao =
            houveDivergencia
                ? (
                    `MATRICULA_RESOLVIDA_BX_DIVERGENCIA_ADMISSAO:` +
                    `${dataAdmissao}->${dataAdmissaoOficial}`
                )
                : 'MATRICULA_RESOLVIDA_BX';


        await atualizarPendenciaMatricula(
            pendencia.id,
            {
                status:
                    'resolvido',
                motivo:
                    motivoResolucao,
                resolvido_em:
                    new Date()
                        .toISOString(),
                ultimo_erro:
                    null,
                proxima_tentativa_em:
                    null
            }
        );


        console.log(
            '✅ Matrícula oficial eSocial resolvida automaticamente:',
            {
                cpf,
                matricula:
                    String(
                        vinculoEscolhido.matricula ||
                        ''
                    ),
                criterio:
                    selecaoVinculo.criterio,
                dataAdmissaoSoc:
                    dataAdmissao,
                dataAdmissaoOficial:
                    dataAdmissaoOficial ||
                    null,
                divergenciaDias:
                    selecaoVinculo.divergenciaDias,
                tipoEventoOrigem:
                    vinculoEscolhido.tipoEvento
            }
        );


        return {
            resolvida:
                true,
            origem:
                'bx',
            criterio:
                selecaoVinculo.criterio,
            matricula:
                vinculoEscolhido.matricula,
            dataAdmissaoSoc:
                dataAdmissao,
            dataAdmissaoOficial:
                dataAdmissaoOficial ||
                null,
            divergenciaDias:
                selecaoVinculo.divergenciaDias
        };
    }


    await atualizarPendenciaMatricula(
        pendencia.id,
        {
            status:
                'pendente',
            tentativas:
                Number(
                    pendencia.tentativas ||
                    0
                ) + 1,
            janela_indice:
                Number(
                    pendencia.janela_indice ||
                    0
                ) + 1,
            motivo:
                selecaoVinculo.criterio ||
                'VINCULO_OFICIAL_NAO_RESOLVIDO',
            ultimo_erro:
                (
                    `A janela BX retornou ${candidatos.length} evento(s) de vínculo, ` +
                    `mas a matrícula oficial não pôde ser escolhida com segurança. ` +
                    `Critério: ${selecaoVinculo.criterio || '-'}; ` +
                    `dtAdm SOC: ${dataAdmissao}; ` +
                    `dtAdm oficial candidata: ${selecaoVinculo.dataAdmissaoOficial || '-'}; ` +
                    `divergência: ${selecaoVinculo.divergenciaDias ?? '-'} dia(s).`
                ),
            proxima_tentativa_em:
                new Date(
                    Date.now() +
                    60 *
                    60 *
                    1000
                ).toISOString()
        }
    );


    return {
        resolvida:
            false,
        motivo:
            selecaoVinculo.criterio ||
            'VINCULO_OFICIAL_NAO_RESOLVIDO',
        divergenciaDias:
            selecaoVinculo.divergenciaDias ??
            null,
        dataAdmissaoOficial:
            selecaoVinculo.dataAdmissaoOficial ||
            null
    };
}


async function semearFilaMatriculasEsocial() {

    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_eventos'
            )
            .select(
                '*'
            )
            .eq(
                'tipo_evento',
                'S-2220'
            );


    if (
        error
    ) {

        throw error;
    }


    let criadas =
        0;


    let resolvidasCache =
        0;


    for (
        const evento
        of (
            Array.isArray(
                data
            )
                ? data
                : []
        )
    ) {

        if (
            Number(
                evento.ambiente_esocial
            ) === 1 &&
            String(
                evento.numero_recibo ||
                ''
            ).trim()
        ) {

            continue;
        }


        if (
            matriculaEventoEhOficial(
                evento
            )
        ) {

            continue;
        }


        const resultado =
            await garantirMatriculaOficialEvento(
                evento,
                {
                    criarPendencia:
                        true
                }
            );


        if (
            resultado.encontrada
        ) {

            resolvidasCache++;
        } else {

            criadas++;
        }
    }


    return {
        criadas,
        resolvidasCache
    };
}


async function processarFilaMatriculasEsocial({
    limiteItens = 3
} = {}) {

    if (
        workerMatriculasEsocialRodando
    ) {

        return {
            success:
                false,
            executou:
                false,
            motivo:
                'WORKER_JA_EM_EXECUCAO'
        };
    }


    if (
        bxBloqueadoPorCalendario()
    ) {

        return {
            success:
                true,
            executou:
                false,
            motivo:
                'BX_BLOQUEADO_DIAS_1_A_7'
        };
    }


    workerMatriculasEsocialRodando =
        true;


    try {

        const {
            data,
            error
        } =
            await getSupabase()
                .from(
                    'esocial_matriculas_pendentes'
                )
                .select(
                    '*'
                )
                .in(
                    'status',
                    [
                        'pendente',
                        'erro',
                        'aguardando_janela'
                    ]
                )
                .order(
                    'data_evento',
                    {
                        ascending:
                            true,
                        nullsFirst:
                            false
                    }
                )
                .order(
                    'created_at',
                    {
                        ascending:
                            true
                    }
                )
                .limit(
                    30
                );


        if (
            error
        ) {

            throw error;
        }


        const agoraMs =
            Date.now();


        const elegiveis =
            (
                Array.isArray(
                    data
                )
                    ? data
                    : []
            )
                .filter(
                    item => {

                        if (
                            !item.proxima_tentativa_em
                        ) {

                            return true;
                        }


                        const dataTentativa =
                            new Date(
                                item.proxima_tentativa_em
                            );


                        return Number.isNaN(
                            dataTentativa.getTime()
                        ) ||
                        dataTentativa.getTime() <=
                            agoraMs;
                    }
                )
                .slice(
                    0,
                    Math.max(
                        1,
                        Number(
                            limiteItens ||
                            3
                        )
                    )
                );


        const resultados =
            [];


        for (
            const pendencia
            of elegiveis
        ) {

            try {

                const resultado =
                    await processarUmaPendenciaMatriculaEsocial(
                        pendencia
                    );


                resultados.push({
                    id:
                        pendencia.id,
                    cpf:
                        pendencia.cpf,
                    ...resultado
                });


                if (
                    resultado.motivo === 'LIMITE_DIARIO_WORKER_BX' ||
                    resultado.motivo === 'LIMITE_DIARIO_WORKER_BX_ANTES_DOWNLOAD'
                ) {

                    break;
                }

            } catch (
                error
            ) {

                const mensagem =
                    error?.message ||
                    String(
                        error
                    );


                console.error(
                    '❌ Worker matrícula eSocial:',
                    {
                        pendenciaId:
                            pendencia.id,
                        cpf:
                            pendencia.cpf,
                        error:
                            mensagem
                    }
                );


                await atualizarPendenciaMatricula(
                    pendencia.id,
                    {
                        status:
                            'erro',
                        tentativas:
                            Number(
                                pendencia.tentativas ||
                                0
                            ) + 1,
                        ultimo_erro:
                            mensagem,
                        proxima_tentativa_em:
                            new Date(
                                Date.now() +
                                60 *
                                60 *
                                1000
                            ).toISOString()
                    }
                );


                resultados.push({
                    id:
                        pendencia.id,
                    cpf:
                        pendencia.cpf,
                    resolvida:
                        false,
                    motivo:
                        'ERRO',
                    error:
                        mensagem
                });
            }
        }


        return {
            success:
                true,
            executou:
                true,
            quantidade:
                resultados.length,
            resultados
        };

    } finally {

        workerMatriculasEsocialRodando =
            false;
    }
}



// ============================================================
// AUTOENVIO AUTOMÁTICO DE S-2220
// ============================================================

function autoEnvioEsocialAtivo() {

    return [
        '1',
        'true',
        'sim',
        'yes',
        'on'
    ].includes(
        String(
            process.env.ESOCIAL_AUTO_ENVIO_ATIVO ||
            'false'
        )
            .trim()
            .toLowerCase()
    );
}


function limiteAutoEnvioEsocialPorCiclo() {

    return Math.min(
        20,
        Math.max(
            1,
            envNumber(
                'ESOCIAL_AUTO_ENVIO_ITENS_POR_CICLO',
                3
            )
        )
    );
}


function localizarHandlerEnvioEventoEsocial() {

    const camada =
        (
            Array.isArray(
                router?.stack
            )
                ? router.stack
                : []
        )
            .find(
                item =>
                    item?.route?.path ===
                        '/enviar-evento-esocial/:id' &&
                    item?.route?.methods?.post ===
                        true
            );


    if (
        !camada?.route?.stack?.length
    ) {

        return null;
    }


    const handler =
        camada.route.stack[
            camada.route.stack.length -
            1
        ]?.handle;


    return typeof handler ===
        'function'
            ? handler
            : null;
}


async function executarEnvioEventoEsocialInternamente(
    eventoId
) {

    const id =
        String(
            eventoId ||
            ''
        ).trim();


    if (
        !id
    ) {

        return {
            statusHttp:
                400,
            payload: {
                success:
                    false,
                error:
                    'ID do evento não informado.'
            }
        };
    }


    if (
        autoEnviosEsocialEmAndamento.has(
            id
        )
    ) {

        return {
            statusHttp:
                409,
            payload: {
                success:
                    false,
                motivo:
                    'AUTO_ENVIO_JA_EM_ANDAMENTO',
                error:
                    'Já existe um autoenvio em andamento para este evento.'
            }
        };
    }


    const handler =
        localizarHandlerEnvioEventoEsocial();


    if (
        !handler
    ) {

        return {
            statusHttp:
                500,
            payload: {
                success:
                    false,
                motivo:
                    'HANDLER_ENVIO_NAO_LOCALIZADO',
                error:
                    'A rota interna de envio eSocial não foi localizada.'
            }
        };
    }


    autoEnviosEsocialEmAndamento.add(
        id
    );


    try {

        return await new Promise(
            async (
                resolve,
                reject
            ) => {

                let finalizado =
                    false;


                const finalizar =
                    (
                        statusHttp,
                        payload
                    ) => {

                        if (
                            finalizado
                        ) {

                            return;
                        }


                        finalizado =
                            true;


                        resolve({
                            statusHttp,
                            payload
                        });
                    };


                const reqInterno = {
                    params: {
                        id
                    }
                };


                const resInterno = {

                    statusCode:
                        200,

                    status(
                        codigo
                    ) {

                        this.statusCode =
                            Number(
                                codigo
                            ) ||
                            500;

                        return this;
                    },

                    json(
                        payload
                    ) {

                        finalizar(
                            this.statusCode,
                            payload
                        );

                        return this;
                    }
                };


                try {

                    const retornoHandler =
                        handler(
                            reqInterno,
                            resInterno
                        );


                    if (
                        retornoHandler &&
                        typeof retornoHandler.then ===
                            'function'
                    ) {

                        await retornoHandler;
                    }


                    if (
                        !finalizado
                    ) {

                        finalizar(
                            resInterno.statusCode,
                            {
                                success:
                                    false,
                                motivo:
                                    'ROTA_SEM_RESPOSTA',
                                error:
                                    'A rota de envio terminou sem produzir resposta JSON.'
                            }
                        );
                    }

                } catch (
                    error
                ) {

                    reject(
                        error
                    );
                }
            }
        );

    } finally {

        autoEnviosEsocialEmAndamento.delete(
            id
        );
    }
}



function localizarHandlerConsultaLoteEsocial() {

    const camada =
        (
            Array.isArray(
                router?.stack
            )
                ? router.stack
                : []
        )
            .find(
                item =>
                    item?.route?.path ===
                        '/consultar-lote-esocial/:id' &&
                    item?.route?.methods?.post ===
                        true
            );


    if (
        !camada?.route?.stack?.length
    ) {

        return null;
    }


    const handler =
        camada.route.stack[
            camada.route.stack.length -
            1
        ]?.handle;


    return typeof handler ===
        'function'
            ? handler
            : null;
}


async function executarConsultaLoteEsocialInternamente(
    eventoId
) {

    const id =
        String(
            eventoId ||
            ''
        ).trim();


    if (
        !id
    ) {

        return {
            statusHttp:
                400,
            payload: {
                success:
                    false,
                error:
                    'ID do evento não informado.'
            }
        };
    }


    if (
        consultasLotesEsocialEmAndamento.has(
            id
        )
    ) {

        return {
            statusHttp:
                409,
            payload: {
                success:
                    false,
                motivo:
                    'CONSULTA_LOTE_JA_EM_ANDAMENTO',
                error:
                    'Já existe uma consulta de lote em andamento para este evento.'
            }
        };
    }


    const handler =
        localizarHandlerConsultaLoteEsocial();


    if (
        !handler
    ) {

        return {
            statusHttp:
                500,
            payload: {
                success:
                    false,
                motivo:
                    'HANDLER_CONSULTA_LOTE_NAO_LOCALIZADO',
                error:
                    'A rota interna de consulta do lote eSocial não foi localizada.'
            }
        };
    }


    consultasLotesEsocialEmAndamento.add(
        id
    );


    try {

        return await new Promise(
            async (
                resolve,
                reject
            ) => {

                let finalizado =
                    false;


                const finalizar =
                    (
                        statusHttp,
                        payload
                    ) => {

                        if (
                            finalizado
                        ) {

                            return;
                        }


                        finalizado =
                            true;


                        resolve({
                            statusHttp,
                            payload
                        });
                    };


                const reqInterno = {
                    params: {
                        id
                    },
                    body: {}
                };


                const resInterno = {

                    statusCode:
                        200,

                    status(
                        codigo
                    ) {

                        this.statusCode =
                            Number(
                                codigo
                            ) ||
                            500;

                        return this;
                    },

                    json(
                        payload
                    ) {

                        finalizar(
                            this.statusCode,
                            payload
                        );

                        return this;
                    }
                };


                try {

                    const retornoHandler =
                        handler(
                            reqInterno,
                            resInterno
                        );


                    if (
                        retornoHandler &&
                        typeof retornoHandler.then ===
                            'function'
                    ) {

                        await retornoHandler;
                    }


                    if (
                        !finalizado
                    ) {

                        finalizar(
                            resInterno.statusCode,
                            {
                                success:
                                    false,
                                motivo:
                                    'ROTA_CONSULTA_SEM_RESPOSTA',
                                error:
                                    'A rota de consulta do lote terminou sem produzir resposta JSON.'
                            }
                        );
                    }

                } catch (
                    error
                ) {

                    reject(
                        error
                    );
                }
            }
        );

    } finally {

        consultasLotesEsocialEmAndamento.delete(
            id
        );
    }
}


async function listarEventosPendentesConsultaLoteEsocial(
    limite = 100
) {

    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_eventos'
            )
            .select(
                '*'
            )
            .eq(
                'tipo_evento',
                'S-2220'
            )
            .not(
                'protocolo_envio',
                'is',
                null
            )
            .is(
                'numero_recibo',
                null
            )
            .in(
                'status',
                [
                    'pendente',
                    'processando'
                ]
            )
            .order(
                'data_envio',
                {
                    ascending:
                        true,
                    nullsFirst:
                        false
                }
            )
            .limit(
                Math.min(
                    200,
                    Math.max(
                        1,
                        Number(
                            limite ||
                            100
                        )
                    )
                )
            );


    if (
        error
    ) {

        throw error;
    }


    return (
        Array.isArray(
            data
        )
            ? data
            : []
    )
        .filter(
            evento =>
                Boolean(
                    String(
                        evento.protocolo_envio ||
                        ''
                    ).trim()
                ) &&
                !String(
                    evento.numero_recibo ||
                    ''
                ).trim()
        );
}


async function processarConsultasLotesAutomaticasEsocial({
    limiteItens = 20
} = {}) {

    if (
        workerConsultaLotesEsocialRodando
    ) {

        return {
            success:
                false,
            executou:
                false,
            motivo:
                'CONSULTA_LOTES_JA_EM_EXECUCAO'
        };
    }


    workerConsultaLotesEsocialRodando =
        true;


    try {

        const pendentes =
            await listarEventosPendentesConsultaLoteEsocial(
                200
            );


        const fila =
            pendentes.slice(
                0,
                Math.min(
                    50,
                    Math.max(
                        1,
                        Number(
                            limiteItens ||
                            20
                        )
                    )
                )
            );


        const resultados =
            [];


        for (
            const evento
            of fila
        ) {

            const id =
                String(
                    evento.id ||
                    ''
                ).trim();


            if (
                !id
            ) {

                continue;
            }


            try {

                const retorno =
                    await executarConsultaLoteEsocialInternamente(
                        id
                    );


                resultados.push({
                    eventoId:
                        id,
                    statusHttp:
                        retorno.statusHttp,
                    success:
                        retorno.payload?.success ===
                            true,
                    processado:
                        retorno.payload?.processado ===
                            true,
                    eventoAceito:
                        retorno.payload?.eventoAceito ===
                            true,
                    numeroRecibo:
                        retorno.payload?.numeroRecibo ||
                        null,
                    motivo:
                        retorno.payload?.motivo ||
                        null,
                    error:
                        retorno.payload?.error ||
                        null
                });

            } catch (
                error
            ) {

                resultados.push({
                    eventoId:
                        id,
                    statusHttp:
                        500,
                    success:
                        false,
                    processado:
                        false,
                    eventoAceito:
                        false,
                    motivo:
                        'ERRO_CONSULTA_LOTE_AUTOMATICA',
                    error:
                        error?.message ||
                        String(
                            error
                        )
                });
            }


            // Evitar rajada de consultas no WebService.
            await aguardarEntreChamadasBx(
                1200
            );
        }


        return {
            success:
                true,
            executou:
                true,
            pendentes:
                pendentes.length,
            processados:
                resultados.length,
            resultados
        };

    } finally {

        workerConsultaLotesEsocialRodando =
            false;
    }
}



function consultaAutomaticaLoteEsocialAtiva() {

    const valor =
        String(
            process.env.ESOCIAL_AUTO_CONSULTA_LOTE_ATIVA ??
            process.env.ESOCIAL_AUTO_ENVIO_ATIVO ??
            'false'
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


function iniciarWorkerConsultaLotesEsocial() {

    if (
        timerConsultaLotesEsocial
    ) {

        return;
    }


    const ativo =
        consultaAutomaticaLoteEsocialAtiva();


    if (
        !ativo
    ) {

        console.log(
            'ℹ️ Consulta automática de lotes eSocial desativada.'
        );

        return;
    }


    const intervaloMs =
        Math.max(
            30 *
            1000,
            envNumber(
                'ESOCIAL_AUTO_CONSULTA_LOTE_INTERVALO_MS',
                60 *
                1000
            )
        );


    const executar =
        async () => {

            try {

                const resultado =
                    await processarConsultasLotesAutomaticasEsocial({
                        limiteItens:
                            envNumber(
                                'ESOCIAL_AUTO_CONSULTA_LOTE_ITENS_POR_CICLO',
                                20
                            )
                    });


                if (
                    resultado.processados
                ) {

                    console.log(
                        '🔎 Consulta automática de lotes eSocial:',
                        resultado
                    );
                }

            } catch (
                error
            ) {

                console.error(
                    '❌ Consulta automática de lotes eSocial:',
                    error?.message ||
                    error
                );
            }
        };


    const timerInicial =
        setTimeout(
            executar,
            10000
        );


    if (
        typeof timerInicial.unref ===
            'function'
    ) {

        timerInicial.unref();
    }


    timerConsultaLotesEsocial =
        setInterval(
            executar,
            intervaloMs
        );


    if (
        typeof timerConsultaLotesEsocial.unref ===
            'function'
    ) {

        timerConsultaLotesEsocial.unref();
    }


    console.log(
        `🔎 Consulta automática de lotes eSocial ativa. Intervalo: ${Math.round(intervaloMs / 1000)}s.`
    );
}


function eventoElegivelAutoEnvioEsocial(
    evento,
    ambienteAtual
) {

    if (
        !evento ||
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


    // Só eventos novos, já sob controle exclusivo do sistema.
    if (
        !eventoSobControleExclusivoEsocial(
            evento
        )
    ) {

        return false;
    }


    // Matrícula obrigatoriamente oficial.
    if (
        !matriculaEventoEhOficial(
            evento
        )
    ) {

        return false;
    }


    // Já confirmado como existente no eSocial.
    if (
        evento.existe_no_esocial ===
            true ||
        String(
            evento.numero_recibo_existente ||
            ''
        ).trim()
    ) {

        return false;
    }


    const ambienteEvento =
        Number(
            evento.ambiente_esocial
        );


    // Não repetir envio/tentativa no MESMO ambiente.
    if (
        ambienteEvento ===
            ambienteAtual &&
        (
            String(
                evento.numero_recibo ||
                ''
            ).trim() ||
            String(
                evento.protocolo_envio ||
                ''
            ).trim()
        )
    ) {

        return false;
    }


    const status =
        String(
            evento.status ||
            ''
        )
            .trim()
            .toLowerCase();


    // Estados que exigem tratamento humano/recuperação específica.
    if (
        [
            'cancelado',
            'envio_incerto'
        ].includes(
            status
        )
    ) {

        return false;
    }


    if (
        autoEnviosEsocialEmAndamento.has(
            String(
                evento.id ||
                ''
            )
        )
    ) {

        return false;
    }


    return true;
}


async function listarEventosElegiveisAutoEnvioEsocial(
    limite = 100
) {

    const ambienteAtual =
        obterAmbienteEsocialConfigurado();


    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_eventos'
            )
            .select(
                '*'
            )
            .eq(
                'tipo_evento',
                'S-2220'
            )
            .order(
                'data_exame',
                {
                    ascending:
                        true,
                    nullsFirst:
                        false
                }
            )
            .order(
                'created_at',
                {
                    ascending:
                        true
                }
            )
            .limit(
                Math.min(
                    500,
                    Math.max(
                        1,
                        Number(
                            limite ||
                            100
                        )
                    )
                )
            );


    if (
        error
    ) {

        throw error;
    }


    return (
        Array.isArray(
            data
        )
            ? data
            : []
    )
        .filter(
            evento =>
                eventoElegivelAutoEnvioEsocial(
                    evento,
                    ambienteAtual
                )
        );
}


async function processarEnviosAutomaticosEsocial({
    limiteItens =
        limiteAutoEnvioEsocialPorCiclo()
} = {}) {

    if (
        !autoEnvioEsocialAtivo()
    ) {

        return {
            success:
                true,
            executou:
                false,
            motivo:
                'AUTO_ENVIO_DESATIVADO'
        };
    }


    if (
        workerAutoEnvioEsocialRodando
    ) {

        return {
            success:
                false,
            executou:
                false,
            motivo:
                'AUTO_ENVIO_JA_EM_EXECUCAO'
        };
    }


    const ambiente =
        obterAmbienteEsocialConfigurado();


    if (
        ambiente === 1 &&
        !producaoEsocialExplicitamentePermitida()
    ) {

        return {
            success:
                true,
            executou:
                false,
            motivo:
                'PRODUCAO_NAO_AUTORIZADA',
            ambiente
        };
    }


    workerAutoEnvioEsocialRodando =
        true;


    try {

        const elegiveis =
            await listarEventosElegiveisAutoEnvioEsocial(
                200
            );


        const fila =
            elegiveis.slice(
                0,
                Math.min(
                    20,
                    Math.max(
                        1,
                        Number(
                            limiteItens ||
                            3
                        )
                    )
                )
            );


        const resultados =
            [];


        for (
            const evento
            of fila
        ) {

            const id =
                String(
                    evento.id ||
                    ''
                ).trim();


            if (
                !id
            ) {

                continue;
            }


            try {

                console.log(
                    '🚀 Autoenvio S-2220 iniciado:',
                    {
                        eventoId:
                            id,
                        cpf:
                            normalizarCpfEsocial(
                                evento.cpf ||
                                ''
                            ),
                        ambiente
                    }
                );


                const retorno =
                    await executarEnvioEventoEsocialInternamente(
                        id
                    );


                let retornoConsulta =
                    null;


                const protocoloRecebido =
                    String(
                        retorno.payload?.protocoloEnvio ||
                        retorno.payload?.protocolo_envio ||
                        ''
                    ).trim();


                if (
                    retorno.payload?.success ===
                        true &&
                    protocoloRecebido
                ) {

                    // O lote normalmente processa em poucos segundos.
                    // Fazemos uma primeira consulta imediatamente; se
                    // ainda estiver processando, o worker periódico
                    // continuará consultando sem intervenção humana.
                    await aguardarEntreChamadasBx(
                        2500
                    );


                    try {

                        retornoConsulta =
                            await executarConsultaLoteEsocialInternamente(
                                id
                            );

                    } catch (
                        erroConsulta
                    ) {

                        retornoConsulta = {
                            statusHttp:
                                500,
                            payload: {
                                success:
                                    false,
                                processado:
                                    false,
                                motivo:
                                    'ERRO_CONSULTA_POS_ENVIO',
                                error:
                                    erroConsulta?.message ||
                                    String(
                                        erroConsulta
                                    )
                            }
                        };


                        console.warn(
                            '⚠️ Envio realizado, mas a primeira consulta do lote falhou:',
                            {
                                eventoId:
                                    id,
                                error:
                                    retornoConsulta.payload.error
                            }
                        );
                    }
                }


                resultados.push({
                    eventoId:
                        id,
                    cpf:
                        normalizarCpfEsocial(
                            evento.cpf ||
                            ''
                        ),
                    statusHttp:
                        retorno.statusHttp,
                    success:
                        retorno.payload?.success ===
                            true,
                    motivo:
                        retorno.payload?.motivo ||
                        null,
                    numeroRecibo:
                        retornoConsulta?.payload?.numeroRecibo ||
                        retorno.payload?.numeroRecibo ||
                        retorno.payload?.numero_recibo ||
                        null,
                    protocoloEnvio:
                        protocoloRecebido ||
                        null,
                    consultaLote: retornoConsulta
                        ? {
                            statusHttp:
                                retornoConsulta.statusHttp,
                            success:
                                retornoConsulta.payload?.success ===
                                    true,
                            processado:
                                retornoConsulta.payload?.processado ===
                                    true,
                            eventoAceito:
                                retornoConsulta.payload?.eventoAceito ===
                                    true,
                            numeroRecibo:
                                retornoConsulta.payload?.numeroRecibo ||
                                null
                        }
                        : null,
                    error:
                        retorno.payload?.error ||
                        retornoConsulta?.payload?.error ||
                        null
                });


                console.log(
                    '📨 Resultado autoenvio S-2220:',
                    {
                        eventoId:
                            id,
                        statusHttp:
                            retorno.statusHttp,
                        success:
                            retorno.payload?.success ===
                                true,
                        motivo:
                            retorno.payload?.motivo ||
                            null
                    }
                );

            } catch (
                error
            ) {

                const mensagem =
                    error?.message ||
                    String(
                        error
                    );


                console.error(
                    '❌ Autoenvio S-2220:',
                    {
                        eventoId:
                            id,
                        error:
                            mensagem
                    }
                );


                resultados.push({
                    eventoId:
                        id,
                    cpf:
                        normalizarCpfEsocial(
                            evento.cpf ||
                            ''
                        ),
                    statusHttp:
                        500,
                    success:
                        false,
                    motivo:
                        'ERRO_AUTO_ENVIO',
                    error:
                        mensagem
                });
            }
        }


        return {
            success:
                true,
            executou:
                true,
            ambiente,
            elegiveis:
                elegiveis.length,
            processados:
                resultados.length,
            resultados
        };

    } finally {

        workerAutoEnvioEsocialRodando =
            false;
    }
}


async function statusAutoEnvioEsocial() {

    const ambiente =
        obterAmbienteEsocialConfigurado();


    const elegiveis =
        await listarEventosElegiveisAutoEnvioEsocial(
            500
        );


    const pendentesConsultaLote =
        await listarEventosPendentesConsultaLoteEsocial(
            500
        );


    return {
        ativo:
            autoEnvioEsocialAtivo(),
        rodando:
            workerAutoEnvioEsocialRodando,
        ambiente,
        producaoPermitida:
            ambiente !== 1 ||
            producaoEsocialExplicitamentePermitida(),
        limitePorCiclo:
            limiteAutoEnvioEsocialPorCiclo(),
        elegiveis:
            elegiveis.length,
        pendentesConsultaLote:
            pendentesConsultaLote.length,
        consultaLoteRodando:
            workerConsultaLotesEsocialRodando,
        limiteDivergenciaAdmissaoDias:
            limiteDivergenciaAdmissaoMatriculaEsocial(),
        somenteControleExclusivo:
            true
    };
}


async function statusMatriculasEsocial() {

    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_matriculas_pendentes'
            )
            .select(
                'status'
            );


    if (
        error
    ) {

        throw error;
    }


    const contagem = {};


    for (
        const item
        of (
            Array.isArray(
                data
            )
                ? data
                : []
        )
    ) {

        const status =
            String(
                item.status ||
                'sem_status'
            );


        contagem[
            status
        ] =
            Number(
                contagem[
                    status
                ] ||
                0
            ) + 1;
    }


    return {
        workerAtivo:
            String(
                process.env.ESOCIAL_MATRICULA_WORKER_ATIVO ||
                'true'
            )
                .trim()
                .toLowerCase() !==
                'false',
        workerRodando:
            workerMatriculasEsocialRodando,
        bxBloqueadoDias1a7:
            bxBloqueadoPorCalendario(),
        dataBrasil:
            partesDataBrasil()
                .iso,
        limiteDiarioWorkerPorEmpregador:
            limiteDiarioWorkerBx(),
        fila:
            contagem
    };
}


// ============================================================
// ROTAS DE DIAGNÓSTICO / TESTE DA FILA
// ============================================================

router.get(
    '/matriculas-esocial/status',
    async (
        req,
        res
    ) => {

        try {

            return res.json({
                success:
                    true,
                ...await statusMatriculasEsocial()
            });

        } catch (
            error
        ) {

            return res
                .status(
                    500
                )
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


router.post(
    '/matriculas-esocial/semear-fila',
    async (
        req,
        res
    ) => {

        try {

            const resultado =
                await semearFilaMatriculasEsocial();


            return res.json({
                success:
                    true,
                ...resultado
            });

        } catch (
            error
        ) {

            return res
                .status(
                    500
                )
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


router.post(
    '/matriculas-esocial/processar-fila',
    async (
        req,
        res
    ) => {

        try {

            const limite =
                Math.min(
                    10,
                    Math.max(
                        1,
                        Number(
                            req.body?.limite ||
                            3
                        ) ||
                        3
                    )
                );


            const resultado =
                await processarFilaMatriculasEsocial({
                    limiteItens:
                        limite
                });


            return res.json(
                resultado
            );

        } catch (
            error
        ) {

            return res
                .status(
                    500
                )
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
// ROTAS DE DIAGNÓSTICO / TESTE DO AUTOENVIO
// ============================================================

router.get(
    '/auto-envio-esocial/status',
    async (
        req,
        res
    ) => {

        try {

            return res.json({
                success:
                    true,
                ...await statusAutoEnvioEsocial()
            });

        } catch (
            error
        ) {

            return res
                .status(
                    500
                )
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


router.post(
    '/auto-envio-esocial/processar',
    async (
        req,
        res
    ) => {

        try {

            const limite =
                Math.min(
                    20,
                    Math.max(
                        1,
                        Number(
                            req.body?.limite ||
                            limiteAutoEnvioEsocialPorCiclo()
                        ) ||
                        limiteAutoEnvioEsocialPorCiclo()
                    )
                );


            const resultado =
                await processarEnviosAutomaticosEsocial({
                    limiteItens:
                        limite
                });


            return res.json(
                resultado
            );

        } catch (
            error
        ) {

            return res
                .status(
                    500
                )
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



router.post(
    '/auto-envio-esocial/consultar-pendentes',
    async (
        req,
        res
    ) => {

        try {

            const limite =
                Math.min(
                    50,
                    Math.max(
                        1,
                        Number(
                            req.body?.limite ||
                            20
                        ) ||
                        20
                    )
                );


            const resultado =
                await processarConsultasLotesAutomaticasEsocial({
                    limiteItens:
                        limite
                });


            return res.json(
                resultado
            );

        } catch (
            error
        ) {

            return res
                .status(
                    500
                )
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


function iniciarWorkerMatriculasEsocial() {

    const ativo =
        String(
            process.env.ESOCIAL_MATRICULA_WORKER_ATIVO ||
            'true'
        )
            .trim()
            .toLowerCase() !==
            'false';


    if (
        !ativo
    ) {

        console.log(
            'ℹ️ Worker automático de matrículas eSocial desativado.'
        );

        return;
    }


    if (
        timerWorkerMatriculasEsocial
    ) {

        return;
    }


    const intervaloMs =
        Math.max(
            15 *
            60 *
            1000,
            envNumber(
                'ESOCIAL_MATRICULA_WORKER_INTERVALO_MS',
                60 *
                60 *
                1000
            )
        );


    const executar =
        async () => {

            try {

                await backfillVinculosDoCacheBxExistente();

                await semearFilaMatriculasEsocial();

                const resultado =
                    await processarFilaMatriculasEsocial({
                        limiteItens:
                            envNumber(
                                'ESOCIAL_MATRICULA_WORKER_ITENS_POR_CICLO',
                                3
                            )
                    });


                console.log(
                    '🤖 Worker matrícula eSocial:',
                    resultado
                );


                // ================================================
                // AUTOENVIO
                //
                // Funciona mesmo nos dias 1 a 7 para vínculos cuja
                // matrícula oficial já esteja em cache.
                //
                // Histórico antigo NÃO é enviado automaticamente:
                // somente eventos sob controle exclusivo.
                // ================================================

                const resultadoAutoEnvio =
                    await processarEnviosAutomaticosEsocial({
                        limiteItens:
                            limiteAutoEnvioEsocialPorCiclo()
                    });


                console.log(
                    '🚀 Worker autoenvio S-2220:',
                    resultadoAutoEnvio
                );

            } catch (
                error
            ) {

                console.error(
                    '❌ Worker automático de matrículas eSocial:',
                    error?.message ||
                    error
                );
            }
        };


    const timerInicial =
        setTimeout(
            executar,
            15000
        );


    if (
        typeof timerInicial.unref === 'function'
    ) {

        timerInicial.unref();
    }


    timerWorkerMatriculasEsocial =
        setInterval(
            executar,
            intervaloMs
        );


    if (
        typeof timerWorkerMatriculasEsocial.unref === 'function'
    ) {

        timerWorkerMatriculasEsocial.unref();
    }


    console.log(
        `🤖 Worker automático de matrículas eSocial ativo. Intervalo: ${Math.round(intervaloMs / 60000)} min.`
    );
}


// ============================================================
// MATRÍCULA OFICIAL DO VÍNCULO (S-2200 / S-2190)
// ============================================================

function localizarVinculoTrabalhistaBx(eventosBx, cpfEsperado) {
    const cpf = normalizarCpfEsocial(cpfEsperado);

    const candidatos = (Array.isArray(eventosBx) ? eventosBx : [])
        .filter(item =>
            ['S-2200', 'S-2190'].includes(item?.tipoEvento) &&
            normalizarCpfEsocial(item?.cpf) === cpf &&
            String(item?.matricula || '').trim()
        )
        .sort((a, b) => {
            const prioridadeA = a.tipoEvento === 'S-2200' ? 2 : 1;
            const prioridadeB = b.tipoEvento === 'S-2200' ? 2 : 1;

            if (prioridadeA !== prioridadeB) {
                return prioridadeB - prioridadeA;
            }

            return String(b.dataReferencia || '')
                .localeCompare(String(a.dataReferencia || ''));
        });

    return candidatos[0] || null;
}


async function aplicarMatriculaOficialBxNoEvento(evento, eventosBx) {
    const vinculo = localizarVinculoTrabalhistaBx(eventosBx, evento?.cpf);

    if (!vinculo) {
        return { encontrada: false, alterada: false, matricula: null };
    }

    // Salva o vínculo permanentemente para os próximos ASOs.
    const salvo =
        await salvarVinculoOficialEsocial(
            vinculo
        );

    const aplicado =
        await aplicarVinculoOficialNoEvento(
            evento,
            salvo || {
                ...vinculo,
                matricula_esocial:
                    vinculo.matricula,
                cod_categ:
                    vinculo.codCateg,
                data_admissao:
                    vinculo.dataReferencia
            },
            'bx'
        );

    return {
        ...aplicado,
        tipoEventoVinculo:
            vinculo.tipoEvento,
        idEventoVinculo:
            vinculo.idEvento
    };
}


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


    // ========================================================
    // QUALQUER S-2200 / S-2190 BAIXADO VIRA CACHE PERMANENTE
    // ========================================================

    await salvarVinculosOficiaisDoBx(
        eventosBx
    );


    return data ||
        [];
}

// ============================================================
// IMPORTAÇÃO MANUAL DE XML COMPLETO DO PORTAL E-SOCIAL
//
// Utilizado como alternativa segura quando o BX estiver
// indisponível.
//
// NÃO envia nada ao eSocial.
// NÃO consulta Web Service.
// Apenas lê um XML baixado diretamente do portal.
// ============================================================


// ============================================================
// EXTRAIR XML DO EVENTO COMPLETO BAIXADO DO PORTAL
// ============================================================

function interpretarXmlCompletoPortalEsocial(
    xmlCompleto
) {

    const xml =
        String(
            xmlCompleto ||
            ''
        ).trim();


    if (
        !xml
    ) {

        throw new Error(
            'XML do eSocial não informado.'
        );
    }


    // ========================================================
    // PARSE
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
            'XML do eSocial inválido.'
        );
    }


    // ========================================================
    // VERIFICAR ERRO DE PARSE
    // ========================================================

    const errosParse =
        encontrarElementosPorLocalName(
            documento,
            'parsererror',
            []
        );


    if (
        errosParse.length
    ) {

        throw new Error(
            'O arquivo informado não contém um XML válido.'
        );
    }


    // ========================================================
    // RETORNO EVENTO COMPLETO
    // ========================================================

    const retornosCompletos =
        encontrarElementosPorLocalName(
            documento,
            'retornoEventoCompleto',
            []
        );


    const retornoCompleto =
        retornosCompletos[0] ||
        null;


    if (
        !retornoCompleto
    ) {

        throw new Error(
            'retornoEventoCompleto não encontrado. ' +
            'Utilize o XML baixado pela opção de download do portal eSocial.'
        );
    }


    // ========================================================
    // CONTAINER DO EVENTO
    // ========================================================

    const containerEvento =
        primeiroFilhoPorLocalName(
            retornoCompleto,
            'evento'
        );


    if (
        !containerEvento
    ) {

        throw new Error(
            'Evento não encontrado dentro do XML.'
        );
    }


    // ========================================================
    // CONTAINER DO RECIBO
    // ========================================================

    const containerRecibo =
        primeiroFilhoPorLocalName(
            retornoCompleto,
            'recibo'
        );


    if (
        !containerRecibo
    ) {

        throw new Error(
            'Recibo não encontrado dentro do XML.'
        );
    }


    // ========================================================
    // SERIALIZAR OS DOIS XMLs INTERNOS
    // ========================================================

    const xmlEvento =
        serializarPrimeiroFilhoElementoBx(
            containerEvento
        );


    const xmlRecibo =
        serializarPrimeiroFilhoElementoBx(
            containerRecibo
        );


    if (
        !xmlEvento
    ) {

        throw new Error(
            'Conteúdo XML do evento não localizado.'
        );
    }


    if (
        !xmlRecibo
    ) {

        throw new Error(
            'Conteúdo XML do recibo não localizado.'
        );
    }


    // ========================================================
    // DOCUMENTO DO EVENTO
    // ========================================================

    const documentoEvento =
        new DOMParser()
            .parseFromString(
                xmlEvento,
                'text/xml'
            );


    // ========================================================
    // DOCUMENTO DO RECIBO
    // ========================================================

    const documentoRecibo =
        new DOMParser()
            .parseFromString(
                xmlRecibo,
                'text/xml'
            );


    // ========================================================
    // IDENTIFICAR EVENTO
    // ========================================================

    const deteccao =
        detectarTipoEventoEsocialBx(
            documentoEvento
        );


    if (
        !deteccao.tipoEvento ||
        !deteccao.noEvento
    ) {

        throw new Error(
            'O tipo de evento do XML não foi reconhecido.'
        );
    }


    if (
        ![
            'S-2220',
            'S-2240'
        ].includes(
            deteccao.tipoEvento
        )
    ) {

        throw new Error(
            `O evento ${deteccao.tipoEvento} ainda não é suportado pela importação.`
        );
    }


    // ========================================================
    // ID DO EVENTO
    // ========================================================

    const idEvento =
        String(
            deteccao.noEvento.getAttribute(
                'Id'
            ) ||
            ''
        ).trim();


    if (
        !idEvento
    ) {

        throw new Error(
            'Id do evento não encontrado no XML.'
        );
    }


    // ========================================================
    // AMBIENTE
    // ========================================================

    const tpAmb =
        String(
            textoPrimeiroElemento(
                deteccao.noEvento,
                'tpAmb'
            ) ||
            ''
        ).trim();


    /*
     * Somente aceitamos XML de PRODUÇÃO REAL.
     *
     * 1 = Produção
     * 2 = Produção Restrita
     */

    if (
        tpAmb !==
        '1'
    ) {

        throw new Error(
            'O XML informado não pertence ao ambiente de Produção real. ' +
            `tpAmb encontrado: ${tpAmb || 'não informado'}.`
        );
    }


    // ========================================================
    // RETORNO DO RECIBO
    // ========================================================

    const retornoEventoRecibo =
        encontrarElementosPorLocalName(
            documentoRecibo,
            'retornoEvento',
            []
        )[0] ||
        null;


    if (
        !retornoEventoRecibo
    ) {

        throw new Error(
            'retornoEvento não encontrado no recibo.'
        );
    }


    const idEventoRecibo =
        String(
            retornoEventoRecibo.getAttribute(
                'Id'
            ) ||
            ''
        ).trim();


    // ========================================================
    // ID DO EVENTO PRECISA BATER COM O RECIBO
    // ========================================================

    if (
        idEventoRecibo &&
        idEventoRecibo !==
            idEvento
    ) {

        throw new Error(
            'O Id do evento é diferente do Id informado no recibo.'
        );
    }


    // ========================================================
    // CÓDIGO DE PROCESSAMENTO
    // ========================================================

    const cdResposta =
        String(
            textoPrimeiroElemento(
                documentoRecibo,
                'cdResposta'
            ) ||
            ''
        ).trim();


    const descResposta =
        String(
            textoPrimeiroElemento(
                documentoRecibo,
                'descResposta'
            ) ||
            ''
        ).trim();


    // ========================================================
    // ACEITAR SOMENTE EVENTO PROCESSADO COM SUCESSO
    // ========================================================

    if (
        cdResposta !==
        '201'
    ) {

        throw new Error(
            `O XML não representa um evento concluído com sucesso. ` +
            `Código: ${cdResposta || 'não informado'}. ` +
            `${descResposta || ''}`
        );
    }


    // ========================================================
    // NÚMERO DO RECIBO
    // ========================================================

    const numeroRecibo =
        String(
            textoPrimeiroElemento(
                documentoRecibo,
                'nrRecibo'
            ) ||
            ''
        ).trim();


    if (
        !numeroRecibo
    ) {

        throw new Error(
            'Número do recibo não encontrado no XML.'
        );
    }


    // ========================================================
    // UTILIZAR NOSSO INTERPRETADOR BX EXISTENTE
    //
    // Ele já sabe extrair:
    //
    // - tipo
    // - empregador
    // - CPF
    // - matrícula
    // - categoria
    // - data
    // ========================================================

    const interpretado =
        interpretarEventoBaixadoBx({

            xmlEvento,

            xmlRecibo,

            idEvento,

            numeroRecibo
        });


    if (
        !interpretado
    ) {

        throw new Error(
            'Não foi possível interpretar os dados do evento.'
        );
    }


    // ========================================================
    // VALIDAR CPF
    // ========================================================

    const cpf =
        normalizarCpfEsocial(
            interpretado.cpf
        );


    if (
        cpf.length !==
        11
    ) {

        throw new Error(
            'CPF do trabalhador não encontrado ou inválido no XML.'
        );
    }


    // ========================================================
    // VALIDAR DATA
    // ========================================================

    if (
        !interpretado.dataReferencia
    ) {

        throw new Error(
            'Data de referência do evento não encontrada no XML.'
        );
    }


    return {

        ...interpretado,

        cpf,

        numeroRecibo,

        idEvento,

        tpAmb:
            1,

        cdResposta,

        descResposta,

        xmlEvento,

        xmlRecibo,

        xmlCompleto:
            xml
    };
}


// ============================================================
// LOCALIZAR EVENTOS LOCAIS CORRESPONDENTES
// ============================================================

async function localizarEventosLocaisDoXmlEsocial(
    eventoImportado
) {

    const {
        data,
        error
    } =
        await getSupabase()
            .from(
                'esocial_eventos'
            )
            .select(
                '*'
            )
            .eq(
                'tipo_evento',
                eventoImportado.tipoEvento
            );


    if (
        error
    ) {

        throw error;
    }


    const eventos =
        Array.isArray(
            data
        )
            ? data
            : [];


    // ========================================================
    // PRIMEIRO FILTRO:
    // MESMO CPF
    // ========================================================

    const candidatosCpf =
        eventos.filter(
            evento =>
                normalizarCpfEsocial(
                    evento.cpf
                ) ===
                eventoImportado.cpf
        );


    if (
        !candidatosCpf.length
    ) {

        return [];
    }


    // ========================================================
    // TENTATIVA 1:
    // MATCH COMPLETO JÁ UTILIZADO PELO BX
    // ========================================================

    const correspondenciasExatas =
        candidatosCpf.filter(
            evento =>
                eventoBxCorrespondeAoEventoLocal(
                    evento,
                    eventoImportado
                )
        );


    if (
        correspondenciasExatas.length
    ) {

        return correspondenciasExatas;
    }


    // ========================================================
    // TENTATIVA 2:
    //
    // Alguns registros antigos podem não ter matrícula/categoria
    // gravadas corretamente.
    //
    // Neste fallback exigimos:
    //
    // - mesmo CPF
    // - mesmo tipo
    // - mesmo empregador
    // - mesma data
    //
    // E SOMENTE aceitamos se resultar em UM único registro.
    // ========================================================

    const nrInscImportado =
        normalizarDocumentoEsocial(
            eventoImportado
                .nrInscEmpregador ||
            ''
        );


    const correspondenciasFallback =
        candidatosCpf.filter(
            evento => {

                const nrInscLocal =
                    normalizarDocumentoEsocial(
                        evento
                            .nr_insc_empregador ||
                        ''
                    );


                if (
                    nrInscLocal !==
                    nrInscImportado
                ) {

                    return false;
                }


                const dataLocal =
                    obterDataReferenciaEventoLocalBx(
                        evento
                    );


                return (
                    dataLocal &&
                    dataLocal ===
                        eventoImportado
                            .dataReferencia
                );
            }
        );


    if (
        correspondenciasFallback.length ===
        1
    ) {

        return correspondenciasFallback;
    }


    /*
     * Se houver 2 ou mais resultados no fallback,
     * não assumimos nada.
     *
     * Melhor não alterar registro algum do que marcar
     * o evento errado como concluído.
     */

    return [];
}


// ============================================================
// MARCAR EVENTOS LOCAIS COMO EXISTENTES NA PRODUÇÃO
// ============================================================

async function confirmarEventosLocaisPorXmlEsocial(
    eventosLocais,
    eventoImportado
) {

    const lista =
        Array.isArray(
            eventosLocais
        )
            ? eventosLocais
            : [];


    if (
        !lista.length
    ) {

        return [];
    }


    const agora =
        new Date()
            .toISOString();


    const atualizados =
        [];


    for (
        const evento
        of lista
    ) {

        const {
            data,
            error
        } =
            await getSupabase()
                .from(
                    'esocial_eventos'
                )
                .update({

                    // --------------------------------------------
                    // PROVA DE EXISTÊNCIA NA PRODUÇÃO REAL
                    // --------------------------------------------

                    existe_no_esocial:
                        true,

                    id_evento_esocial_existente:
                        eventoImportado
                            .idEvento,

                    numero_recibo_existente:
                        eventoImportado
                            .numeroRecibo,

                    verificado_esocial_em:
                        agora,

                    /*
                     * Não marcamos verificacao_esocial_completa=true
                     * porque não fizemos uma busca completa no BX.
                     *
                     * O XML prova definitivamente que ESTE evento
                     * existe, o que já é suficiente para bloquear
                     * qualquer reenvio.
                     */

                    verificacao_esocial_completa:
                        false,

                    updated_at:
                        agora
                })
                .eq(
                    'id',
                    evento.id
                )
                .select(
                    '*'
                )
                .single();


        if (
            error
        ) {

            throw error;
        }


        if (
            data
        ) {

            atualizados.push(
                data
            );
        }
    }


    return atualizados;
}

// ============================================================
// INTERPRETAR S-3000 BAIXADO DO PORTAL
// ============================================================

function interpretarXmlS3000PortalEsocial(
    xmlCompleto
) {

    const xml =
        String(
            xmlCompleto ||
            ''
        ).trim();


    if (
        !xml
    ) {

        throw new Error(
            'XML S-3000 vazio.'
        );
    }


    const documento =
        new DOMParser()
            .parseFromString(
                xml,
                'text/xml'
            );


    const retornoCompleto =
        encontrarElementosPorLocalName(
            documento,
            'retornoEventoCompleto',
            []
        )[0] ||
        null;


    if (
        !retornoCompleto
    ) {

        throw new Error(
            'retornoEventoCompleto não encontrado no S-3000.'
        );
    }


    const containerEvento =
        primeiroFilhoPorLocalName(
            retornoCompleto,
            'evento'
        );


    const containerRecibo =
        primeiroFilhoPorLocalName(
            retornoCompleto,
            'recibo'
        );


    if (
        !containerEvento ||
        !containerRecibo
    ) {

        throw new Error(
            'Evento ou recibo não encontrado no S-3000.'
        );
    }


    const xmlEvento =
        serializarPrimeiroFilhoElementoBx(
            containerEvento
        );


    const xmlRecibo =
        serializarPrimeiroFilhoElementoBx(
            containerRecibo
        );


    if (
        !xmlEvento ||
        !xmlRecibo
    ) {

        throw new Error(
            'XML interno do S-3000 não encontrado.'
        );
    }


    const documentoEvento =
        new DOMParser()
            .parseFromString(
                xmlEvento,
                'text/xml'
            );


    const documentoRecibo =
        new DOMParser()
            .parseFromString(
                xmlRecibo,
                'text/xml'
            );


    const deteccao =
        detectarTipoEventoEsocialBx(
            documentoEvento
        );


    if (
        deteccao.tipoEvento !==
        'S-3000'
    ) {

        throw new Error(
            'O XML informado não é S-3000.'
        );
    }


    const idEvento =
        String(
            deteccao.noEvento?.getAttribute(
                'Id'
            ) ||
            ''
        ).trim();


    if (
        !idEvento
    ) {

        throw new Error(
            'Id do S-3000 não encontrado.'
        );
    }


    const tpAmb =
        String(
            textoPrimeiroElemento(
                deteccao.noEvento,
                'tpAmb'
            ) ||
            ''
        ).trim();


    if (
        tpAmb !==
        '1'
    ) {

        throw new Error(
            'S-3000 não pertence ao ambiente de Produção.'
        );
    }


    const retornoEventoRecibo =
        encontrarElementosPorLocalName(
            documentoRecibo,
            'retornoEvento',
            []
        )[0] ||
        null;


    if (
        !retornoEventoRecibo
    ) {

        throw new Error(
            'Retorno do S-3000 não encontrado.'
        );
    }


    const cdResposta =
        String(
            textoPrimeiroElemento(
                documentoRecibo,
                'cdResposta'
            ) ||
            ''
        ).trim();


    if (
        cdResposta !==
        '201'
    ) {

        throw new Error(
            `S-3000 não foi processado com sucesso. Código ${cdResposta}.`
        );
    }


    const numeroRecibo =
        String(
            textoPrimeiroElemento(
                documentoRecibo,
                'nrRecibo'
            ) ||
            ''
        ).trim();


    if (
        !numeroRecibo
    ) {

        throw new Error(
            'Recibo do S-3000 não encontrado.'
        );
    }


    const interpretado =
        interpretarEventoBaixadoBx({

            xmlEvento,

            xmlRecibo,

            idEvento,

            numeroRecibo
        });


    if (
        !interpretado
    ) {

        throw new Error(
            'Não foi possível interpretar o S-3000.'
        );
    }


    return {

        ...interpretado,

        tpAmb:
            1,

        cdResposta,

        xmlCompleto:
            xml
    };
}

// ============================================================
// DIAGNÓSTICO - ORIGEM DO CÓDIGO DE AGENTE S-2240
// SOMENTE LEITURA
// ============================================================

router.get(
    '/diagnostico-codigo-agente-s2240/:id',
    async (req, res) => {

        try {

            const id =
                String(
                    req.params.id ||
                    ''
                ).trim();


            const {
                data: evento,
                error
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .select(
                        [
                            'id',
                            'tipo_evento',
                            'riscos_funcionario_soc',
                            'caracteristicas_riscos_ghe_soc'
                        ].join(', ')
                    )
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
                        success: false,
                        error:
                            'Evento não encontrado.'
                    });
            }


            // ====================================================
            // NORMALIZAR JSON
            // ====================================================

            const normalizarLista =
                valor => {

                    if (
                        Array.isArray(
                            valor
                        )
                    ) {
                        return valor;
                    }


                    if (
                        valor &&
                        typeof valor ===
                            'object'
                    ) {
                        return [
                            valor
                        ];
                    }


                    if (
                        typeof valor ===
                            'string' &&
                        valor.trim()
                    ) {

                        try {

                            const parsed =
                                JSON.parse(
                                    valor
                                );


                            return Array.isArray(
                                parsed
                            )
                                ? parsed
                                : parsed
                                    ? [parsed]
                                    : [];

                        } catch (error) {

                            return [];
                        }
                    }


                    return [];
                };


            const riscos1875 =
                normalizarLista(
                    evento
                        .riscos_funcionario_soc
                );


            const caracteristicas7541 =
                normalizarLista(
                    evento
                        .caracteristicas_riscos_ghe_soc
                );


            // ====================================================
            // MONTAR DIAGNÓSTICO
            // ====================================================

            const diagnostico =
                riscos1875
                    .filter(
                        risco =>
                            String(
                                risco?.codigoAgenteNocivo ||
                                ''
                            ).trim() ===
                            '05.01.001'
                    )
                    .map(
                        risco => {

                            const codRisco =
                                String(
                                    risco?.codRisco ||
                                    ''
                                ).trim();


                            const correspondencias7541 =
                                caracteristicas7541
                                    .filter(
                                        item =>
                                            String(
                                                item?.codRisco ||
                                                ''
                                            ).trim() ===
                                            codRisco
                                    );


                            return {

                                codRisco,

                                risco:
                                    risco?.risco ||
                                    '',


                                // ================================
                                // 1875
                                // ================================

                                origem1875: {

                                    codigoNormalizado:
                                        risco
                                            ?.codigoAgenteNocivo ||
                                        '',

                                    codigoRaw:
                                        risco
                                            ?.raw
                                            ?.CODIGOAGENTENOCIVO ||
                                        '',

                                    aplicaEsocialRaw:
                                        risco
                                            ?.raw
                                            ?.APLICAESOCIAL ||
                                        '',

                                    aplicaLtcatRaw:
                                        risco
                                            ?.raw
                                            ?.APLICALTCAT ||
                                        '',

                                    nomeOrigemRaw:
                                        risco
                                            ?.raw
                                            ?.NOMEORIGEM ||
                                        ''
                                },


                                // ================================
                                // 7541
                                // ================================

                                origem7541:
                                    correspondencias7541.map(
                                        item => ({

                                            ghe:
                                                item
                                                    ?.codigoGhe ||
                                                item
                                                    ?.gheAplicacao
                                                    ?.codigoGhe ||
                                                '',

                                            codigoNormalizado:
                                                item
                                                    ?.codigoAgenteNocivo ||
                                                '',

                                            CDFATORTABELA24:
                                                item
                                                    ?.raw
                                                    ?.CDFATORTABELA24 ||
                                                '',

                                            CDFATORTABELA23:
                                                item
                                                    ?.raw
                                                    ?.CDFATORTABELA23 ||
                                                '',

                                            classificacao:
                                                item
                                                    ?.classificacao ||
                                                '',

                                            aplicaEsocial1875:
                                                item
                                                    ?.aplicaEsocial1875 ??
                                                null,

                                            codigoAgenteNocivo1875:
                                                item
                                                    ?.codigoAgenteNocivo1875 ||
                                                '',

                                            codigoAgenteNocivo7541:
                                                item
                                                    ?.codigoAgenteNocivo7541 ||
                                                '',

                                            validacaoCodigoAgente:
                                                item
                                                    ?.validacaoCodigoAgente ||
                                                ''
                                        })
                                    )
                            };
                        }
                    );


            return res.json({

                success:
                    true,

                id:
                    evento.id,

                tipoEvento:
                    evento.tipo_evento,

                somenteLeitura:
                    true,

                quantidade:
                    diagnostico.length,

                diagnostico
            });


        } catch (error) {

            console.error(
                '❌ Diagnóstico código agente S-2240:',
                error
            );


            return res
                .status(500)
                .json({
                    success: false,
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
// REPROCESSAR DADOS S-2240
// SOMENTE DADOS SOC / NÃO GERA XML / NÃO ASSINA / NÃO ENVIA
// ============================================================

router.post(
    '/reprocessar-dados-s2240/:id',

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
                        success: false,
                        error:
                            'ID do evento não informado.'
                    });
            }


            // ====================================================
            // BUSCAR EVENTO ORIGINAL
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
                    .select(
                        '*'
                    )
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
                        success: false,
                        error:
                            'Evento não encontrado.'
                    });
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
                'S-2240'
            ) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            `O evento ${id} não é S-2240.`
                    });
            }


            // ====================================================
            // REPROCESSAR REGRA
            // ====================================================

            const eventosReprocessados =
                await aplicarRegraEventosEsocial(
                    [
                        evento
                    ]
                );


            const novoS2240 =
                eventosReprocessados.find(
                    item =>
                        String(
                            item?.tipoEvento ||
                            item?.tipo_evento ||
                            ''
                        )
                            .trim()
                            .toUpperCase() ===
                        'S-2240'
                );


            if (
                !novoS2240
            ) {

                return res
                    .status(422)
                    .json({
                        success: false,
                        error:
                            'A regra não gerou um novo candidato S-2240.'
                    });
            }


            // ====================================================
            // DADOS QUE SERÃO ATUALIZADOS
            // ====================================================
            //
            // SOMENTE dados ambientais.
            //
            // NÃO altera:
            // - XML
            // - assinatura
            // - protocolo
            // - recibo
            // - status de transmissão
            // ====================================================

            const dadosAtualizacao = {

                // ------------------------------------------------
                // CADASTRO / VIGÊNCIA COMPLETADOS PELO 219968
                // ------------------------------------------------

                // A matrícula retornada pelo SOC é SOMENTE matrícula SOC.
                // Nunca sobrescrever evento.matricula, que é reservado
                // para a matrícula oficial do vínculo no eSocial.
                matricula_soc:
                    novoS2240.matricula ||
                    evento.matricula_soc ||
                    (
                        !matriculaEventoEhOficial(evento)
                            ? evento.matricula
                            : null
                    ) ||
                    null,

                data_inicio_condicao:
                    novoS2240.dataInicioCondicao ||
                    novoS2240.data_inicio_condicao ||
                    evento.data_inicio_condicao ||
                    null,

                // ------------------------------------------------
                // 1875
                // ------------------------------------------------

                riscos_funcionario_soc:
                    novoS2240
                        .riscosFuncionarioSoc ||
                    [],

                agentes_nocivos_esocial:
                    novoS2240
                        .agentesNocivosEsocial ||
                    [],

                agentes_nocivos_esocial_detalhados:
                    novoS2240
                        .agentesNocivosEsocialDetalhados ||
                    [],

                consulta_riscos_funcionario_ok:
                    novoS2240
                        .consultaRiscosFuncionarioOk ===
                    true,

                erro_consulta_riscos_funcionario:
                    String(
                        novoS2240
                            .erroConsultaRiscosFuncionario ||
                        ''
                    ),


                // ------------------------------------------------
                // 11573
                // ------------------------------------------------

                ghes_aplicaveis_soc:
                    novoS2240
                        .ghesAplicaveisSoc ||
                    [],

                consulta_hierarquias_ghe_ok:
                    novoS2240
                        .consultaHierarquiasGheOk ===
                    true,

                erro_consulta_hierarquias_ghe:
                    String(
                        novoS2240
                            .erroConsultaHierarquiasGhe ||
                        ''
                    ),


                // ------------------------------------------------
                // 7541
                // ------------------------------------------------

                caracteristicas_riscos_ghe_soc:
                    novoS2240
                        .caracteristicasRiscosGheSoc ||
                    [],

                riscos_sem_caracteristica_ghe_soc:
                    novoS2240
                        .riscosSemCaracteristicaGheSoc ||
                    [],

                consulta_caracteristicas_ghe_ok:
                    novoS2240
                        .consultaCaracteristicasGheOk ===
                    true,

                erro_consulta_caracteristicas_ghe:
                    String(
                        novoS2240
                            .erroConsultaCaracteristicasGhe ||
                        ''
                    ),

                divergencias_codigo_agente_soc:
                    novoS2240
                        .divergenciasCodigoAgenteSoc ||
                    [],

                    // ------------------------------------------------
// RESPONSÁVEL AMBIENTAL / respReg
// ------------------------------------------------

responsaveis_ambientais_soc:
    Array.isArray(
        novoS2240
            .responsaveisAmbientaisSoc
    )
        ? novoS2240
            .responsaveisAmbientaisSoc
        : [],

consulta_responsaveis_ambientais_ok:
    novoS2240
        .consultaResponsaveisAmbientaisOk ===
    true,

erro_consulta_responsaveis_ambientais:
    String(
        novoS2240
            .erroConsultaResponsaveisAmbientais ||
        ''
    ),

                // ------------------------------------------------
                // CONTROLE
                // ------------------------------------------------

                updated_at:
                    new Date()
                        .toISOString()
            };


            // ====================================================
            // ATUALIZAR SOMENTE O REGISTRO INFORMADO
            // ====================================================

            const {
                error:
                    erroUpdate
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update(
                        dadosAtualizacao
                    )
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
            // MATRÍCULA OFICIAL
            //
            // O reprocessamento ambiental pode trazer a matrícula
            // interna do SOC. Ela fica em matricula_soc. Aqui
            // aplicamos a matrícula oficial já conhecida no cache
            // eSocial/BX, quando disponível.
            // ====================================================

            const eventoAtualizadoParaVinculo = {
                ...evento,
                ...dadosAtualizacao,
                id
            };

            const matriculaOficial =
                await garantirMatriculaOficialEvento(
                    eventoAtualizadoParaVinculo,
                    {
                        criarPendencia:
                            true
                    }
                );


            // ====================================================
            // RESUMO DOS AGENTES
            // ====================================================

            const agentes =
                (
                    novoS2240
                        .agentesNocivosEsocialDetalhados ||
                    []
                )
                    .map(
                        agente => ({

                            codAgNoc:
                                agente.codAgNoc ||
                                agente.codigoAgenteNocivo ||
                                '',

                            utilizEPC:
                                agente.utilizEPC ||
                                '',

                            eficEpc:
                                agente.eficEpc ||
                                '',

                            utilizEPI:
                                agente.utilizEPI ||
                                '',

                            eficEpi:
                                agente.eficEpi ||
                                '',

                            cruzamento219605Ok:
                                agente
                                    .cruzamento219605Ok ===
                                true,

                            caracteristicas7541:
                                Array.isArray(
                                    agente.caracteristicasGhe
                                )
                                    ? agente
                                        .caracteristicasGhe
                                        .length
                                    : 0,

                            caracteristicas219605:
                                Array.isArray(
                                    agente
                                        .caracteristicasTecnicas219605
                                )
                                    ? agente
                                        .caracteristicasTecnicas219605
                                        .length
                                    : 0
                                    ,

diagnosticoRiscos:
    Array.isArray(
        agente.caracteristicasGhe
    )
        ? agente.caracteristicasGhe.map(
            item => ({

                codRisco:
                    item.codRisco ||
                    '',

                nomeRisco7541:
                    item.nomeRisco ||
                    '',

                ghe:
                    item
                        ?.gheAplicacao
                        ?.codigoGhe ||
                    item.codigoGhe ||
                    '',

                encontrou219605:
                    !!item
                        .caracteristicaTecnica219605,

                nomeRisco219605:
                    item
                        ?.caracteristicaTecnica219605
                        ?.perigoFatorRisco ||
                    '',

                utilizaEPC219605:
                    item
                        ?.caracteristicaTecnica219605
                        ?.utilizaEPC ||
                    '',

                eficEpc219605:
                    item
                        ?.caracteristicaTecnica219605
                        ?.eficEpc ||
                    '',

                utilizaEPI219605:
                    item
                        ?.caracteristicaTecnica219605
                        ?.utilizaEPI ||
                    ''
            })
        )
        : []
                        })
                    );


            return res.json({

                success:
                    true,

                id:
                    id,

                tipoEvento:
                    'S-2240',

                atualizado:
                    true,

                xmlGerado:
                    false,

                assinado:
                    false,

                transmitido:
                    false,

                matriculaOficialEncontrada:
                    matriculaOficial.encontrada ===
                    true,

                matricula:
                    matriculaOficial.matricula ||
                    eventoAtualizadoParaVinculo.matricula ||
                    null,

                matriculaSoc:
                    eventoAtualizadoParaVinculo.matricula_soc ||
                    null,

                dataAdmissaoEsocial:
                    matriculaOficial.dataAdmissaoEsocial ||
                    eventoAtualizadoParaVinculo.data_admissao_esocial ||
                    null,

                ghes:
    (
        novoS2240
            .ghesAplicaveisSoc ||
        []
    )
        .map(
            item =>
                item.codigoGhe
        ),

            responsaveisAmbientais:
                novoS2240
                    .responsaveisAmbientaisSoc ||
                [],

            consultaResponsaveisAmbientaisOk:
                novoS2240
                    .consultaResponsaveisAmbientaisOk ===
                true,

            erroConsultaResponsaveisAmbientais:
                String(
                    novoS2240
                        .erroConsultaResponsaveisAmbientais ||
                    ''
                ),

            agentes
            });


        } catch (
            error
        ) {

            console.error(
                '❌ Reprocessar dados S-2240:',
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
// IMPORTAR HISTÓRICO E-SOCIAL EM MASSA POR ZIP
// ============================================================

router.post(
    '/importar-historico-esocial-zip',

    uploadZipEsocial.single(
        'arquivo'
    ),

    async (
        req,
        res
    ) => {

        try {

            // ====================================================
            // VALIDAR ARQUIVO
            // ====================================================

            if (
                !req.file ||
                !req.file.buffer
            ) {

                return res
                    .status(
                        400
                    )
                    .json({

                        success:
                            false,

                        error:
                            'Nenhum arquivo ZIP foi enviado.'
                    });
            }


            const nomeArquivo =
                String(
                    req.file.originalname ||
                    ''
                ).trim();


            if (
                !nomeArquivo
                    .toLowerCase()
                    .endsWith(
                        '.zip'
                    )
            ) {

                return res
                    .status(
                        400
                    )
                    .json({

                        success:
                            false,

                        error:
                            'O arquivo precisa estar no formato ZIP.'
                    });
            }


            // ====================================================
            // ABRIR ZIP
            // ====================================================

            let zip;


            try {

                zip =
                    new AdmZipEsocial(
                        req.file.buffer
                    );

            } catch (
                error
            ) {

                return res
                    .status(
                        400
                    )
                    .json({

                        success:
                            false,

                        error:
                            'Não foi possível abrir o arquivo ZIP.'
                    });
            }


            const todasEntradas =
                zip.getEntries();


            const entradasXml =
                todasEntradas.filter(
                    entrada =>
                        !entrada.isDirectory &&
                        String(
                            entrada.entryName ||
                            ''
                        )
                            .toLowerCase()
                            .endsWith(
                                '.xml'
                            )
                );


            if (
                !entradasXml.length
            ) {

                return res
                    .status(
                        400
                    )
                    .json({

                        success:
                            false,

                        error:
                            'Nenhum XML foi encontrado dentro do ZIP.'
                    });
            }


            // ====================================================
            // PROTEÇÃO
            // ====================================================

            if (
                entradasXml.length >
                20000
            ) {

                return res
                    .status(
                        400
                    )
                    .json({

                        success:
                            false,

                        error:
                            'O ZIP contém mais de 20.000 XMLs. Divida o arquivo.'
                    });
            }


            // ====================================================
            // CONTADORES
            // ====================================================

            let processados =
                0;

            let importados =
                0;

            let s2220 =
                0;

            let s2240 =
                0;

            let s3000 =
                0;

            let registrosLocaisAtualizados =
                0;

            let semCorrespondencia =
                0;

            let ignorados =
                0;

            let duplicadosNoZip =
                0;

            let erros =
                0;

            let bytesDescompactados =
                0;


            const idsProcessados =
                new Set();


            const detalhesErros =
                [];


            const detalhesSemCorrespondencia =
                [];


            // ====================================================
            // PROCESSAR TODOS OS XMLs
            // ====================================================

            for (
                let indice = 0;
                indice < entradasXml.length;
                indice++
            ) {

                const entrada =
                    entradasXml[
                        indice
                    ];


                const nomeXml =
                    String(
                        entrada.entryName ||
                        `xml-${indice + 1}.xml`
                    );


                try {

                    const buffer =
                        entrada.getData();


                    bytesDescompactados +=
                        buffer.length;


                    // ================================================
                    // PROTEÇÃO CONTRA ZIP GIGANTE DESCOMPACTADO
                    // ================================================

                    if (
                        bytesDescompactados >
                        300 *
                        1024 *
                        1024
                    ) {

                        throw new Error(
                            'O conteúdo descompactado ultrapassou 300 MB.'
                        );
                    }


                    const xml =
                        buffer
                            .toString(
                                'utf8'
                            )
                            .replace(
                                /^\uFEFF/,
                                ''
                            )
                            .trim();


                    if (
                        !xml
                    ) {

                        ignorados++;

                        continue;
                    }


                    processados++;


                    // ================================================
                    // IDENTIFICAR S-3000
                    // ================================================

                    const documentoRapido =
                        new DOMParser()
                            .parseFromString(
                                xml,
                                'text/xml'
                            );


                    const possuiS3000 =
                        encontrarElementosPorLocalName(
                            documentoRapido,
                            'evtExclusao',
                            []
                        ).length >
                        0;


                    let eventoImportado;


                    // ================================================
                    // S-3000
                    // ================================================

                    if (
                        possuiS3000
                    ) {

                        eventoImportado =
                            interpretarXmlS3000PortalEsocial(
                                xml
                            );

                    } else {

                        // ============================================
                        // S-2220 / S-2240
                        // ============================================

                        try {

                            eventoImportado =
                                interpretarXmlCompletoPortalEsocial(
                                    xml
                                );

                        } catch (
                            error
                        ) {

                            const mensagem =
                                String(
                                    error?.message ||
                                    ''
                                );


                            /*
                             * O ZIP do eSocial pode conter muitos
                             * outros tipos de evento.
                             *
                             * Eles não são erro para nosso objetivo.
                             */

                            if (
                                mensagem.includes(
                                    'ainda não é suportado'
                                ) ||
                                mensagem.includes(
                                    'tipo de evento'
                                )
                            ) {

                                ignorados++;

                                continue;
                            }


                            throw error;
                        }
                    }


                    if (
                        !eventoImportado ||
                        !eventoImportado.idEvento
                    ) {

                        ignorados++;

                        continue;
                    }


                    // ================================================
                    // DUPLICIDADE DENTRO DO PRÓPRIO ZIP
                    // ================================================

                    if (
                        idsProcessados.has(
                            eventoImportado.idEvento
                        )
                    ) {

                        duplicadosNoZip++;

                        continue;
                    }


                    idsProcessados.add(
                        eventoImportado.idEvento
                    );


                    // ================================================
                    // SALVAR NO ESPELHO
                    // ================================================

                    await salvarEventosBxNoBanco([
                        eventoImportado
                    ]);


                    importados++;


                    // ================================================
                    // TIPO
                    // ================================================

                    if (
                        eventoImportado.tipoEvento ===
                        'S-2220'
                    ) {

                        s2220++;

                    } else if (
                        eventoImportado.tipoEvento ===
                        'S-2240'
                    ) {

                        s2240++;

                    } else if (
                        eventoImportado.tipoEvento ===
                        'S-3000'
                    ) {

                        s3000++;
                    }


                    // ================================================
                    // S-3000:
                    //
                    // O TRIGGER DO BANCO FAZ A REVERSÃO DO EVENTO
                    // REFERENCIADO.
                    // ================================================

                    if (
                        eventoImportado.tipoEvento ===
                        'S-3000'
                    ) {

                        continue;
                    }


                    // ================================================
                    // LOCALIZAR EVENTO NO NOSSO SISTEMA
                    // ================================================

                    const eventosLocais =
                        await localizarEventosLocaisDoXmlEsocial(
                            eventoImportado
                        );


                    if (
                        !eventosLocais.length
                    ) {

                        semCorrespondencia++;


                        if (
                            detalhesSemCorrespondencia.length <
                            100
                        ) {

                            detalhesSemCorrespondencia.push({

                                arquivo:
                                    nomeXml,

                                tipoEvento:
                                    eventoImportado.tipoEvento,

                                cpf:
                                    eventoImportado.cpf,

                                matricula:
                                    eventoImportado.matricula,

                                dataReferencia:
                                    eventoImportado.dataReferencia,

                                idEvento:
                                    eventoImportado.idEvento
                            });
                        }


                        continue;
                    }


                    // ================================================
                    // CONFIRMAR LOCALMENTE
                    // ================================================

                    const atualizados =
                        await confirmarEventosLocaisPorXmlEsocial(

                            eventosLocais,

                            eventoImportado
                        );


                    registrosLocaisAtualizados +=
                        atualizados.length;


                } catch (
                    error
                ) {

                    erros++;


                    console.error(
                        '❌ Erro no XML do ZIP:',
                        nomeXml,
                        error?.message ||
                        error
                    );


                    if (
                        detalhesErros.length <
                        100
                    ) {

                        detalhesErros.push({

                            arquivo:
                                nomeXml,

                            erro:
                                error?.message ||
                                String(
                                    error
                                )
                        });
                    }
                }
            }


            // ====================================================
            // RETORNO
            // ====================================================

            return res.json({

                success:
                    true,

                arquivo:
                    nomeArquivo,

                quantidadeXmlNoZip:
                    entradasXml.length,

                processados,

                importados,

                tipos: {

                    s2220,

                    s2240,

                    s3000
                },

                registrosLocaisAtualizados,

                semCorrespondencia,

                ignorados,

                duplicadosNoZip,

                erros,

                tamanhoDescompactadoMb:
                    Number(
                        (
                            bytesDescompactados /
                            1024 /
                            1024
                        ).toFixed(
                            2
                        )
                    ),

                detalhesSemCorrespondencia,

                detalhesErros,

                message:
                    `Histórico importado. ` +
                    `${importados} evento(s) real(is) gravado(s) e ` +
                    `${registrosLocaisAtualizados} registro(s) local(is) atualizado(s).`
            });


        } catch (
            error
        ) {

            console.error(
                '❌ Erro importando ZIP eSocial:',
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
                        error?.message ||
                        String(
                            error
                        )
                });
        }
    }
);


// ============================================================
// IMPORTAR XML COMPLETO BAIXADO DO PORTAL E-SOCIAL
// ============================================================

router.post(
    '/importar-evento-esocial-xml',

    async (
        req,
        res
    ) => {

        try {

            const xml =
                String(
                    req.body?.xml ||
                    ''
                ).trim();


            const nomeArquivo =
                String(
                    req.body?.nomeArquivo ||
                    ''
                ).trim();


            if (
                !xml
            ) {

                return res
                    .status(
                        400
                    )
                    .json({

                        success:
                            false,

                        error:
                            'Conteúdo XML não informado.'
                    });
            }


            // ====================================================
            // EVITAR ARQUIVOS ABSURDAMENTE GRANDES
            // ====================================================

            if (
                xml.length >
                5 *
                1024 *
                1024
            ) {

                return res
                    .status(
                        413
                    )
                    .json({

                        success:
                            false,

                        error:
                            'O XML informado é maior que o limite permitido.'
                    });
            }


            // ====================================================
            // INTERPRETAR
            // ====================================================

            const eventoImportado =
                interpretarXmlCompletoPortalEsocial(
                    xml
                );


            console.log(
                '📥 XML eSocial importado:',
                {

                    arquivo:
                        nomeArquivo ||
                        null,

                    tipoEvento:
                        eventoImportado
                            .tipoEvento,

                    cpf:
                        eventoImportado
                            .cpf,

                    matricula:
                        eventoImportado
                            .matricula,

                    dataReferencia:
                        eventoImportado
                            .dataReferencia,

                    idEvento:
                        eventoImportado
                            .idEvento,

                    numeroRecibo:
                        eventoImportado
                            .numeroRecibo
                }
            );


            // ====================================================
            // SALVAR COMO EVENTO REAL DO E-SOCIAL
            //
            // Usa a mesma tabela utilizada pelos downloads BX.
            // ====================================================

            await salvarEventosBxNoBanco([
                eventoImportado
            ]);


            // ====================================================
            // LOCALIZAR NA NOSSA TABELA
            // ====================================================

            const eventosLocais =
                await localizarEventosLocaisDoXmlEsocial(
                    eventoImportado
                );


            // ====================================================
            // XML VÁLIDO, MAS NÃO ACHAMOS REGISTRO LOCAL
            // ====================================================

            if (
                !eventosLocais.length
            ) {

                return res.json({

                    success:
                        true,

                    importado:
                        true,

                    encontradoNoSistema:
                        false,

                    quantidadeAtualizada:
                        0,

                    message:
                        'XML válido e confirmado como evento de Produção, ' +
                        'mas nenhum registro correspondente foi localizado no sistema.',

                    arquivo:
                        nomeArquivo ||
                        null,

                    evento: {

                        tipoEvento:
                            eventoImportado
                                .tipoEvento,

                        cpf:
                            eventoImportado
                                .cpf,

                        matricula:
                            eventoImportado
                                .matricula,

                        dataReferencia:
                            eventoImportado
                                .dataReferencia,

                        nrInscEmpregador:
                            eventoImportado
                                .nrInscEmpregador,

                        idEvento:
                            eventoImportado
                                .idEvento,

                        numeroRecibo:
                            eventoImportado
                                .numeroRecibo
                    }
                });
            }


            // ====================================================
            // CONFIRMAR NO NOSSO BANCO
            // ====================================================

            const atualizados =
                await confirmarEventosLocaisPorXmlEsocial(

                    eventosLocais,

                    eventoImportado
                );


            // ====================================================
            // RETORNO
            // ====================================================

            return res.json({

                success:
                    true,

                importado:
                    true,

                encontradoNoSistema:
                    true,

                quantidadeAtualizada:
                    atualizados.length,

                message:
                    atualizados.length ===
                        1
                        ? (
                            'Evento encontrado no sistema e confirmado ' +
                            'como emitido no eSocial de Produção.'
                        )
                        : (
                            `${atualizados.length} registros foram confirmados ` +
                            'como emitidos no eSocial de Produção.'
                        ),

                arquivo:
                    nomeArquivo ||
                    null,

                evento: {

                    tipoEvento:
                        eventoImportado
                            .tipoEvento,

                    cpf:
                        eventoImportado
                            .cpf,

                    matricula:
                        eventoImportado
                            .matricula,

                    dataReferencia:
                        eventoImportado
                            .dataReferencia,

                    nrInscEmpregador:
                        eventoImportado
                            .nrInscEmpregador,

                    idEvento:
                        eventoImportado
                            .idEvento,

                    numeroRecibo:
                        eventoImportado
                            .numeroRecibo,

                    cdResposta:
                        eventoImportado
                            .cdResposta
                },

                eventosLocais:
                    atualizados.map(
                        evento => ({

                            id:
                                evento.id,

                            colaborador:
                                evento.colaborador ||
                                null,

                            cpf:
                                evento.cpf,

                            tipoEvento:
                                evento.tipo_evento,

                            dataExame:
                                evento.data_exame
                        })
                    )
            });


        } catch (
            error
        ) {

            console.error(
                '❌ Erro importando XML do eSocial:',
                error?.message ||
                error
            );


            return res
                .status(
                    400
                )
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

async function verificarEventoExistenteNoEsocialAntesDoEnvio(
    evento
) {

    if (
        !evento ||
        typeof evento !==
            'object'
    ) {

        throw new Error(
            'Evento não informado para verificação.'
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
    // JÁ CONFIRMADO NO E-SOCIAL
    //
    // PRIMEIRA TRAVA.
    // ========================================================

    if (
        evento.existe_no_esocial ===
            true ||
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
                'espelho-confirmado',

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


    // ========================================================
    // NOVOS EVENTOS SOB CONTROLE EXCLUSIVO
    //
    // NÃO CONSULTA BX.
    //
    // Nossa base + SOC + nossos próprios envios passam a ser
    // a fonte de controle depois da data de corte.
    // ========================================================

    if (
        eventoSobControleExclusivoEsocial(
            evento
        )
    ) {

        return {

            success:
                true,

            verificacaoCompleta:
                true,

            jaExisteNoEsocial:
                false,

            origem:
                'controle-exclusivo',

            eventoForaJanelaSegura:
                false,

            dataReferencia:
                obterDataReferenciaEventoLocalBx(
                    evento
                ),

            correspondente:
                null,

            consulta: {

                realizada:
                    false,

                motivo:
                    'Evento posterior à data de início do controle exclusivo.'
            },

            download: {

                realizado:
                    false
            }
        };
    }


    // ========================================================
    // HISTÓRICO ANTIGO
    //
    // Para eventos anteriores à data de corte ainda precisamos
    // do BX ou da nossa carga histórica do eSocial.
    // ========================================================

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
        cpf.length !==
        11
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


    const vinculoBx =
        await aplicarMatriculaOficialBxNoEvento(
            evento,
            resultadoDownload.eventosInterpretados
        );


    const correspondente =
        resultadoDownload.correspondente ||
        null;


    const consultaCompleta =
        Boolean(
            consulta.consultaCompleta
        );


    const verificacaoCompleta =
        !correspondente &&
        consultaCompleta &&
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

            eventoForaJanelaSegura =
                dataReferenciaDate.getTime() <
                (
                    Date.now() -
                    (
                        30 *
                        24 *
                        60 *
                        60 *
                        1000
                    )
                );
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

        vinculoBx,

        consulta: {

            cdResposta:
                consulta.cdResposta,

            descResposta:
                consulta.descResposta,

            quantidadeTotalEncontrada:
                consulta.qtdeTotEvtsConsulta,

            quantidadeRetornada:
                consulta.identificadores.length,

            consultaCompleta,

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
                resultadoDownload
                    .eventosInterpretados
                    .length,

            falhas:
                resultadoDownload.falhas,

            todosProcessados:
                resultadoDownload.todosProcessados,

            interrompidoPorCorrespondencia:
                resultadoDownload
                    .interrompidoPorCorrespondencia
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


            const vinculoBx =
                await aplicarMatriculaOficialBxNoEvento(
                    evento,
                    resultadoDownload.eventosInterpretados
                );


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

                vinculoTrabalhista:
                    vinculoBx,

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
// ASSINAR EVENTO S-2220 / S-2240
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
            // EVENTOS SUPORTADOS
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
                            'A assinatura direta está disponível somente para S-2220 e S-2240.'
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

                    tipoEvento,

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

                const gerarXmlEvento =
                    tipoEvento === 'S-2240'
                        ? gerarXmlS2240
                        : gerarXmlS2220;


                const resultadoXml =
                    gerarXmlEvento(
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

                tipoEvento,

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
            // EVENTOS SUPORTADOS
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
                            'A validação XSD está disponível somente para S-2220 e S-2240.'
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

            const validarContraXsd =
                tipoEvento === 'S-2240'
                    ? validarXmlS2240ContraXsd
                    : validarXmlS2220ContraXsd;


            const resultado =
                await validarContraXsd(
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
            // EVENTOS SUPORTADOS
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
                            'O envio direto está disponível somente para S-2220 e S-2240.'
                    });
            }


            // ====================================================
            // S-2220 / S-2240:
            // NUNCA TRANSMITIR COM MATRÍCULA DO SOC
            // ====================================================

            if (
                [
                    'S-2220',
                    'S-2240'
                ].includes(
                    tipoEvento
                )
            ) {

                const matriculaOficial =
                    await garantirMatriculaOficialEvento(
                        evento,
                        {
                            criarPendencia:
                                true
                        }
                    );


                if (
                    matriculaOficial.encontrada !==
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
                            motivo:
                                'MATRICULA_ESOCIAL_PENDENTE',
                            bxBloqueadoDias1a7:
                                bxBloqueadoPorCalendario(),
                            error:
                                'A matrícula oficial do vínculo ainda não foi localizada. ' +
                                'O evento está na fila automática e não será enviado com a matrícula do SOC.'
                        });
                }
            }


            // ====================================================
            // TRAVA EXCLUSIVA DO S-2240 EM PRODUÇÃO
            // ====================================================

            if (
                tipoEvento === 'S-2240' &&
                ambiente === 1 &&
                String(
                    process.env.ESOCIAL_PERMITIR_S2240_PRODUCAO ||
                    ''
                )
                    .trim()
                    .toLowerCase() !== 'true'
            ) {

                return res
                    .status(409)
                    .json({
                        success: false,
                        bloqueado: true,
                        podeEnviar: false,
                        ambiente,
                        motivo:
                            'PRODUCAO_S2240_NAO_AUTORIZADA',
                        error:
                            'O envio de S-2240 em Produção permanece bloqueado. ' +
                            'Use Produção Restrita para o primeiro envio controlado.'
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


            // ============================================================
// NÃO REENVIAR TENTATIVA DO MESMO AMBIENTE
//
// IMPORTANTE:
//
// Um teste antigo feito em Produção Restrita (tpAmb=2)
// NÃO pode impedir posteriormente o primeiro envio real
// em Produção (tpAmb=1).
//
// Porém:
//
// - recibo/protocolo de Produção bloqueia Produção;
// - recibo/protocolo de ambiente desconhecido bloqueia por segurança;
// - envio incerto no MESMO ambiente bloqueia.
// ============================================================

const ambienteTentativaAnterior =
    Number(
        evento.ambiente_esocial
    );


const possuiAmbienteAnteriorConhecido =
    ambienteTentativaAnterior === 1 ||
    ambienteTentativaAnterior === 2;


const tentativaAnteriorMesmoAmbiente =
    possuiAmbienteAnteriorConhecido &&
    ambienteTentativaAnterior ===
        ambiente;


const tentativaAnteriorOutroAmbiente =
    possuiAmbienteAnteriorConhecido &&
    ambienteTentativaAnterior !==
        ambiente;


// ============================================================
// RECIBO ANTERIOR
// ============================================================

const numeroReciboAnterior =
    String(
        evento.numero_recibo ||
        ''
    ).trim();


if (
    numeroReciboAnterior
) {

    /*
     * Se estamos indo para Produção e o recibo antigo
     * pertence explicitamente à Produção Restrita,
     * NÃO bloqueamos.
     *
     * Recibo de Produção ou de ambiente desconhecido:
     * bloqueamos.
     */

    const reciboRestritoIgnoravel =
        ambiente === 1 &&
        ambienteTentativaAnterior === 2;


    if (
        !reciboRestritoIgnoravel
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
                    'Este evento já possui recibo de uma tentativa ' +
                    'compatível com o ambiente atual ou de ambiente não identificado. ' +
                    'O reenvio foi bloqueado.',

                numeroRecibo:
                    numeroReciboAnterior,

                ambienteAtual:
                    ambiente,

                ambienteAnterior:
                    possuiAmbienteAnteriorConhecido
                        ? ambienteTentativaAnterior
                        : null
            });
    }


    console.log(
        'ℹ️ Recibo antigo de Produção Restrita não bloqueará ' +
        'o primeiro envio em Produção:',
        {
            eventoId:
                evento.id,

            numeroReciboAnterior,

            ambienteAnterior:
                ambienteTentativaAnterior,

            ambienteAtual:
                ambiente
        }
    );
}


// ============================================================
// PROTOCOLO ANTERIOR
// ============================================================

const protocoloAnterior =
    String(
        evento.protocolo_envio ||
        ''
    ).trim();


if (
    protocoloAnterior
) {

    /*
     * Produção + protocolo explicitamente da Produção Restrita:
     * pode seguir.
     */

    const protocoloRestritoIgnoravel =
        ambiente === 1 &&
        ambienteTentativaAnterior === 2;


    if (
        !protocoloRestritoIgnoravel
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
                    'Este evento já possui protocolo de envio no ambiente atual ' +
                    'ou o ambiente da tentativa anterior não pôde ser confirmado. ' +
                    'A tentativa existente deve ser consultada e não será reenviada.',

                protocoloEnvio:
                    protocoloAnterior,

                ambienteAtual:
                    ambiente,

                ambienteAnterior:
                    possuiAmbienteAnteriorConhecido
                        ? ambienteTentativaAnterior
                        : null
            });
    }


    console.log(
        'ℹ️ Protocolo antigo de Produção Restrita não bloqueará ' +
        'o primeiro envio em Produção:',
        {
            eventoId:
                evento.id,

            protocoloAnterior,

            ambienteAnterior:
                ambienteTentativaAnterior,

            ambienteAtual:
                ambiente
        }
    );
}


// ============================================================
// ENVIO INCERTO
// ============================================================

const envioIncertoAnterior =
    String(
        evento.status ||
        ''
    )
        .trim()
        .toLowerCase() ===
    'envio_incerto';


const erroIncertoAnterior =
    String(
        evento.erro_esocial ||
        ''
    );


const envioIncertoComprovadamenteLocal =
    envioIncertoAnterior &&
    !protocoloAnterior &&
    erroIncertoAnterior.includes(
        'ESOCIAL_URL_ENVIO_RESTRITA is not defined'
    );


if (
    envioIncertoAnterior &&
    !envioIncertoComprovadamenteLocal
) {

    /*
     * Se sabemos que a situação incerta pertence somente
     * à Produção Restrita e agora estamos indo para Produção,
     * ela não bloqueia o envio real.
     *
     * Se foi no mesmo ambiente ou não sabemos o ambiente,
     * bloqueamos.
     */

    const envioIncertoRestritoIgnoravel =
        ambiente === 1 &&
        ambienteTentativaAnterior === 2;


    if (
        !envioIncertoRestritoIgnoravel
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
                    'Existe uma tentativa anterior com resultado incerto ' +
                    'no mesmo ambiente ou em ambiente não identificado. ' +
                    'Não será feito novo envio até essa tentativa ser verificada.',

                ambienteAtual:
                    ambiente,

                ambienteAnterior:
                    possuiAmbienteAnteriorConhecido
                        ? ambienteTentativaAnterior
                        : null
            });
    }


    console.log(
        'ℹ️ Situação incerta antiga pertence à Produção Restrita. ' +
        'Ela não bloqueará o primeiro envio em Produção.',
        {
            eventoId:
                evento.id,

            ambienteAnterior:
                ambienteTentativaAnterior,

            ambienteAtual:
                ambiente
        }
    );
}


if (
    envioIncertoComprovadamenteLocal
) {

    console.warn(
        '♻️ Liberando nova tentativa após erro local anterior à conexão:',
        {
            eventoId: evento.id,
            ambiente
        }
    );
}


// ============================================================
// LOG DE TROCA DE AMBIENTE
// ============================================================

if (
    tentativaAnteriorOutroAmbiente
) {

    console.log(
        '🔄 Evento possui histórico em outro ambiente:',
        {
            eventoId:
                evento.id,

            ambienteAnterior:
                ambienteTentativaAnterior,

            ambienteAtual:
                ambiente
        }
    );
}


            // ====================================================
            // GERAR XML NOVO
            //
            // Não reutiliza xml_gerado/xml_assinado antigo.
            // ====================================================

            const gerarXmlEvento =
                tipoEvento === 'S-2240'
                    ? gerarXmlS2240
                    : gerarXmlS2220;


            const validarXmlEvento =
                tipoEvento === 'S-2240'
                    ? validarXmlS2240ContraXsd
                    : validarXmlS2220ContraXsd;


            const resultadoXml =
                gerarXmlEvento(
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
                await validarXmlEvento(
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


                const mensagemTransmissao =
                    erroTransmissao?.message ||
                    String(
                        erroTransmissao
                    );


                const erroLocalAntesHttp =
                    erroTransmissao instanceof ReferenceError ||
                    /^ESOCIAL_[A-Z0-9_]+\s+(não configurado|não encontrado)/i
                        .test(
                            mensagemTransmissao
                        );


                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .update({

                        data_envio:
                            erroLocalAntesHttp
                                ? null
                                : agoraErro,

                        ambiente_esocial:
                            ambiente,

                        status:
                            erroLocalAntesHttp
                                ? 'erro_pre_transmissao'
                                : 'envio_incerto',

                        erro_esocial:
                            mensagemTransmissao,

                        codigo_erro_esocial:
                            erroLocalAntesHttp
                                ? 'ERRO_PRE_TRANSMISSAO'
                                : 'ENVIO_INCERTO',

                        updated_at:
                            agoraErro
                    })
                    .eq(
                        'id',
                        evento.id
                    );


                if (
                    erroLocalAntesHttp
                ) {

                    return res
                        .status(500)
                        .json({
                            success: false,
                            enviadoAoEsocial: false,
                            bloqueado: false,
                            podeReenviar: true,
                            ambiente,
                            eventoId: evento.id,
                            idEvento:
                                resultadoXml.idEvento,
                            motivo:
                                'ERRO_PRE_TRANSMISSAO',
                            error:
                                'O envio não foi iniciado por causa de um erro local de configuração.',
                            detalhe:
                                mensagemTransmissao
                        });
                }


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
                            mensagemTransmissao
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

                tipoSaida,

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

                    filtros,

                    tipoSaida
                });


            const registros =
                localizarRegistrosExportaDados(
                    dados
                );


            return res.json({

                success:
                    true,

                tipo,

                tipoSaida:
                    tipoSaida ||
                    SOC_CONFIG.tipoSaida,

                empresa:
                    empresa ||
                    SOC_CONFIG.empresaPrincipal,

                empresaTrabalho:
                    empresaTrabalho ||
                    null,

                quantidade:
                    registros.length,

                registros,

                dados
            });


        } catch (
            error
        ) {

            const detalhe =
                formatarErro(
                    error
                );


            console.error(
                '❌ Erro Exporta Dados:',
                detalhe
            );


            return res
                .status(502)
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

const eventosGerados =
    await aplicarRegraEventosEsocial(
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

const ESOCIAL_NAMESPACE_S2240 =
    'http://www.esocial.gov.br/schema/evt/evtExpRisco/v_S_01_03_00';    


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
// GERAR XML S-2240
// ============================================================

function gerarXmlS2240(
    evento,
    opcoes = {}
) {

    if (
        !evento ||
        typeof evento !== 'object'
    ) {
        throw new Error(
            'Evento S-2240 não informado.'
        );
    }


    // ========================================================
    // AUXILIARES LOCAIS
    // ========================================================

    const primeiroTexto = (...valores) => {

        for (const valor of valores) {

            if (
                valor !== undefined &&
                valor !== null &&
                String(valor).trim() !== ''
            ) {
                return String(valor).trim();
            }
        }

        return '';
    };


    const normalizarSimNao = valor => {

        if (
            valor === true ||
            valor === 1 ||
            valor === '1'
        ) {
            return 'S';
        }

        if (
            valor === false ||
            valor === 0 ||
            valor === '0'
        ) {
            return 'N';
        }

        const texto =
            String(valor || '')
                .trim()
                .toUpperCase();

        if (
            texto === 'S' ||
            texto === 'SIM'
        ) {
            return 'S';
        }

        if (
            texto === 'N' ||
            texto === 'NAO' ||
            texto === 'NÃO'
        ) {
            return 'N';
        }

        return '';
    };


    const normalizarDecimal = valor => {

        const texto =
            String(
                valor ?? ''
            )
                .trim()
                .replace(',', '.');

        if (!texto) {
            return '';
        }

        if (
            !/^\d+(?:\.\d{1,4})?$/.test(
                texto
            )
        ) {
            throw new Error(
                `Valor quantitativo inválido: "${texto}".`
            );
        }

        return texto;
    };


    // ========================================================
    // AMBIENTE eSOCIAL
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
        primeiroTexto(
            evento.tp_insc_empregador,
            evento.tpInscEmpregador
        );


    const nrInsc =
        primeiroTexto(
            evento.nr_insc_empregador,
            evento.nrInscEmpregador
        )
            .replace(
                /[^0-9A-Za-z]/g,
                ''
            )
            .toUpperCase();


    if (
        ![
            '1',
            '2'
        ].includes(
            tpInsc
        )
    ) {
        throw new Error(
            'Tipo de inscrição do empregador inválido no S-2240.'
        );
    }


    if (
        tpInsc === '1' &&
        ![
            8,
            14
        ].includes(
            nrInsc.length
        )
    ) {
        throw new Error(
            `nrInsc do empregador inválido: ${nrInsc.length} posições.`
        );
    }


    if (
        tpInsc === '2' &&
        nrInsc.length !== 11
    ) {
        throw new Error(
            'CPF do empregador deve possuir 11 posições.'
        );
    }


    // ========================================================
    // TRABALHADOR / VÍNCULO
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
        primeiroTexto(
            evento.matricula
        );


    const codCateg =
        primeiroTexto(
            evento.cod_categ,
            evento.codCateg
        );


    if (
        !matricula &&
        !codCateg
    ) {
        throw new Error(
            'O S-2240 precisa possuir matrícula ou codCateg.'
        );
    }


    let xmlVinculo =
        '';


    if (
        matricula
    ) {

        if (
            matricula.length > 30
        ) {
            throw new Error(
                'A matrícula possui mais de 30 caracteres.'
            );
        }

        xmlVinculo +=
            `      <matricula>${escaparXmlEsocial(matricula)}</matricula>\n`;

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

        xmlVinculo +=
            `      <codCateg>${escaparXmlEsocial(codCateg)}</codCateg>\n`;
    }


    // ========================================================
    // DATA DE INÍCIO DA CONDIÇÃO
    // ========================================================

    // ========================================================
// DATA DE INÍCIO DA CONDIÇÃO
// ========================================================

const ghesParaDataCondicao =
    normalizarArrayEsocial(
        evento.ghes_aplicaveis_soc ||
        evento.ghesAplicaveisSoc ||
        []
    );


const ghePrincipalParaData =
    ghesParaDataCondicao.find(
        item =>
            String(
                item?.origemAplicacao ||
                item?.origem_aplicacao ||
                ''
            )
                .trim()
                .toLowerCase() ===
            'funcionário'
    ) ||
    ghesParaDataCondicao[0] ||
    {};


const dtIniCondicaoInformada =
    primeiroTexto(
        evento.dt_ini_condicao,
        evento.dtIniCondicao,
        evento.data_inicio_condicao,
        evento.dataInicioCondicao,

        // Data real em que o GHE começou a valer
        // para este trabalhador segundo o SOC.
        ghePrincipalParaData.dataInicial,
        ghePrincipalParaData.data_inicial,

        // Último fallback: admissão de origem SOC/local.
        evento.data_admissao,
        evento.dataAdmissao
    )
        .substring(
            0,
            10
        );


const dataAdmissaoOficialEsocial =
    primeiroTexto(
        evento.data_admissao_esocial,
        evento.dataAdmissaoEsocial
    )
        .substring(
            0,
            10
        );


/*
 * O S-2240 não pode iniciar uma condição para este empregador
 * antes de o vínculo existir no RET/eSocial.
 *
 * O SOC pode informar uma data anterior. Preservamos essa data
 * no banco, mas para o XML usamos a mais recente entre:
 * - início real da condição informado pelo SOC;
 * - admissão oficial do vínculo no eSocial.
 */
let dtIniCondicao =
    dtIniCondicaoInformada;


if (
    dataAdmissaoOficialEsocial &&
    validarDataEsocial(
        dataAdmissaoOficialEsocial
    ) &&
    (
        !dtIniCondicao ||
        dataAdmissaoOficialEsocial >
            dtIniCondicao
    )
) {

    dtIniCondicao =
        dataAdmissaoOficialEsocial;
}

    if (
        !validarDataEsocial(
            dtIniCondicao
        )
    ) {
        throw new Error(
            `dtIniCondicao não informada ou inválida: "${dtIniCondicao}".`
        );
    }


    const dtFimCondicao =
        primeiroTexto(
            evento.dt_fim_condicao,
            evento.dtFimCondicao,
            evento.data_fim_condicao,
            evento.dataFimCondicao
        )
            .substring(
                0,
                10
            );


    if (
        dtFimCondicao &&
        !validarDataEsocial(
            dtFimCondicao
        )
    ) {
        throw new Error(
            `dtFimCondicao inválida: "${dtFimCondicao}".`
        );
    }


    /*
     * Empregado comum não deve receber dtFimCondicao
     * somente porque foi desligado.
     *
     * Esse campo possui regra específica principalmente
     * para trabalhador avulso.
     */

    if (
        dtFimCondicao &&
        codCateg &&
        !codCateg.startsWith(
            '2'
        )
    ) {
        throw new Error(
            'dtFimCondicao não deve ser usado como encerramento comum de empregado.'
        );
    }


    // ========================================================
    // AMBIENTE DE TRABALHO
    // ========================================================

    const ghes =
        normalizarArrayEsocial(
            evento.ghes_aplicaveis_soc ||
            evento.ghesAplicaveisSoc ||
            []
        );


    let ambientes =
        normalizarArrayEsocial(
            evento.ambientes_s2240 ||
            evento.ambientesS2240 ||
            evento.info_amb ||
            evento.infoAmb ||
            []
        );


    /*
     * Se ainda não existe uma estrutura "ambientesS2240",
     * podemos montar o ambiente básico usando o GHE já
     * identificado + CNPJ da unidade.
     */

    if (
        ambientes.length === 0
    ) {

        const ghePrincipal =
            ghes.find(
                item =>
                    String(
                        item?.origemAplicacao ||
                        ''
                    )
                        .trim()
                        .toLowerCase() ===
                    'funcionário'
            ) ||
            ghes[0] ||
            {};


        ambientes = [
            {
                localAmb:
                    primeiroTexto(
                        evento.local_amb,
                        evento.localAmb,
                        '1'
                    ),

                dscSetor:
                    primeiroTexto(
                        evento.dsc_setor,
                        evento.dscSetor,
                        evento.setor_colaborador,
                        evento.setorColaborador,
                        ghePrincipal.nomeSetor
                    ),

                tpInsc:
                    primeiroTexto(
                        evento.tp_insc_ambiente,
                        evento.tpInscAmbiente,
                        '1'
                    ),

                nrInsc:
                    primeiroTexto(
                        evento.nr_insc_ambiente,
                        evento.nrInscAmbiente,
                        evento.cnpj_unidade,
                        evento.cnpjUnidade
                    )
            }
        ];
    }


    if (
        ambientes.length > 1 &&
        !String(
            codCateg ||
            ''
        ).startsWith(
            '2'
        )
    ) {
        throw new Error(
            'Mais de um ambiente no S-2240 somente deve ser usado nas hipóteses permitidas pelo leiaute.'
        );
    }


    let xmlAmbientes =
        '';


    for (
        const ambienteTrabalho
        of ambientes
    ) {

        const localAmb =
            primeiroTexto(
                ambienteTrabalho.localAmb,
                ambienteTrabalho.local_amb
            );


        const dscSetor =
            primeiroTexto(
                ambienteTrabalho.dscSetor,
                ambienteTrabalho.dsc_setor,
                ambienteTrabalho.nomeSetor
            );


        const tpInscAmb =
            primeiroTexto(
                ambienteTrabalho.tpInsc,
                ambienteTrabalho.tp_insc
            );


        const nrInscAmb =
            primeiroTexto(
                ambienteTrabalho.nrInsc,
                ambienteTrabalho.nr_insc
            )
                .replace(
                    /\D/g,
                    ''
                );


        if (
            ![
                '1',
                '2'
            ].includes(
                localAmb
            )
        ) {
            throw new Error(
                `localAmb inválido: "${localAmb}".`
            );
        }


        if (
            !dscSetor ||
            dscSetor.length > 100
        ) {
            throw new Error(
                'Descrição do setor não informada ou maior que 100 caracteres.'
            );
        }


        if (
            ![
                '1',
                '3',
                '4'
            ].includes(
                tpInscAmb
            )
        ) {
            throw new Error(
                `tpInsc do ambiente inválido: "${tpInscAmb}".`
            );
        }


        if (
            tpInscAmb === '1' &&
            nrInscAmb.length !== 14
        ) {
            throw new Error(
                `CNPJ do ambiente deve possuir 14 dígitos. Recebido: "${nrInscAmb}".`
            );
        }


        if (
            tpInscAmb === '3' &&
            nrInscAmb.length !== 14
        ) {
            throw new Error(
                'CAEPF do ambiente deve possuir 14 dígitos.'
            );
        }


        if (
            tpInscAmb === '4' &&
            nrInscAmb.length !== 12
        ) {
            throw new Error(
                'CNO do ambiente deve possuir 12 dígitos.'
            );
        }


        xmlAmbientes +=
            `      <infoAmb>\n`;

        xmlAmbientes +=
            `        <localAmb>${escaparXmlEsocial(localAmb)}</localAmb>\n`;

        xmlAmbientes +=
            `        <dscSetor>${escaparXmlEsocial(dscSetor)}</dscSetor>\n`;

        xmlAmbientes +=
            `        <tpInsc>${escaparXmlEsocial(tpInscAmb)}</tpInsc>\n`;

        xmlAmbientes +=
            `        <nrInsc>${escaparXmlEsocial(nrInscAmb)}</nrInsc>\n`;

        xmlAmbientes +=
            `      </infoAmb>\n`;
    }


    // ========================================================
    // ATIVIDADE DESEMPENHADA
    // ========================================================

    const atividadeObjeto =
        evento.atividade_s2240 ||
        evento.atividadeS2240 ||
        {};


    let dscAtivDes =
    primeiroTexto(
        atividadeObjeto.dscAtivDes,
        atividadeObjeto.dsc_ativ_des,
        evento.dsc_ativ_des,
        evento.dscAtivDes,
        evento.descricao_atividade,
        evento.descricaoAtividade,
        evento.atividade_desempenhada,
        evento.atividadeDesempenhada
    );


// ========================================================
// FALLBACK POR CARGO SEMELHANTE
// ========================================================

if (!dscAtivDes) {

    const normalizarNomeCargo = valor =>

        String(
            valor ||
            ''
        )
            .normalize('NFD')
            .replace(
                /[\u0300-\u036f]/g,
                ''
            )
            .toUpperCase()
            .replace(
                /[^A-Z0-9]+/g,
                ' '
            )
            .trim();


    const cargoAtual =
        normalizarNomeCargo(
            primeiroTexto(
                evento.cargo_colaborador,
                evento.cargoColaborador,
                ghePrincipalParaData.nomeCargo,
                ghePrincipalParaData.nome_cargo
            )
        );


    /*
     * O SOC possui na mesma unidade os cadastros:
     *
     * AUXILIAR EM SAUDE BUCAL - ASB
     * AUXILIAR DE SAÚDE BUCAL - ASB
     *
     * Tratamos os dois como a mesma família de atividade
     * quando o cadastro exato não possui descrição.
     */

    const ehAuxiliarSaudeBucal =
        (
            cargoAtual.includes(
                'AUXILIAR'
            ) &&
            cargoAtual.includes(
                'SAUDE BUCAL'
            )
        ) ||
        cargoAtual.includes(
            'ASB'
        );


    if (
        ehAuxiliarSaudeBucal
    ) {

        dscAtivDes =
            'Prestar apoio ao dentista nas atividades clínicas e administrativas, proporcionando atendimento eficiente e seguro aos pacientes.';
    }
}


    /*
     * IMPORTANTE:
     *
     * Não usamos o nome do cargo como descrição da
     * atividade. São coisas diferentes no S-2240.
     */

    if (
        !dscAtivDes
    ) {
        throw new Error(
            'Descrição da atividade (dscAtivDes) não encontrada para o S-2240.'
        );
    }


    if (
        dscAtivDes.length > 999
    ) {
        throw new Error(
            'dscAtivDes possui mais de 999 caracteres.'
        );
    }


    // ========================================================
    // AGENTES NOCIVOS
    // ========================================================

    const agentes =
        normalizarArrayEsocial(
            evento.agentes_s2240 ||
            evento.agentesS2240 ||
            evento.agentes_nocivos_esocial_detalhados ||
            evento.agentesNocivosEsocialDetalhados ||
            evento.agentes_nocivos_esocial ||
            evento.agentesNocivosEsocial ||
            []
        );


    if (
        agentes.length === 0
    ) {
        throw new Error(
            'Nenhum agente foi encontrado para o S-2240.'
        );
    }


    const codigosAgentes =
        agentes
            .map(
                agente =>
                    primeiroTexto(
                        agente.codAgNoc,
                        agente.codigoAgenteNocivo,
                        agente.codigo_agente_nocivo
                    )
            )
            .filter(Boolean);


    const codigosDistintos =
        new Set(
            codigosAgentes
        );


    /*
     * 09.01.001 significa ausência.
     * Nunca pode andar junto com outro agente.
     */

    if (
        codigosDistintos.has(
            '09.01.001'
        ) &&
        codigosDistintos.size > 1
    ) {
        throw new Error(
            'O agente 09.01.001 não pode ser enviado junto com outro agente nocivo.'
        );
    }


    let xmlAgentes =
        '';


    for (
        const agente
        of agentes
    ) {

        const codAgNoc =
            primeiroTexto(
                agente.codAgNoc,
                agente.codigoAgenteNocivo,
                agente.codigo_agente_nocivo
            );


        if (
            !/^\d{2}\.\d{2}\.\d{3}$/.test(
                codAgNoc
            )
        ) {
            throw new Error(
                `Código de agente nocivo inválido: "${codAgNoc}".`
            );
        }


        const caracteristicas =
            normalizarArrayEsocial(
                agente.caracteristicasGhe ||
                agente.caracteristicas_ghe ||
                []
            );


        const caracteristica =
            caracteristicas[0] ||
            {};


        const avaliacao =
            agente.avaliacao ||
            agente.medicao ||
            {};


        const classificacao =
            primeiroTexto(
                avaliacao.classificacao,
                agente.classificacao,
                caracteristica.classificacao
            )
                .toLowerCase();


        let tpAval =
    primeiroTexto(
        avaliacao.tpAval,
        avaliacao.tp_aval,
        agente.tpAval,
        agente.tp_aval,
        agente.tipoAvaliacao,
        agente.tipo_avaliacao
    );


// ========================================================
// DEFINIR CRITÉRIO DE AVALIAÇÃO E-SOCIAL
// ========================================================
//
// IMPORTANTE:
//
// O campo CLASSIFICACAO da extração 7541 do SOC
// NÃO corresponde necessariamente ao tpAval do eSocial.
//
// Exemplo real:
// risco biológico 03.01.001 vem do SOC como
// "quantitativo", porém sem unidade de medida,
// intensidade ou concentração.
//
// Portanto, não podemos copiar esse campo cegamente.
// ========================================================

if (
    !tpAval
) {

    // ----------------------------------------------------
    // AGENTES BIOLÓGICOS - GRUPO 03
    // ----------------------------------------------------

    if (
        codAgNoc.startsWith(
            '03.'
        )
    ) {

        tpAval =
            '2'; // qualitativo

    } else if (
        classificacao.includes(
            'qual'
        )
    ) {

        tpAval =
            '2';

    } else if (
        classificacao.includes(
            'quant'
        )
    ) {

        /*
         * Para outros grupos ainda mantemos a indicação
         * quantitativa do SOC.
         *
         * Se não houver intConc/unMed/tecMedicao,
         * a validação abaixo continuará bloqueando o XML.
         */

        tpAval =
            '1';
    }
}

        // ----------------------------------------------------
        // AUSÊNCIA
        // ----------------------------------------------------

        if (
            codAgNoc ===
            '09.01.001'
        ) {

            xmlAgentes +=
                `      <agNoc>\n`;

            xmlAgentes +=
                `        <codAgNoc>09.01.001</codAgNoc>\n`;

            xmlAgentes +=
                `      </agNoc>\n`;

            continue;
        }


        if (
            ![
                '1',
                '2'
            ].includes(
                tpAval
            )
        ) {
            throw new Error(
                `tpAval não definido para o agente ${codAgNoc}.`
            );
        }


        // ----------------------------------------------------
        // DESCRIÇÃO DO AGENTE
        // ----------------------------------------------------

        const riscosAgente =
            normalizarArrayEsocial(
                agente.riscos ||
                []
            );


        let dscAgNoc =
            primeiroTexto(
                agente.dscAgNoc,
                agente.dsc_ag_noc,
                agente.descricaoAgente,
                agente.descricao_agente
            );


        /*
         * 05.01.001 exige descrição específica.
         *
         * Se houver somente um risco de origem,
         * conseguimos aproveitar a descrição dele.
         *
         * Se houver vários, não adivinhamos.
         */

        if (
            codAgNoc ===
            '05.01.001' &&
            !dscAgNoc
        ) {

            if (
                riscosAgente.length === 1
            ) {
                dscAgNoc =
                    primeiroTexto(
                        riscosAgente[0].risco,
                        riscosAgente[0].nomeRisco
                    );

            } else {
                throw new Error(
                    'O agente 05.01.001 possui múltiplas descrições. ' +
                    'Ele precisa estar normalizado em agentes separados antes de gerar o XML.'
                );
            }
        }


        if (
            dscAgNoc.length > 100
        ) {
            throw new Error(
                `dscAgNoc do agente ${codAgNoc} possui mais de 100 caracteres.`
            );
        }


        // ----------------------------------------------------
        // MEDIÇÃO QUANTITATIVA
        // ----------------------------------------------------

        const intConc =
            normalizarDecimal(
                primeiroTexto(
                    avaliacao.intConc,
                    avaliacao.int_conc,
                    avaliacao.valor,
                    agente.intConc,
                    agente.int_conc,
                    agente.intensidadeConcentracao,
                    agente.valorMedicao
                )
            );


        const limTol =
            normalizarDecimal(
                primeiroTexto(
                    avaliacao.limTol,
                    avaliacao.lim_tol,
                    agente.limTol,
                    agente.lim_tol,
                    agente.limiteTolerancia
                )
            );


        const unMed =
            primeiroTexto(
                avaliacao.unMed,
                avaliacao.un_med,
                avaliacao.unidadeMedidaEsocial,
                agente.unMed,
                agente.un_med,
                agente.unidadeMedidaEsocial
            );


        const tecMedicao =
            primeiroTexto(
                avaliacao.tecMedicao,
                avaliacao.tec_medicao,
                avaliacao.tecnicaMedicao,
                agente.tecMedicao,
                agente.tec_medicao,
                agente.tecnicaMedicao
            );


        if (
            tpAval === '1'
        ) {

            if (
                !intConc
            ) {
                throw new Error(
                    `Agente quantitativo ${codAgNoc} sem intensidade/concentração.`
                );
            }


            if (
                !/^\d+$/.test(
                    unMed
                ) ||
                Number(unMed) < 1 ||
                Number(unMed) > 30
            ) {
                throw new Error(
                    `Agente quantitativo ${codAgNoc} sem unidade de medida eSocial válida.`
                );
            }


            if (
                !tecMedicao ||
                tecMedicao.length > 40
            ) {
                throw new Error(
                    `Agente quantitativo ${codAgNoc} sem técnica de medição válida.`
                );
            }


            if (
                [
                    '01.18.001',
                    '02.01.014'
                ].includes(
                    codAgNoc
                ) &&
                !limTol
            ) {
                throw new Error(
                    `O agente ${codAgNoc} exige limite de tolerância.`
                );
            }
        }


        // ----------------------------------------------------
        // PROCESSO - 05.01.001
        // ----------------------------------------------------

        const nrProcJud =
            primeiroTexto(
                agente.nrProcJud,
                agente.nr_proc_jud,
                agente.numeroProcesso,
                avaliacao.nrProcJud
            );


        if (
            codAgNoc ===
            '05.01.001' &&
            dtIniCondicao >=
                '2024-01-22' &&
            !nrProcJud
        ) {
            throw new Error(
                'O agente 05.01.001 exige nrProcJud para esta data de início da condição.'
            );
        }


        // ----------------------------------------------------
        // EPC / EPI
        // ----------------------------------------------------

        const epcEpi =
            agente.epcEpi ||
            agente.epc_epi ||
            {};


        const utilizEPC =
            primeiroTexto(
                epcEpi.utilizEPC,
                epcEpi.utiliz_epc,
                agente.utilizEPC,
                agente.utiliz_epc
            );


        const utilizEPI =
            primeiroTexto(
                epcEpi.utilizEPI,
                epcEpi.utiliz_epi,
                agente.utilizEPI,
                agente.utiliz_epi
            );


        if (
            ![
                '0',
                '1',
                '2'
            ].includes(
                utilizEPC
            )
        ) {
            throw new Error(
                `utilizEPC não definido para o agente ${codAgNoc}.`
            );
        }


        if (
            ![
                '0',
                '1',
                '2'
            ].includes(
                utilizEPI
            )
        ) {
            throw new Error(
                `utilizEPI não definido para o agente ${codAgNoc}.`
            );
        }


        const eficEpc =
            normalizarSimNao(
                epcEpi.eficEpc ??
                epcEpi.efic_epc ??
                agente.eficEpc ??
                agente.efic_epc
            );


        const eficEpi =
            normalizarSimNao(
                epcEpi.eficEpi ??
                epcEpi.efic_epi ??
                agente.eficEpi ??
                agente.efic_epi
            );


        if (
            utilizEPC === '2' &&
            !eficEpc
        ) {
            throw new Error(
                `eficEpc não informado para o agente ${codAgNoc}.`
            );
        }


        if (
            utilizEPI === '2' &&
            !eficEpi
        ) {
            throw new Error(
                `eficEpi não informado para o agente ${codAgNoc}.`
            );
        }


        // ----------------------------------------------------
        // MONTAR agNoc
        // ----------------------------------------------------

        xmlAgentes +=
            `      <agNoc>\n`;

        xmlAgentes +=
            `        <codAgNoc>${escaparXmlEsocial(codAgNoc)}</codAgNoc>\n`;


        if (
            dscAgNoc
        ) {
            xmlAgentes +=
                `        <dscAgNoc>${escaparXmlEsocial(dscAgNoc)}</dscAgNoc>\n`;
        }


        xmlAgentes +=
            `        <tpAval>${escaparXmlEsocial(tpAval)}</tpAval>\n`;


        if (
            tpAval === '1'
        ) {

            xmlAgentes +=
                `        <intConc>${escaparXmlEsocial(intConc)}</intConc>\n`;


            if (
                limTol
            ) {
                xmlAgentes +=
                    `        <limTol>${escaparXmlEsocial(limTol)}</limTol>\n`;
            }


            xmlAgentes +=
                `        <unMed>${escaparXmlEsocial(unMed)}</unMed>\n`;

            xmlAgentes +=
                `        <tecMedicao>${escaparXmlEsocial(tecMedicao)}</tecMedicao>\n`;
        }


        if (
            codAgNoc ===
            '05.01.001' &&
            nrProcJud
        ) {
            xmlAgentes +=
                `        <nrProcJud>${escaparXmlEsocial(nrProcJud)}</nrProcJud>\n`;
        }


        // ----------------------------------------------------
        // epcEpi
        // ----------------------------------------------------

        xmlAgentes +=
            `        <epcEpi>\n`;

        xmlAgentes +=
            `          <utilizEPC>${escaparXmlEsocial(utilizEPC)}</utilizEPC>\n`;


        if (
            utilizEPC === '2'
        ) {
            xmlAgentes +=
                `          <eficEpc>${escaparXmlEsocial(eficEpc)}</eficEpc>\n`;
        }


        xmlAgentes +=
            `          <utilizEPI>${escaparXmlEsocial(utilizEPI)}</utilizEPI>\n`;


        if (
            utilizEPI === '2'
        ) {
            xmlAgentes +=
                `          <eficEpi>${escaparXmlEsocial(eficEpi)}</eficEpi>\n`;


            let epis =
                normalizarArrayEsocial(
                    epcEpi.epis ||
                    agente.epis ||
                    epcEpi.epi ||
                    agente.epi ||
                    []
                );


            /*
             * Aceita um CA/documento único já normalizado.
             */

            if (
                epis.length === 0
            ) {

                const docUnico =
                    primeiroTexto(
                        epcEpi.docAval,
                        agente.docAval,
                        agente.caEpi,
                        caracteristica.caEpi
                    );


                if (
                    docUnico
                ) {
                    epis = [
                        {
                            docAval:
                                docUnico
                        }
                    ];
                }
            }


            if (
                epis.length === 0
            ) {
                throw new Error(
                    `Agente ${codAgNoc}: utilizEPI=2, mas nenhum docAval/CA foi encontrado.`
                );
            }


            for (
                const epi
                of epis
            ) {

                const docAval =
                    primeiroTexto(
                        epi.docAval,
                        epi.doc_aval,
                        epi.ca,
                        epi.caEpi
                    );


                if (
                    !docAval ||
                    docAval.length > 255
                ) {
                    throw new Error(
                        `docAval/CA inválido para o agente ${codAgNoc}.`
                    );
                }


                xmlAgentes +=
                    `          <epi>\n`;

                xmlAgentes +=
                    `            <docAval>${escaparXmlEsocial(docAval)}</docAval>\n`;

                xmlAgentes +=
                    `          </epi>\n`;
            }


            const epiCompl =
                epcEpi.epiCompl ||
                epcEpi.epi_compl ||
                agente.epiCompl ||
                agente.epi_compl ||
                {};


            const camposEpiCompl = [
                'medProtecao',
                'condFuncto',
                'usoInint',
                'przValid',
                'periodicTroca',
                'higienizacao'
            ];


            const valoresEpiCompl =
                {};


            for (
                const campo
                of camposEpiCompl
            ) {

                const valor =
                    normalizarSimNao(
                        epiCompl[
                            campo
                        ]
                    );


                if (
                    !valor
                ) {
                    throw new Error(
                        `Agente ${codAgNoc}: campo ${campo} do epiCompl não informado.`
                    );
                }


                valoresEpiCompl[
                    campo
                ] =
                    valor;
            }


            xmlAgentes +=
                `          <epiCompl>\n`;


            for (
                const campo
                of camposEpiCompl
            ) {
                xmlAgentes +=
                    `            <${campo}>${valoresEpiCompl[campo]}</${campo}>\n`;
            }


            xmlAgentes +=
                `          </epiCompl>\n`;
        }


        xmlAgentes +=
            `        </epcEpi>\n`;

        xmlAgentes +=
            `      </agNoc>\n`;
    }


    // ========================================================
    // RESPONSÁVEIS PELOS REGISTROS AMBIENTAIS
    // ========================================================

    let responsaveis =
        normalizarArrayEsocial(
            evento.responsaveis_ambientais_soc ||
            evento.responsaveisAmbientaisSoc ||
            evento.responsaveis_ambientais ||
            evento.responsaveisAmbientais ||
            evento.resp_reg ||
            evento.respReg ||
            []
        );


    if (
        responsaveis.length === 0 &&
        evento.responsavelAmbiental
    ) {
        responsaveis = [
            evento.responsavelAmbiental
        ];
    }


    if (
        responsaveis.length === 0
    ) {
        throw new Error(
            'Nenhum responsável ambiental (respReg) foi encontrado para o S-2240.'
        );
    }


    const somenteAusencia =
        codigosDistintos.size === 1 &&
        codigosDistintos.has(
            '09.01.001'
        );


    let xmlResponsaveis =
        '';


    for (
        const responsavel
        of responsaveis
    ) {

        const cpfResp =
            primeiroTexto(
                responsavel.cpfResp,
                responsavel.cpf_resp,
                responsavel.cpf
            )
                .replace(
                    /\D/g,
                    ''
                );


        if (
            cpfResp.length !== 11
        ) {
            throw new Error(
                'CPF do responsável ambiental deve possuir 11 dígitos.'
            );
        }


        const ideOC =
            primeiroTexto(
                responsavel.ideOC,
                responsavel.ide_oc,
                responsavel.codigoOrgaoClasse
            );


        const dscOC =
            primeiroTexto(
                responsavel.dscOC,
                responsavel.dsc_oc,
                responsavel.descricaoOrgaoClasse
            );


        const nrOC =
            primeiroTexto(
                responsavel.nrOC,
                responsavel.nr_oc,
                responsavel.numeroRegistro
            );


        const ufOC =
            primeiroTexto(
                responsavel.ufOC,
                responsavel.uf_oc,
                responsavel.ufRegistro
            )
                .toUpperCase();


        if (
            !somenteAusencia
        ) {

            if (
                ![
                    '1',
                    '4',
                    '9'
                ].includes(
                    ideOC
                )
            ) {
                throw new Error(
                    `ideOC inválido para responsável ambiental: "${ideOC}".`
                );
            }


            if (
                ideOC === '9' &&
                !dscOC
            ) {
                throw new Error(
                    'dscOC é obrigatório quando ideOC = 9.'
                );
            }


            if (
                !nrOC
            ) {
                throw new Error(
                    'Número do registro do responsável ambiental não informado.'
                );
            }


            if (
                !/^[A-Z]{2}$/.test(
                    ufOC
                )
            ) {
                throw new Error(
                    'UF do registro do responsável ambiental inválida.'
                );
            }
        }


        xmlResponsaveis +=
            `      <respReg>\n`;

        xmlResponsaveis +=
            `        <cpfResp>${escaparXmlEsocial(cpfResp)}</cpfResp>\n`;


        if (
            !somenteAusencia
        ) {

            xmlResponsaveis +=
                `        <ideOC>${escaparXmlEsocial(ideOC)}</ideOC>\n`;


            if (
                ideOC === '9'
            ) {
                xmlResponsaveis +=
                    `        <dscOC>${escaparXmlEsocial(dscOC)}</dscOC>\n`;
            }


            xmlResponsaveis +=
                `        <nrOC>${escaparXmlEsocial(nrOC)}</nrOC>\n`;

            xmlResponsaveis +=
                `        <ufOC>${escaparXmlEsocial(ufOC)}</ufOC>\n`;
        }


        xmlResponsaveis +=
            `      </respReg>\n`;
    }


    // ========================================================
    // OBSERVAÇÃO
    // ========================================================

    const obsCompl =
        primeiroTexto(
            evento.obs_compl_s2240,
            evento.obsComplS2240,
            evento.obs_compl,
            evento.obsCompl
        );


    if (
        obsCompl.length > 999
    ) {
        throw new Error(
            'obsCompl do S-2240 possui mais de 999 caracteres.'
        );
    }


    let xmlObservacao =
        '';


    if (
        obsCompl
    ) {

        xmlObservacao +=
            `      <obs>\n`;

        xmlObservacao +=
            `        <obsCompl>${escaparXmlEsocial(obsCompl)}</obsCompl>\n`;

        xmlObservacao +=
            `      </obs>\n`;
    }


    // ========================================================
    // ID DO EVENTO
    // ========================================================

    const idEvento =
        primeiroTexto(
            evento.id_evento_esocial,
            evento.idEventoEsocial
        ) ||
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
        `<eSocial xmlns="${ESOCIAL_NAMESPACE_S2240}">\n`;

    xml +=
        `  <evtExpRisco Id="${escaparXmlEsocial(idEvento)}">\n`;


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
    // infoExpRisco
    // --------------------------------------------------------

    xml +=
        `    <infoExpRisco>\n`;

    xml +=
        `      <dtIniCondicao>${escaparXmlEsocial(dtIniCondicao)}</dtIniCondicao>\n`;


    if (
        dtFimCondicao
    ) {
        xml +=
            `      <dtFimCondicao>${escaparXmlEsocial(dtFimCondicao)}</dtFimCondicao>\n`;
    }


    xml +=
        xmlAmbientes;


    // --------------------------------------------------------
    // infoAtiv
    // --------------------------------------------------------

    xml +=
        `      <infoAtiv>\n`;

    xml +=
        `        <dscAtivDes>${escaparXmlEsocial(dscAtivDes)}</dscAtivDes>\n`;

    xml +=
        `      </infoAtiv>\n`;


    // --------------------------------------------------------
    // agentes
    // --------------------------------------------------------

    xml +=
        xmlAgentes;


    // --------------------------------------------------------
    // responsáveis
    // --------------------------------------------------------

    xml +=
        xmlResponsaveis;


    // --------------------------------------------------------
    // observação
    // --------------------------------------------------------

    xml +=
        xmlObservacao;


    xml +=
        `    </infoExpRisco>\n`;

    xml +=
        `  </evtExpRisco>\n`;

    xml +=
        `</eSocial>`;


    return {
        idEvento,
        ambiente,
        namespace:
            ESOCIAL_NAMESPACE_S2240,
        dtIniCondicao,
        dtIniCondicaoInformada:
            dtIniCondicaoInformada ||
            null,
        dataAdmissaoEsocial:
            dataAdmissaoOficialEsocial ||
            null,
        dtIniAjustadaPorAdmissaoOficial:
            Boolean(
                dataAdmissaoOficialEsocial &&
                dtIniCondicaoInformada &&
                dtIniCondicao !==
                    dtIniCondicaoInformada
            ),
        xml
    };
}

// ============================================================
// CONTROLE EXCLUSIVO DOS NOVOS EVENTOS E-SOCIAL
// ============================================================

function controleExclusivoEsocialAtivo() {

    const valor =
        String(
            process.env.ESOCIAL_CONTROLE_EXCLUSIVO ||
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


// ============================================================
// DATA DE INÍCIO DO CONTROLE EXCLUSIVO
// ============================================================

function obterDataControleExclusivoEsocial() {

    const valor =
        String(
            process.env.ESOCIAL_DATA_CONTROLE_INTEGRAL ||
            ''
        ).trim();


    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
            valor
        )
    ) {

        return '';
    }


    return valor;
}


// ============================================================
// EVENTO ESTÁ SOB CONTROLE TOTAL DO NOSSO SISTEMA?
// ============================================================

function eventoSobControleExclusivoEsocial(
    evento
) {

    if (
        !controleExclusivoEsocialAtivo()
    ) {

        return false;
    }


    const dataControle =
        obterDataControleExclusivoEsocial();


    if (
        !dataControle
    ) {

        return false;
    }


    const dataEvento =
        obterDataReferenciaEventoLocalBx(
            evento
        );


    if (
        !dataEvento
    ) {

        return false;
    }


    return (
        dataEvento >=
        dataControle
    );
}

function enriquecerEventoParaFrontendEsocial(
    evento
) {

    if (
        !evento ||
        typeof evento !==
            'object'
    ) {

        return evento;
    }


    // ========================================================
    // DADOS BÁSICOS
    // ========================================================

    const tipoEvento =
        String(
            evento.tipo_evento ||
            ''
        )
            .trim()
            .toUpperCase();


    const ambienteBanco =
        Number(
            evento.ambiente_esocial
        ) || null;


    const statusBanco =
        String(
            evento.status ||
            ''
        )
            .trim()
            .toLowerCase();


    const statusSocOriginal =
        String(
            evento.status_evento_soc ||
            ''
        ).trim();


    const statusSocNormalizado =
        statusSocOriginal
            .toLowerCase()
            .normalize(
                'NFD'
            )
            .replace(
                /[\u0300-\u036f]/g,
                ''
            );


    // ========================================================
    // RECIBO LOCAL
    // ========================================================

    const numeroReciboLocal =
        String(
            evento.numero_recibo ||
            ''
        ).trim();


    const numeroReciboLocalProducao =
        ambienteBanco === 1
            ? numeroReciboLocal
            : '';


    // ========================================================
    // ESPELHO / BX
    // ========================================================

    const numeroReciboBx =
        String(
            evento.numero_recibo_existente ||
            ''
        ).trim();


    const idEventoBx =
        String(
            evento.id_evento_esocial_existente ||
            ''
        ).trim();


    const existeConfirmadoBx =
        evento.existe_no_esocial ===
            true ||
        Boolean(
            numeroReciboBx ||
            idEventoBx
        );


    // ========================================================
    // SOC 6603
    // ========================================================

    const socConcluidoComRecibo =
        statusSocNormalizado.includes(
            'conclu'
        ) &&
        Boolean(
            numeroReciboLocal
        );


    // ========================================================
    // EMITIDO
    // ========================================================

    const emitidoEsocial =
        Boolean(
            existeConfirmadoBx ||
            numeroReciboLocalProducao ||
            socConcluidoComRecibo
        );


    // ========================================================
    // PROTOCOLO DE PRODUÇÃO PENDENTE
    // ========================================================

    const protocoloPendenteProducao =
        Boolean(
            ambienteBanco === 1 &&
            evento.protocolo_envio &&
            !numeroReciboLocalProducao
        );


    // ========================================================
    // ENVIO INCERTO
    // ========================================================

    const envioIncerto =
        statusBanco ===
        'envio_incerto';


    // ========================================================
    // BX CONFIRMOU QUE NÃO EXISTE
    // ========================================================

    const confirmadoNaoEmitidoPorBx =
        evento.verificacao_esocial_completa ===
            true &&
        Boolean(
            evento.verificado_esocial_em
        ) &&
        evento.existe_no_esocial ===
            false &&
        !emitidoEsocial;


    // ========================================================
    // NOVO EVENTO SOB CONTROLE EXCLUSIVO
    //
    // Depois da data de corte:
    //
    // - ninguém envia por fora;
    // - se não está no espelho;
    // - não tem recibo;
    // - não tem protocolo;
    //
    // então podemos tratá-lo como NÃO EMITIDO.
    // ========================================================

    const sobControleExclusivo =
        eventoSobControleExclusivoEsocial(
            evento
        );


    const socPodeEstarProcessando =
        statusSocNormalizado.includes(
            'conclu'
        ) ||
        statusSocNormalizado ===
            'assinado' ||
        statusSocNormalizado ===
            'processando';


    const confirmadoNaoEmitidoPorControle =
        sobControleExclusivo &&
        !emitidoEsocial &&
        !protocoloPendenteProducao &&
        !envioIncerto &&
        !socPodeEstarProcessando;


    const confirmadoNaoEmitido =
        confirmadoNaoEmitidoPorBx ||
        confirmadoNaoEmitidoPorControle;


    // ========================================================
    // AGUARDANDO VERIFICAÇÃO
    //
    // Isso ficará principalmente para o HISTÓRICO anterior
    // à data em que o nosso sistema assumiu o controle.
    // ========================================================

    const aguardandoVerificacao =
        !emitidoEsocial &&
        !confirmadoNaoEmitido &&
        !protocoloPendenteProducao &&
        !envioIncerto;


    // ========================================================
    // MATRÍCULA OFICIAL
    // ========================================================

    const matriculaOficialPronta =
        matriculaEventoEhOficial(
            evento
        );


    // ========================================================
    // PODE EMITIR
    //
    // POR ENQUANTO SOMENTE S-2220.
    // ========================================================

    const podeEmitir =
        tipoEvento ===
            'S-2220' &&
        confirmadoNaoEmitido &&
        matriculaOficialPronta &&
        !emitidoEsocial &&
        !protocoloPendenteProducao &&
        !envioIncerto;


    // ========================================================
    // RECIBO
    // ========================================================

    const numeroReciboEfetivo =
        numeroReciboBx ||
        numeroReciboLocalProducao ||
        (
            socConcluidoComRecibo
                ? numeroReciboLocal
                : ''
        ) ||
        null;


    // ========================================================
    // ID
    // ========================================================

    let idEventoEfetivo =
        null;


    if (
        existeConfirmadoBx
    ) {

        idEventoEfetivo =
            idEventoBx ||
            evento.id_evento_esocial ||
            null;

    } else if (
        ambienteBanco === 1
    ) {

        idEventoEfetivo =
            evento.id_evento_esocial ||
            null;
    }


    // ========================================================
    // STATUS
    // ========================================================

    let statusFrontend =
        'aguardando_verificacao';


    let statusExibicao =
        'aguardando_verificacao';


    let statusEventoSocFrontend =
        statusSocOriginal ||
        null;


    if (
        emitidoEsocial
    ) {

        statusFrontend =
            'sucesso';

        statusExibicao =
            'emitido';

        statusEventoSocFrontend =
            'Concluído';

    } else if (
        protocoloPendenteProducao
    ) {

        statusFrontend =
            'pendente';

        statusExibicao =
            'processando';

    } else if (
        envioIncerto
    ) {

        statusFrontend =
            'envio_incerto';

        statusExibicao =
            'envio_incerto';

    } else if (
        confirmadoNaoEmitido &&
        tipoEvento === 'S-2220' &&
        !matriculaOficialPronta
    ) {

        statusFrontend =
            'pendente';

        statusExibicao =
            'aguardando_matricula';

        statusEventoSocFrontend =
            'Aguardando matrícula eSocial';

    } else if (
        confirmadoNaoEmitido
    ) {

        statusFrontend =
            'pendente';

        statusExibicao =
            'nao_emitido';

        statusEventoSocFrontend =
            'Não emitido';

    } else {

        statusFrontend =
            'aguardando_verificacao';

        statusExibicao =
            'aguardando_verificacao';

        statusEventoSocFrontend =
            'Aguardando verificação';
    }


    // ========================================================
    // ORIGEM DO STATUS
    // ========================================================

    let origemStatus =
        'nao_verificado';


    if (
        existeConfirmadoBx
    ) {

        origemStatus =
            'espelho_esocial';

    } else if (
        numeroReciboLocalProducao
    ) {

        origemStatus =
            'envio_producao_local';

    } else if (
        socConcluidoComRecibo
    ) {

        origemStatus =
            'soc_6603';

    } else if (
        confirmadoNaoEmitidoPorBx
    ) {

        origemStatus =
            'bx_nao_encontrado';

    } else if (
        confirmadoNaoEmitidoPorControle
    ) {

        origemStatus =
            'controle_exclusivo';
    }


    return {

        ...evento,


        // ====================================================
        // FRONT
        // ====================================================

        status:
            statusFrontend,

        status_evento_soc:
            statusEventoSocFrontend,

        numero_recibo:
            numeroReciboEfetivo,

        id_evento_esocial:
            idEventoEfetivo,


        // ====================================================
        // ESTADO
        // ====================================================

        emitido_esocial:
            emitidoEsocial,

        ja_emitido:
            emitidoEsocial,

        confirmado_nao_emitido:
            confirmadoNaoEmitido,

        aguardando_verificacao:
            aguardandoVerificacao,

        sob_controle_exclusivo:
            sobControleExclusivo,

        pode_emitir:
            podeEmitir,

        matricula_oficial_pronta:
            matriculaOficialPronta,

        matricula_soc:
            evento.matricula_soc ||
            null,

        matricula_origem:
            evento.matricula_origem ||
            null,

        pode_tentar_emitir:
            podeEmitir,

        status_exibicao:
            statusExibicao,

        numero_recibo_exibicao:
            numeroReciboEfetivo,

        id_evento_esocial_exibicao:
            idEventoEfetivo,

        ambiente_esocial_exibicao:
            existeConfirmadoBx
                ? 1
                : ambienteBanco,

        origem_status_esocial:
            origemStatus
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
                String(
                    req.query.empresaId ||
                    ''
                ).trim();


            const status =
                String(
                    req.query.status ||
                    ''
                )
                    .trim()
                    .toLowerCase();


            const tipoEvento =
                String(
                    req.query.tipoEvento ||
                    req.query.tipo_evento ||
                    ''
                ).trim();


            const dataInicio =
                String(
                    req.query.dataInicio ||
                    req.query.data_inicio ||
                    ''
                ).trim();


            const dataFim =
                String(
                    req.query.dataFim ||
                    req.query.data_fim ||
                    ''
                ).trim();


            // ====================================================
            // CONSULTA
            // ====================================================

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


            // ====================================================
            // EMPRESA
            // ====================================================

            if (
                empresaId
            ) {

                query =
                    query.eq(
                        'codigo_empresa',
                        empresaId
                    );
            }


            // ====================================================
            // TIPO
            // ====================================================

            if (
                tipoEvento
            ) {

                query =
                    query.eq(
                        'tipo_evento',
                        tipoEvento
                    );
            }


            // ====================================================
            // DATA INICIAL
            // ====================================================

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


            // ====================================================
            // DATA FINAL
            // ====================================================

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


            /*
             * Não filtramos status diretamente no Supabase.
             *
             * Exemplo:
             *
             * banco = erro
             * porque houve uma tentativa na Produção Restrita.
             *
             * BX = encontrou na Produção real.
             *
             * Para o front esse evento deve ser "sucesso".
             */


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


            // ====================================================
            // ENRIQUECER
            // ====================================================

            let eventos =
                (
                    Array.isArray(
                        data
                    )
                        ? data
                        : []
                )
                    .map(
                        item =>
                            enriquecerEventoParaFrontendEsocial(
                                item
                            )
                    );


            // ====================================================
            // FILTRAR STATUS DEPOIS
            // ====================================================

            if (
                status
            ) {

                eventos =
                    eventos.filter(
                        item =>
                            String(
                                item.status ||
                                ''
                            )
                                .trim()
                                .toLowerCase() ===
                            status
                    );
            }


            // ====================================================
            // RETORNO
            // ====================================================

            return res.json({

                success:
                    true,

                quantidade:
                    eventos.length,

                eventos
            });


        } catch (
            error
        ) {

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
                        error?.message ||
                        String(
                            error
                        )
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
            // MATRÍCULA OFICIAL OBRIGATÓRIA
            // ====================================================

            const matriculaOficial =
                await garantirMatriculaOficialEvento(
                    evento,
                    {
                        criarPendencia:
                            true
                    }
                );


            if (
                matriculaOficial.encontrada !==
                true
            ) {

                return res
                    .status(409)
                    .json({
                        success:
                            false,
                        bloqueado:
                            true,
                        motivo:
                            'MATRICULA_ESOCIAL_PENDENTE',
                        bxBloqueadoDias1a7:
                            bxBloqueadoPorCalendario(),
                        error:
                            'A matrícula oficial do vínculo ainda não foi localizada. ' +
                            'O evento foi colocado na fila automática e o XML não será gerado com a matrícula do SOC.'
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
// TESTE COMPLETO LOCAL XML S-2240
// GERA / ASSINA / VALIDA XSD
// NÃO SALVA / NÃO TRANSMITE
// ============================================================

router.get(
    '/teste-xml-s2240/:id',

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
                        success: false,
                        error:
                            'ID do evento não informado.'
                    });
            }


            // ====================================================
            // BUSCAR EVENTO NO BANCO
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
                        success: false,
                        error:
                            'Evento não encontrado.'
                    });
            }


            // ====================================================
            // GARANTIR QUE É S-2240
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
                'S-2240'
            ) {

                return res
                    .status(400)
                    .json({
                        success: false,

                        error:
                            `O evento ${id} não é S-2240. ` +
                            `Tipo encontrado: ${tipoEvento || 'não informado'}.`
                    });
            }


            // ====================================================
            // MATRÍCULA OFICIAL OBRIGATÓRIA
            // ====================================================

            const matriculaOficial =
                await garantirMatriculaOficialEvento(
                    evento,
                    {
                        criarPendencia:
                            true
                    }
                );


            if (
                matriculaOficial.encontrada !==
                true
            ) {

                return res
                    .status(409)
                    .json({
                        success: false,
                        teste: true,
                        bloqueado: true,
                        motivo:
                            'MATRICULA_ESOCIAL_PENDENTE',
                        bxBloqueadoDias1a7:
                            bxBloqueadoPorCalendario(),
                        error:
                            'A matrícula oficial do vínculo ainda não foi localizada. ' +
                            'O S-2240 não será nem mesmo testado com a matrícula do SOC.'
                    });
            }


            // ====================================================
            // GERAR XML SOMENTE EM MEMÓRIA
            // ====================================================

            const resultado =
                gerarXmlS2240(
                    evento,
                    {
                        ambiente: 2
                    }
                );


            // ====================================================
            // ASSINAR SOMENTE EM MEMÓRIA
            // ====================================================

            const resultadoAssinatura =
                assinarXmlEsocial(
                    resultado.xml
                );


            const certificado =
                carregarCertificadoEsocial();


            validarAssinaturaXmlEsocial(
                resultadoAssinatura.xmlAssinado,
                certificado.publicCertPem
            );


            // ====================================================
            // VALIDAR XML ASSINADO NO XSD OFICIAL
            // ====================================================

            const validacaoXsd =
                await validarXmlS2240ContraXsd(
                    resultadoAssinatura.xmlAssinado
                );


            // ====================================================
            // MONTAR LOTE SOMENTE EM MEMÓRIA
            // ====================================================

            const transmissor =
                carregarIdentificacaoTransmissorDoA1();


            const lote =
                montarLoteEsocial({
                    eventos: [
                        {
                            ...evento,
                            id_evento_esocial:
                                resultado.idEvento,
                            xml_assinado:
                                resultadoAssinatura.xmlAssinado
                        }
                    ],
                    transmissor
                });


            // ====================================================
            // NÃO SALVAR
            // NÃO ENVIAR
            // ====================================================

            return res.json({

                success:
                    true,

                teste:
                    true,

                salvo:
                    false,

                assinado:
                    true,

                assinaturaValidaLocal:
                    true,

                transmitido:
                    false,

                loteMontado:
                    true,

                grupoLote:
                    lote.grupo,

                quantidadeEventosLote:
                    lote.quantidadeEventos,

                xsdValido:
                    validacaoXsd.valido,

                schema:
                    validacaoXsd.schema,

                quantidadeXsd:
                    validacaoXsd.quantidadeXsd,

                errosXsd:
                    validacaoXsd.erros,

                idBanco:
                    id,

                idEvento:
                    resultado.idEvento,

                ambiente:
                    resultado.ambiente,

                dtIniCondicao:
                    resultado.dtIniCondicao,

                dtIniCondicaoInformada:
                    resultado.dtIniCondicaoInformada ||
                    null,

                dataAdmissaoEsocial:
                    resultado.dataAdmissaoEsocial ||
                    null,

                dtIniAjustadaPorAdmissaoOficial:
                    resultado.dtIniAjustadaPorAdmissaoOficial ===
                    true,

                matricula:
                    evento.matricula ||
                    null,

                matriculaSoc:
                    evento.matricula_soc ||
                    null,

                matriculaOrigem:
                    evento.matricula_origem ||
                    null,

                namespace:
                    resultado.namespace,

                xml:
                    resultadoAssinatura.xmlAssinado
            });


        } catch (error) {

            console.error(
                '❌ Teste XML S-2240:',
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    teste:
                        true,

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
// DIAGNÓSTICO DO STATUS E-SOCIAL NO SOC - EXPORTA DADOS 6603
// ============================================================

router.get(
    '/diagnostico-6603/:id',

    async (
        req,
        res
    ) => {

        try {

            const id =
                Number(
                    req.params.id
                );


            if (
                !Number.isFinite(id) ||
                id <= 0
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'ID do evento inválido.'
                    });
            }


            // ====================================================
            // EVENTO LOCAL
            // ====================================================

            const {
                data: evento,
                error: erroEvento
            } =
                await getSupabase()
                    .from(
                        'esocial_eventos'
                    )
                    .select(
                        '*'
                    )
                    .eq(
                        'id',
                        id
                    )
                    .single();


            if (
                erroEvento ||
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
            // VALIDAR EXTRAÇÃO
            // ====================================================

            if (
                !extracaoConfigurada(
                    'eventosesocial'
                )
            ) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        error:
                            'Exporta Dados 6603 não está configurado.'
                    });
            }


            const extracao =
                obterExtracao(
                    'eventosesocial'
                );


            const tipoEvento =
                String(
                    evento.tipo_evento ||
                    ''
                )
                    .trim()
                    .toUpperCase();


            let layout =
                '';


            if (
                tipoEvento ===
                'S-2220'
            ) {

                layout =
                    '2220';

            } else if (
                tipoEvento ===
                'S-2240'
            ) {

                layout =
                    '2240';

            } else {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'Diagnóstico disponível somente para S-2220 e S-2240.'
                    });
            }


            const codigoEmpresa =
                String(
                    evento.codigo_empresa ||
                    evento.codigoEmpresa ||
                    ''
                ).trim();


            if (
                !codigoEmpresa
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'Código da empresa SOC não encontrado no evento.'
                    });
            }


            // ====================================================
            // DATA DO EVENTO
            // ====================================================

            const dataReferencia =
                obterDataReferenciaEventoLocalBx(
                    evento
                );


            if (
                !dataReferencia
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'Data do evento não encontrada.'
                    });
            }


            const dataBase =
                new Date(
                    `${dataReferencia}T12:00:00`
                );


            const inicio =
                new Date(
                    dataBase
                );


            inicio.setDate(
                inicio.getDate() -
                45
            );


            const fim =
                new Date(
                    dataBase
                );


            fim.setDate(
                fim.getDate() +
                45
            );


            const dataInicio =
                inicio
                    .toISOString()
                    .substring(
                        0,
                        10
                    );


            const dataFim =
                fim
                    .toISOString()
                    .substring(
                        0,
                        10
                    );


            // ====================================================
            // CONSULTAR 6603
            // ====================================================

            console.log(
                '🔎 Diagnóstico 6603:',
                {
                    id,
                    colaborador:
                        evento.colaborador,
                    cpf:
                        evento.cpf,
                    idFicha:
                        evento.id_ficha_soc,
                    empresa:
                        codigoEmpresa,
                    layout,
                    dataInicio,
                    dataFim
                }
            );


            const retorno =
                await exportarDadosSoc({

                    codigo:
                        extracao.codigo,

                    chave:
                        extracao.chave,

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


            // ====================================================
            // DADOS PARA PROCURAR
            // ====================================================

            const cpfLocal =
                String(
                    evento.cpf ||
                    ''
                )
                    .replace(
                        /\D/g,
                        ''
                    );


            const fichaLocal =
                String(
                    evento.id_ficha_soc ||
                    ''
                ).trim();


            const nomeLocal =
                String(
                    evento.colaborador ||
                    ''
                )
                    .trim()
                    .toLowerCase()
                    .normalize(
                        'NFD'
                    )
                    .replace(
                        /[\u0300-\u036f]/g,
                        ''
                    );


            // ====================================================
            // PROCURAR CANDIDATOS
            //
            // Como ainda não sabemos todos os nomes de campos
            // retornados pelo 6603, vamos examinar genericamente
            // o conteúdo sem assumir o layout.
            // ====================================================

            const candidatos =
                registros.filter(
                    registro => {

                        if (
                            !registro ||
                            typeof registro !==
                                'object'
                        ) {

                            return false;
                        }


                        const textoRegistro =
                            Object
                                .values(
                                    registro
                                )
                                .map(
                                    valor =>
                                        String(
                                            valor ??
                                            ''
                                        )
                                )
                                .join(
                                    ' | '
                                );


                        const somenteNumeros =
                            textoRegistro
                                .replace(
                                    /\D/g,
                                    ''
                                );


                        const textoNormalizado =
                            textoRegistro
                                .toLowerCase()
                                .normalize(
                                    'NFD'
                                )
                                .replace(
                                    /[\u0300-\u036f]/g,
                                    ''
                                );


                        // CPF
                        if (
                            cpfLocal &&
                            somenteNumeros.includes(
                                cpfLocal
                            )
                        ) {

                            return true;
                        }


                        // Ficha / Sequencial
                        if (
                            fichaLocal &&
                            Object
                                .values(
                                    registro
                                )
                                .some(
                                    valor =>
                                        String(
                                            valor ??
                                            ''
                                        ).trim() ===
                                        fichaLocal
                                )
                        ) {

                            return true;
                        }


                        // Nome
                        if (
                            nomeLocal &&
                            nomeLocal.length >=
                                5 &&
                            textoNormalizado.includes(
                                nomeLocal
                            )
                        ) {

                            return true;
                        }


                        return false;
                    }
                );


            // ====================================================
            // RESUMO DOS CAMPOS DISPONÍVEIS
            // ====================================================

            const nomesCampos =
                Array.from(
                    new Set(
                        registros
                            .flatMap(
                                registro =>
                                    registro &&
                                    typeof registro ===
                                        'object'
                                        ? Object.keys(
                                            registro
                                        )
                                        : []
                            )
                    )
                )
                    .sort();


            return res.json({

                success:
                    true,

                eventoLocal: {

                    id:
                        evento.id,

                    colaborador:
                        evento.colaborador,

                    cpf:
                        evento.cpf,

                    idFichaSoc:
                        evento.id_ficha_soc,

                    tipoEvento:
                        evento.tipo_evento,

                    dataReferencia,

                    codigoEmpresa
                },

                consulta6603: {

                    layout,

                    dataInicio,

                    dataFim,

                    quantidadeRegistros:
                        registros.length
                },

                camposRetornados:
                    nomesCampos,

                quantidadeCandidatos:
                    candidatos.length,

                candidatos:
                    candidatos.slice(
                        0,
                        20
                    )
            });


        } catch (
            error
        ) {

            console.error(
                '❌ Diagnóstico 6603:',
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
// NORMALIZAR RISCO DO EXPORTA DADOS 1875
// ============================================================

function normalizarRiscoFuncionario1875(
    registro
) {

    const original =
        registro &&
        typeof registro === 'object'
            ? registro
            : {};


    return {

        codRisco:
            texto(
                primeiroCampo(
                    original,
                    [
                        'CODRISCO',
                        'codrisco',
                        'codRisco'
                    ],
                    ''
                )
            ),


        risco:
            texto(
                primeiroCampo(
                    original,
                    [
                        'RISCO',
                        'risco'
                    ],
                    ''
                )
            ),


        nomeOrigem:
            texto(
                primeiroCampo(
                    original,
                    [
                        'NOMEORIGEM',
                        'nomeorigem',
                        'nomeOrigem'
                    ],
                    ''
                )
            ),


        aplicaPpp:
            valorBooleanoSoc(
                primeiroCampo(
                    original,
                    [
                        'APLICAPPP',
                        'aplicaPPP'
                    ],
                    false
                )
            ),


        aplicaPcmso:
            valorBooleanoSoc(
                primeiroCampo(
                    original,
                    [
                        'APLICAPCMSO',
                        'aplicaPCMSO'
                    ],
                    false
                )
            ),


        aplicaAso:
            valorBooleanoSoc(
                primeiroCampo(
                    original,
                    [
                        'APLICAASO',
                        'aplicaASO'
                    ],
                    false
                )
            ),


        codCateg:
            texto(
                primeiroCampo(
                    original,
                    [
                        'CODCATEGORIAESOCIAL',
                        'codCategoriaEsocial'
                    ],
                    ''
                )
            ),


        matricula:
            texto(
                primeiroCampo(
                    original,
                    [
                        'MATRICULA',
                        'matricula'
                    ],
                    ''
                )
            ),


        cpf:
            normalizarCpf(
                primeiroCampo(
                    original,
                    [
                        'CPF',
                        'cpf'
                    ],
                    ''
                )
            ),


        funcionario:
            texto(
                primeiroCampo(
                    original,
                    [
                        'FUNCIONARIO',
                        'funcionario'
                    ],
                    ''
                )
            ),


        codigoFuncionario:
            texto(
                primeiroCampo(
                    original,
                    [
                        'CODIGOFUNCIONARIO',
                        'codigoFuncionario'
                    ],
                    ''
                )
            ),


        situacaoFuncionario:
            texto(
                primeiroCampo(
                    original,
                    [
                        'SITUACAOFUNCIONARIO',
                        'situacaoFuncionario'
                    ],
                    ''
                )
            ),


        aplicaEsocial:
            valorBooleanoSoc(
                primeiroCampo(
                    original,
                    [
                        'APLICAESOCIAL',
                        'aplicaEsocial'
                    ],
                    false
                )
            ),


        codigoAgenteNocivo:
            texto(
                primeiroCampo(
                    original,
                    [
                        'CODIGOAGENTENOCIVO',
                        'codigoAgenteNocivo'
                    ],
                    ''
                )
            ),


        aplicaInventarioPgr:
            valorBooleanoSoc(
                primeiroCampo(
                    original,
                    [
                        'APLICAINVENTARIODERISCOSPGR',
                        'aplicaInventarioDeRiscosPgr'
                    ],
                    false
                )
            ),


        aplicaLtcat:
            valorBooleanoSoc(
                primeiroCampo(
                    original,
                    [
                        'APLICALTCAT',
                        'aplicaLtcat'
                    ],
                    false
                )
            ),


        raw:
            original
    };
}


// ============================================================
// CONSULTAR RISCOS DO FUNCIONÁRIO - EXPORTA DADOS 1875
// ============================================================

async function consultarRiscosFuncionario1875(
    evento
) {

    if (
        !extracaoConfigurada(
            'riscos_funcionario'
        )
    ) {

        throw new Error(
            'Exporta Dados 1875 - Riscos do Funcionário não configurado.'
        );
    }


    const codigoEmpresa =
        String(
            evento?.codigoEmpresa ||
            evento?.codigo_empresa ||
            ''
        ).trim();


    const codigoFuncionario =
        String(
            evento?.codigoFuncionario ||
            evento?.codigo_funcionario ||
            ''
        ).trim();


    if (
        !codigoEmpresa
    ) {

        throw new Error(
            'Código da empresa SOC ausente para consulta dos riscos.'
        );
    }


    if (
        !codigoFuncionario
    ) {

        throw new Error(
            'Código do funcionário SOC ausente para consulta dos riscos.'
        );
    }


    const extracao =
        obterExtracao(
            'riscos_funcionario'
        );


    const retorno =
        await exportarDadosSoc({

            codigo:
                extracao.codigo,

            chave:
                extracao.chave,

            empresa:
                SOC_CONFIG.empresaPrincipal,

            empresaTrabalho:
                codigoEmpresa,

            filtros: {

                funcionario:
                    codigoFuncionario
            },

            tipoSaida:
                'xml'
        });


    const registros =
        localizarRegistrosExportaDados(
            retorno
        );


    const riscos =
        registros

            .map(
                normalizarRiscoFuncionario1875
            )

            .filter(
                item =>
                    item &&
                    (
                        item.codRisco ||
                        item.risco
                    )
            );


    console.log(
        `🧪 Riscos 1875: ` +
        `${evento?.colaborador || codigoFuncionario} | ` +
        `${riscos.length} risco(s).`
    );


    return riscos;
}


function montarAgentesNocivosEsocial1875(
    riscos
) {

    const lista =
        Array.isArray(
            riscos
        )
            ? riscos
            : [];


    // ========================================================
    // LOCALIZAR NÚMERO DE PROCESSO DO 05.01.001
    // ========================================================

    const obterNrProcJud =
        item => {

            const raw =
                item?.raw &&
                typeof item.raw ===
                    'object'
                    ? item.raw
                    : {};


            return String(
                item?.nrProcJud ||
                item?.nr_proc_jud ||
                item?.numeroProcesso ||
                item?.numero_processo ||

                raw.NRPROCJUD ||
                raw.NR_PROC_JUD ||
                raw.NUMEROPROCESSO ||
                raw.NUMERO_PROCESSO ||
                raw.PROCESSO ||
                raw.PROCESSOJUDICIAL ||
                raw.PROCESSO_JUDICIAL ||
                raw.PROCESSOADMINISTRATIVO ||
                raw.PROCESSO_ADMINISTRATIVO ||

                ''
            ).trim();
        };


    // ========================================================
    // RISCOS MARCADOS PELO SOC COMO APLICÁVEIS AO ESOCIAL
    // ========================================================

    const aplicaveisOriginais =
        lista.filter(
            item =>
                item &&
                item.aplicaEsocial ===
                    true &&
                String(
                    item.codigoAgenteNocivo ||
                    ''
                ).trim()
        );


    // ========================================================
    // 05.01.001
    //
    // Esse código somente pode seguir para o S-2240 quando
    // houver um processo administrativo/judicial real.
    //
    // NÃO inventamos nrProcJud.
    // NÃO removemos a informação original do SOC.
    // Apenas impedimos que ela vire um agNoc inválido.
    // ========================================================

    const riscos0501001SemProcesso =
        aplicaveisOriginais.filter(
            item => {

                const codigo =
                    String(
                        item.codigoAgenteNocivo ||
                        ''
                    ).trim();


                if (
                    codigo !==
                    '05.01.001'
                ) {

                    return false;
                }


                return !obterNrProcJud(
                    item
                );
            }
        );


    if (
        riscos0501001SemProcesso.length >
        0
    ) {

        console.warn(
            '⚠️ S-2240: riscos 05.01.001 ignorados por ausência de nrProcJud:',
            riscos0501001SemProcesso.map(
                item => ({
                    codRisco:
                        item.codRisco ||
                        '',
                    risco:
                        item.risco ||
                        ''
                })
            )
        );
    }


    // ========================================================
    // AGENTES EFETIVAMENTE INFORMÁVEIS
    // ========================================================

    const aplicaveis =
        aplicaveisOriginais.filter(
            item => {

                const codigo =
                    String(
                        item.codigoAgenteNocivo ||
                        ''
                    ).trim();


                if (
                    codigo !==
                    '05.01.001'
                ) {

                    return true;
                }


                return Boolean(
                    obterNrProcJud(
                        item
                    )
                );
            }
        );


    // ========================================================
    // AGENTES REAIS
    // ========================================================

    const agentesReais =
        aplicaveis.filter(
            item =>
                String(
                    item.codigoAgenteNocivo ||
                    ''
                ).trim() !==
                '09.01.001'
        );


    /*
     * 09.01.001 representa ausência de agente nocivo
     * informável e não deve ser enviado junto com
     * agentes reais.
     *
     * IMPORTANTE:
     * Se todos os agentes forem descartados e o SOC
     * não tiver fornecido 09.01.001, não inventamos
     * ausência. Nesse caso a lista ficará vazia e a
     * validação posterior deverá bloquear o S-2240.
     */
    const fonte =
        agentesReais.length
            ? agentesReais
            : aplicaveis.filter(
                item =>
                    String(
                        item.codigoAgenteNocivo ||
                        ''
                    ).trim() ===
                    '09.01.001'
            );


    const mapa =
        new Map();


    for (
        const item
        of fonte
    ) {

        const codigo =
            String(
                item.codigoAgenteNocivo ||
                ''
            ).trim();


        if (
            !codigo
        ) {

            continue;
        }


        const nrProcJud =
            codigo ===
            '05.01.001'
                ? obterNrProcJud(
                    item
                )
                : '';


        /*
         * Para 05.01.001, processos diferentes não podem
         * ser agrupados no mesmo agente.
         */
        const chaveMapa =
            codigo ===
            '05.01.001'
                ? `${codigo}|${nrProcJud}`
                : codigo;


        if (
            !mapa.has(
                chaveMapa
            )
        ) {

            mapa.set(
                chaveMapa,
                {
                    codAgNoc:
                        codigo,

                    codigoAgenteNocivo:
                        codigo,

                    ...(nrProcJud
                        ? {
                            nrProcJud
                        }
                        : {}),

                    riscos:
                        []
                }
            );
        }


        mapa
            .get(
                chaveMapa
            )
            .riscos
            .push({

                codRisco:
                    item.codRisco,

                risco:
                    item.risco,

                nomeOrigem:
                    item.nomeOrigem,

                aplicaInventarioPgr:
                    item.aplicaInventarioPgr,

                aplicaLtcat:
                    item.aplicaLtcat,

                ...(nrProcJud
                    ? {
                        nrProcJud
                    }
                    : {})
            });
    }


    return Array.from(
        mapa.values()
    );
}


// ============================================================
// SALVAR SNAPSHOT DOS RISCOS DO FUNCIONÁRIO
// ============================================================

async function salvarRiscosFuncionario1875(
    evento,
    riscos
) {

    const db =
        getSupabase();


    const codigoEmpresa =
        String(
            evento?.codigoEmpresa ||
            evento?.codigo_empresa ||
            ''
        ).trim();


    const codigoFuncionario =
        String(
            evento?.codigoFuncionario ||
            evento?.codigo_funcionario ||
            ''
        ).trim();


    const idFichaSoc =
        String(
            evento?.idFicha ||
            evento?.id_ficha_soc ||
            ''
        ).trim();


    if (
        !codigoEmpresa ||
        !codigoFuncionario
    ) {

        return;
    }


    const lista =
        Array.isArray(
            riscos
        )
            ? riscos
            : [];


    if (
        !lista.length
    ) {

        return;
    }


    const dataReferencia =
        normalizarData(
            evento?.dataExame ||
            evento?.data_exame ||
            evento?.dataAso ||
            evento?.data_aso ||
            ''
        ) ||
        null;


    const agora =
        new Date()
            .toISOString();


    const registros =
        lista.map(
            item => ({

                codigo_empresa:
                    codigoEmpresa,

                codigo_funcionario:
                    codigoFuncionario,

                id_ficha_soc:
                    idFichaSoc,

                data_referencia:
                    dataReferencia,

                cpf:
                    item.cpf ||
                    normalizarCpf(
                        evento?.cpf ||
                        ''
                    ) ||
                    null,

                matricula:
                    item.matricula ||
                    evento?.matricula ||
                    null,

                cod_categ:
                    item.codCateg ||
                    evento?.codCateg ||
                    evento?.cod_categ ||
                    null,

                cod_risco:
                    item.codRisco ||
                    '',

                risco:
                    item.risco ||
                    null,

                nome_origem:
                    item.nomeOrigem ||
                    '',

                aplica_esocial:
                    item.aplicaEsocial ===
                    true,

                codigo_agente_nocivo:
                    item.codigoAgenteNocivo ||
                    null,

                aplica_inventario_pgr:
                    item.aplicaInventarioPgr ===
                    true,

                aplica_ltcat:
                    item.aplicaLtcat ===
                    true,

                aplica_ppp:
                    item.aplicaPpp ===
                    true,

                aplica_pcmso:
                    item.aplicaPcmso ===
                    true,

                aplica_aso:
                    item.aplicaAso ===
                    true,

                raw:
                    item.raw ||
                    {},

                consultado_em:
                    agora,

                updated_at:
                    agora
            })
        );


    const {
        error
    } =
        await db
            .from(
                'esocial_riscos_funcionario_soc'
            )
            .upsert(
                registros,
                {
                    onConflict:
                        'codigo_empresa,codigo_funcionario,id_ficha_soc,cod_risco,nome_origem'
                }
            );


    if (
        error
    ) {

        throw error;
    }


    console.log(
        `💾 ${registros.length} risco(s) do funcionário salvos no Supabase.`
    );
}


// ============================================================
// INICIAR WORKER AUTOMÁTICO DE MATRÍCULAS
// ============================================================

iniciarWorkerMatriculasEsocial();


// ============================================================
// INICIAR CONSULTA AUTOMÁTICA DOS LOTES
// ============================================================

iniciarWorkerConsultaLotesEsocial();


// ============================================================
// EXPORTAR ROUTER
// ============================================================

module.exports =
    router;
