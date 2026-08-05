// ============================================================
// PROCESSADOR REAL - INTEGRAÇÃO COM E-SOCIAL
// ============================================================

const { query, transaction } = require('../config/database');
const CertificadoDigital = require('./certificado');
const GeradorXMLReal = require('./geradorXMLReal');
const ClienteSoapReal = require('./clienteSoapReal');
const { logger } = require('../../server');

class ProcessadorReal {
    constructor() {
        this.certificado = null;
        this.geradorXML = new GeradorXMLReal();
        this.clienteSoap = new ClienteSoapReal();
        this.ambiente = process.env.ESOCIAL_AMBIENTE || 'homologacao';
    }

    async iniciar() {
        try {
            logger.info('🚀 Iniciando processador real e-Social...');

            // Carregar certificado ativo
            await this.carregarCertificado();

            // Inicializar cliente SOAP
            await this.clienteSoap.inicializar(this.ambiente);

            logger.info('✅ Processador real e-Social iniciado');
            return true;
        } catch (error) {
            logger.error('❌ Erro ao iniciar processador real:', error);
            return false;
        }
    }

    async carregarCertificado() {
        try {
            const result = await query(`
                SELECT * FROM certificados_esocial 
                WHERE ativo = true 
                AND data_validade > NOW()
                LIMIT 1
            `);

            if (result.rows.length === 0) {
                throw new Error('Nenhum certificado ativo e válido encontrado');
            }

            const certData = result.rows[0];
            
            const certDigital = new CertificadoDigital(
                certData.arquivo_certificado,
                certData.senha
            );
            
            const info = await certDigital.carregar();
            
            this.certificado = {
                id: certData.id,
                nome: certData.nome,
                cnpj_cpf: certData.cnpj_cpf,
                arquivo_certificado: certData.arquivo_certificado,
                senha: certData.senha,
                info: info
            };

            logger.info(`✅ Certificado carregado: ${certData.nome}`);
            logger.info(`   Válido até: ${info.validade.notAfter}`);
            
            return this.certificado;
        } catch (error) {
            logger.error('❌ Erro ao carregar certificado:', error);
            throw error;
        }
    }

    // ============================================================
    // ENVIAR EVENTO PARA O E-SOCIAL
    // ============================================================

    async enviarEvento(eventoId) {
        try {
            // Buscar evento no banco
            const eventoResult = await query(`
                SELECT e.*, 
                       emp.cnpj as empresa_cnpj,
                       emp.unidade as empresa_nome,
                       f.nome as funcionario_nome,
                       f.cpf as funcionario_cpf
                FROM eventos_esocial e
                JOIN empresas_esocial emp ON e.empresa_id = emp.id
                LEFT JOIN funcionarios_esocial f ON e.funcionario_id = f.id
                WHERE e.id = $1
            `, [eventoId]);

            if (eventoResult.rows.length === 0) {
                throw new Error('Evento não encontrado');
            }

            const evento = eventoResult.rows[0];
            
            // Verificar se já foi enviado
            if (evento.status === 'sucesso') {
                throw new Error('Evento já foi enviado com sucesso');
            }

            // Gerar XML
            const dados = evento.json_dados || {};
            dados.cnpj = evento.empresa_cnpj;
            dados.ambiente = this.ambiente;
            
            // Adicionar dados do funcionário se disponível
            if (evento.funcionario_cpf) {
                dados.cpf = evento.funcionario_cpf;
                dados.nome = evento.funcionario_nome;
            }

            const xml = await this.geradorXML.gerarEvento(evento.tipo_evento, dados);
            
            // Assinar XML
            const certDigital = new CertificadoDigital(
                this.certificado.arquivo_certificado,
                this.certificado.senha
            );
            await certDigital.carregar();
            const xmlAssinado = certDigital.assinarXml(xml);
            
            // Salvar XML assinado
            await query(
                'UPDATE eventos_esocial SET xml_assinado = $1 WHERE id = $2',
                [xmlAssinado, eventoId]
            );

            // Enviar para o eSocial
            const resultado = await this.clienteSoap.enviarLote(xmlAssinado, this.certificado);

            if (resultado.success) {
                await query(`
                    UPDATE eventos_esocial 
                    SET status = 'sucesso',
                        numero_recibo = $1,
                        protocolo = $2,
                        codigo_retorno = $3,
                        mensagem_retorno = $4,
                        ultimo_envio = NOW()
                    WHERE id = $5
                `, [
                    resultado.numeroRecibo,
                    resultado.protocolo,
                    resultado.codigo,
                    resultado.mensagem,
                    eventoId
                ]);

                // Registrar log
                await this.registrarLog(eventoId, 'success', 'Evento enviado com sucesso', {
                    protocolo: resultado.protocolo,
                    numeroRecibo: resultado.numeroRecibo
                });

                logger.info(`✅ Evento ${eventoId} enviado com sucesso!`);
                logger.info(`   Recibo: ${resultado.numeroRecibo}`);

                return {
                    success: true,
                    evento_id: eventoId,
                    numero_recibo: resultado.numeroRecibo,
                    protocolo: resultado.protocolo
                };
            }

            throw new Error('Erro ao enviar evento');

        } catch (error) {
            logger.error(`❌ Erro ao enviar evento ${eventoId}:`, error);
            
            await query(`
                UPDATE eventos_esocial 
                SET status = 'erro',
                    mensagem_retorno = $1,
                    ultimo_envio = NOW()
                WHERE id = $2
            `, [error.message, eventoId]);

            await this.registrarLog(eventoId, 'error', error.message);

            throw error;
        }
    }

    // ============================================================
    // ENVIAR LOTE DE EVENTOS
    // ============================================================

    async enviarLote(eventosIds) {
        const resultados = [];
        
        // Buscar todos os eventos
        for (const id of eventosIds) {
            try {
                const result = await this.enviarEvento(id);
                resultados.push({ id, success: true, data: result });
            } catch (error) {
                resultados.push({ id, success: false, error: error.message });
            }
        }

        return resultados;
    }

    // ============================================================
    // PROCESSAR PLANILHA E ENVIAR EM LOTE
    // ============================================================

    async processarPlanilha(funcionarios, tipoEvento, ambiente) {
        const resultados = [];
        
        for (const func of funcionarios) {
            try {
                // Buscar empresa
                const empresaResult = await query(
                    'SELECT id FROM empresas_esocial WHERE cnpj = $1',
                    [func.cnpj]
                );

                if (empresaResult.rows.length === 0) {
                    resultados.push({
                        funcionario: func.nome,
                        cpf: func.cpf,
                        success: false,
                        error: `Empresa não encontrada para CNPJ: ${func.cnpj}`
                    });
                    continue;
                }

                const empresaId = empresaResult.rows[0].id;

                // Verificar se funcionário já existe
                let funcionarioId = null;
                const funcResult = await query(
                    'SELECT id FROM funcionarios_esocial WHERE cpf = $1 AND empresa_id = $2',
                    [func.cpf.replace(/\D/g, ''), empresaId]
                );

                if (funcResult.rows.length === 0) {
                    // Criar funcionário
                    const newFunc = await query(`
                        INSERT INTO funcionarios_esocial (empresa_id, cpf, nome)
                        VALUES ($1, $2, $3)
                        RETURNING id
                    `, [empresaId, func.cpf.replace(/\D/g, ''), func.nome]);
                    funcionarioId = newFunc.rows[0].id;
                } else {
                    funcionarioId = funcResult.rows[0].id;
                }

                // Criar evento
                const eventoResult = await query(`
                    INSERT INTO eventos_esocial (
                        empresa_id, funcionario_id, tipo_evento,
                        json_dados, status
                    ) VALUES ($1, $2, $3, $4, 'pendente')
                    RETURNING id
                `, [
                    empresaId,
                    funcionarioId,
                    tipoEvento,
                    {
                        ...func,
                        data_evento: func.dataExame,
                        periodo_apuracao: new Date().toISOString().slice(0, 7)
                    }
                ]);

                const eventoId = eventoResult.rows[0].id;

                // Enviar automaticamente
                await this.enviarEvento(eventoId);

                resultados.push({
                    funcionario: func.nome,
                    cpf: func.cpf,
                    success: true,
                    evento_id: eventoId
                });

            } catch (error) {
                resultados.push({
                    funcionario: func.nome,
                    cpf: func.cpf,
                    success: false,
                    error: error.message
                });
            }
        }

        return resultados;
    }

    // ============================================================
    // REGISTRAR LOG
    // ============================================================

    async registrarLog(eventoId, tipo, mensagem, detalhes = null) {
        await query(
            `INSERT INTO logs_esocial (evento_id, tipo, mensagem, detalhes)
             VALUES ($1, $2, $3, $4)`,
            [eventoId, tipo, mensagem, detalhes]
        );
    }
}

// Instância única
let processadorInstance = null;

async function iniciarProcessadorReal() {
    if (!processadorInstance) {
        processadorInstance = new ProcessadorReal();
        await processadorInstance.iniciar();
    }
    return processadorInstance;
}

function getProcessadorReal() {
    return processadorInstance;
}

module.exports = {
    ProcessadorReal,
    iniciarProcessadorReal,
    getProcessadorReal
};