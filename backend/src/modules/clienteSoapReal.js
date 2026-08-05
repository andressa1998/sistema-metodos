// ============================================================
// CLIENTE SOAP REAL PARA E-SOCIAL
// ============================================================

const soap = require('soap');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { logger } = require('../../server');

class ClienteSoapReal {
    constructor() {
        this.client = null;
        this.ambiente = 'homologacao'; // 'homologacao' ou 'producao'
        this.timeout = 60000;
    }

    async inicializar(ambiente = 'homologacao') {
        this.ambiente = ambiente;
        this.timeout = parseInt(process.env.ESOCIAL_TIMEOUT || '60') * 1000;

        // URLs do webservice do eSocial
        const urls = {
            homologacao: {
                envio: 'https://webservices.esocial.gov.br/services/EnvioLoteEventos/EnvioLoteEventos?wsdl',
                consulta: 'https://webservices.esocial.gov.br/services/ConsultaLoteEventos/ConsultaLoteEventos?wsdl'
            },
            producao: {
                envio: 'https://webservices.esocial.gov.br/services/EnvioLoteEventos/EnvioLoteEventos?wsdl',
                consulta: 'https://webservices.esocial.gov.br/services/ConsultaLoteEventos/ConsultaLoteEventos?wsdl'
            }
        };

        const urlsAmbiente = urls[ambiente] || urls.homologacao;
        this.wsdlUrl = urlsAmbiente.envio;

        // Configurar agente HTTPS
        const agent = new https.Agent({
            rejectUnauthorized: false,
            keepAlive: true,
            timeout: this.timeout
        });

        try {
            logger.info(`🔄 Inicializando cliente SOAP em ${ambiente}`);
            
            this.client = await soap.createClientAsync(this.wsdlUrl, {
                timeout: this.timeout,
                agent: agent,
                wsdl_headers: {
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': 'EnviarLoteEventos'
                }
            });

            logger.info(`✅ Cliente SOAP inicializado (${ambiente})`);
            return this.client;

        } catch (error) {
            logger.error('❌ Erro ao inicializar cliente SOAP:', error);
            throw new Error(`Falha ao inicializar cliente SOAP: ${error.message}`);
        }
    }

    async enviarLote(loteXML, certificado) {
        try {
            if (!this.client) {
                await this.inicializar(this.ambiente);
            }

            logger.info('📤 Enviando lote para o eSocial...');
            logger.debug(`Tamanho do lote: ${loteXML.length} caracteres`);

            // Preparar envelope SOAP
            const envelope = this.prepararEnvelope(loteXML);

            // Enviar via SOAP
            const result = await this.client.EnviarLoteEventosAsync({
                loteEventos: {
                    $: {
                        'xmlns': 'http://www.esocial.gov.br/schema/evt/evtLoteEventos/v_S-1.0.0'
                    },
                    _: loteXML
                }
            });

            // Processar resposta
            const response = result[0]?.EnviarLoteEventosResponse;
            if (!response) {
                throw new Error('Resposta vazia do webservice');
            }

            const retorno = response.retorno || response.Retorno;

            if (retorno) {
                // Verificar erro
                if (retorno.codigo && retorno.codigo !== '0' && retorno.codigo !== 'S') {
                    throw new Error(`Erro no envio: ${retorno.mensagem || retorno.msg || 'Erro desconhecido'}`);
                }

                const protocolo = retorno.protocolo || retorno.Protocolo || '';
                const numeroRecibo = retorno.numeroRecibo || retorno.NumeroRecibo || '';

                logger.info(`✅ Lote enviado com sucesso!`);
                logger.info(`   Protocolo: ${protocolo}`);
                logger.info(`   Recibo: ${numeroRecibo}`);

                return {
                    success: true,
                    protocolo: protocolo,
                    numeroRecibo: numeroRecibo,
                    codigo: retorno.codigo || '0',
                    mensagem: retorno.mensagem || 'Enviado com sucesso',
                    dadosCompletos: response
                };
            }

            throw new Error('Resposta inválida do webservice');

        } catch (error) {
            logger.error('❌ Erro ao enviar lote:', error);
            
            if (error.code === 'ETIMEDOUT') {
                throw new Error('Timeout ao enviar lote. Tente novamente.');
            }

            throw error;
        }
    }

    async consultarStatus(numeroRecibo, certificado) {
        try {
            if (!this.client) {
                await this.inicializar(this.ambiente);
            }

            logger.info(`🔍 Consultando status do recibo: ${numeroRecibo}`);

            const result = await this.client.ConsultarLoteEventosAsync({
                consultaLote: {
                    $: {
                        'xmlns': 'http://www.esocial.gov.br/schema/evt/evtLoteEventos/v_S-1.0.0'
                    },
                    _: {
                        tpInsc: '1',
                        nrInsc: certificado.cnpj_cpf.replace(/\D/g, ''),
                        nrRecibo: numeroRecibo
                    }
                }
            });

            const response = result[0]?.ConsultarLoteEventosResponse;
            if (!response) {
                throw new Error('Resposta vazia do webservice');
            }

            const retorno = response.retorno || response.Retorno;

            if (retorno) {
                const statusMap = {
                    '0': 'sucesso',
                    '1': 'processando',
                    '2': 'erro',
                    '3': 'cancelado'
                };

                const status = statusMap[retorno.codigo] || 'processando';

                logger.info(`📋 Status do lote: ${status}`);
                logger.info(`   Mensagem: ${retorno.mensagem || retorno.msg || ''}`);

                let eventos = [];
                if (retorno.eventos && retorno.eventos.evento) {
                    const eventosArray = Array.isArray(retorno.eventos.evento) 
                        ? retorno.eventos.evento 
                        : [retorno.eventos.evento];
                    
                    eventos = eventosArray.map(evt => ({
                        tipo: evt.tipo,
                        recibo: evt.recibo || evt.numeroRecibo,
                        status: evt.status,
                        mensagem: evt.mensagem || evt.msg
                    }));
                }

                return {
                    success: true,
                    status: status,
                    codigo: retorno.codigo,
                    mensagem: retorno.mensagem || retorno.msg || '',
                    eventos: eventos,
                    dadosCompletos: response
                };
            }

            throw new Error('Resposta inválida do webservice');

        } catch (error) {
            logger.error('❌ Erro ao consultar status:', error);
            throw error;
        }
    }

    prepararEnvelope(xml) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:esocial="http://www.esocial.gov.br/schema/evt/evtLoteEventos/v_S-1.0.0">
    <soapenv:Header/>
    <soapenv:Body>
        <esocial:EnviarLoteEventos>
            ${xml}
        </esocial:EnviarLoteEventos>
    </soapenv:Body>
</soapenv:Envelope>`;
    }

    // Validar XML
    async validarSchema(xml) {
        try {
            const parser = require('xml2js').Parser();
            await parser.parseStringPromise(xml);
            logger.info('✅ XML válido');
            return true;
        } catch (error) {
            logger.error('❌ XML inválido:', error);
            return false;
        }
    }
}

module.exports = ClienteSoapReal;