// ============================================================
// GERADOR DE XML REAL PARA E-SOCIAL
// ============================================================

const moment = require('moment');
const { Builder } = require('xml2js');
const { logger } = require('../../server');

class GeradorXMLReal {
    constructor() {
        this.builder = new Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8' },
            renderOpts: { pretty: true, indent: '  ' },
            headless: false
        });
    }

    // ============================================================
    // S-2200 - ADMISSÃO DE TRABALHADOR
    // ============================================================

    gerarS2200(dados) {
        const id = `ID${dados.cpf.replace(/\D/g, '')}${moment().format('YYYYMMDDHHmmssSSS')}`;
        
        // Validar dados obrigatórios
        const obrigatorios = ['cpf', 'nome', 'data_nascimento', 'sexo', 'data_admissao', 'salario_base', 'cargo', 'codigo_cbo'];
        const faltando = obrigatorios.filter(campo => !dados[campo]);
        
        if (faltando.length > 0) {
            throw new Error(`Dados obrigatórios faltando para S-2200: ${faltando.join(', ')}`);
        }

        const evento = {
            evento: {
                $: {
                    'xmlns': 'http://www.esocial.gov.br/schema/evt/evtAdmissao/v_S-1.0.0'
                },
                evtAdmissao: {
                    $: { Id: id },
                    ideEvento: {
                        tpAmb: dados.ambiente === 'producao' ? '1' : '2',
                        procEmi: '1',
                        verProc: '1.0.0'
                    },
                    ideEmpregador: {
                        tpInsc: '1',
                        nrInsc: dados.cnpj.replace(/\D/g, '')
                    },
                    trabalhador: {
                        dadosBasicos: {
                            cpfTrab: dados.cpf.replace(/\D/g, ''),
                            nmTrab: dados.nome,
                            dtNasc: moment(dados.data_nascimento).format('YYYY-MM-DD'),
                            sexo: dados.sexo || 'M'
                        },
                        dadosPessoais: {
                            racaCor: dados.raca_cor || '1',
                            email: dados.email || '',
                            telefone: dados.telefone || ''
                        },
                        endereco: {
                            brasil: {
                                logradouro: dados.logradouro || '',
                                nrLogradouro: dados.numero || '',
                                complemento: dados.complemento || '',
                                bairro: dados.bairro || '',
                                cidade: dados.cidade || '',
                                uf: dados.uf || '',
                                cep: dados.cep ? dados.cep.replace(/\D/g, '') : '',
                                codMun: dados.codigo_municipio || ''
                            }
                        }
                    },
                    vinculo: {
                        matricula: dados.matricula || `MAT-${Date.now()}`,
                        tpRegTrab: dados.tipo_contrato || '1',
                        tpRegPrev: dados.tipo_previdencia || '1',
                        infoRegimeTrab: {
                            dtAdm: moment(dados.data_admissao).format('YYYY-MM-DD'),
                            cargo: {
                                nmCargo: dados.cargo,
                                codCargo: dados.codigo_cargo || '',
                                codFuncao: dados.codigo_funcao || '',
                                codCBO: dados.codigo_cbo || '0000-00',
                                dtIngrCargo: moment(dados.data_admissao).format('YYYY-MM-DD')
                            },
                            remun: {
                                vrSalFx: parseFloat(dados.salario_base).toFixed(2),
                                undSalFixo: dados.unidade_salario || '1'
                            },
                            jornada: {
                                tpJornada: dados.regime_jornada || '1',
                                hrEntr: dados.horario_entrada || '08:00',
                                hrSaid: dados.horario_saida || '17:00',
                                duracJornada: dados.duracao_jornada || '8'
                            }
                        }
                    }
                }
            }
        };

        return this.builder.buildObject(evento);
    }

    // ============================================================
    // S-2240 - CONDIÇÕES AMBIENTAIS DO TRABALHO
    // ============================================================

    gerarS2240(dados) {
        const id = `ID${dados.cpf.replace(/\D/g, '')}${moment().format('YYYYMMDDHHmmssSSS')}`;

        // Validar dados obrigatórios
        const obrigatorios = ['cpf', 'nome', 'data_inicio', 'codigo_atividade', 'fator_risco'];
        const faltando = obrigatorios.filter(campo => !dados[campo]);
        
        if (faltando.length > 0) {
            throw new Error(`Dados obrigatórios faltando para S-2240: ${faltando.join(', ')}`);
        }

        const evento = {
            evento: {
                $: {
                    'xmlns': 'http://www.esocial.gov.br/schema/evt/evtRisco/v_S-1.0.0'
                },
                evtRisco: {
                    $: { Id: id },
                    ideEvento: {
                        tpAmb: dados.ambiente === 'producao' ? '1' : '2',
                        procEmi: '1',
                        verProc: '1.0.0'
                    },
                    ideEmpregador: {
                        tpInsc: '1',
                        nrInsc: dados.cnpj.replace(/\D/g, '')
                    },
                    ideTrabalhador: {
                        cpfTrab: dados.cpf.replace(/\D/g, '')
                    },
                    infoAmb: {
                        dtIniCondicao: moment(dados.data_inicio).format('YYYY-MM-DD'),
                        infoAtiv: {
                            codAtiv: dados.codigo_atividade,
                            descAtiv: dados.descricao_atividade || '',
                            fatorRisco: dados.fator_risco || '1'
                        }
                    }
                }
            }
        };

        return this.builder.buildObject(evento);
    }

    // ============================================================
    // GERAR LOTE
    // ============================================================

    gerarLote(xmls, cnpj) {
        if (!xmls || xmls.length === 0) {
            throw new Error('Nenhum XML para enviar');
        }

        // Se for apenas um evento, retorna o XML diretamente
        if (xmls.length === 1) {
            return xmls[0];
        }

        // Para múltiplos eventos, criar um lote
        const lote = {
            loteEventos: {
                $: {
                    'xmlns': 'http://www.esocial.gov.br/schema/evt/evtLoteEventos/v_S-1.0.0'
                },
                grupo: {
                    ideEmpregador: {
                        tpInsc: '1',
                        nrInsc: cnpj.replace(/\D/g, '')
                    },
                    ideTransmissor: {
                        tpInsc: '1',
                        nrInsc: cnpj.replace(/\D/g, '')
                    },
                    eventos: {
                        evento: xmls
                    }
                }
            }
        };

        const builder = new Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8' },
            renderOpts: { pretty: false }
        });

        return builder.buildObject(lote);
    }
}

module.exports = GeradorXMLReal;