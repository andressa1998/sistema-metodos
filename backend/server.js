// ============================================================
// BACKEND COMPLETO E-SOCIAL - server.js
// ============================================================

const http = require('http');
const url = require('url');

const PORT = 3002;

// ============================================================
// DADOS MOCK (SIMULANDO BANCO DE DADOS)
// ============================================================

let empresas = [
    { id: 1, unidade: 'Empresa Teste 1', cnpj: '00.000.000/0001-00', holding: 'Métodos' },
    { id: 2, unidade: 'Empresa Teste 2', cnpj: '00.000.000/0002-00', holding: 'DOP' }
];

let eventos = [
    {
        id: 1,
        codigo_evento: 'EVT-001',
        tipo_evento: 'S-2200',
        status: 'sucesso',
        empresa_id: 1,
        empresa_nome: 'Empresa Teste 1',
        funcionario_nome: 'João Silva',
        periodo_apuracao: '01/2025',
        numero_recibo: 'REC-12345',
        created_at: new Date().toISOString()
    },
    {
        id: 2,
        codigo_evento: 'EVT-002',
        tipo_evento: 'S-1200',
        status: 'pendente',
        empresa_id: 2,
        empresa_nome: 'Empresa Teste 2',
        funcionario_nome: 'Maria Santos',
        periodo_apuracao: '01/2025',
        numero_recibo: null,
        created_at: new Date().toISOString()
    }
];

let certificados = [
    {
        id: 1,
        nome: 'Certificado Teste',
        cnpj_cpf: '00.000.000/0001-00',
        data_validade: '2026-12-31T00:00:00.000Z',
        ativo: true
    }
];

let logs = [];

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function sendJSON(res, status, data) {
    res.writeHead(status, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify(data));
}

function parseBody(req, callback) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        try {
            callback(JSON.parse(body));
        } catch (e) {
            callback(null);
        }
    });
}

// ============================================================
// SERVIDOR
// ============================================================

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    const method = req.method;

    console.log(`${method} ${path}`);

    // ============================================================
    // CORS - Preflight
    // ============================================================
    if (method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end();
        return;
    }

    // ============================================================
    // HEALTH CHECK
    // ============================================================
    if (path === '/health' && method === 'GET') {
        sendJSON(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
        return;
    }

    // ============================================================
    // EMPRESAS
    // ============================================================
    if (path === '/api/esocial/empresas' && method === 'GET') {
        sendJSON(res, 200, empresas);
        return;
    }

    // ============================================================
    // EVENTOS
    // ============================================================
    if (path === '/api/esocial/eventos' && method === 'GET') {
        // Verificar se tem filtro por empresa
        const empresa_id = parsedUrl.query.empresa_id;
        let resultado = eventos;
        if (empresa_id) {
            resultado = eventos.filter(e => e.empresa_id == empresa_id);
        }
        sendJSON(res, 200, resultado);
        return;
    }

    // POST /api/esocial/eventos
    if (path === '/api/esocial/eventos' && method === 'POST') {
        parseBody(req, (data) => {
            if (!data || !data.empresa_id || !data.tipo_evento) {
                sendJSON(res, 400, { error: 'Dados incompletos' });
                return;
            }

            const empresa = empresas.find(e => e.id == data.empresa_id);
            
            const novoEvento = {
                id: Date.now(),
                codigo_evento: `EVT-${Date.now()}`,
                tipo_evento: data.tipo_evento,
                status: 'pendente',
                empresa_id: data.empresa_id,
                empresa_nome: empresa ? empresa.unidade : 'Empresa Desconhecida',
                funcionario_nome: data.funcionario_id ? 'Funcionário Teste' : null,
                periodo_apuracao: data.periodo_apuracao || '01/2025',
                numero_recibo: null,
                created_at: new Date().toISOString()
            };

            eventos.push(novoEvento);
            
            logs.push({
                evento_id: novoEvento.id,
                tipo: 'info',
                mensagem: `Evento ${novoEvento.tipo_evento} criado`,
                created_at: new Date().toISOString()
            });

            sendJSON(res, 201, novoEvento);
        });
        return;
    }

    // GET /api/esocial/eventos/stats
    if (path === '/api/esocial/eventos/stats' && method === 'GET') {
        const total = eventos.length;
        const status = {};
        eventos.forEach(e => {
            status[e.status] = (status[e.status] || 0) + 1;
        });
        const statusArray = Object.keys(status).map(key => ({ status: key, total: status[key] }));
        sendJSON(res, 200, { total, status: statusArray });
        return;
    }

    // POST /api/esocial/eventos/:id/enviar
    if (path.match(/^\/api\/esocial\/eventos\/\d+\/enviar$/) && method === 'POST') {
        const id = parseInt(path.split('/')[4]);
        const evento = eventos.find(e => e.id === id);
        
        if (!evento) {
            sendJSON(res, 404, { error: 'Evento não encontrado' });
            return;
        }

        evento.status = 'processando';
        evento.numero_recibo = `REC-${Date.now()}`;
        
        logs.push({
            evento_id: id,
            tipo: 'info',
            mensagem: `Evento ${id} enviado para processamento`,
            created_at: new Date().toISOString()
        });

        // Simular processamento assíncrono
        setTimeout(() => {
            evento.status = 'sucesso';
            logs.push({
                evento_id: id,
                tipo: 'success',
                mensagem: `Evento ${id} processado com sucesso`,
                created_at: new Date().toISOString()
            });
        }, 3000);

        sendJSON(res, 200, { 
            success: true, 
            message: `Evento ${id} enviado com sucesso!`,
            numero_recibo: evento.numero_recibo
        });
        return;
    }

    // POST /api/esocial/eventos/:id/cancelar
    if (path.match(/^\/api\/esocial\/eventos\/\d+\/cancelar$/) && method === 'POST') {
        const id = parseInt(path.split('/')[4]);
        const evento = eventos.find(e => e.id === id);
        
        if (!evento) {
            sendJSON(res, 404, { error: 'Evento não encontrado' });
            return;
        }

        evento.status = 'cancelado';
        
        logs.push({
            evento_id: id,
            tipo: 'warning',
            mensagem: `Evento ${id} cancelado`,
            created_at: new Date().toISOString()
        });

        sendJSON(res, 200, { 
            success: true, 
            message: `Evento ${id} cancelado com sucesso!`
        });
        return;
    }

    // GET /api/esocial/eventos/:id/status
    if (path.match(/^\/api\/esocial\/eventos\/\d+\/status$/) && method === 'GET') {
        const id = parseInt(path.split('/')[4]);
        const evento = eventos.find(e => e.id === id);
        
        if (!evento) {
            sendJSON(res, 404, { error: 'Evento não encontrado' });
            return;
        }

        const logsEvento = logs.filter(l => l.evento_id === id);

        sendJSON(res, 200, {
            evento: evento,
            logs: logsEvento
        });
        return;
    }

    // GET /api/esocial/eventos/:id/xml
    if (path.match(/^\/api\/esocial\/eventos\/\d+\/xml$/) && method === 'GET') {
        const id = parseInt(path.split('/')[4]);
        sendJSON(res, 200, {
            xml: `<?xml version="1.0" encoding="UTF-8"?>
<evento xmlns="http://www.esocial.gov.br/schema/evt/evtAdmissao/v_S-1.0.0">
    <evtAdmissao Id="ID${id}">
        <ideEvento>
            <tpAmb>2</tpAmb>
            <procEmi>1</procEmi>
            <verProc>1.0.0</verProc>
        </ideEvento>
        <ideEmpregador>
            <tpInsc>1</tpInsc>
            <nrInsc>00000000000100</nrInsc>
        </ideEmpregador>
        <trabalhador>
            <dadosBasicos>
                <cpfTrab>12345678900</cpfTrab>
                <nmTrab>Funcionário Teste</nmTrab>
                <dtNasc>1990-01-01</dtNasc>
                <sexo>M</sexo>
            </dadosBasicos>
        </trabalhador>
        <vinculo>
            <matricula>12345</matricula>
            <tpRegTrab>1</tpRegTrab>
            <tpRegPrev>1</tpRegPrev>
            <infoRegimeTrab>
                <dtAdm>2025-01-01</dtAdm>
            </infoRegimeTrab>
        </vinculo>
    </evtAdmissao>
</evento>`
        });
        return;
    }

    // ============================================================
    // CERTIFICADOS
    // ============================================================
    if (path === '/api/esocial/certificados' && method === 'GET') {
        sendJSON(res, 200, certificados);
        return;
    }

    if (path === '/api/esocial/certificados' && method === 'POST') {
        parseBody(req, (data) => {
            if (!data || !data.nome || !data.cnpj_cpf) {
                sendJSON(res, 400, { error: 'Dados incompletos' });
                return;
            }

            const novoCert = {
                id: Date.now(),
                nome: data.nome,
                cnpj_cpf: data.cnpj_cpf,
                ativo: true,
                data_validade: '2026-12-31T00:00:00.000Z'
            };

            // Desativar outros
            certificados.forEach(c => c.ativo = false);
            certificados.push(novoCert);

            sendJSON(res, 201, { 
                success: true, 
                certificado: novoCert,
                message: 'Certificado enviado com sucesso!'
            });
        });
        return;
    }

    // PUT /api/esocial/certificado/ativo/:id
    if (path.match(/^\/api\/esocial\/certificado\/ativo\/\d+$/) && method === 'PUT') {
        const id = parseInt(path.split('/')[5]);
        certificados.forEach(c => c.ativo = (c.id === id));
        const ativo = certificados.find(c => c.id === id);
        
        sendJSON(res, 200, { 
            success: true, 
            certificado: ativo,
            message: 'Certificado ativado com sucesso!'
        });
        return;
    }

    // POST /api/esocial/certificado/testar
    if (path === '/api/esocial/certificado/testar' && method === 'POST') {
        const ativo = certificados.find(c => c.ativo);
        if (ativo) {
            sendJSON(res, 200, { 
                success: true, 
                message: 'Certificado válido e funcionando!',
                certificado: ativo
            });
        } else {
            sendJSON(res, 400, { 
                success: false, 
                error: 'Nenhum certificado ativo encontrado'
            });
        }
        return;
    }

    // ============================================================
    // FUNCIONÁRIOS
    // ============================================================
    if (path === '/api/esocial/funcionarios' && method === 'GET') {
        const empresa_id = parsedUrl.query.empresa_id || 1;
        sendJSON(res, 200, [
            { id: 1, nome: 'João Silva', cpf: '123.456.789-00', empresa_id: parseInt(empresa_id), ativo: true },
            { id: 2, nome: 'Maria Santos', cpf: '987.654.321-00', empresa_id: parseInt(empresa_id), ativo: true },
            { id: 3, nome: 'Pedro Oliveira', cpf: '111.222.333-44', empresa_id: parseInt(empresa_id), ativo: true }
        ]);
        return;
    }

    // ============================================================
    // INTEGRAÇÃO SOC
    // ============================================================
    if (path === '/api/esocial/integracao/sync' && method === 'POST') {
        sendJSON(res, 200, { 
            success: true, 
            criados: 5, 
            atualizados: 3,
            message: 'Sincronização concluída com sucesso!'
        });
        return;
    }

    // ============================================================
    // ROTA NÃO ENCONTRADA
    // ============================================================
    sendJSON(res, 404, { error: 'Rota não encontrada' });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

server.listen(PORT, () => {
    console.log('');
    console.log('🚀 ========================================');
    console.log('🚀 Servidor e-Social rodando na porta', PORT);
    console.log('🚀 ========================================');
    console.log('');
    console.log('📋 TESTE AS ROTAS:');
    console.log(`   ✅ Health: http://localhost:${PORT}/health`);
    console.log(`   ✅ Empresas: http://localhost:${PORT}/api/esocial/empresas`);
    console.log(`   ✅ Eventos: http://localhost:${PORT}/api/esocial/eventos`);
    console.log(`   ✅ Certificados: http://localhost:${PORT}/api/esocial/certificados`);
    console.log('');
    console.log('📌 Agora recarregue o frontend e entre na aba E-Social');
    console.log('');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Porta ${PORT} já está em uso!`);
        console.log('Tente matar o processo ou usar outra porta:');
        console.log('   - No PowerShell: netstat -ano | findstr :3002');
        console.log('   - Depois: taskkill /PID <PID> /F');
    } else {
        console.error('❌ Erro no servidor:', err);
    }
});