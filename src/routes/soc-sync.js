// src/routes/soc-sync.js
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { logger } = require('../../server');
const socIntegration = require('../modules/soc-integration');
const { gerarEventoS2200, gerarEventoS2240 } = require('../modules/esocial-generator');

// ============================================================
// SINCRONIZAÇÃO COMPLETA SOC → E-SOCIAL
// ============================================================

router.post('/sync-completo', async (req, res) => {
    try {
        const { empresaPrincipal } = req.body;
        logger.info('🔄 Iniciando sincronização completa SOC → E-Social');

        const resultados = {
            empresas: { encontradas: 0, salvas: 0, erros: 0 },
            funcionarios: { encontrados: 0, salvos: 0, erros: 0 },
            exames: { encontrados: 0, salvos: 0, erros: 0 },
            riscos: { encontrados: 0, salvos: 0, erros: 0 },
            cargos: { encontrados: 0, salvos: 0, erros: 0 },
            setores: { encontrados: 0, salvos: 0, erros: 0 }
        };

        // 1. BUSCAR EMPRESA PRINCIPAL
        logger.info('📋 Buscando empresa principal...');
        const empresaData = await socIntegration.buscarEmpresasSOC(empresaPrincipal || '1');
        
        if (empresaData && empresaData.EmpresaRetorno) {
            const empresa = empresaData.EmpresaRetorno;
            resultados.empresas.encontradas++;
            
            const { error } = await supabase
                .from('empresas_soc')
                .upsert({
                    codigo_soc: empresa.codigo,
                    nome: empresa.nomeAbreviado,
                    razao_social: empresa.razaoSocial,
                    cnpj: empresa.numeroCnpj,
                    dados_completos: empresa,
                    ultima_sincronizacao: new Date().toISOString()
                }, { onConflict: 'codigo_soc' });

            if (error) {
                resultados.empresas.erros++;
                logger.error('Erro ao salvar empresa:', error);
            } else {
                resultados.empresas.salvas++;
            }
        }

        // 2. BUSCAR FUNCIONÁRIOS
        logger.info('📋 Buscando funcionários...');
        let pagina = 1;
        let totalFuncionarios = 0;
        
        while (pagina <= 10) {
            try {
                const funcData = await socIntegration.buscarFuncionariosSOC({
                    codigoEmpresa: empresaPrincipal || '1',
                    pagina: pagina,
                    registrosPorPagina: 100
                });

                if (!funcData || !funcData.FuncionarioRetorno) break;

                // Parse dos funcionários (adaptar conforme retorno do SOC)
                const funcionarios = funcData.FuncionarioRetorno || [];
                totalFuncionarios += funcionarios.length;

                for (const func of funcionarios) {
                    try {
                        // Verificar se já existe
                        const { data: existing } = await supabase
                            .from('funcionarios_soc')
                            .select('id')
                            .eq('codigo_soc', func.codigo)
                            .maybeSingle();

                        if (!existing) {
                            const { error } = await supabase
                                .from('funcionarios_soc')
                                .insert({
                                    codigo_soc: func.codigo,
                                    nome: func.nomeFuncionario,
                                    cpf: func.cpf,
                                    matricula: func.matricula,
                                    data_nascimento: func.dataNascimento,
                                    data_admissao: func.dataAdmissao,
                                    situacao: func.situacao,
                                    dados_completos: func,
                                    empresa_principal: empresaPrincipal || '1'
                                });

                            if (error) {
                                resultados.funcionarios.erros++;
                            } else {
                                resultados.funcionarios.salvos++;
                            }
                        } else {
                            // Atualizar
                            const { error } = await supabase
                                .from('funcionarios_soc')
                                .update({
                                    nome: func.nomeFuncionario,
                                    situacao: func.situacao,
                                    dados_completos: func,
                                    ultima_atualizacao: new Date().toISOString()
                                })
                                .eq('codigo_soc', func.codigo);

                            if (!error) resultados.funcionarios.salvos++;
                        }
                    } catch (e) {
                        resultados.funcionarios.erros++;
                    }
                }

                resultados.funcionarios.encontrados += funcionarios.length;
                pagina++;

                if (funcionarios.length < 100) break;
            } catch (err) {
                logger.error(`Erro na página ${pagina}:`, err);
                break;
            }
        }

        // 3. BUSCAR EXAMES
        logger.info('📋 Buscando exames...');
        try {
            const examesData = await socIntegration.buscarExamesSOC(empresaPrincipal || '1');
            // Parse e salvar exames...
            // (Adaptar conforme estrutura do SOC)
        } catch (err) {
            logger.error('Erro ao buscar exames:', err);
        }

        // 4. BUSCAR RISCOS
        logger.info('📋 Buscando riscos...');
        try {
            const riscosData = await socIntegration.buscarRiscosSOC(empresaPrincipal || '1');
            // Parse e salvar riscos...
        } catch (err) {
            logger.error('Erro ao buscar riscos:', err);
        }

        // 5. BUSCAR CARGOS
        logger.info('📋 Buscando cargos...');
        try {
            const cargosData = await socIntegration.buscarCargosSOC(empresaPrincipal || '1');
            // Parse e salvar cargos...
        } catch (err) {
            logger.error('Erro ao buscar cargos:', err);
        }

        // 6. BUSCAR SETORES
        logger.info('📋 Buscando setores...');
        try {
            const setoresData = await socIntegration.buscarSetoresSOC(empresaPrincipal || '1');
            // Parse e salvar setores...
        } catch (err) {
            logger.error('Erro ao buscar setores:', err);
        }

        // Registrar log da sincronização
        await supabase
            .from('logs_sincronizacao')
            .insert({
                tipo: 'soc_sync_completo',
                status: 'sucesso',
                resultados: resultados,
                data_execucao: new Date().toISOString()
            });

        res.json({
            success: true,
            total_empresas: resultados.empresas.salvas,
            total_funcionarios: resultados.funcionarios.salvos,
            total_exames: resultados.exames.salvos,
            total_riscos: resultados.riscos.salvos,
            total_cargos: resultados.cargos.salvos,
            total_setores: resultados.setores.salvos,
            detalhes: resultados
        });

    } catch (error) {
        logger.error('❌ Erro na sincronização:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// GERAR EVENTOS AUTOMATICAMENTE
// ============================================================

router.post('/gerar-automatico', async (req, res) => {
    try {
        logger.info('🔄 Gerando eventos e-Social automaticamente...');

        // 1. Buscar funcionários que ainda não têm eventos S-2200
        const { data: funcionariosSemEvento, error: errFunc } = await supabase
            .from('funcionarios_soc')
            .select(`
                *,
                eventos_esocial!left(id)
            `)
            .filter('eventos_esocial.tipo_evento', 'neq', 'S-2200')
            .or('eventos_esocial.id.is.null');

        if (errFunc) throw errFunc;

        // 2. Buscar empresas
        const { data: empresas, error: errEmp } = await supabase
            .from('empresas_soc')
            .select('*');

        if (errEmp) throw errEmp;

        const empresaMap = {};
        empresas.forEach(e => {
            empresaMap[e.codigo_soc] = e;
        });

        let s2200Criados = 0;
        let s2240Criados = 0;
        let erros = 0;
        const eventosCriados = [];

        // 3. Gerar eventos para cada funcionário
        for (const func of (funcionariosSemEvento || [])) {
            try {
                const empresa = empresaMap[func.empresa_principal];
                if (!empresa) continue;

                // Gerar S-2200
                const dadosS2200 = {
                    cnpj: empresa.cnpj,
                    funcionario: {
                        cpf: func.cpf,
                        nome: func.nome,
                        data_nascimento: func.data_nascimento || '1990-01-01',
                        sexo: 'M'
                    },
                    data_admissao: func.data_admissao || new Date().toISOString().split('T')[0],
                    matricula: func.matricula || `MAT-${Date.now()}`,
                    salario_base: func.salario || 0,
                    cargo: func.cargo || 'Funcionário',
                    codigo_cbo: func.codigo_cbo || '0000-00',
                    ambiente: 'homologacao'
                };

                const xmlS2200 = gerarEventoS2200(dadosS2200);

                // Criar evento S-2200
                const { data: evento, error: errEvento } = await supabase
                    .from('eventos_esocial')
                    .insert({
                        empresa_id: empresa.id,
                        funcionario_id: func.id,
                        tipo_evento: 'S-2200',
                        json_dados: dadosS2200,
                        xml_assinado: xmlS2200,
                        status: 'pendente',
                        data_evento: func.data_admissao || new Date().toISOString().split('T')[0],
                        periodo_apuracao: new Date().toISOString().slice(0, 7)
                    })
                    .select()
                    .single();

                if (errEvento) throw errEvento;

                s2200Criados++;
                eventosCriados.push({ funcionario: func.nome, evento: 'S-2200', id: evento.id });

                // Gerar S-2240 (se tiver riscos)
                // Aqui você pode buscar os riscos do funcionário no SOC
                // e gerar S-2240 para cada risco

                // Exemplo: gerar um S-2240 genérico
                const dadosS2240 = {
                    cnpj: empresa.cnpj,
                    funcionario: {
                        cpf: func.cpf,
                        nome: func.nome
                    },
                    data_inicio: func.data_admissao || new Date().toISOString().split('T')[0],
                    codigo_atividade: '0001',
                    descricao_atividade: 'Atividades administrativas',
                    fator_risco: '1',
                    ambiente: 'homologacao'
                };

                const xmlS2240 = gerarEventoS2240(dadosS2240);

                const { data: evento2240, error: err2240 } = await supabase
                    .from('eventos_esocial')
                    .insert({
                        empresa_id: empresa.id,
                        funcionario_id: func.id,
                        tipo_evento: 'S-2240',
                        json_dados: dadosS2240,
                        xml_assinado: xmlS2240,
                        status: 'pendente',
                        data_evento: func.data_admissao || new Date().toISOString().split('T')[0],
                        periodo_apuracao: new Date().toISOString().slice(0, 7)
                    })
                    .select()
                    .single();

                if (!err2240) {
                    s2240Criados++;
                    eventosCriados.push({ funcionario: func.nome, evento: 'S-2240', id: evento2240.id });
                }

            } catch (err) {
                erros++;
                logger.error(`Erro ao gerar evento para ${func.nome}:`, err);
            }
        }

        // Registrar log
        await supabase
            .from('logs_sincronizacao')
            .insert({
                tipo: 'gerar_eventos_automatico',
                status: 'sucesso',
                resultados: { s2200: s2200Criados, s2240: s2240Criados, erros },
                data_execucao: new Date().toISOString()
            });

        res.json({
            success: true,
            eventos_criados: s2200Criados + s2240Criados,
            s2200_criados: s2200Criados,
            s2240_criados: s2240Criados,
            erros: erros,
            eventos: eventosCriados
        });

    } catch (error) {
        logger.error('❌ Erro ao gerar eventos:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// BUSCAR NOVOS FUNCIONÁRIOS
// ============================================================

router.get('/novos-funcionarios', async (req, res) => {
    try {
        // Buscar funcionários que não têm eventos S-2200
        const { data: funcionarios, error } = await supabase
            .from('funcionarios_soc')
            .select(`
                *,
                eventos_esocial!left(id, tipo_evento)
            `)
            .filter('eventos_esocial.tipo_evento', 'neq', 'S-2200')
            .or('eventos_esocial.id.is.null');

        if (error) throw error;

        res.json({
            success: true,
            novos: funcionarios?.length || 0,
            funcionarios: funcionarios || []
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// VERIFICAR STATUS DA INTEGRAÇÃO
// ============================================================

router.get('/status-integracao', async (req, res) => {
    try {
        // Verificar conexão com SOC
        let conectado = false;
        try {
            await socIntegration.buscarEmpresasSOC(process.env.SOC_EMPRESA_PRINCIPAL || '1');
            conectado = true;
        } catch (err) {
            conectado = false;
        }

        // Buscar última sincronização
        const { data: lastSync } = await supabase
            .from('logs_sincronizacao')
            .select('data_execucao')
            .eq('status', 'sucesso')
            .order('data_execucao', { ascending: false })
            .limit(1)
            .single();

        res.json({
            success: true,
            conectado,
            ultima_sincronizacao: lastSync?.data_execucao || null,
            total_empresas: (await supabase.from('empresas_soc').select('count')).count || 0,
            total_funcionarios: (await supabase.from('funcionarios_soc').select('count')).count || 0,
            total_eventos: (await supabase.from('eventos_esocial').select('count')).count || 0
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ============================================================
// CONFIGURAR SOC (salvar credenciais)
// ============================================================

router.post('/configurar-soc', async (req, res) => {
    try {
        const { username, password, empresa_principal, codigo_responsavel } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Usuário e senha são obrigatórios' });
        }

        // Salvar no .env ou banco (aqui salvamos no banco)
        const { error } = await supabase
            .from('configuracoes_soc')
            .upsert({
                chave: 'soc_credentials',
                valor: JSON.stringify({ username, password, empresa_principal, codigo_responsavel }),
                atualizado_em: new Date().toISOString()
            }, { onConflict: 'chave' });

        if (error) throw error;

        res.json({ success: true, message: 'Configurações salvas com sucesso' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;