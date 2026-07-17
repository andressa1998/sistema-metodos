// ========================= CONFIGURAÇÃO SUPABASE =========================
const SUPABASE_URL = 'https://uvilxelwpvrwjxxdougw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2aWx4ZWx3cHZyd2p4eGRvdWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUxODksImV4cCI6MjA5ODA3MTE4OX0.6YXJYNUFBxL-KQbpZQvRbvKejSFMTpKk6qbxOF_tdlM';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// URL da Edge Function OMIE (proxy)
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/omie-proxy`;

// ========================= CACHE PARA EVITAR CHAMADAS REPETIDAS =========================
let clientesCache = null;
let ultimaBuscaClientes = 0;
const CACHE_TTL = 120000;

// ========================= MAPEAMENTO DE EXAMES =========================
const EXAME_MAP = {
  'Avaliação Clínica Ocupacional (Anamnese e Exame físico)': 'exame_clinico',
  'Avaliação Clínica com ênfase Mental (Anamnese e Exame físico)': 'exame_clinico',
  'Audiometria tonal ocupacional': 'audiometria',
  'Avaliação da acuidade visual': 'acuidade_visual',
  'ECG (Eletrocardiograma) convencional de até 12 derivações': 'eletrocardiograma',
  'EEG (Eletroencefalograma) de rotina': 'eletroencefalograma',
  'Prova de função pulmonar completa (ou espirometria)': 'espirometria',
  'Radiografia de tórax em duas incidências': 'raio_x_torax',
  'Hemograma com contagem de plaquetas ou frações (eritrograma, leucograma, plaquetas)': 'hemograma',
  'Hepatite B - HBsAC (anti-HBs)': 'anti_hbs',
  'Anti-HCV': 'anti_hcv',
  'Hepatite B - HBsAG': 'anti_hbs_ag',
  'Hepatite B - HBeAG': 'anti_hbs_ag',
  'Sífilis - VDRL': 'vdrl',
  'Cultura nas fezes: salmonela, shigellae e E. coli enteropatogênicas, enteroinvasora (sorol. incluída) + campylobacter SP. + E. coli enterohemorrágica': 'coprocultura',
  'Parasitológico de fezes': 'parasitologico',
  'Gama-glutamil transferase (Gama-GT)': 'gama_gt',
  'Glicemia': 'glicose',
  'Hemoglobina glicada (A1 total)': 'glicose',
  'Fungos, pesquisa a fresco': 'pesquisa_fungos',
  'DINAMOMETRIA': 'dinamometria',
  'Visita Técnica': 'visita_tec',
  'Transporte': 'transporte',
};

const UNIDADES_IGNORADAS = [
  'CAPANEMA MOVEIS',
  'AF ACADEMIA CARATINGA',
  'RAFAEL CRISTIAN DA SILVA',
  'SANTOS & FILHOS MATERIAIS',
  'SANTOS & SANTOS MATERIAIS DE CONSTRUCAO',
  'UNIDADE DO FUNCIONARIO',
  'METODOS CURITIBA',
  'MABG PRESTADORA'
];

let chartTotal = null;
let chartExames = null;
let chartMensalidade = null;
let statusFiltroAtual = 'todos';

// ========================= FUNÇÕES AUXILIARES =========================
function normalizarUnidade(nome) {
  if (!nome) return '';
  let normalizado = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  normalizado = normalizado.replace(/[()\-.,/]/g, ' ');
  const sufixos = [
    ' LTDA', ' LTDA.', ' S/A', ' S.A.', ' ME', ' EIRELI', ' SS', ' S/S',
    ' ADMINISTRADORA', ' ADMINISTRADORA DE CARTOES',
    ' SERVICOS', ' MEDICOS', ' ODONTOLOGICOS', ' CLINICA', ' APOIO',
    ' DE ', ' DO ', ' DA ', ' DAS ', ' DOS ', ' E '
  ];
  sufixos.forEach(suf => {
    const regex = new RegExp(`\\s*${suf.trim()}$`, 'i');
    normalizado = normalizado.replace(regex, '');
  });
  normalizado = normalizado.replace(/\s+/g, ' ').trim().toUpperCase();
  return normalizado;
}

function normalizarCnpj(cnpj) {
  if (!cnpj) return '';
  return cnpj.replace(/\D/g, '');
}

function normalizarNomeExame(nome) {
  if (!nome) return '';
  const limpo = nome.trim();
  if (EXAME_MAP[limpo]) return EXAME_MAP[limpo];
  for (let [key, value] of Object.entries(EXAME_MAP)) {
    if (limpo.includes(key) || key.includes(limpo)) return value;
  }
  return limpo;
}

function isUnidadeIgnorada(nome) {
  if (!nome) return false;
  const normalizado = normalizarUnidade(nome);
  return UNIDADES_IGNORADAS.some(ignorada => normalizarUnidade(ignorada) === normalizado);
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mostrarAlerta(mensagem, tipo = 'info') {
  const area = document.getElementById('alertArea');
  if (!area) {
    console.log(`${tipo.toUpperCase()}: ${mensagem}`);
    return;
  }
  area.innerHTML = `<div class="alert alert-${tipo} alert-dismissible fade show" role="alert">
    ${mensagem}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  </div>`;
}

// ========================= AUTENTICAÇÃO PARA EDGE FUNCTION =========================
async function getSupabaseToken() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session?.access_token || null;
}

async function fetchOmieProxy(payload) {
  const token = await getSupabaseToken();
  
  if (!token) {
    throw new Error('Usuário não autenticado. Faça login novamente.');
  }

  try {
    console.log(`📤 Chamando Edge Function...`);
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}`;
      
      try {
        const errorData = JSON.parse(errorText);
        console.error('📄 Detalhes do erro:', errorData);
        if (errorData.details && errorData.details.faultstring) {
          errorMessage += `: ${errorData.details.faultstring}`;
        } else if (errorData.error) {
          errorMessage += `: ${errorData.error}`;
        } else if (errorData.message) {
          errorMessage += `: ${errorData.message}`;
        } else {
          errorMessage += `: ${errorText}`;
        }
      } catch (e) {
        errorMessage += `: ${errorText}`;
      }
      
      throw new Error(errorMessage);
    }

    return response;
  } catch (err) {
    console.error('❌ Erro no fetchOmieProxy:', err.message);
    throw err;
  }
}

// ========================= CONSTANTES DA OMIE =========================
const CODIGO_SERVICO_OMIE = '17.12.01';
const CODIGO_CATEGORIA_OMIE = '1.01.02';
const CODIGO_CONTA_CORRENTE = 3172676169;
const CODIGO_SERVICO_LC116 = '17.12';

// ========================= FUNÇÕES OMIE =========================

// Buscar e-mail do cliente
async function buscarEmailClienteOmie(codigoCliente) {
  try {
    console.log(`🔍 Buscando e-mail do cliente código: ${codigoCliente}`);
    
    const payload = {
      endpoint: 'geral/clientes',
      call: 'ConsultarCliente',
      param: [{
        codigo_cliente_omie: codigoCliente.toString()
      }]
    };
    
    const response = await fetchOmieProxy(payload);
    
    if (!response.ok) {
      console.error(`HTTP ${response.status} ao buscar e-mail`);
      return '';
    }
    
    const data = await response.json();
    
    if (data.fault) {
      console.error('Erro OMIE:', data.fault.faultstring);
      return '';
    }
    
    const email = data.email || 
                  data.email_cliente || 
                  data.contato?.email || 
                  data.dados_contato?.email ||
                  '';
    
    if (email) {
      console.log(`✅ E-mail encontrado: ${email}`);
    } else {
      console.log('⚠️ E-mail não encontrado no cadastro do cliente');
    }
    
    return email;
  } catch (err) {
    console.error('❌ Erro ao buscar e-mail:', err);
    return '';
  }
}

// ========================= CRIAR ORDEM DE SERVIÇO NA OMIE (ETAPA 50) - VERSÃO FINAL =========================
async function criarOrdemServicoOmie(registro, codigoCliente) {
  const now = new Date();
  const timestamp = now.getTime();
  const random = Math.floor(Math.random() * 10000);
  const codigoIntegracao = `OS-${registro.ano}${String(registro.mes).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${timestamp}-${random}`;
  
  console.log(`🔑 Código de integração gerado: ${codigoIntegracao}`);

  const emailCliente = await buscarEmailClienteOmie(codigoCliente);

  let descricaoCompleta = '';
  const detalhes = registro.detalhes || {};
  
  if (detalhes.mensalidade) {
    const mens = detalhes.mensalidade;
    const valorMensalidade = mens.precoUnitario || 0;
    descricaoCompleta += `MENSALIDADE: R$ ${valorMensalidade.toFixed(2)}\n`;
  }
  
  if (detalhes['vidas (NR-1)']) {
    const vidas = detalhes['vidas (NR-1)'];
    const qtdVidas = vidas.quantidade || 0;
    const valorVida = vidas.precoUnitario || 0;
    const subtotalVidas = qtdVidas * valorVida;
    descricaoCompleta += `VIDAS NR-1: ${qtdVidas} x R$ ${valorVida.toFixed(2)} = R$ ${subtotalVidas.toFixed(2)}\n`;
  }
  
  for (let [exame, info] of Object.entries(detalhes)) {
    if (exame === 'mensalidade' || exame === 'vidas (NR-1)') continue;
    
    if (typeof info === 'object' && info.funcionarios && info.funcionarios.length > 0) {
      info.funcionarios.forEach(f => {
        const nomeFunc = f.nome || 'N/A';
        const dataExame = f.data || '—';
        const valorUnitario = info.precoUnitario || 0;
        descricaoCompleta += `${exame.toUpperCase()} - ${nomeFunc} - ${dataExame} - R$ ${valorUnitario.toFixed(2)}\n`;
      });
    } else if (typeof info === 'object' && info.quantidade !== undefined) {
      const qtd = info.quantidade || 0;
      const valorUnitario = info.precoUnitario || 0;
      descricaoCompleta += `${exame.toUpperCase()} - ${qtd} unid. - R$ ${valorUnitario.toFixed(2)}\n`;
    } else {
      descricaoCompleta += `${exame.toUpperCase()} - ${info}\n`;
    }
  }
  
  if (!descricaoCompleta) {
    descricaoCompleta = `Faturamento ${registro.mes}/${registro.ano} - ${registro.unidade}`;
  }

  // Data de vencimento compensada
  let dataVencimentoOriginal = '01/08/2026';
  if (registro.data_vencimento) {
    const partes = registro.data_vencimento.split('-');
    const ano = parseInt(partes[0]);
    const mes = parseInt(partes[1]);
    const dia = parseInt(partes[2]);
    
    let mesCorrigido = mes - 1;
    let anoCorrigido = ano;
    if (mesCorrigido === 0) {
      mesCorrigido = 12;
      anoCorrigido = ano - 1;
    }
    
    const dataCorrigida = new Date(anoCorrigido, mesCorrigido - 1, dia);
    dataVencimentoOriginal = dataCorrigida.toLocaleDateString('pt-BR');
  }

  const cabecalho = {
    cCodIntOS: codigoIntegracao,
    nCodCli: parseInt(codigoCliente),
    dDtPrevisao: dataVencimentoOriginal,
    cEtapa: '50',
    nQtdeParc: 1,
    cCodParc: '999'
  };

  const servicosPrestados = [{
    cCodServMun: CODIGO_SERVICO_OMIE,
    cCodServLC116: CODIGO_SERVICO_LC116,
    cDescServ: descricaoCompleta,
    nQtde: 1,
    nValUnit: registro.valor_total,
    cDadosAdicItem: descricaoCompleta,
    cTribServ: "1",
    cRetemISS: "N",
    impostos: {
      nAliqISS: 2.01
    }
  }];

  const informacoesAdicionais = {
    cCidPrestServ: 'ARAUCARIA (PR)',
    cCodCateg: CODIGO_CATEGORIA_OMIE,
    nCodCC: CODIGO_CONTA_CORRENTE,
    cDadosAdicNF: descricaoCompleta,
    cNumRecibo: "0"
  };

  const email = {
    cEnvBoleto: 'S',
    cEnvLink: 'S',
    cEnviarPara: emailCliente
  };

  const payloadCriar = {
    endpoint: 'servicos/os',
    call: 'IncluirOS',
    param: [{
      cabecalho: cabecalho,
      servicosPrestados: servicosPrestados,
      informacoesAdicionais: informacoesAdicionais,
      email: email
    }]
  };

  console.log('🚀 Criando OS na OMIE (Etapa 50)...');
  console.log('📤 Payload:', JSON.stringify(payloadCriar, null, 2));

  const responseCriar = await fetchOmieProxy(payloadCriar);
  
  if (!responseCriar.ok) {
    const errorText = await responseCriar.text();
    console.error('Erro na resposta:', errorText);
    throw new Error(`HTTP ${responseCriar.status}: ${errorText}`);
  }

  const resultCriar = await responseCriar.json();
  console.log('📥 Resposta criação:', JSON.stringify(resultCriar, null, 2));

  if (resultCriar.fault) {
    throw new Error(`Erro OMIE ao criar: ${resultCriar.fault.faultstring}`);
  }

  const osId = resultCriar.nCodOS || resultCriar.cabecalho?.nCodOS;
  console.log(`✅ OS criada com ID: ${osId}`);
  console.log(`📅 Data enviada: ${dataVencimentoOriginal}`);
  console.log(`📍 Cidade: ARAUCARIA (PR)`);
  console.log(`✅ Tributação: Exigível (cTribISS: N)`);

  return resultCriar;
}

// Listar OS prontas para faturar (Etapa 50)
async function listarOSProntasParaFaturar() {
  console.log('🔍 Buscando OS prontas para faturar (Etapa 50)...');
  
  const payload = {
    endpoint: 'servicos/os',
    call: 'ListarOS',
    param: [{
      pagina: 1,
      registros_por_pagina: 100,
      filtrar_por_etapa: '50'
    }]
  };
  
  try {
    const response = await fetchOmieProxy(payload);
    const data = await response.json();
    
    if (data.fault) {
      throw new Error(`Erro OMIE: ${data.fault.faultstring}`);
    }
    
    const osList = data.osCadastro || [];
    console.log(`📋 ${osList.length} OS prontas para faturar`);
    return osList;
  } catch (err) {
    console.error('❌ Erro:', err);
    return [];
  }
}

// ========================= FATURAR EM LOTE CORRIGIDO =========================
async function faturarLoteOSCorrigido(etapa = '50') {
  console.log(`💰 Faturando todas as OS com etapa: ${etapa} → Etapa 60`);
  
  const payload = {
    endpoint: 'servicos/oslote',
    call: 'FaturarLoteOS',
    param: [{
      cEtapa: etapa
    }]
  };
  
  try {
    const response = await fetchOmieProxy(payload);
    const data = await response.json();
    console.log('📥 Resposta faturamento em lote:', data);
    
    if (data.fault) {
      throw new Error(`Erro OMIE: ${data.fault.faultstring}`);
    }
    
    const qtd = data.nQtdeFat || data.nQtdetFet || 0;
    const idLote = data.nIdLoteFat || data.nIdLoteFet || 'N/A';
    
    console.log(`✅ ${qtd} OS enviadas para faturamento!`);
    console.log(`📋 ID do Lote: ${idLote}`);
    return data;
  } catch (err) {
    console.error('❌ Erro ao faturar em lote:', err);
    throw err;
  }
}

// ========================= TESTAR FATURAMENTO EM LOTE CORRIGIDO =========================
async function testarFaturarLote() {
  console.log('🚀 Testando faturamento em lote...');
  
  try {
    // Primeiro, verificar se há OS na Etapa 50
    const osList = await listarOSProntasParaFaturar();
    console.log(`📋 ${osList.length} OS encontradas na Etapa 50`);
    
    if (osList.length === 0) {
      console.log('⚠️ Nenhuma OS na Etapa 50 para faturar.');
      return;
    }
    
    // Mostrar quais OS serão faturadas
    console.log('📋 OS que serão faturadas:');
    osList.forEach(os => {
      const numOS = os.Cabecalho?.cNumOS || os.cabecalho?.cNumOS || 'N/A';
      const cliente = os.Cabecalho?.cNomeCli || os.cabecalho?.cNomeCli || 'Sem cliente';
      console.log(`  OS ${numOS} - ${cliente}`);
    });
    
    // Confirmar com o usuário
    if (!confirm(`Deseja faturar ${osList.length} OS?`)) {
      console.log('❌ Operação cancelada pelo usuário.');
      return;
    }
    
    // Executar o faturamento em lote
    const resultado = await faturarLoteOSCorrigido('50');
    console.log('✅ Resultado:', resultado);
    
    // Verificar o status do lote após alguns segundos
    const idLote = resultado.nIdLoteFat || resultado.nIdLoteFet;
    if (idLote) {
      console.log(`⏳ Aguardando 5 segundos para verificar o status do lote ${idLote}...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const status = await statusLoteOS(idLote);
      console.log('📊 Status do lote:', status);
    }
    
    return resultado;
  } catch (err) {
    console.error('❌ Erro:', err.message);
    throw err;
  }
}

// Função para monitorar o lote até concluir
async function monitorarLoteAteConcluir(nIdLoteFat) {
  console.log(`🔍 Monitorando lote ${nIdLoteFat}...`);
  
  let tentativas = 0;
  const maxTentativas = 20;
  
  while (tentativas < maxTentativas) {
    try {
      const status = await statusLoteOS(nIdLoteFat);
      tentativas++;
      
      console.log(`📊 Tentativa ${tentativas}/${maxTentativas} - Status: ${status.cStatus} - Processadas: ${status.nQtdeProcessadas || 0}/${status.nQtdeTotal || 0}`);
      
      if (status.cStatus === 'Concluído') {
        console.log(`✅ Lote ${nIdLoteFat} concluído com sucesso!`);
        console.log(`📋 ${status.nQtdeProcessadas || 0} OS faturadas`);
        
        // Verificar as OS na Etapa 60
        await listarOSFaturadas();
        return status;
      }
      
      if (status.cStatus === 'Erro') {
        console.error(`❌ Lote ${nIdLoteFat} falhou!`);
        return status;
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (err) {
      console.error(`❌ Erro:`, err);
      tentativas++;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  console.log(`⏰ Tempo limite excedido para o lote ${nIdLoteFat}`);
  return null;
}

// Status do lote
async function statusLoteOS(nIdLoteFat) {
  console.log(`🔍 Verificando status do lote: ${nIdLoteFat}`);
  
  const payload = {
    endpoint: 'servicos/oslote',
    call: 'StatusLoteOS',
    param: [{
      nIdLoteFat: parseInt(nIdLoteFat)
    }]
  };
  
  try {
    const response = await fetchOmieProxy(payload);
    const data = await response.json();
    console.log('📥 Status do lote:', data);
    return data;
  } catch (err) {
    console.error('❌ Erro:', err);
    return null;
  }
}

// Faturar OS individualmente
async function faturarOSIndividual(codigoOS) {
  console.log(`💰 Faturando OS ${codigoOS} individualmente...`);
  
  const payload = {
    endpoint: 'servicos/os',
    call: 'FaturarOS',
    param: [{
      nCodOS: parseInt(codigoOS)
    }]
  };
  
  try {
    const response = await fetchOmieProxy(payload);
    const data = await response.json();
    console.log('📥 Resposta:', data);
    
    if (data.fault) {
      throw new Error(`Erro OMIE: ${data.fault.faultstring}`);
    }
    
    console.log(`✅ OS ${codigoOS} faturada com sucesso!`);
    return data;
  } catch (err) {
    console.error(`❌ Erro ao faturar OS ${codigoOS}:`, err.message);
    throw err;
  }
}

// Trocar etapa da OS
async function trocarEtapaOS(codigoOS, novaEtapa = '60') {
  console.log(`🔄 Trocando etapa da OS ${codigoOS} para ${novaEtapa}...`);
  
  const payload = {
    endpoint: 'servicos/os',
    call: 'TrocarEtapaOS',
    param: [{
      nCodOS: parseInt(codigoOS),
      cEtapa: novaEtapa
    }]
  };
  
  try {
    console.log('📤 Payload:', JSON.stringify(payload, null, 2));
    const response = await fetchOmieProxy(payload);
    const data = await response.json();
    console.log('📥 Resposta:', JSON.stringify(data, null, 2));
    
    if (data.fault) {
      throw new Error(`Erro OMIE: ${data.fault.faultstring}`);
    }
    
    console.log(`✅ OS ${codigoOS} trocada para etapa ${novaEtapa}!`);
    console.log(`   Número OS: ${data.cNumOS || 'N/A'}`);
    console.log(`   Nova Etapa: ${data.cEtapa || novaEtapa}`);
    return data;
  } catch (err) {
    console.error(`❌ Erro ao trocar etapa:`, err.message);
    throw err;
  }
}

// Consultar OS
async function consultarOS(codigoOS) {
  console.log(`🔍 Consultando OS ${codigoOS}...`);
  
  const payload = {
    endpoint: 'servicos/os',
    call: 'ConsultarOS',
    param: [{
      nCodOS: parseInt(codigoOS)
    }]
  };
  
  try {
    const response = await fetchOmieProxy(payload);
    const data = await response.json();
    console.log('📥 Dados da OS:', JSON.stringify(data, null, 2));
    
    if (data.fault) {
      console.error('❌ Erro OMIE:', data.fault.faultstring);
      return null;
    }
    
    console.log(`📋 OS ${codigoOS}:`);
    console.log(`   Número: ${data.cabecalho?.cNumOS || data.Cabecalho?.cNumOS || 'N/A'}`);
    console.log(`   Etapa: ${data.cabecalho?.cEtapa || data.Cabecalho?.cEtapa || 'N/A'}`);
    console.log(`   Cliente: ${data.cabecalho?.cNomeCli || data.Cabecalho?.cNomeCli || 'N/A'}`);
    console.log(`   Valor: R$ ${data.servicosPrestados?.[0]?.nValUnit || data.ServicosPrestados?.[0]?.nValUnit || 0}`);
    console.log(`   Faturada: ${data.cabecalho?.cFaturada || data.Cabecalho?.cFaturada || 'N'}`);
    
    return data;
  } catch (err) {
    console.error('❌ Erro:', err);
    return null;
  }
}

// ========================= PROCESSAR UPLOAD - VERSÃO CORRIGIDA =========================
async function processarUpload(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // 1) Localizar cabeçalho
  let headerRowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.length >= 3 &&
        row[0]?.toString().trim() === 'Exames' &&
        row[1]?.toString().trim() === 'Funcionário' &&
        row[2]?.toString().trim() === 'Data do Exame') {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) throw new Error('Cabeçalho da planilha não encontrado.');

  const dataRows = rows.slice(headerRowIndex + 1);

  // 2) Extrair datas para determinar o mês de referência
  const mapMesAno = {};
  let maxCount = 0;
  let mesEscolhido = 0, anoEscolhido = 0;

  for (let row of dataRows) {
    if (!row[0] && !row[1] && !row[2]) continue;
    const dataExameStr = row[2]?.toString().trim();
    if (!dataExameStr) continue;

    const partes = dataExameStr.split(/[\/\-]/);
    if (partes.length === 3) {
      let d, m, a;
      if (parseInt(partes[0]) > 31) {
        a = parseInt(partes[0]);
        m = parseInt(partes[1]);
        d = parseInt(partes[2]);
      } else {
        d = parseInt(partes[0]);
        m = parseInt(partes[1]);
        a = parseInt(partes[2]);
        if (a < 100) a += 2000;
      }
      if (!isNaN(d) && !isNaN(m) && !isNaN(a) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const dataObj = new Date(a, m - 1, d);
        if (!isNaN(dataObj.getTime())) {
          const chave = `${a}-${m}`;
          mapMesAno[chave] = (mapMesAno[chave] || 0) + 1;
          if (mapMesAno[chave] > maxCount) {
            maxCount = mapMesAno[chave];
            mesEscolhido = m;
            anoEscolhido = a;
          }
        }
      }
    }
  }

  if (mesEscolhido === 0) {
    const now = new Date();
    mesEscolhido = now.getMonth() + 1;
    anoEscolhido = now.getFullYear();
  }

  // ===== CORREÇÃO: MÊS DE FATURAMENTO = MÊS DOS EXAMES + 1 =====
  let mesFaturamento = mesEscolhido + 1;
  let anoFaturamento = anoEscolhido;
  if (mesFaturamento > 12) {
    mesFaturamento = 1;
    anoFaturamento += 1;
  }

  console.log(`📅 Mês dos exames: ${mesEscolhido}/${anoEscolhido}`);
  console.log(`📅 Mês de faturamento: ${mesFaturamento}/${anoFaturamento}`);

  // 4) Ler exames por unidade da planilha
  const examesPorUnidade = {};
  const unidadesNaPlanilha = new Set();

  for (let row of dataRows) {
    if (!row[0] && !row[1] && !row[2]) continue;
    const exameUpload = row[0]?.toString().trim();
    const unidadePlanilha = row[4]?.toString().trim();
    const funcionario = row[1]?.toString().trim();
    const dataExameStr = row[2]?.toString().trim();
    if (!exameUpload || !unidadePlanilha) continue;

    if (isUnidadeIgnorada(unidadePlanilha)) continue;

    const exameNormalizado = normalizarNomeExame(exameUpload);
    if (!exameNormalizado) continue;

    const chaveUnidade = normalizarUnidade(unidadePlanilha);
    unidadesNaPlanilha.add(chaveUnidade);

    if (!examesPorUnidade[chaveUnidade]) {
      examesPorUnidade[chaveUnidade] = [];
    }
    examesPorUnidade[chaveUnidade].push({
      exame: exameNormalizado,
      nomeOriginal: exameUpload,
      funcionario: funcionario || 'N/A',
      dataExame: dataExameStr || '—'
    });
  }

  // 5) Buscar TODAS as unidades cadastradas
  const { data: todasUnidades, error: unidadesError } = await supabaseClient
    .from('precos')
    .select('*');

  if (unidadesError) throw unidadesError;

  // 6) Construir mapas para busca
  const mapaUnidades = {};
  const mapaUnidadesPorRazaoSocial = {};

  todasUnidades.forEach(u => {
    const chave = normalizarUnidade(u.unidade);
    mapaUnidades[chave] = u;
    if (u.razao_social) {
      const chaveRazao = normalizarUnidade(u.razao_social);
      mapaUnidadesPorRazaoSocial[chaveRazao] = u;
    }
  });

  // 7) Determinar quais unidades serão processadas
  const unidadesParaProcessar = new Set();

  for (let chave of unidadesNaPlanilha) {
    unidadesParaProcessar.add(chave);
  }

  for (let [chave, unidade] of Object.entries(mapaUnidades)) {
    const temMensalidade = unidade.mensalidade && unidade.mensalidade > 0;
    const temVidas = unidade.vidas && unidade.vidas > 0 && unidade.qtd_vidas && unidade.qtd_vidas > 0;
    
    if (temMensalidade || temVidas) {
      unidadesParaProcessar.add(chave);
      console.log(`✅ Unidade incluída (mensalidade/vidas): ${unidade.unidade}`);
    }
  }

  console.log(`📊 Total de unidades a processar: ${unidadesParaProcessar.size}`);

  // 8) Buscar cada unidade e construir registros
  const unidadesEncontradas = {};
  const unidadesNaoEncontradas = [];

  for (let chave of unidadesParaProcessar) {
    let unidadeEncontrada = null;
    
    if (mapaUnidades[chave]) {
      unidadeEncontrada = mapaUnidades[chave];
    } else if (mapaUnidadesPorRazaoSocial[chave]) {
      unidadeEncontrada = mapaUnidadesPorRazaoSocial[chave];
    } else {
      for (let [nomeCadastrado, unidade] of Object.entries(mapaUnidades)) {
        if (nomeCadastrado.includes(chave) || chave.includes(nomeCadastrado)) {
          unidadeEncontrada = unidade;
          break;
        }
      }
      if (!unidadeEncontrada) {
        for (let [razaoCadastrada, unidade] of Object.entries(mapaUnidadesPorRazaoSocial)) {
          if (razaoCadastrada.includes(chave) || chave.includes(razaoCadastrada)) {
            unidadeEncontrada = unidade;
            break;
          }
        }
      }
    }

    if (unidadeEncontrada) {
      unidadesEncontradas[chave] = unidadeEncontrada;
    } else {
      unidadesNaoEncontradas.push(chave);
      console.warn(`❌ Unidade NÃO encontrada no cadastro: "${chave}"`);
    }
  }

  // 9) Construir registros de faturamento
  const registros = [];

  for (let chavePlanilha in unidadesEncontradas) {
    const unidade = unidadesEncontradas[chavePlanilha];
    const nomeUnidade = unidade.unidade;

    const detalhes = {};
    let total = 0;

    // ===== MENSALIDADE =====
    if (unidade.mensalidade && unidade.mensalidade > 0) {
      total += unidade.mensalidade;
      detalhes['mensalidade'] = { 
        quantidade: 1, 
        precoUnitario: unidade.mensalidade,
        subtotal: unidade.mensalidade
      };
    }

    // ===== VIDAS (NR-1) =====
    if (unidade.vidas && unidade.vidas > 0 && unidade.qtd_vidas && unidade.qtd_vidas > 0) {
      const valorVidas = unidade.vidas * unidade.qtd_vidas;
      total += valorVidas;
      detalhes['vidas (NR-1)'] = {
        quantidade: unidade.qtd_vidas,
        precoUnitario: unidade.vidas,
        subtotal: valorVidas
      };
    }

    // ===== EXAMES =====
    if (examesPorUnidade[chavePlanilha]) {
      for (let ex of examesPorUnidade[chavePlanilha]) {
        const preco = unidade[ex.exame] || 0;
        if (preco === 0) continue;
        total += preco;
        if (!detalhes[ex.exame]) {
          detalhes[ex.exame] = {
            quantidade: 0,
            precoUnitario: preco,
            funcionarios: []
          };
        }
        detalhes[ex.exame].quantidade += 1;
        detalhes[ex.exame].funcionarios.push({
          nome: ex.funcionario,
          data: ex.dataExame
        });
      }
    }

    if (Object.keys(detalhes).length === 0) {
      console.warn(`⚠️ Unidade sem itens para faturar: ${nomeUnidade}`);
      continue;
    }

    // ===== DATA DE VENCIMENTO CORRETA =====
    // Mês de faturamento: mesFaturamento (ex: AGOSTO)
    // Dia: do cadastro da unidade
    const diaVencimento = unidade.dia_vencimento || 10;
    const ultimoDia = new Date(anoFaturamento, mesFaturamento, 0).getDate();
    const diaFinal = Math.min(diaVencimento, ultimoDia);
    // Data com o MÊS DE FATURAMENTO (AGOSTO) e o DIA do cadastro
    const dataVencimento = new Date(anoFaturamento, mesFaturamento - 1, diaFinal);
    const dataVencimentoStr = dataVencimento.toISOString().split('T')[0];

    console.log(`📅 ${nomeUnidade}: vencimento em ${dataVencimentoStr}`);

    registros.push({
      unidade: nomeUnidade,
      mes: mesFaturamento,
      ano: anoFaturamento,
      valor_total: total,
      detalhes: detalhes,
      data_vencimento: dataVencimentoStr,
      nota_emitida: false,
      boleto_enviado: false,
      pago: false
    });
  }

  if (registros.length === 0) throw new Error('Nenhuma unidade com itens para faturar.');

  // 10) Deletar registros antigos do mesmo mês/ano
  const { error: deleteError } = await supabaseClient
    .from('faturamento')
    .delete()
    .eq('mes', mesFaturamento)
    .eq('ano', anoFaturamento);

  if (deleteError) {
    console.warn('Erro ao deletar registros antigos:', deleteError);
  }

  // 11) Inserir novos registros
  const { data: insertedData, error: insertError } = await supabaseClient
    .from('faturamento')
    .insert(registros)
    .select();

  if (insertError) throw insertError;

  const totalGeral = registros.reduce((acc, r) => acc + r.valor_total, 0);

  console.log('📊 RESUMO DO PROCESSAMENTO:');
  console.log(`   Mês de faturamento: ${mesFaturamento}/${anoFaturamento}`);
  console.log(`   Total de registros: ${registros.length}`);
  console.log(`   Valor total: R$ ${totalGeral.toFixed(2)}`);
  console.log(`   Unidades na planilha: ${unidadesNaPlanilha.size}`);
  console.log(`   Unidades com mensalidade/vidas: ${unidadesParaProcessar.size - unidadesNaPlanilha.size}`);
  console.log(`   Unidades não encontradas: ${unidadesNaoEncontradas.length}`);

  return {
    totalRegistros: registros.length,
    totalGeral,
    unidadesNaoEncontradas,
    mesProcessado: mesFaturamento,
    anoProcessado: anoFaturamento,
    unidadesEncontradas: Object.keys(unidadesEncontradas).length,
    unidadesComMensalidadeVidas: unidadesParaProcessar.size - unidadesNaPlanilha.size
  };
}

// ========================= FUNÇÕES DE BUSCA DE CLIENTES =========================
async function listarClientesOmie() {
  const agora = Date.now();
  if (clientesCache && (agora - ultimaBuscaClientes) < CACHE_TTL) {
    console.log(`📦 Usando cache de clientes (${clientesCache.length} clientes)`);
    return clientesCache;
  }

  let pagina = 1;
  let todosClientes = [];
  let totalPaginas = 1;
  const MAX_PAGINAS = 50;
  let tentativas = 0;
  const MAX_TENTATIVAS = 3;

  while (pagina <= totalPaginas && pagina <= MAX_PAGINAS && tentativas < MAX_TENTATIVAS) {
    try {
      console.log(`📄 Buscando página ${pagina} de clientes...`);
      const payload = {
        endpoint: 'geral/clientes',
        call: 'ListarClientes',
        param: [{ 
          pagina: pagina, 
          registros_por_pagina: 100
        }]
      };
      
      const response = await fetchOmieProxy(payload);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`HTTP ${response.status} na página ${pagina}:`, errorText);
        tentativas++;
        if (tentativas < MAX_TENTATIVAS) {
          console.log(`⏳ Tentativa ${tentativas}/${MAX_TENTATIVAS}, aguardando...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        break;
      }
      
      const data = await response.json();
      
      if (data.fault) {
        console.error('Erro OMIE:', data.faultstring);
        if (data.faultstring && data.faultstring.includes('REDUNDANT')) {
          const waitTime = parseInt(data.faultstring.match(/\d+/)?.[0] || 30);
          console.log(`⏳ Aguardando ${waitTime} segundos...`);
          await new Promise(resolve => setTimeout(resolve, (waitTime + 5) * 1000));
          continue;
        }
        break;
      }

      const clientes = data.clientes_cadastro || data.clientes || [];
      console.log(`📄 Página ${pagina}: ${clientes.length} clientes carregados`);
      
      todosClientes = todosClientes.concat(clientes);
      
      if (data.total_paginas) {
        totalPaginas = data.total_paginas;
        console.log(`📊 Total de páginas: ${totalPaginas}`);
      }
      
      pagina++;
      tentativas = 0;
      
      if (pagina <= totalPaginas && pagina <= MAX_PAGINAS) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    } catch (err) {
      console.error(`Erro na página ${pagina}:`, err.message);
      tentativas++;
      if (tentativas < MAX_TENTATIVAS) {
        console.log(`⏳ Tentativa ${tentativas}/${MAX_TENTATIVAS}, aguardando...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        break;
      }
    }
  }

  console.log(`✅ Total de clientes carregados: ${todosClientes.length}`);
  
  clientesCache = todosClientes;
  ultimaBuscaClientes = Date.now();
  
  return todosClientes;
}

async function buscarClientePorCnpjPaginado(cnpj) {
  const cnpjLimpo = normalizarCnpj(cnpj);
  if (!cnpjLimpo || cnpjLimpo.length !== 14) {
    console.error(`CNPJ inválido: ${cnpj}`);
    return null;
  }
  
  console.log(`🔍 Buscando cliente com CNPJ: ${cnpjLimpo}`);
  
  let pagina = 1;
  const MAX_PAGINAS = 613;
  let tentativas = 0;
  const MAX_TENTATIVAS = 3;
  
  while (pagina <= MAX_PAGINAS && tentativas < MAX_TENTATIVAS) {
    try {
      console.log(`📄 Buscando página ${pagina} de ${MAX_PAGINAS}...`);
      const payload = {
        endpoint: 'geral/clientes',
        call: 'ListarClientes',
        param: [{ 
          pagina: pagina, 
          registros_por_pagina: 100
        }]
      };
      
      const response = await fetchOmieProxy(payload);
      
      if (!response.ok) {
        console.error(`HTTP ${response.status} na página ${pagina}`);
        pagina++;
        tentativas = 0;
        continue;
      }
      
      const data = await response.json();
      
      if (data.fault) {
        if (data.faultstring && data.faultstring.includes('REDUNDANT')) {
          const waitTime = parseInt(data.faultstring.match(/\d+/)?.[0] || 30);
          console.log(`⏳ Aguardando ${waitTime} segundos...`);
          await new Promise(resolve => setTimeout(resolve, (waitTime + 5) * 1000));
          tentativas++;
          if (tentativas >= MAX_TENTATIVAS) {
            console.log(`❌ Muitas tentativas, pulando página ${pagina}...`);
            pagina++;
            tentativas = 0;
          }
          continue;
        }
        console.error('Erro OMIE:', data.faultstring);
        pagina++;
        continue;
      }

      const clientes = data.clientes_cadastro || data.clientes || [];
      
      for (const cliente of clientes) {
        const cnpjCliente = normalizarCnpj(cliente.cnpj_cpf || cliente.cnpj || '');
        if (cnpjCliente === cnpjLimpo) {
          const codigo = cliente.codigo_cliente_omie || cliente.codigo_cliente;
          console.log(`✅ Cliente encontrado na página ${pagina}: ${cliente.razao_social}`);
          console.log(`   CNPJ: ${cliente.cnpj_cpf || cliente.cnpj}`);
          console.log(`   Código: ${codigo}`);
          return cliente;
        }
      }
      
      console.log(`📄 Página ${pagina}: ${clientes.length} clientes, nenhum match`);
      pagina++;
      tentativas = 0;
      
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (err) {
      console.error(`Erro na página ${pagina}:`, err.message);
      pagina++;
      tentativas = 0;
    }
  }
  
  console.log(`❌ Cliente com CNPJ ${cnpj} não encontrado em ${pagina} páginas.`);
  return null;
}

async function buscarCodigoClienteParaOS(unidade) {
  console.log(`🔍 Buscando código do cliente para: ${unidade}`);
  
  const { data: unidadeData, error } = await supabaseClient
    .from('precos')
    .select('id, unidade, cnpj, codigo_cliente_omie')
    .eq('unidade', unidade)
    .single();
  
  if (error || !unidadeData) {
    console.error('❌ Unidade não encontrada:', error);
    return null;
  }
  
  if (unidadeData.codigo_cliente_omie) {
    console.log(`✅ Código já existe: ${unidadeData.codigo_cliente_omie}`);
    return unidadeData.codigo_cliente_omie;
  }
  
  if (!unidadeData.cnpj) {
    console.error('❌ Unidade sem CNPJ cadastrado');
    return null;
  }
  
  console.log(`🔍 Buscando cliente na OMIE com CNPJ: ${unidadeData.cnpj}`);
  const cliente = await buscarClientePorCnpjPaginado(unidadeData.cnpj);
  
  if (!cliente) {
    console.error(`❌ Cliente não encontrado na OMIE para CNPJ: ${unidadeData.cnpj}`);
    return null;
  }
  
  const codigo = cliente.codigo_cliente_omie || cliente.codigo_cliente;
  console.log(`✅ Cliente encontrado: ${cliente.razao_social} (código: ${codigo})`);
  
  const { error: updateError } = await supabaseClient
    .from('precos')
    .update({ codigo_cliente_omie: codigo })
    .eq('id', unidadeData.id);
  
  if (updateError) {
    console.error('❌ Erro ao salvar código:', updateError);
    return null;
  }
  
  console.log(`✅ Código ${codigo} salvo para ${unidade}`);
  return codigo;
}

async function buscarDadosClienteOmie(unidade) {
  try {
    const { data: unidadeData, error } = await supabaseClient
      .from('precos')
      .select('cnpj')
      .eq('unidade', unidade)
      .single();
    
    if (error || !unidadeData) {
      console.warn('Unidade não encontrada no cadastro:', unidade);
      return null;
    }
    
    if (!unidadeData.cnpj) {
      console.warn('Unidade sem CNPJ:', unidade);
      return null;
    }
    
    const cnpjLimpo = normalizarCnpj(unidadeData.cnpj);
    const clientes = await listarClientesOmie();
    
    if (!clientes) return null;
    
    for (const cliente of clientes) {
      const cnpjCliente = normalizarCnpj(cliente.cnpj_cpf || cliente.cnpj || '');
      if (cnpjCliente === cnpjLimpo) {
        const codigo = cliente.codigo_cliente_omie || cliente.codigo_cliente;
        return {
          cnpj: cliente.cnpj_cpf || cliente.cnpj || '',
          codigo_cliente: codigo,
          razao_social: cliente.razao_social
        };
      }
    }
    
    return null;
  } catch (err) {
    console.error('Erro ao buscar dados do cliente na OMIE:', err);
    return null;
  }
}

async function buscarCodigoClienteOmie(nomeUnidade) {
  const { data: unidade, error } = await supabaseClient
    .from('precos')
    .select('id, unidade, cnpj, codigo_cliente_omie')
    .eq('unidade', nomeUnidade)
    .single();

  if (error || !unidade) {
    throw new Error(`Unidade não encontrada no cadastro: ${nomeUnidade}`);
  }

  if (unidade.codigo_cliente_omie) {
    console.log(`✅ Código do cliente encontrado no Supabase: ${unidade.codigo_cliente_omie}`);
    return unidade.codigo_cliente_omie;
  }

  if (unidade.cnpj) {
    console.log(`🔍 Cliente sem código, tentando sincronizar pelo CNPJ: ${unidade.cnpj}`);
    try {
      const resultado = await buscarCodigoClienteParaOS(nomeUnidade);
      if (resultado) {
        console.log(`✅ Cliente sincronizado! Código: ${resultado}`);
        return resultado;
      }
    } catch (err) {
      console.error('❌ Erro ao sincronizar cliente:', err.message);
    }
  }

  throw new Error(`Código OMIE não encontrado para: ${nomeUnidade}. Execute a sincronização de clientes.`);
}

// ========================= GRÁFICOS =========================
function processarDadosPorMes(dados, ano) {
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const totalPorMes = new Array(12).fill(0);
  const examesPorMes = new Array(12).fill(0);
  const mensalidadePorMes = new Array(12).fill(0);

  dados.forEach(row => {
    if (ano > 0 && row.ano !== ano) return;
    const mesIndex = row.mes - 1;
    totalPorMes[mesIndex] += row.valor_total;
    if (row.detalhes) {
      for (let [nome, info] of Object.entries(row.detalhes)) {
        let qtd = (typeof info === 'object' && info.quantidade !== undefined) ? info.quantidade : info;
        let preco = (typeof info === 'object' && info.precoUnitario !== undefined) ? info.precoUnitario : 0;
        if (nome === 'mensalidade') {
          mensalidadePorMes[mesIndex] += qtd * preco;
        } else if (nome !== 'vidas (NR-1)') {
          examesPorMes[mesIndex] += qtd * preco;
        }
      }
    }
  });

  return { meses, totalPorMes, examesPorMes, mensalidadePorMes };
}

function renderizarGraficos(dados, ano) {
  const { meses, totalPorMes, examesPorMes, mensalidadePorMes } = processarDadosPorMes(dados, ano);

  function criarOuAtualizarGrafico(canvasId, label, data, cor) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    let chart = null;
    if (window[canvasId + 'Chart']) {
      chart = window[canvasId + 'Chart'];
      chart.data.datasets[0].data = data;
      chart.data.datasets[0].label = label;
      chart.update();
    } else {
      chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: meses,
          datasets: [{
            label: label,
            data: data,
            backgroundColor: cor,
            borderColor: cor,
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return 'R$ ' + value.toLocaleString('pt-BR');
                }
              }
            }
          }
        }
      });
      window[canvasId + 'Chart'] = chart;
    }
  }

  criarOuAtualizarGrafico('chartTotal', 'Valor Total', totalPorMes, '#213b7c');
  criarOuAtualizarGrafico('chartExames', 'Exames', examesPorMes, '#41bae8');
  criarOuAtualizarGrafico('chartMensalidade', 'Mensalidade', mensalidadePorMes, '#f59e0b');
}

// ========================= EXPORTAR PREÇOS =========================
async function exportarPrecos() {
  try {
    const { data, error } = await supabaseClient
      .from('precos')
      .select('*')
      .order('unidade', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) {
      mostrarAlerta('Nenhum dado para exportar.', 'warning');
      return;
    }

    const colunas = [
      { header: 'Grupo', field: 'grupo' },
      { header: 'Holding', field: 'holding' },
      { header: 'Unidade', field: 'unidade' },
      { header: 'CNPJ', field: 'cnpj' },
      { header: 'Exame Clínico', field: 'exame_clinico' },
      { header: 'Mensalidade', field: 'mensalidade' },
      { header: 'Vidas (valor)', field: 'vidas' },
      { header: 'Qtd Vidas', field: 'qtd_vidas' },
      { header: 'Audiometria Ocupacional', field: 'audiometria' },
      { header: 'Acuidade Visual', field: 'acuidade_visual' },
      { header: 'Eletrocardiograma', field: 'eletrocardiograma' },
      { header: 'Eletroencefalograma', field: 'eletroencefalograma' },
      { header: 'Espirometria', field: 'espirometria' },
      { header: 'Raio X Tórax', field: 'raio_x_torax' },
      { header: 'Hemograma completo', field: 'hemograma' },
      { header: 'Anti Hbs', field: 'anti_hbs' },
      { header: 'Anti Hcv', field: 'anti_hcv' },
      { header: 'Anti Hbs AG', field: 'anti_hbs_ag' },
      { header: 'VDRL', field: 'vdrl' },
      { header: 'Coprocultura', field: 'coprocultura' },
      { header: 'Parasitológico', field: 'parasitologico' },
      { header: 'Gama GT', field: 'gama_gt' },
      { header: 'Glicose', field: 'glicose' },
      { header: 'Pesquisa de Fungos', field: 'pesquisa_fungos' },
      { header: 'Dinamometria', field: 'dinamometria' },
      { header: 'Visita Técnica', field: 'visita_tec' },
      { header: 'Transporte', field: 'transporte' }
    ];

    const rows = data.map(item => {
      const row = {};
      colunas.forEach(col => {
        const valor = item[col.field];
        if (typeof valor === 'number' && col.field !== 'qtd_vidas') {
          row[col.header] = valor.toFixed(2);
        } else {
          row[col.header] = valor ?? '';
        }
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Preços');
    ws['!cols'] = colunas.map(() => ({ wch: 18 }));
    const fileName = `precos_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    mostrarAlerta(`Arquivo "${fileName}" exportado com sucesso!`, 'success');
  } catch (err) {
    mostrarAlerta('Erro ao exportar: ' + err.message, 'danger');
  }
}

// ========================= BOLETOS =========================
function getStatusBoleto(row) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  
  if (!row.omie_os_id || row.omie_status !== 'criado') {
    return { status: 'naogerado', label: 'Não Gerado', class: 'secondary', icon: 'fa-file' };
  }
  
  if (row.pago) {
    return { status: 'pago', label: 'Pago', class: 'success', icon: 'fa-check-circle' };
  }
  
  if (row.data_vencimento) {
    const venc = new Date(row.data_vencimento + 'T00:00:00');
    const diffDays = Math.ceil((venc - hoje) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      return { status: 'vencido', label: 'Vencido', class: 'danger', icon: 'fa-exclamation-circle' };
    } else if (diffDays <= 3) {
      return { status: 'avencer', label: 'Vence em breve', class: 'warning', icon: 'fa-clock' };
    } else {
      return { status: 'avencer', label: 'A Vencer', class: 'info', icon: 'fa-hourglass-half' };
    }
  }
  
  return { status: 'naogerado', label: 'Não Gerado', class: 'secondary', icon: 'fa-file' };
}

function getStatusNota(row) {
  if (!row.omie_os_id || row.omie_status !== 'criado') {
    return { status: 'naoemitida', label: 'Não Emitida', class: 'secondary', icon: 'fa-file' };
  }
  
  if (row.nota_emitida) {
    if (row.nota_status === 'rejeitada') {
      return { status: 'rejeitada', label: 'Rejeitada', class: 'danger', icon: 'fa-times-circle' };
    } else if (row.nota_status === 'aceita') {
      return { status: 'aceita', label: 'Aceita', class: 'success', icon: 'fa-check-circle' };
    } else {
      return { status: 'gerada', label: 'Gerada', class: 'info', icon: 'fa-file-pdf' };
    }
  }
  
  return { status: 'naoemitida', label: 'Não Emitida', class: 'secondary', icon: 'fa-file' };
}

async function carregarBoletos(mes = 0, ano = 0, unidadeFiltro = '', statusFiltro = 'todos') {
  let query = supabaseClient.from('faturamento').select('*');

  if (mes > 0) query = query.eq('mes', mes);
  if (ano > 0) query = query.eq('ano', ano);
  if (unidadeFiltro) query = query.ilike('unidade', `%${unidadeFiltro}%`);

  const { data, error } = await query.order('ano', { ascending: false }).order('mes', { ascending: false });
  
  if (error) {
    mostrarAlerta('Erro ao carregar boletos: ' + error.message, 'danger');
    return;
  }

  let dadosFiltrados = data || [];
  if (statusFiltro !== 'todos') {
    dadosFiltrados = dadosFiltrados.filter(row => {
      const status = getStatusBoleto(row);
      return status.status === statusFiltro;
    });
  }

  atualizarCardsBoletos(data || []);
  renderizarTabelaBoletos(dadosFiltrados);
}

function atualizarCardsBoletos(dados) {
  let pagos = 0;
  let vencidos = 0;
  let aVencer = 0;
  let naoGerados = 0;

  dados.forEach(row => {
    const status = getStatusBoleto(row);
    if (status.status === 'pago') pagos++;
    else if (status.status === 'vencido') vencidos++;
    else if (status.status === 'avencer') aVencer++;
    else if (status.status === 'naogerado') naoGerados++;
  });

  document.getElementById('totalBoletosPagos').textContent = pagos;
  document.getElementById('totalBoletosVencidos').textContent = vencidos;
  document.getElementById('totalBoletosAVencer').textContent = aVencer;
  document.getElementById('totalBoletosNaoGerados').textContent = naoGerados;
}

function renderizarTabelaBoletos(dados) {
  const tbody = document.getElementById('boletosBody');
  
  if (!dados || dados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Nenhum boleto encontrado</td></tr>`;
    return;
  }

  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  let html = '';
  dados.forEach(row => {
    const mesNome = meses[row.mes - 1];
    const statusBoleto = getStatusBoleto(row);
    const statusNota = getStatusNota(row);
    const dataVenc = row.data_vencimento ? new Date(row.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
    const isPago = row.pago;

    html += `<tr>
      <td><strong>${row.unidade}</strong></td>
      <td>${mesNome}/${row.ano}</td>
      <td class="text-end">R$ ${row.valor_total.toFixed(2)}</td>
      <td class="text-center">
        <span class="badge bg-${statusBoleto.class}">
          <i class="fas ${statusBoleto.icon}"></i> ${statusBoleto.label}
        </span>
      </td>
      <td class="text-center">
        <span class="badge bg-${statusNota.class}">
          <i class="fas ${statusNota.icon}"></i> ${statusNota.label}
        </span>
      </td>
      <td class="text-center">${dataVenc}</td>
      <td class="text-end">
        <button class="btn btn-sm toggle-status-boletos ${isPago ? 'btn-success' : 'btn-outline-secondary'}" 
                data-id="${row.id}" data-field="pago" title="${isPago ? 'Marcar como não pago' : 'Marcar como pago'}">
          <i class="fas ${isPago ? 'fa-check-circle' : 'fa-circle'}"></i>
        </button>
        <button class="btn btn-sm btn-outline-info btn-ver-nota" 
                data-id="${row.id}" 
                data-unidade="${row.unidade}"
                data-os-id="${row.omie_os_id || ''}"
                title="Ver detalhes da nota">
          <i class="fas fa-file-pdf"></i>
        </button>
      </td>
    </tr>`;
  });

  tbody.innerHTML = html;

  document.querySelectorAll('.toggle-status-boletos').forEach(btn => {
    btn.addEventListener('click', async function() {
      const id = this.dataset.id;
      const isPago = this.classList.contains('btn-success');
      
      try {
        const { error } = await supabaseClient
          .from('faturamento')
          .update({ pago: !isPago })
          .eq('id', id);
        
        if (error) throw error;
        
        mostrarAlerta(`Boleto ${isPago ? 'desmarcado como pago' : 'marcado como pago'}!`, 'success');
        
        const mes = parseInt(document.getElementById('boletoFiltroMes').value);
        const ano = parseInt(document.getElementById('boletoFiltroAno').value);
        const unidade = document.getElementById('boletoFiltroUnidade').value.trim();
        const status = document.getElementById('boletoFiltroStatus').value;
        carregarBoletos(mes, ano, unidade, status);
        
      } catch (err) {
        mostrarAlerta('Erro ao atualizar status: ' + err.message, 'danger');
      }
    });
  });

  document.querySelectorAll('.btn-ver-nota').forEach(btn => {
    btn.addEventListener('click', function() {
      const unidade = this.dataset.unidade;
      const osId = this.dataset.osId;
      
      if (!osId) {
        mostrarAlerta('Nenhuma OS associada a esta unidade.', 'warning');
        return;
      }
      
      mostrarAlerta(`Nota fiscal para ${unidade}. ID OS: ${osId}`, 'info');
    });
  });
}

async function atualizarStatusBoletos() {
  const btn = document.getElementById('btnAtualizarStatusBoletos');
  const originalText = btn.innerHTML;
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando...';
  
  try {
    const { data, error } = await supabaseClient
      .from('faturamento')
      .select('*')
      .not('omie_os_id', 'is', null)
      .eq('omie_status', 'criado');
    
    if (error) throw error;
    
    let atualizados = 0;
    
    for (const row of data) {
      try {
        const payload = {
          endpoint: 'servicos/os',
          call: 'ConsultarOS',
          param: [{
            nCodOS: parseInt(row.omie_os_id)
          }]
        };
        
        const response = await fetchOmieProxy(payload);
        const osData = await response.json();
        
        if (osData.fault) continue;
        
        const notaStatus = osData.notaFiscal?.cStatus || 'gerada';
        const isPago = osData.boletos?.some(b => b.cStatus === 'Pago') || false;
        
        const updateData = {};
        
        if (notaStatus === 'Aceita' || notaStatus === 'Autorizada') {
          updateData.nota_status = 'aceita';
        } else if (notaStatus === 'Rejeitada' || notaStatus === 'Cancelada') {
          updateData.nota_status = 'rejeitada';
        } else {
          updateData.nota_status = 'gerada';
        }
        
        if (isPago) {
          updateData.pago = true;
        }
        
        if (osData.notaFiscal) {
          updateData.nota_emitida = true;
          updateData.boleto_enviado = true;
        }
        
        await supabaseClient
          .from('faturamento')
          .update(updateData)
          .eq('id', row.id);
        
        atualizados++;
        
      } catch (err) {
        console.error(`Erro ao processar OS ${row.omie_os_id}:`, err.message);
      }
    }
    
    mostrarAlerta(`Status atualizado para ${atualizados} registros!`, 'success');
    
    const mes = parseInt(document.getElementById('boletoFiltroMes').value);
    const ano = parseInt(document.getElementById('boletoFiltroAno').value);
    const unidade = document.getElementById('boletoFiltroUnidade').value.trim();
    const status = document.getElementById('boletoFiltroStatus').value;
    carregarBoletos(mes, ano, unidade, status);
    
  } catch (err) {
    mostrarAlerta('Erro ao atualizar status: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function exportarBoletosCSV() {
  const table = document.getElementById('boletosTable');
  if (!table) return;
  
  let csv = 'Unidade,Mês/Ano,Valor (R$),Status Boleto,Status Nota,Data Vencimento\n';
  const rows = table.querySelectorAll('tbody tr');
  
  rows.forEach(row => {
    const cols = row.querySelectorAll('td');
    if (cols.length >= 6) {
      const unidade = cols[0]?.textContent?.trim() || '';
      const mesAno = cols[1]?.textContent?.trim() || '';
      const valor = cols[2]?.textContent?.trim()?.replace('R$ ', '') || '';
      const statusBoleto = cols[3]?.textContent?.trim() || '';
      const statusNota = cols[4]?.textContent?.trim() || '';
      const dataVenc = cols[5]?.textContent?.trim() || '';
      
      csv += `"${unidade}","${mesAno}",${valor},"${statusBoleto}","${statusNota}","${dataVenc}"\n`;
    }
  });
  
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `boletos_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
}

// ========================= FUNÇÕES DE RELATÓRIO =========================
async function carregarRelatorio(mes = 0, ano = 0, unidadeFiltro = '', status = 'todos') {
  let query = supabaseClient.from('faturamento').select('*');

  if (mes > 0) query = query.eq('mes', mes);
  if (ano > 0) query = query.eq('ano', ano);
  if (unidadeFiltro) query = query.ilike('unidade', `%${unidadeFiltro}%`);

  if (status === 'pendentes') {
    query = query.eq('nota_emitida', false).eq('boleto_enviado', false).eq('pago', false);
  } else if (status === 'enviado') {
    query = query.eq('nota_emitida', true).eq('boleto_enviado', true).eq('pago', false);
  } else if (status === 'pago') {
    query = query.eq('pago', true);
  }

  const { data, error } = await query.order('ano', { ascending: false }).order('mes', { ascending: false });
  if (error) {
    mostrarAlerta('Erro ao carregar relatório: ' + error.message, 'danger');
    return;
  }

  atualizarDashboards(data);

  const tbody = document.getElementById('resultsBody');
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Nenhum registro encontrado</td></tr>`;
    return;
  }

  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const hoje = new Date();

  let html = '';
  data.forEach(row => {
    const mesNome = meses[row.mes - 1];
    
    let statusClass = 'secondary';
    let statusIcon = 'fa-clock';
    let statusText = 'Pendente';
    if (row.pago) {
      statusClass = 'success';
      statusIcon = 'fa-check-circle';
      statusText = 'Pago';
    } else if (row.data_vencimento) {
      const venc = new Date(row.data_vencimento + 'T00:00:00');
      const diffDays = Math.ceil((venc - hoje) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        statusClass = 'danger';
        statusIcon = 'fa-times-circle';
        statusText = 'Vencido';
      } else if (diffDays <= 2) {
        statusClass = 'warning';
        statusIcon = 'fa-exclamation-triangle';
        statusText = 'Próx. venc.';
      } else {
        statusClass = 'info';
        statusIcon = 'fa-hourglass-half';
        statusText = 'Aguardando';
      }
    }

    const dataVenc = row.data_vencimento ? new Date(row.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
    const isEnviado = row.nota_emitida && row.boleto_enviado;
    const isPago = row.pago;
    
    const temOs = row.omie_os_id && row.omie_status === 'criado';
    const osErro = row.omie_status === 'erro';

    html += `<tr>
      <td><strong>${row.unidade}</strong></td>
      <td>${mesNome}/${row.ano}</td>
      <td class="text-end">R$ ${row.valor_total.toFixed(2)}</td>
      <td class="text-center">
        <span class="badge bg-${statusClass}"><i class="fas ${statusIcon}"></i> ${statusText}</span>
      </td>
      <td class="text-center">${dataVenc}</td>
      <td class="text-center">
        <button class="btn btn-sm toggle-status ${isEnviado ? 'btn-success' : 'btn-outline-secondary'}" 
                data-id="${row.id}" data-field="enviado" title="Marcar como enviado para unidade">
          <i class="fas fa-envelope"></i>
        </button>
        <button class="btn btn-sm toggle-status ${isPago ? 'btn-success' : 'btn-outline-secondary'}" 
                data-id="${row.id}" data-field="pago" title="Marcar como pago">
          <i class="fas fa-money-bill-wave"></i>
        </button>
        <button class="btn btn-sm btn-outline-primary btn-detalhes" 
                data-id="${row.id}" 
                data-unidade="${row.unidade}"
                data-mes="${row.mes}"
                data-ano="${row.ano}"
                data-detalhes='${JSON.stringify(row.detalhes)}'
                title="Ver detalhes">
          <i class="fas fa-eye"></i>
        </button>
        <button class="btn btn-sm ${temOs ? 'btn-success' : (osErro ? 'btn-danger' : 'btn-outline-primary')} btn-criar-os" 
                data-id="${row.id}" 
                data-unidade="${row.unidade}"
                data-valor="${row.valor_total}"
                data-mes="${row.mes}"
                data-ano="${row.ano}"
                data-detalhes='${JSON.stringify(row.detalhes)}'
                data-os-id="${row.omie_os_id || ''}"
                data-os-status="${row.omie_status || ''}"
                data-os-erro="${row.omie_erro || ''}"
                title="${temOs ? 'OS já criada (Etapa 50)' : (osErro ? 'Erro ao criar OS' : 'Criar OS na Etapa 50')}">
          <i class="fas ${temOs ? 'fa-check-circle' : (osErro ? 'fa-exclamation-triangle' : 'fa-file-invoice')}"></i>
          ${temOs ? 'OS OK' : (osErro ? 'Erro' : 'Criar OS')}
        </button>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;

  document.querySelectorAll('.toggle-status').forEach(btn => {
    btn.addEventListener('click', async function() {
      const id = this.dataset.id;
      const field = this.dataset.field;
      let updateData = {};
      if (field === 'enviado') {
        const isAtivo = this.classList.contains('btn-success');
        const novoStatus = !isAtivo;
        updateData = { nota_emitida: novoStatus, boleto_enviado: novoStatus };
      } else if (field === 'pago') {
        const isAtivo = this.classList.contains('btn-success');
        updateData = { pago: !isAtivo };
      }
      try {
        const { error } = await supabaseClient
          .from('faturamento')
          .update(updateData)
          .eq('id', id);
        if (error) throw error;
        const mesFiltro = parseInt(document.getElementById('filterMonth').value);
        const anoFiltro = parseInt(document.getElementById('filterYear').value);
        const unidadeFiltro = document.getElementById('filterUnit').value.trim();
        carregarRelatorio(mesFiltro, anoFiltro, unidadeFiltro, statusFiltroAtual);
      } catch (err) {
        mostrarAlerta('Erro ao atualizar status: ' + err.message, 'danger');
      }
    });
  });

  document.querySelectorAll('.btn-detalhes').forEach(btn => {
    btn.addEventListener('click', function() {
      const unidade = this.dataset.unidade;
      const mes = parseInt(this.dataset.mes);
      const ano = parseInt(this.dataset.ano);
      const detalhes = JSON.parse(this.dataset.detalhes);
      mostrarDetalhes(unidade, mes, ano, detalhes);
    });
  });

  document.querySelectorAll('.btn-criar-os').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.dataset.id;
      const unidade = this.dataset.unidade;
      const valor = parseFloat(this.dataset.valor);
      const mes = this.dataset.mes;
      const ano = this.dataset.ano;
      const detalhes = JSON.parse(this.dataset.detalhes);
      const osStatus = this.dataset.osStatus;
      
      if (osStatus === 'criado') {
        mostrarAlerta(`OS já criada para ${unidade}.`, 'info');
        return;
      }
      
      abrirModalCriarOs(id, unidade, valor, mes, ano, detalhes);
    });
  });
}

function mostrarDetalhes(unidade, mes, ano, detalhes) {
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const mesNome = meses[mes - 1];
  const modalTitle = document.getElementById('detalhesModalLabel');
  modalTitle.textContent = `Detalhes - ${unidade} (${mesNome}/${ano})`;

  const body = document.getElementById('detalhesModalBody');
  if (!detalhes || Object.keys(detalhes).length === 0) {
    body.innerHTML = '<p class="text-muted">Nenhum detalhe disponível.</p>';
  } else {
    let listHtml = '<ul class="list-group">';
    let totalGeral = 0;
    for (let [exame, info] of Object.entries(detalhes)) {
      let qtd, preco, funcionarios;
      if (typeof info === 'object' && info !== null) {
        qtd = info.quantidade || 0;
        preco = info.precoUnitario || 0;
        funcionarios = info.funcionarios || [];
      } else {
        qtd = info;
        preco = 0;
        funcionarios = [];
      }
      const subtotal = qtd * preco;
      totalGeral += subtotal;

      let funcionariosHtml = '';
      if (funcionarios.length > 0) {
        funcionariosHtml = '<ul class="list-unstyled mb-0 small">' +
          funcionarios.map(f => `<li>👤 ${f.nome} 📅 ${f.data}</li>`).join('') +
          '</ul>';
      }

      listHtml += `<li class="list-group-item">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <strong>${exame}</strong>
            <span class="text-muted ms-2">(${qtd} unid. x R$ ${preco.toFixed(2)})</span>
            ${funcionariosHtml}
          </div>
          <span class="badge bg-primary rounded-pill">R$ ${subtotal.toFixed(2)}</span>
        </div>
      </li>`;
    }
    if (totalGeral > 0) {
      listHtml += `<li class="list-group-item d-flex justify-content-between align-items-center fw-bold">
        Total
        <span>R$ ${totalGeral.toFixed(2)}</span>
      </li>`;
    }
    listHtml += '</ul>';
    body.innerHTML = listHtml;
  }

  const modal = new bootstrap.Modal(document.getElementById('detalhesModal'));
  modal.show();
}

function abrirModalCriarOs(id, unidade, valor, mes, ano, detalhes) {
  document.getElementById('osFaturamentoId').value = id;
  document.getElementById('osCliente').value = unidade;
  document.getElementById('osValorTotal').value = 'R$ ' + formatarMoeda(valor);
  
  const confirmBtn = document.getElementById('confirmarCriarOsBtn');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando cliente...';
  
  const statusMessage = document.getElementById('osStatusMessage');
  statusMessage.innerHTML = '<div class="alert alert-info"><i class="fas fa-spinner fa-spin"></i> Buscando código do cliente na OMIE...</div>';
  
  buscarCodigoClienteParaOS(unidade).then(async (codigoCliente) => {
    if (codigoCliente) {
      statusMessage.innerHTML = `<div class="alert alert-success">
        <i class="fas fa-check-circle"></i> Código do cliente encontrado: <strong>${codigoCliente}</strong>
      </div>`;
      
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fas fa-save"></i> Criar OS (Etapa 50)';
      confirmBtn.dataset.codigoCliente = codigoCliente;
      
      buscarDadosClienteOmie(unidade).then(result => {
        if (result) {
          document.getElementById('osCnpj').value = result.cnpj || 'Não informado';
        }
      });
    } else {
      statusMessage.innerHTML = `<div class="alert alert-danger">
        <i class="fas fa-exclamation-triangle"></i> 
        <strong>Cliente não encontrado na OMIE!</strong><br>
        Verifique se o CNPJ da unidade está correto e se o cliente está cadastrado na OMIE.
      </div>`;
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-times"></i> Cliente não encontrado';
    }
  }).catch(err => {
    statusMessage.innerHTML = `<div class="alert alert-danger">
      <i class="fas fa-exclamation-triangle"></i> Erro ao buscar cliente: ${err.message}
    </div>`;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-times"></i> Erro';
  });
  
  let descricao = `Faturamento referente a ${mes}/${ano}\n\n`;
  descricao += `Cliente: ${unidade}\n`;
  descricao += `Valor Total: R$ ${formatarMoeda(valor)}\n\n`;
  descricao += `--- Itens ---\n`;
  
  if (detalhes && Object.keys(detalhes).length > 0) {
    for (let [exame, info] of Object.entries(detalhes)) {
      let qtd = (typeof info === 'object' && info.quantidade !== undefined) ? info.quantidade : info;
      let preco = (typeof info === 'object' && info.precoUnitario !== undefined) ? info.precoUnitario : 0;
      let funcionarios = (typeof info === 'object' && info.funcionarios !== undefined) ? info.funcionarios : [];
      
      descricao += `\n${exame}:\n`;
      descricao += `  Quantidade: ${qtd}\n`;
      descricao += `  Valor Unitário: R$ ${formatarMoeda(preco)}\n`;
      descricao += `  Subtotal: R$ ${formatarMoeda(qtd * preco)}\n`;
      
      if (funcionarios && funcionarios.length > 0) {
        descricao += `  Funcionários:\n`;
        funcionarios.forEach(f => {
          descricao += `    - ${f.nome} (${f.data || 'data não informada'})\n`;
        });
      }
    }
  }
  
  document.getElementById('osDescricao').value = descricao;
  const modal = new bootstrap.Modal(document.getElementById('criarOsModal'));
  modal.show();
}

// ========================= DASHBOARD =========================
function atualizarDashboards(dados) {
  let totalExames = 0;
  let valorTotal = 0;
  let totalVidasQtd = 0;
  let totalVidasValor = 0;
  let totalMensalidade = 0;
  let clinicoQtd = 0;
  let clinicoValor = 0;
  let complementarQtd = 0;
  let complementarValor = 0;

  dados.forEach(row => {
    valorTotal += row.valor_total;
    if (row.detalhes) {
      for (let [nome, info] of Object.entries(row.detalhes)) {
        let qtd = (typeof info === 'object' && info.quantidade !== undefined) ? info.quantidade : info;
        let preco = (typeof info === 'object' && info.precoUnitario !== undefined) ? info.precoUnitario : 0;
        if (nome === 'vidas (NR-1)') {
          totalVidasQtd += qtd;
          totalVidasValor += qtd * preco;
        } else if (nome === 'mensalidade') {
          totalMensalidade += qtd * preco;
        } else {
          if (nome === 'exame_clinico') {
            clinicoQtd += qtd;
            clinicoValor += qtd * preco;
          } else {
            complementarQtd += qtd;
            complementarValor += qtd * preco;
          }
          totalExames += qtd;
        }
      }
    }
  });

  document.getElementById('totalExames').textContent = totalExames;
  document.getElementById('valorTotal').textContent = 'R$ ' + formatarMoeda(valorTotal);
  document.getElementById('totalVidas').textContent = totalVidasQtd;
  document.getElementById('totalMensalidade').textContent = 'R$ ' + formatarMoeda(totalMensalidade);

  document.getElementById('clinicoQtd').textContent = clinicoQtd;
  document.getElementById('clinicoValor').textContent = 'R$ ' + formatarMoeda(clinicoValor);
  document.getElementById('complementarQtd').textContent = complementarQtd;
  document.getElementById('complementarValor').textContent = 'R$ ' + formatarMoeda(complementarValor);

  const totalExamesValor = clinicoValor + complementarValor;
  document.getElementById('comparativoTotal').textContent = 'R$ ' + formatarMoeda(valorTotal);
  document.getElementById('comparativoMensalidade').textContent = 'R$ ' + formatarMoeda(totalMensalidade);
  document.getElementById('comparativoExames').textContent = 'R$ ' + formatarMoeda(totalExamesValor);
  document.getElementById('comparativoVidas').textContent = 'R$ ' + formatarMoeda(totalVidasValor);

  const maxValor = Math.max(valorTotal, totalMensalidade, totalExamesValor, totalVidasValor, 1);
  document.getElementById('barTotal').style.width = (valorTotal / maxValor * 100) + '%';
  document.getElementById('barMensalidade').style.width = (totalMensalidade / maxValor * 100) + '%';
  document.getElementById('barExames').style.width = (totalExamesValor / maxValor * 100) + '%';
  document.getElementById('barVidas').style.width = (totalVidasValor / maxValor * 100) + '%';
}

async function carregarCards(mes = 0, ano = 0) {
  let query = supabaseClient.from('faturamento').select('*');
  if (mes > 0) query = query.eq('mes', mes);
  if (ano > 0) query = query.eq('ano', ano);

  const { data, error } = await query;
  if (error) {
    mostrarAlerta('Erro ao carregar cards: ' + error.message, 'danger');
    return;
  }
  atualizarDashboards(data || []);
}

async function carregarGraficos(ano = 0) {
  let query = supabaseClient.from('faturamento').select('*');
  if (ano > 0) query = query.eq('ano', ano);

  const { data, error } = await query;
  if (error) {
    mostrarAlerta('Erro ao carregar gráficos: ' + error.message, 'danger');
    return;
  }
  renderizarGraficos(data || [], ano);
}

// ========================= FUNÇÕES DE CRUD PREÇOS =========================
let precosDataGlobal = [];

async function carregarPrecos() {
  const { data, error } = await supabaseClient
    .from('precos')
    .select('*')
    .order('unidade', { ascending: true });
  if (error) {
    mostrarAlerta('Erro ao carregar preços: ' + error.message, 'danger');
    return;
  }
  precosDataGlobal = data || [];
  renderizarTabelaPrecos(precosDataGlobal);
}

function renderizarTabelaPrecos(dados) {
  const tbody = document.getElementById('precosBody');
  if (!dados || dados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Nenhum registro encontrado</td></tr>`;
    return;
  }
  let html = '';
  dados.forEach(row => {
    html += `<tr>
      <td>${row.grupo || ''}</td>
      <td>${row.holding || ''}</td>
      <td><strong>${row.unidade}</strong></td>
      <td>${row.cnpj || ''}</td>
      <td class="text-end">${row.exame_clinico ? 'R$ ' + row.exame_clinico.toFixed(2) : ''}</td>
      <td class="text-end">${row.mensalidade ? 'R$ ' + row.mensalidade.toFixed(2) : ''}</td>
      <td class="text-end">${row.vidas || ''}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-soft-primary btn-edit" data-id="${row.id}"><i class="fas fa-edit"></i></button>
        <button class="btn btn-sm btn-soft-danger btn-delete" data-id="${row.id}"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;

  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      editarPreco(id);
    });
  });
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      if (confirm('Deseja realmente excluir este registro?')) excluirPreco(id);
    });
  });
}

async function salvarPreco(dados) {
  const id = dados.id;
  const payload = { ...dados };
  delete payload.id;
  Object.keys(payload).forEach(key => {
    if (payload[key] === null || payload[key] === undefined || payload[key] === '') {
      delete payload[key];
    }
  });
  let result;
  if (id) {
    result = await supabaseClient
      .from('precos')
      .update(payload)
      .eq('id', id);
  } else {
    result = await supabaseClient
      .from('precos')
      .insert([payload]);
  }
  if (result.error) {
    throw new Error(result.error.message + (result.error.details ? ' - ' + result.error.details : ''));
  }
  return result;
}

async function excluirPreco(id) {
  const { error } = await supabaseClient
    .from('precos')
    .delete()
    .eq('id', id);
  if (error) {
    mostrarAlerta('Erro ao excluir: ' + error.message, 'danger');
  } else {
    mostrarAlerta('Registro excluído com sucesso!', 'success');
    carregarPrecos();
  }
}

function preencherFormulario(dados) {
  document.getElementById('precoId').value = dados.id || '';
  document.getElementById('precoGrupo').value = dados.grupo || '';
  document.getElementById('precoHolding').value = dados.holding || '';
  document.getElementById('precoUnidade').value = dados.unidade || '';
  document.getElementById('precoRazaoSocial').value = dados.razao_social || '';
  document.getElementById('precoCnpj').value = dados.cnpj || '';
  document.getElementById('precoExameClinico').value = dados.exame_clinico || '';
  document.getElementById('precoMensalidade').value = dados.mensalidade || '';
  document.getElementById('precoVidas').value = dados.vidas || '';
  document.getElementById('precoQtdVidas').value = dados.qtd_vidas || '';
  document.getElementById('precoAudiometria').value = dados.audiometria || '';
  document.getElementById('precoAcuidade').value = dados.acuidade_visual || '';
  document.getElementById('precoEcg').value = dados.eletrocardiograma || '';
  document.getElementById('precoEeg').value = dados.eletroencefalograma || '';
  document.getElementById('precoEspirometria').value = dados.espirometria || '';
  document.getElementById('precoRaioX').value = dados.raio_x_torax || '';
  document.getElementById('precoHemograma').value = dados.hemograma || '';
  document.getElementById('precoAntiHbs').value = dados.anti_hbs || '';
  document.getElementById('precoAntiHcv').value = dados.anti_hcv || '';
  document.getElementById('precoAntiHbsAg').value = dados.anti_hbs_ag || '';
  document.getElementById('precoVdrl').value = dados.vdrl || '';
  document.getElementById('precoCoprocultura').value = dados.coprocultura || '';
  document.getElementById('precoParasitologico').value = dados.parasitologico || '';
  document.getElementById('precoGamaGt').value = dados.gama_gt || '';
  document.getElementById('precoGlicose').value = dados.glicose || '';
  document.getElementById('precoPesquisaFungos').value = dados.pesquisa_fungos || '';
  document.getElementById('precoDinamometria').value = dados.dinamometria || '';
  document.getElementById('precoVisitaTec').value = dados.visita_tec || '';
  document.getElementById('precoTransporte').value = dados.transporte || '';
  document.getElementById('precoDiaVencimento').value = dados.dia_vencimento || 10;
}

function lerFormulario() {
  const id = document.getElementById('precoId').value;
  return {
    id: id ? parseInt(id) : null,
    grupo: document.getElementById('precoGrupo').value || null,
    holding: document.getElementById('precoHolding').value || null,
    unidade: document.getElementById('precoUnidade').value.trim(),
    razao_social: document.getElementById('precoRazaoSocial').value.trim() || null,
    cnpj: document.getElementById('precoCnpj').value.trim() || null,
    exame_clinico: parseFloat(document.getElementById('precoExameClinico').value) || null,
    mensalidade: parseFloat(document.getElementById('precoMensalidade').value) || null,
    vidas: parseInt(document.getElementById('precoVidas').value) || null,
    qtd_vidas: parseInt(document.getElementById('precoQtdVidas').value) || 0,
    audiometria: parseFloat(document.getElementById('precoAudiometria').value) || null,
    acuidade_visual: parseFloat(document.getElementById('precoAcuidade').value) || null,
    eletrocardiograma: parseFloat(document.getElementById('precoEcg').value) || null,
    eletroencefalograma: parseFloat(document.getElementById('precoEeg').value) || null,
    espirometria: parseFloat(document.getElementById('precoEspirometria').value) || null,
    raio_x_torax: parseFloat(document.getElementById('precoRaioX').value) || null,
    hemograma: parseFloat(document.getElementById('precoHemograma').value) || null,
    anti_hbs: parseFloat(document.getElementById('precoAntiHbs').value) || null,
    anti_hcv: parseFloat(document.getElementById('precoAntiHcv').value) || null,
    anti_hbs_ag: parseFloat(document.getElementById('precoAntiHbsAg').value) || null,
    vdrl: parseFloat(document.getElementById('precoVdrl').value) || null,
    coprocultura: parseFloat(document.getElementById('precoCoprocultura').value) || null,
    parasitologico: parseFloat(document.getElementById('precoParasitologico').value) || null,
    gama_gt: parseFloat(document.getElementById('precoGamaGt').value) || null,
    glicose: parseFloat(document.getElementById('precoGlicose').value) || null,
    pesquisa_fungos: parseFloat(document.getElementById('precoPesquisaFungos').value) || null,
    dinamometria: parseFloat(document.getElementById('precoDinamometria').value) || null,
    visita_tec: parseFloat(document.getElementById('precoVisitaTec').value) || null,
    transporte: parseFloat(document.getElementById('precoTransporte').value) || null,
    dia_vencimento: parseInt(document.getElementById('precoDiaVencimento').value) || 10,
  };
}

async function editarPreco(id) {
  const { data, error } = await supabaseClient
    .from('precos')
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    mostrarAlerta('Erro ao carregar dados para edição: ' + error.message, 'danger');
    return;
  }
  preencherFormulario(data);
  document.getElementById('precoModalLabel').textContent = 'Editar Preços';
  const modal = new bootstrap.Modal(document.getElementById('precoModal'));
  modal.show();
}

// ========================= EVENTOS DO DOMContentLoaded =========================
document.addEventListener('DOMContentLoaded', function () {
  const loginPage = document.getElementById('loginPage');
  const menuPage = document.getElementById('menuPage');
  const dashboardPage = document.getElementById('dashboardPage');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const showRegister = document.getElementById('showRegister');
  const showLogin = document.getElementById('showLogin');
  const logoutBtn = document.getElementById('logoutBtn');
  const userEmailSpan = document.getElementById('userEmail');
  const loginMessage = document.getElementById('loginMessage');

  // ========================= NAVEGAÇÃO =========================
  if (showRegister) {
    showRegister.addEventListener('click', function (e) {
      e.preventDefault();
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
      loginMessage.innerHTML = '';
    });
  }
  if (showLogin) {
    showLogin.addEventListener('click', function (e) {
      e.preventDefault();
      registerForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      loginMessage.innerHTML = '';
    });
  }

  // ========================= AUTENTICAÇÃO =========================
  async function fazerLogin(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function fazerCadastro(email, password) {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function fazerLogout() {
    await supabaseClient.auth.signOut();
    mostrarPaginaLogin();
  }

  function mostrarPaginaLogin() {
    loginPage.classList.remove('hidden');
    menuPage.classList.add('hidden');
    dashboardPage.classList.add('hidden');
  }

  function mostrarMenu(user) {
    loginPage.classList.add('hidden');
    menuPage.classList.remove('hidden');
    dashboardPage.classList.add('hidden');
    userEmailSpan.textContent = user.email;
    statusFiltroAtual = 'todos';
    document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
    const btnTodos = document.querySelector('[data-status="todos"]');
    if (btnTodos) btnTodos.classList.add('active');
  }

  function mostrarDashboard(user) {
    loginPage.classList.add('hidden');
    menuPage.classList.add('hidden');
    dashboardPage.classList.remove('hidden');
    document.getElementById('userEmail').textContent = user.email;
    document.querySelector('#tab-relatorio').click();
    carregarRelatorio(0, 0, '', 'todos');
    const anoAtual = new Date().getFullYear();
    carregarCards(0, anoAtual);
    carregarGraficos(anoAtual);
    carregarPrecos();
    
    // Carregar boletos na primeira vez
    setTimeout(() => {
      const mes = parseInt(document.getElementById('boletoFiltroMes')?.value || 0);
      const ano = parseInt(document.getElementById('boletoFiltroAno')?.value || 0);
      const unidade = document.getElementById('boletoFiltroUnidade')?.value?.trim() || '';
      const status = document.getElementById('boletoFiltroStatus')?.value || 'todos';
      carregarBoletos(mes, ano, unidade, status);
    }, 500);
  }

  // ========================= EVENTOS DO MENU =========================
  document.querySelectorAll('.menu-card').forEach(card => {
    card.addEventListener('click', function() {
      const target = this.dataset.target;
      if (target === 'faturamento') {
        supabaseClient.auth.getUser().then(({ data }) => {
          if (data.user) {
            mostrarDashboard(data.user);
          } else {
            mostrarPaginaLogin();
          }
        });
      }
    });
  });

  // Verificar sessão ao carregar
  supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session) {
      mostrarMenu(data.session.user);
    } else {
      mostrarPaginaLogin();
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
      await fazerLogin(email, password);
      const user = (await supabaseClient.auth.getUser()).data.user;
      mostrarMenu(user);
    } catch (err) {
      loginMessage.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    try {
      await fazerCadastro(email, password);
      loginMessage.innerHTML = `<div class="alert alert-success">Cadastro realizado! Faça login.</div>`;
      registerForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
    } catch (err) {
      loginMessage.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fazerLogout();
  });

  // ========================= CRUD PREÇOS =========================
  document.getElementById('searchPreco').addEventListener('input', function () {
    const termo = this.value.toLowerCase().trim();
    if (!termo) {
      renderizarTabelaPrecos(precosDataGlobal);
      return;
    }
    const filtrados = precosDataGlobal.filter(item => {
      const grupo = (item.grupo || '').toLowerCase();
      const holding = (item.holding || '').toLowerCase();
      const unidade = (item.unidade || '').toLowerCase();
      const cnpj = (item.cnpj || '').replace(/\D/g, '');
      return grupo.includes(termo) || holding.includes(termo) || unidade.includes(termo) || cnpj.includes(termo);
    });
    renderizarTabelaPrecos(filtrados);
  });

  document.getElementById('btnNovoPreco').addEventListener('click', function () {
    document.getElementById('precoForm').reset();
    document.getElementById('precoId').value = '';
    document.getElementById('precoModalLabel').textContent = 'Novo Cadastro de Preços';
    const modal = new bootstrap.Modal(document.getElementById('precoModal'));
    modal.show();
  });

  document.getElementById('savePrecoBtn').addEventListener('click', async function () {
    const dados = lerFormulario();
    if (!dados.unidade) {
      mostrarAlerta('O campo Unidade é obrigatório.', 'warning');
      return;
    }
    if (!dados.grupo || !dados.holding) {
      mostrarAlerta('Os campos Grupo e Holding são obrigatórios.', 'warning');
      return;
    }
    try {
      await salvarPreco(dados);
      mostrarAlerta('Registro salvo com sucesso!', 'success');
      bootstrap.Modal.getInstance(document.getElementById('precoModal')).hide();
      carregarPrecos();
    } catch (err) {
      mostrarAlerta('Erro ao salvar: ' + err.message, 'danger');
    }
  });

  // ========================= EVENTOS DA INTERFACE =========================
  document.getElementById('processUploadBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('uploadFileInput');
    const status = document.getElementById('uploadStatus');
    const feedback = document.getElementById('uploadFeedback');

    if (!fileInput.files || fileInput.files.length === 0) {
      status.innerHTML = '<span class="text-warning">Selecione um arquivo.</span>';
      feedback.innerHTML = '';
      return;
    }

    status.innerHTML = `<span class="text-info">Processando...</span>`;
    feedback.innerHTML = '';

    try {
      const result = await processarUpload(fileInput.files[0]);
      const mesNome = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                       'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][result.mesProcessado - 1];
      status.innerHTML = `<span class="text-success">✓ ${result.totalRegistros} unidades processadas para ${mesNome}/${result.anoProcessado}. Total: R$ ${result.totalGeral.toFixed(2)}</span>`;

      if (result.unidadesNaoEncontradas && result.unidadesNaoEncontradas.length > 0) {
        let lista = result.unidadesNaoEncontradas.map(u => `<li class="list-unstyled">${u}</li>`).join('');
        feedback.innerHTML = `
          <div class="alert alert-warning alert-dismissible fade show" role="alert">
            <strong><i class="fas fa-exclamation-triangle"></i> Unidades na planilha não encontradas no cadastro:</strong>
            <ul class="mb-0 mt-1" style="list-style: none; padding-left: 0;">${lista}</ul>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
          </div>
        `;
      } else {
        feedback.innerHTML = '';
      }

      const mesF = parseInt(document.getElementById('filterMonth').value);
      const anoF = parseInt(document.getElementById('filterYear').value);
      const unidadeF = document.getElementById('filterUnit').value.trim();
      carregarRelatorio(mesF, anoF, unidadeF, statusFiltroAtual);

    } catch (err) {
      status.innerHTML = `<span class="text-danger">Erro: ${err.message}</span>`;
      feedback.innerHTML = '';
    }
  });

  document.getElementById('applyFiltersBtn').addEventListener('click', () => {
    const mes = parseInt(document.getElementById('filterMonth').value);
    const ano = parseInt(document.getElementById('filterYear').value);
    const unidade = document.getElementById('filterUnit').value.trim();
    carregarRelatorio(mes, ano, unidade, statusFiltroAtual);
  });

  document.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      statusFiltroAtual = this.dataset.status;
      const mes = parseInt(document.getElementById('filterMonth').value);
      const ano = parseInt(document.getElementById('filterYear').value);
      const unidade = document.getElementById('filterUnit').value.trim();
      carregarRelatorio(mes, ano, unidade, statusFiltroAtual);
    });
  });

  document.getElementById('exportPrecosBtn').addEventListener('click', exportarPrecos);

  // ========================= EVENTO BOTÃO CONFIRMAR CRIAR OS =========================
  document.getElementById('confirmarCriarOsBtn').addEventListener('click', async function() {
    const id = document.getElementById('osFaturamentoId').value;
    const unidade = document.getElementById('osCliente').value;
    const statusMessage = document.getElementById('osStatusMessage');
    const confirmBtn = this;
    
    if (!id) {
      mostrarAlerta('ID do faturamento não encontrado.', 'danger');
      return;
    }
    
    const codigoCliente = this.dataset.codigoCliente;
    if (!codigoCliente) {
      statusMessage.innerHTML = '<div class="alert alert-warning">Aguardando busca do cliente...</div>';
      return;
    }
    
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Criando OS (Etapa 50)...';
    statusMessage.innerHTML = '<div class="alert alert-info">Criando Ordem de Serviço na OMIE (Etapa 50 - Pronta para faturar)...</div>';
    
    try {
      const { data: registro, error } = await supabaseClient
        .from('faturamento')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      
      const resultado = await criarOrdemServicoOmie(registro, codigoCliente);
      const osId = resultado.nCodOS || resultado.cabecalho?.nCodOS || null;
      
      if (!osId) {
        throw new Error('ID da OS não retornado pela OMIE');
      }
      
      await supabaseClient
        .from('faturamento')
        .update({ 
          omie_os_id: osId, 
          omie_status: 'criado',
          nota_emitida: false,
          boleto_enviado: false
        })
        .eq('id', id);
      
      statusMessage.innerHTML = `
        <div class="alert alert-success">
          <i class="fas fa-check-circle"></i> OS criada com sucesso! 
          <br>
          ID OMIE: <strong>${osId}</strong>
          <br>
          Nº OS: <strong>${resultado.cNumOS || 'N/A'}</strong>
          <br><br>
          <div class="alert alert-info">
            <i class="fas fa-info-circle"></i> 
            A OS foi criada na <strong>Etapa 50</strong> (Pronta para faturar).
            <br>
            <small>Agora você pode usar o botão <strong>"Faturar em Lote"</strong> para enviar todas as OS para a Etapa 60.</small>
          </div>
          <br>
          <button class="btn btn-secondary" onclick="fecharModalCriarOs()">Fechar</button>
        </div>
      `;
      
      mostrarAlerta(`OS criada com sucesso! ID: ${osId} (Etapa 50)`, 'success');
      
      setTimeout(() => {
        const mesF = parseInt(document.getElementById('filterMonth').value);
        const anoF = parseInt(document.getElementById('filterYear').value);
        const unidadeF = document.getElementById('filterUnit').value.trim();
        carregarRelatorio(mesF, anoF, unidadeF, statusFiltroAtual);
      }, 2000);
      
    } catch (err) {
      await supabaseClient
        .from('faturamento')
        .update({ 
          omie_status: 'erro', 
          omie_erro: err.message 
        })
        .eq('id', id);
      
      statusMessage.innerHTML = `<div class="alert alert-danger">
        <i class="fas fa-exclamation-triangle"></i> Erro ao criar OS: ${err.message}
        <br><br>
        <button class="btn btn-secondary" onclick="fecharModalCriarOs()">Fechar</button>
      </div>`;
      
      mostrarAlerta('Erro ao criar OS: ' + err.message, 'danger');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fas fa-save"></i> Criar OS (Etapa 50)';
    }
  });

  window.fecharModalCriarOs = function() {
    const modal = bootstrap.Modal.getInstance(document.getElementById('criarOsModal'));
    if (modal) modal.hide();
    
    const mesF = parseInt(document.getElementById('filterMonth').value);
    const anoF = parseInt(document.getElementById('filterYear').value);
    const unidadeF = document.getElementById('filterUnit').value.trim();
    carregarRelatorio(mesF, anoF, unidadeF, statusFiltroAtual);
  };

 // ========================= EVENTO BOTÃO FATURAR EM LOTE =========================
document.getElementById('btnFaturarLote').addEventListener('click', async function() {
  const btn = this;
  const statusEl = document.getElementById('faturarLoteStatus');
  
  let statusElement = statusEl;
  if (!statusElement) {
    const alertArea = document.getElementById('alertArea');
    if (alertArea) {
      alertArea.innerHTML = `<div id="faturarLoteStatus" class="alert alert-info">⏳ Processando...</div>`;
      statusElement = document.getElementById('faturarLoteStatus');
    }
  }
  
  if (statusElement) {
    statusElement.innerHTML = '⏳ Verificando OS prontas para faturar (Etapa 50)...';
    statusElement.className = 'alert alert-info';
  }
  
  try {
    // Usar a função correta: faturarLoteOSCorrigido
    const osList = await listarOSProntasParaFaturar();
    
    if (osList.length === 0) {
      if (statusElement) {
        statusElement.innerHTML = '⚠️ Nenhuma OS pronta para faturar (Etapa 50).';
        statusElement.className = 'alert alert-warning';
      }
      return;
    }
    
    if (!confirm(`Deseja faturar ${osList.length} OS em lote? (Etapa 50 → 60)`)) {
      if (statusElement) {
        statusElement.innerHTML = 'Operação cancelada.';
        statusElement.className = 'alert alert-muted';
      }
      return;
    }
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Faturando...';
    
    if (statusElement) {
      statusElement.innerHTML = `⏳ Enviando ${osList.length} OS para faturamento (Etapa 50 → 60)...`;
      statusElement.className = 'alert alert-info';
    }
    
    // CHAMAR A FUNÇÃO CORRETA: faturarLoteOSCorrigido
    const resultado = await faturarLoteOSCorrigido('50');
    
    if (resultado && resultado.nIdLoteFat) {
      if (statusElement) {
        statusElement.innerHTML = `
          ✅ ${resultado.nQtdeFat || 0} OS enviadas para faturamento!<br>
          <small>ID do Lote: ${resultado.nIdLoteFat}</small>
          <br><br>
          <div class="alert alert-success">
            <i class="fas fa-check-circle"></i> 
            As OS estão sendo movidas da <strong>Etapa 50</strong> para a <strong>Etapa 60</strong> (Faturadas).
          </div>
          <br>
          <button class="btn btn-sm btn-primary" onclick="verificarStatusLote(${resultado.nIdLoteFat})">
            <i class="fas fa-sync"></i> Verificar Status
          </button>
        `;
        statusElement.className = 'alert alert-success';
      }
      
      mostrarAlerta(`${resultado.nQtdeFat || 0} OS enviadas para faturamento em lote!`, 'success');
      
      setTimeout(() => {
        const mesF = parseInt(document.getElementById('filterMonth')?.value || 0);
        const anoF = parseInt(document.getElementById('filterYear')?.value || 0);
        const unidadeF = document.getElementById('filterUnit')?.value?.trim() || '';
        carregarRelatorio(mesF, anoF, unidadeF, statusFiltroAtual || 'todos');
      }, 5000);
      
    } else {
      if (statusElement) {
        statusElement.innerHTML = '❌ Erro ao faturar em lote.';
        statusElement.className = 'alert alert-danger';
      }
    }
    
  } catch (err) {
    console.error('❌ Erro:', err);
    if (statusElement) {
      statusElement.innerHTML = `❌ Erro: ${err.message}`;
      statusElement.className = 'alert alert-danger';
    }
    mostrarAlerta('Erro ao faturar em lote: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-file-invoice-dollar"></i> Faturar em Lote (50→60)';
  }
});

  window.verificarStatusLote = async function(nIdLoteFat) {
    console.log(`🔍 Verificando status do lote: ${nIdLoteFat}`);
    
    const statusEl = document.getElementById('faturarLoteStatus');
    
    try {
      const status = await statusLoteOS(nIdLoteFat);
      console.log('📊 Status do lote:', status);
      
      if (statusEl) {
        if (status && status.cStatus === 'Concluído') {
          statusEl.innerHTML = `
            ✅ <strong>Lote processado com sucesso!</strong><br>
            📋 ${status.nQtdeProcessadas || 0} OS faturadas (Etapa 60)<br>
            <small>ID do Lote: ${nIdLoteFat}</small>
          `;
          statusEl.className = 'alert alert-success';
          
          setTimeout(() => {
            const mesF = parseInt(document.getElementById('filterMonth')?.value || 0);
            const anoF = parseInt(document.getElementById('filterYear')?.value || 0);
            const unidadeF = document.getElementById('filterUnit')?.value?.trim() || '';
            carregarRelatorio(mesF, anoF, unidadeF, statusFiltroAtual || 'todos');
          }, 2000);
          
        } else if (status && status.cStatus === 'RUNNING') {
          statusEl.innerHTML = `
            ⏳ <strong>Lote em processamento...</strong><br>
            📋 ${status.nQtdeProcessadas || 0} de ${status.nQtdeTotal || 0} OS processadas<br>
            <small>ID do Lote: ${nIdLoteFat}</small>
            <br><br>
            <button class="btn btn-sm btn-primary" onclick="verificarStatusLote(${nIdLoteFat})">
              <i class="fas fa-sync"></i> Atualizar Status
            </button>
          `;
          statusEl.className = 'alert alert-info';
        } else if (status && status.cStatus === 'Erro') {
          statusEl.innerHTML = `
            ❌ <strong>Erro no processamento do lote!</strong><br>
            <small>ID do Lote: ${nIdLoteFat}</small>
            <br>
            <small>Verifique os detalhes no console ou na OMIE.</small>
          `;
          statusEl.className = 'alert alert-danger';
        } else {
          statusEl.innerHTML = `
            ⚠️ Status do lote: ${status?.cStatus || 'Desconhecido'}<br>
            <small>ID do Lote: ${nIdLoteFat}</small>
          `;
          statusEl.className = 'alert alert-warning';
        }
      }
      
      return status;
    } catch (err) {
      console.error('❌ Erro:', err);
      if (statusEl) {
        statusEl.innerHTML = `
          ❌ Erro ao verificar status: ${err.message}<br>
          <small>ID do Lote: ${nIdLoteFat}</small>
        `;
        statusEl.className = 'alert alert-danger';
      }
      return null;
    }
  };

  // ========================= EXCLUSÃO DE PROCESSAMENTO =========================
  document.getElementById('btnExcluirProcessamento').addEventListener('click', function() {
    abrirModalExclusao();
  });

  function abrirModalExclusao() {
    const oldModal = document.getElementById('excluirModalCustom');
    if (oldModal) oldModal.remove();
    const oldBackdrops = document.querySelectorAll('.modal-backdrop');
    oldBackdrops.forEach(b => b.remove());
    document.body.classList.remove('modal-open');

    const meses = [
      { value: 1, label: 'Janeiro' }, { value: 2, label: 'Fevereiro' },
      { value: 3, label: 'Março' }, { value: 4, label: 'Abril' },
      { value: 5, label: 'Maio' }, { value: 6, label: 'Junho' },
      { value: 7, label: 'Julho' }, { value: 8, label: 'Agosto' },
      { value: 9, label: 'Setembro' }, { value: 10, label: 'Outubro' },
      { value: 11, label: 'Novembro' }, { value: 12, label: 'Dezembro' }
    ];
    const anoAtual = new Date().getFullYear();
    const anos = [];
    for (let y = anoAtual; y >= anoAtual - 5; y--) {
      anos.push(y);
    }

    let monthOptions = meses.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
    let yearOptions = anos.map(y => `<option value="${y}">${y}</option>`).join('');

    const modalHTML = `
      <div id="excluirModalCustom" class="modal show" tabindex="-1" style="
        display: block !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        z-index: 9999 !important;
        background: rgba(0,0,0,0.5) !important;
        overflow-y: auto !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
      ">
        <div class="modal-dialog modal-md" style="
          position: relative !important;
          margin: 1.75rem auto !important;
          max-width: 500px !important;
          pointer-events: auto !important;
          transform: none !important;
        ">
          <div class="modal-content" style="
            background: #fff !important;
            border-radius: 16px !important;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3) !important;
          ">
            <div class="modal-header" style="
              background: #dc3545 !important;
              color: #fff !important;
              border-radius: 16px 16px 0 0 !important;
              padding: 16px 20px !important;
              border-bottom: none !important;
            ">
              <h5 class="modal-title" style="color: #fff !important; font-weight: 600;">
                <i class="fas fa-exclamation-triangle me-2"></i> Excluir Processamento
              </h5>
              <button type="button" class="btn-close btn-close-white" onclick="fecharModalExclusao()" style="
                background: transparent !important;
                border: none !important;
                font-size: 1.5rem !important;
                color: #fff !important;
                opacity: 0.8 !important;
              "></button>
            </div>
            <div class="modal-body" style="padding: 20px !important;">
              <p>Selecione o mês e ano para excluir todos os registros de faturamento.</p>
              <div class="row">
                <div class="col-6">
                  <label for="excluirMesCustom" class="form-label">Mês</label>
                  <select id="excluirMesCustom" class="form-select">
                    <option value="0">Selecione</option>
                    ${monthOptions}
                  </select>
                </div>
                <div class="col-6">
                  <label for="excluirAnoCustom" class="form-label">Ano</label>
                  <select id="excluirAnoCustom" class="form-select">
                    <option value="0">Selecione</option>
                    ${yearOptions}
                  </select>
                </div>
              </div>
              <div id="excluirStatusCustom" class="mt-2 small text-danger"></div>
            </div>
            <div class="modal-footer" style="
              border-top: 1px solid #e9ecef !important;
              padding: 12px 20px !important;
              border-radius: 0 0 16px 16px !important;
            ">
              <button type="button" class="btn btn-secondary" onclick="fecharModalExclusao()" style="
                border-radius: 30px !important;
                padding: 8px 24px !important;
                font-weight: 500 !important;
              ">Cancelar</button>
              <button type="button" class="btn btn-danger" id="confirmarExcluirCustom" style="
                border-radius: 30px !important;
                padding: 8px 24px !important;
                font-weight: 500 !important;
              ">
                <i class="fas fa-trash me-1"></i> Excluir
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    document.getElementById('confirmarExcluirCustom').addEventListener('click', async function() {
      const mes = parseInt(document.getElementById('excluirMesCustom').value);
      const ano = parseInt(document.getElementById('excluirAnoCustom').value);
      const status = document.getElementById('excluirStatusCustom');

      if (!mes || !ano) {
        status.textContent = '⚠️ Selecione mês e ano.';
        return;
      }

      if (!confirm(`Deseja realmente excluir todos os registros de ${mes}/${ano}?`)) return;

      status.textContent = '⏳ Excluindo...';
      this.disabled = true;

      try {
        const { error } = await supabaseClient
          .from('faturamento')
          .delete()
          .eq('mes', mes)
          .eq('ano', ano);

        if (error) throw error;

        status.textContent = '✅ Registros excluídos com sucesso!';
        mostrarAlerta(`Registros de ${mes}/${ano} excluídos com sucesso.`, 'success');

        const mesFiltro = parseInt(document.getElementById('filterMonth').value);
        const anoFiltro = parseInt(document.getElementById('filterYear').value);
        const unidadeFiltro = document.getElementById('filterUnit').value.trim();
        carregarRelatorio(mesFiltro, anoFiltro, unidadeFiltro, statusFiltroAtual);

        setTimeout(fecharModalExclusao, 1000);
      } catch (err) {
        status.textContent = `❌ Erro: ${err.message}`;
        mostrarAlerta('Erro ao excluir: ' + err.message, 'danger');
      } finally {
        this.disabled = false;
      }
    });

    console.log('✅ Modal de exclusão customizado aberto');
  }

  window.fecharModalExclusao = function() {
    const modal = document.getElementById('excluirModalCustom');
    if (modal) modal.remove();
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(b => b.remove());
    document.body.classList.remove('modal-open');
  };

  // ========================= DASHBOARD FILTROS =========================
  function popularAnosDashboard() {
    const select = document.getElementById('dashboardYear');
    if (!select) return;
    const anoAtual = new Date().getFullYear();
    for (let y = anoAtual; y >= anoAtual - 5; y--) {
      const option = document.createElement('option');
      option.value = y;
      option.textContent = y;
      select.appendChild(option);
    }
    select.value = anoAtual;
  }
  popularAnosDashboard();

  const tabDashboard = document.getElementById('tab-dashboard');
  if (tabDashboard) {
    tabDashboard.addEventListener('shown.bs.tab', function () {
      const select = document.getElementById('dashboardYear');
      if (select && select.options.length === 0) {
        popularAnosDashboard();
      }
      const mes = parseInt(document.getElementById('dashboardMonth')?.value);
      const ano = parseInt(document.getElementById('dashboardYear')?.value);
      carregarCards(mes, ano);
      carregarGraficos(ano);
    });
  }

  const applyDashboardFilters = document.getElementById('applyDashboardFilters');
  if (applyDashboardFilters) {
    applyDashboardFilters.addEventListener('click', function() {
      const mes = parseInt(document.getElementById('dashboardMonth')?.value);
      const ano = parseInt(document.getElementById('dashboardYear')?.value);
      carregarCards(mes, ano);
      carregarGraficos(ano);
    });
  }

  // ========================= CRIAR OS (SEM TENTAR PREENCHER TRIBUTAÇÃO) =========================
async function criarOS(registro, codigoCliente) {
  const now = new Date();
  const timestamp = now.getTime();
  const random = Math.floor(Math.random() * 10000);
  const codigoIntegracao = `OS-${registro.ano}${String(registro.mes).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${timestamp}-${random}`;

  const emailCliente = await buscarEmailClienteOmie(codigoCliente);

  let descricaoCompleta = '';
  const detalhes = registro.detalhes || {};
  
  if (detalhes.mensalidade) {
    descricaoCompleta += `MENSALIDADE: R$ ${detalhes.mensalidade.precoUnitario?.toFixed(2) || 0}\n`;
  }
  if (detalhes['vidas (NR-1)']) {
    const vidas = detalhes['vidas (NR-1)'];
    descricaoCompleta += `VIDAS NR-1: ${vidas.quantidade} x R$ ${vidas.precoUnitario?.toFixed(2) || 0} = R$ ${(vidas.quantidade * vidas.precoUnitario || 0).toFixed(2)}\n`;
  }
  for (let [exame, info] of Object.entries(detalhes)) {
    if (exame === 'mensalidade' || exame === 'vidas (NR-1)') continue;
    if (typeof info === 'object' && info.funcionarios) {
      info.funcionarios.forEach(f => {
        descricaoCompleta += `${exame.toUpperCase()} - ${f.nome} - ${f.data} - R$ ${info.precoUnitario?.toFixed(2) || 0}\n`;
      });
    }
  }
  
  if (!descricaoCompleta) {
    descricaoCompleta = `Faturamento ${registro.mes}/${registro.ano} - ${registro.unidade}`;
  }

  // Data de vencimento compensada
  let dataVencimentoOriginal = '01/08/2026';
  if (registro.data_vencimento) {
    const partes = registro.data_vencimento.split('-');
    const ano = parseInt(partes[0]), mes = parseInt(partes[1]), dia = parseInt(partes[2]);
    let mesCorrigido = mes - 1, anoCorrigido = ano;
    if (mesCorrigido === 0) { mesCorrigido = 12; anoCorrigido = ano - 1; }
    const dataCorrigida = new Date(anoCorrigido, mesCorrigido - 1, dia);
    dataVencimentoOriginal = dataCorrigida.toLocaleDateString('pt-BR');
  }

  const cabecalho = {
    cCodIntOS: codigoIntegracao,
    nCodCli: parseInt(codigoCliente),
    dDtPrevisao: dataVencimentoOriginal,
    cEtapa: '50',
    nQtdeParc: 1,
    cCodParc: '999'
  };

  const servicosPrestados = [{
    cCodServMun: CODIGO_SERVICO_OMIE,
    cCodServLC116: CODIGO_SERVICO_LC116,
    cDescServ: descricaoCompleta,
    nQtde: 1,
    nValUnit: registro.valor_total,
    cDadosAdicItem: descricaoCompleta,
    cTribServ: "1",
    cRetemISS: "N",
    impostos: {
      nAliqISS: 2.01
    }
  }];

  const informacoesAdicionais = {
    cCidPrestServ: 'ARAUCARIA (PR)',
    cCodCateg: '1.01.02',
    nCodCC: CODIGO_CONTA_CORRENTE,
    cDadosAdicNF: descricaoCompleta
  };

  const email = {
    cEnvBoleto: 'S',
    cEnvLink: 'S',
    cEnviarPara: emailCliente
  };

  const payloadCriar = {
    endpoint: 'servicos/os',
    call: 'IncluirOS',
    param: [{
      cabecalho: cabecalho,
      servicosPrestados: servicosPrestados,
      informacoesAdicionais: informacoesAdicionais,
      email: email
    }]
  };

  console.log('📤 Criando OS...');
  const response = await fetchOmieProxy(payloadCriar);
  const result = await response.json();

  if (result.fault) {
    throw new Error(`Erro ao criar OS: ${result.fault.faultstring}`);
  }

  return result;
}

// ========================= ATUALIZAR TRIBUTAÇÃO VIA ALTERAROS =========================
async function atualizarTributacaoOS(codigoOS) {
  console.log(`🔄 Atualizando tributação da OS ${codigoOS}...`);
  
  // Primeiro, consultar a OS para pegar o nIdItem
  const payloadConsulta = {
    endpoint: 'servicos/os',
    call: 'ConsultarOS',
    param: [{ nCodOS: parseInt(codigoOS) }]
  };
  
  const responseConsulta = await fetchOmieProxy(payloadConsulta);
  const osData = await responseConsulta.json();
  
  if (osData.fault) {
    throw new Error(`Erro ao consultar OS: ${osData.fault.faultstring}`);
  }
  
  const nIdItem = osData.ServicosPrestados?.[0]?.nIdItem;
  const servico = osData.ServicosPrestados?.[0];
  
  if (!nIdItem) {
    throw new Error('Não foi possível encontrar o serviço da OS');
  }
  
  // Agora atualizar com a tributação
  const payloadAlterar = {
    endpoint: 'servicos/os',
    call: 'AlterarOS',
    param: [{
      nCodOS: parseInt(codigoOS),
      servicosPrestados: [{
        nIdItem: nIdItem,
        cCodServMun: servico.cCodServMun,
        cCodServLC116: servico.cCodServLC116,
        cDescServ: servico.cDescServ,
        nQtde: servico.nQtde,
        nValUnit: servico.nValUnit,
        cDadosAdicItem: servico.cDadosAdicItem || '',
        cTribServ: "1",
        cRetemISS: "N",
        cCodCategItem: "1.01.02", // ← TENTAR AQUI NO ALTERAR
        impostos: {
          nAliqISS: 2.01
        }
      }]
    }]
  };
  
  console.log('📤 Atualizando OS com tributação...');
  const response = await fetchOmieProxy(payloadAlterar);
  const result = await response.json();
  
  if (result.fault) {
    throw new Error(`Erro ao atualizar tributação: ${result.fault.faultstring}`);
  }
  
  console.log(`✅ Tributação da OS ${codigoOS} atualizada!`);
  return result;
}

// ========================= CRIAR OS E ATUALIZAR TRIBUTAÇÃO =========================
async function criarOSComTributacao(registro, codigoCliente) {
  try {
    // 1. Criar a OS
    console.log('📌 Passo 1: Criando OS...');
    const resultCriar = await criarOS(registro, codigoCliente);
    
    const osId = resultCriar.nCodOS || resultCriar.cabecalho?.nCodOS;
    console.log(`✅ OS criada com ID: ${osId}`);
    
    // 2. Atualizar a tributação
    console.log('📌 Passo 2: Atualizando tributação...');
    await atualizarTributacaoOS(osId);
    
    console.log(`✅ OS ${osId} criada com tributação "Exigível"!`);
    return resultCriar;
    
  } catch (err) {
    console.error('❌ Erro:', err.message);
    throw err;
  }
}

  // ========================= BOLETOS =========================
  function popularAnosBoletos() {
    const select = document.getElementById('boletoFiltroAno');
    if (!select) return;
    const anoAtual = new Date().getFullYear();
    for (let y = anoAtual; y >= anoAtual - 5; y--) {
      const option = document.createElement('option');
      option.value = y;
      option.textContent = y;
      select.appendChild(option);
    }
    select.value = anoAtual;
  }
  popularAnosBoletos();

  const tabBoletos = document.getElementById('tab-boletos');
  if (tabBoletos) {
    tabBoletos.addEventListener('shown.bs.tab', function () {
      const mes = parseInt(document.getElementById('boletoFiltroMes').value);
      const ano = parseInt(document.getElementById('boletoFiltroAno').value);
      const unidade = document.getElementById('boletoFiltroUnidade').value.trim();
      const status = document.getElementById('boletoFiltroStatus').value;
      carregarBoletos(mes, ano, unidade, status);
    });
  }

  document.getElementById('btnAplicarFiltroBoletos').addEventListener('click', function() {
    const mes = parseInt(document.getElementById('boletoFiltroMes').value);
    const ano = parseInt(document.getElementById('boletoFiltroAno').value);
    const unidade = document.getElementById('boletoFiltroUnidade').value.trim();
    const status = document.getElementById('boletoFiltroStatus').value;
    carregarBoletos(mes, ano, unidade, status);
  });

  document.getElementById('btnAtualizarStatusBoletos').addEventListener('click', atualizarStatusBoletos);
  document.getElementById('btnExportarBoletos').addEventListener('click', exportarBoletosCSV);

  // ========================= OUTROS =========================
  function popularAnos() {
    const select = document.getElementById('filterYear');
    if (!select) return;
    const anoAtual = new Date().getFullYear();
    for (let y = anoAtual; y >= anoAtual - 5; y--) {
      const option = document.createElement('option');
      option.value = y;
      option.textContent = y;
      select.appendChild(option);
    }
    select.value = anoAtual;
  }
  popularAnos();

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      const table = document.getElementById('resultsTable');
      if (!table) return;
      let csv = 'Unidade,Mês/Ano,Valor Total (R$),Detalhes\n';
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length >= 4) {
          const unidade = cols[0]?.textContent?.trim() || '';
          const mesAno = cols[1]?.textContent?.trim() || '';
          const valor = cols[2]?.textContent?.trim()?.replace('R$ ', '') || '';
          const detalhes = cols[3]?.textContent?.trim() || '';
          csv += `"${unidade}","${mesAno}",${valor},"${detalhes}"\n`;
        }
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'faturamento.csv';
      link.click();
    });
  }

  const btnVoltarMenu = document.getElementById('btnVoltarMenu');
  if (btnVoltarMenu) {
    btnVoltarMenu.addEventListener('click', function() {
      supabaseClient.auth.getUser().then(({ data }) => {
        if (data.user) {
          mostrarMenu(data.user);
        } else {
          const email = document.getElementById('userEmail')?.textContent || '';
          mostrarMenu({ email: email });
        }
      });
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fazerLogout();
    });
  }

});