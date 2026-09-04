// src/routes/esocial.js
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { logger } = require('../../server');
const socIntegration = require('../modules/soc-integration');
const { gerarEventoS2200, gerarEventoS2240 } = require('../modules/esocial-generator');

// ============================================================
// PROCESSAR PLANILHA E-SOCIAL
// ============================================================

router.post('/processar-planilha', async (req, res) => {
    try {
        const { funcionarios, tipo_evento, ambiente } = req.body;

        if (!funcionarios || !Array.isArray(funcionarios) || funcionarios.length === 0) {
            return res.status(400).json({ error: 'Nenhum funcionário para processar' });
        }

        if (!tipo_evento) {
            return res.status(400).json({ error: 'Tipo de evento não especificado' });
        }

        logger.info(`📤 Processando ${funcionarios.length} funcionários para ${tipo_evento}`);

        const resultados = [];
        let sucessos = 0;
        let erros = 0;

        for (const func of funcionarios) {
            try {
                // Buscar empresa
                const { data: empresa, error: errEmpresa } = await supabase
                    .from('empresas_esocial')
                    .select('id, cnpj')
                    .eq('cnpj', func.cnpj)
                    .maybeSingle();

                if (errEmpresa || !empresa) {
                    resultados.push({
                        funcionario: func.nome,
                        cpf: func.cpf,
                        success: false,
                        error: `Empresa não encontrada para CNPJ: ${func.cnpj}`
                    });
                    erros++;
                    continue;
                }

                // Buscar funcionário
                let funcionarioId = null;
                const { data: funcExistente, error: errFunc } = await supabase
                    .from('funcionarios_esocial')
                    .select('id')
                    .eq('cpf', func.cpf.replace(/\D/g, ''))
                    .eq('empresa_id', empresa.id)
                    .maybeSingle();

                if (funcExistente) {
                    funcionarioId = funcExistente.id;
                } else {
                    const { data: newFunc, error: errNew } = await supabase
                        .from('funcionarios_esocial')
                        .insert({
                            empresa_id: empresa.id,
                            cpf: func.cpf.replace(/\D/g, ''),
                            nome: func.nome,
                            data_nascimento: func.dataNascimento || null
                        })
                        .select()
                        .single();

                    if (errNew) throw errNew;
                    funcionarioId = newFunc.id;
                }

                // Preparar dados para evento
                const dadosEvento = {
                    cnpj: func.cnpj,
                    funcionario: {
                        cpf: func.cpf.replace(/\D/g, ''),
                        nome: func.nome,
                        data_nascimento: func.dataNascimento || '1990-01-01',
                        sexo: func.sexo || 'M'
                    },
                    data_admissao: func.dataExame || new Date().toISOString().split('T')[0],
                    matricula: func.matricula || `MAT-${Date.now()}`,
                    salario_base: func.salario || 0,
                    cargo: func.cargo || 'Funcionário',
                    codigo_cbo: func.cbo || '0000-00',
                    ambiente: ambiente || 'homologacao'
                };

                // Criar evento
                const { data: evento, error: errEvento } = await supabase
                    .from('eventos_esocial')
                    .insert({
                        empresa_id: empresa.id,
                        funcionario_id: funcionarioId,
                        tipo_evento: tipo_evento,
                        json_dados: dadosEvento,
                        status: 'pendente',
                        data_evento: func.dataExame || new Date().toISOString().split('T')[0],
                        periodo_apuracao: new Date().toISOString().slice(0, 7)
                    })
                    .select()
                    .single();

                if (errEvento) throw errEvento;

                // Gerar XML (apenas para S-2200 e S-2240)
                let xmlGerado = null;
                if (tipo_evento === 'S-2200') {
                    xmlGerado = gerarEventoS2200(dadosEvento);
                } else if (tipo_evento === 'S-2240') {
                    xmlGerado = gerarEventoS2240({
                        ...dadosEvento,
                        data_inicio: func.dataExame || new Date().toISOString().split('T')[0],
                        codigo_atividade: '0001',
                        descricao_atividade: func.descricao_atividade || 'Atividades administrativas',
                        fator_risco: '1'
                    });
                }

                // Salvar XML gerado
                if (xmlGerado) {
                    await supabase
                        .from('eventos_esocial')
                        .update({ xml_assinado: xmlGerado })
                        .eq('id', evento.id);
                }

                sucessos++;
                resultados.push({
                    funcionario: func.nome,
                    cpf: func.cpf,
                    success: true,
                    evento_id: evento.id
                });

            } catch (error) {
                erros++;
                resultados.push({
                    funcionario: func.nome,
                    cpf: func.cpf,
                    success: false,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            total: funcionarios.length,
            sucessos,
            erros,
            resultados
        });

    } catch (error) {
        logger.error('❌ Erro ao processar planilha:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// UPLOAD DE ASOs
// ============================================================

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

router.post('/upload-asos', upload.array('asos', 50), async (req, res) => {
    try {
        const { holding } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        logger.info(`📤 Processando ${files.length} ASOs da holding ${holding}`);

        const resultados = [];
        const erros = [];

        for (const file of files) {
            try {
                const pdfBuffer = require('fs').readFileSync(file.path);
                const pdfParse = require('pdf-parse');
                const dados = await pdfParse(pdfBuffer);

                const texto = dados.text;
                
                // Extrair dados básicos do ASO
                const empresaMatch = texto.match(/Razão Social:\s*([^\n]+)/i);
                const cnpjMatch = texto.match(/CNPJ:\s*([\d\.\/\-]+)/i);
                const funcMatch = texto.match(/Funcionário\s*Nome:\s*([^\n]+)/i);
                const cpfMatch = texto.match(/CPF\s*:\s*([\d\.\-]+)/i);
                const dataMatch = texto.match(/Avaliação Clínica[^\d]*(\d{2}\/\d{2}\/\d{4})/i);
                const tipoMatch = texto.match(/FINS DE EXAME:\s*([^\n]+)/i);

                resultados.push({
                    success: true,
                    arquivo: file.originalname,
                    dados: {
                        empresa: empresaMatch ? empresaMatch[1].trim() : '',
                        cnpj: cnpjMatch ? cnpjMatch[1].trim().replace(/\D/g, '') : '',
                        funcionario: funcMatch ? funcMatch[1].trim() : '',
                        cpf: cpfMatch ? cpfMatch[1].trim().replace(/\D/g, '') : '',
                        dataExame: dataMatch ? dataMatch[1].trim() : '',
                        tipoExame: tipoMatch ? tipoMatch[1].trim() : 'Admissional'
                    },
                    holding
                });

                // Limpar arquivo temporário
                require('fs').unlinkSync(file.path);

            } catch (error) {
                erros.push({
                    arquivo: file.originalname,
                    erro: error.message
                });
                try {
                    require('fs').unlinkSync(file.path);
                } catch (e) {}
            }
        }

        res.json({
            success: true,
            total: files.length,
            sucessos: resultados.length,
            erros: erros.length,
            resultados,
            erros_detalhes: erros
        });

    } catch (error) {
        logger.error('❌ Erro no upload de ASOs:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;