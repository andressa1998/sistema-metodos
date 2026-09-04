'use strict';

const fs = require('fs');
const path = require('path');

const {
    validateXML
} = require('xmllint-wasm');


// ============================================================
// CONFIGURAÇÃO
// ============================================================

const ESOCIAL_NAMESPACE_S2220 =
    'http://www.esocial.gov.br/schema/evt/evtMonit/v_S_01_03_00';

const ESOCIAL_NAMESPACE_S2240 =
    'http://www.esocial.gov.br/schema/evt/evtExpRisco/v_S_01_03_00';


let cachePacoteXsd =
    null;


// ============================================================
// LISTAR XSDs RECURSIVAMENTE
// ============================================================

function listarArquivosXsd(
    diretorio,
    diretorioBase = diretorio
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

        const caminhoCompleto =
            path.join(
                diretorio,
                item.name
            );


        if (
            item.isDirectory()
        ) {

            resultado.push(
                ...listarArquivosXsd(
                    caminhoCompleto,
                    diretorioBase
                )
            );

            continue;
        }


        if (
            !item.isFile() ||
            !item.name
                .toLowerCase()
                .endsWith('.xsd')
        ) {

            continue;
        }


        const caminhoRelativo =
            path
                .relative(
                    diretorioBase,
                    caminhoCompleto
                )
                .replace(
                    /\\/g,
                    '/'
                );


        resultado.push({

            fileName:
                caminhoRelativo,

            baseName:
                path.basename(
                    caminhoCompleto
                ),

            fullPath:
                caminhoCompleto,

            contents:
                fs.readFileSync(
                    caminhoCompleto,
                    'utf8'
                )
        });
    }


    return resultado;
}


// ============================================================
// LOCALIZAR XSD PRINCIPAL DO S-2220
// ============================================================

function localizarXsdPrincipal(
    arquivos,
    namespace,
    tipoEvento
) {

    const namespaceAspasDuplas =
        `targetNamespace="${namespace}"`;


    const namespaceAspasSimples =
        `targetNamespace='${namespace}'`;


    const encontrado =
        arquivos.find(
            arquivo => {

                const conteudo =
                    String(
                        arquivo.contents ||
                        ''
                    );


                return (
                    conteudo.includes(
                        namespaceAspasDuplas
                    ) ||
                    conteudo.includes(
                        namespaceAspasSimples
                    )
                );
            }
        );


    if (
        !encontrado
    ) {

        throw new Error(
            'Não foi localizado no pacote XSD o schema ' +
            `do ${tipoEvento} (${namespace}).`
        );
    }


    return encontrado;
}


// ============================================================
// MONTAR PRELOAD DOS XSDs
// ============================================================

function montarPreloadXsd(
    arquivos,
    principal
) {

    const preload = [];

    const nomesAdicionados =
        new Set();


    function adicionar(
        fileName,
        contents
    ) {

        const nome =
            String(
                fileName ||
                ''
            )
                .replace(
                    /\\/g,
                    '/'
                )
                .trim();


        if (
            !nome ||
            nomesAdicionados.has(
                nome
            )
        ) {

            return;
        }


        nomesAdicionados.add(
            nome
        );


        preload.push({

            fileName:
                nome,

            contents
        });
    }


    for (
        const arquivo
        of arquivos
    ) {

        if (
            arquivo.fullPath ===
            principal.fullPath
        ) {

            continue;
        }


        /*
         * Primeiro preservamos o caminho relativo
         * que veio do ZIP oficial.
         */

        adicionar(
            arquivo.fileName,
            arquivo.contents
        );


        /*
         * Também disponibilizamos pelo basename.
         *
         * Isso ajuda quando um xsd:include/import
         * referencia apenas o nome do arquivo.
         */

        adicionar(
            arquivo.baseName,
            arquivo.contents
        );
    }


    return preload;
}


// ============================================================
// CARREGAR PACOTE XSD
// ============================================================

function carregarPacoteXsdEsocial() {

    if (
        cachePacoteXsd
    ) {

        return cachePacoteXsd;
    }


    const caminhoConfigurado =
        String(
            process.env.ESOCIAL_XSD_DIR ||
            './src/esocial/xsd'
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
            `Diretório de XSD não encontrado: ${diretorio}`
        );
    }


    const arquivos =
        listarArquivosXsd(
            diretorio
        );


    if (
        arquivos.length === 0
    ) {

        throw new Error(
            `Nenhum arquivo .xsd encontrado em ${diretorio}`
        );
    }


    const principais = {
        'S-2220': localizarXsdPrincipal(
            arquivos,
            ESOCIAL_NAMESPACE_S2220,
            'S-2220'
        ),

        'S-2240': localizarXsdPrincipal(
            arquivos,
            ESOCIAL_NAMESPACE_S2240,
            'S-2240'
        )
    };


    cachePacoteXsd = {

        diretorio,

        arquivos,

        principais
    };


    console.log(
        '✅ Pacote XSD eSocial carregado:',
        {
            quantidade:
                arquivos.length,

            principais: {
                'S-2220': principais['S-2220'].fileName,
                'S-2240': principais['S-2240'].fileName
            }
        }
    );


    return cachePacoteXsd;
}


// ============================================================
// FORMATAR ERROS
// ============================================================

function formatarErrosXsd(
    erros
) {

    if (
        !Array.isArray(
            erros
        )
    ) {

        return [];
    }


    return erros.map(
        erro => ({

            mensagem:
                String(
                    erro?.message ||
                    erro?.rawMessage ||
                    erro ||
                    ''
                ).trim(),

            arquivo:
                erro?.loc?.fileName ||
                null,

            linha:
                erro?.loc?.lineNumber ||
                null,

            bruto:
                erro?.rawMessage ||
                null
        })
    );
}


// ============================================================
// VALIDAR XML S-2220
// ============================================================

async function validarXmlEventoContraXsd(
    xml,
    configuracao
) {

    const {
        tipoEvento,
        namespace,
        nomeArquivo
    } = configuracao;

    const conteudoXml =
        String(
            xml ||
            ''
        ).trim();


    if (
        !conteudoXml
    ) {

        throw new Error(
            `XML ${tipoEvento} não informado.`
        );
    }


    if (
        !conteudoXml.includes(
            namespace
        )
    ) {

        throw new Error(
            `O XML informado não utiliza o namespace esperado do ${tipoEvento}.`
        );
    }


    const pacote =
        carregarPacoteXsdEsocial();

    const principal =
        pacote.principais[
            tipoEvento
        ];

    if (!principal) {
        throw new Error(
            `Schema principal do ${tipoEvento} não carregado.`
        );
    }

    const preload =
        montarPreloadXsd(
            pacote.arquivos,
            principal
        );


    let resultado;


    try {

        resultado =
            await validateXML({

                xml: [
                    {
                        fileName:
                            nomeArquivo,

                        contents:
                            conteudoXml
                    }
                ],

                /*
                 * XSD principal.
                 */

                schema: [
                    principal.contents
                ],

                /*
                 * Todos os demais schemas do pacote oficial.
                 */

                preload:
                    preload,

                initialMemoryPages:
                    256,

                maxMemoryPages:
                    2048
            });

    } catch (error) {

        throw new Error(
            'Falha técnica ao executar validação XSD: ' +
            (
                error?.message ||
                String(error)
            )
        );
    }


    const erros =
        formatarErrosXsd(
            resultado?.errors
        );


    return {

        valido:
            resultado?.valid === true,

        schema:
            principal.fileName,

        namespace:
            namespace,

        quantidadeXsd:
            pacote.arquivos.length,

        erros,

        rawOutput:
            resultado?.rawOutput ||
            ''
    };
}


async function validarXmlS2220ContraXsd(xml) {

    return validarXmlEventoContraXsd(
        xml,
        {
            tipoEvento: 'S-2220',
            namespace: ESOCIAL_NAMESPACE_S2220,
            nomeArquivo: 'evento-s2220.xml'
        }
    );
}


async function validarXmlS2240ContraXsd(xml) {

    return validarXmlEventoContraXsd(
        xml,
        {
            tipoEvento: 'S-2240',
            namespace: ESOCIAL_NAMESPACE_S2240,
            nomeArquivo: 'evento-s2240.xml'
        }
    );
}


// ============================================================
// LIMPAR CACHE
// ============================================================

function limparCacheXsdEsocial() {

    cachePacoteXsd =
        null;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    ESOCIAL_NAMESPACE_S2220,

    ESOCIAL_NAMESPACE_S2240,

    carregarPacoteXsdEsocial,

    validarXmlS2220ContraXsd,

    validarXmlS2240ContraXsd,

    limparCacheXsdEsocial
};