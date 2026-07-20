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

// ========================= CRIAR ORDEM DE SERVIÇO NA OMIE (ETAPA 50) =========================
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
    cTribServ: "16",
    cRetemISS: "N",
    impostos: {
      nAliqISS: 2.01,
      cRetemPIS: "N",
      cRetemCOFINS: "N",
      cRetemCSLL: "N",
      cRetemIRRF: "N",
      nAliqPIS: 0,
      nAliqCOFINS: 0,
      nAliqCSLL: 0,
      nAliqIRRF: 0
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

// ========================= CANCELAR NFS-e =========================
async function cancelarNFSe(codigoOS, codigoNF) {
  console.log(`🗑️ Cancelando NFS-e da OS ${codigoOS}...`);
  
  try {
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
    
    const statusNFSe = osData.NotaFiscal?.cStatus || '';
    const numeroNFSe = osData.NotaFiscal?.nNumeroNFSe || codigoNF || '';
    
    if (statusNFSe === 'C' || statusNFSe === '4') {
      return { 
        success: false, 
        message: `NFS-e ${numeroNFSe} já está cancelada.`,
        jaCancelada: true
      };
    }
    
    if (statusNFSe !== 'F' && statusNFSe !== 'A') {
      return { 
        success: false, 
        message: `NFS-e não está faturada (Status: ${statusNFSe || 'N/A'}). Não é possível cancelar.`,
        jaCancelada: false
      };
    }
    
    if (!confirm(`Deseja cancelar a NFS-e ${numeroNFSe} da OS ${codigoOS}?`)) {
      return { success: false, message: 'Cancelamento abortado pelo usuário.', jaCancelada: false };
    }
    
    const payloadCancelar = {
      endpoint: 'servicos/os',
      call: 'CancelarOS',
      param: [{
        nCodOS: parseInt(codigoOS)
      }]
    };
    
    console.log('📤 Cancelando OS na OMIE...');
    const responseCancelar = await fetchOmieProxy(payloadCancelar);
    const result = await responseCancelar.json();
    
    if (result.fault) {
      throw new Error(`Erro ao cancelar OS: ${result.fault.faultstring}`);
    }
    
    console.log(`✅ OS ${codigoOS} cancelada com sucesso!`);
    
    const { data: registro, error } = await supabaseClient
      .from('faturamento')
      .select('id')
      .eq('omie_os_id', codigoOS)
      .single();
    
    if (!error && registro) {
      await supabaseClient
        .from('faturamento')
        .update({
          omie_status: 'cancelado',
          nota_status: 'cancelado',
          nota_emitida: false,
          boleto_enviado: false
        })
        .eq('id', registro.id);
    }
    
    return { 
      success: true, 
      message: `NFS-e ${numeroNFSe} cancelada com sucesso!`,
      jaCancelada: false
    };
    
  } catch (err) {
    console.error('❌ Erro ao cancelar:', err);
    return { 
      success: false, 
      message: `Erro ao cancelar: ${err.message}`,
      jaCancelada: false
    };
  }
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

// ========================= FATURAR EM LOTE =========================
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

// ========================= PROCESSAR UPLOAD CORRIGIDO =========================
async function processarUpload(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

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

  let mesFaturamento = mesEscolhido + 1;
  let anoFaturamento = anoEscolhido;
  if (mesFaturamento > 12) {
    mesFaturamento = 1;
    anoFaturamento += 1;
  }

  console.log(`📅 Mês dos exames: ${mesEscolhido}/${anoEscolhido}`);
  console.log(`📅 Mês de faturamento: ${mesFaturamento}/${anoFaturamento}`);

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

  const { data: todasUnidades, error: unidadesError } = await supabaseClient
    .from('precos')
    .select('*');

  if (unidadesError) throw unidadesError;

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

  // Buscar registros existentes para preservar dados
  const { data: registrosExistentes, error: buscaExistenteError } = await supabaseClient
    .from('faturamento')
    .select('*')
    .eq('mes', mesFaturamento)
    .eq('ano', anoFaturamento);

  if (buscaExistenteError) {
    console.warn('Erro ao buscar registros existentes:', buscaExistenteError);
  }

  const mapaExistentes = {};
  if (registrosExistentes) {
    registrosExistentes.forEach(r => {
      mapaExistentes[r.unidade] = r;
    });
  }

  const registrosParaInserir = [];
  const registrosParaAtualizar = [];
  const unidadesAtualizadas = [];
  const unidadesNovas = [];

  for (let chavePlanilha in unidadesEncontradas) {
    const unidade = unidadesEncontradas[chavePlanilha];
    const nomeUnidade = unidade.unidade;

    const detalhes = {};
    let total = 0;

    if (unidade.mensalidade && unidade.mensalidade > 0) {
      total += unidade.mensalidade;
      detalhes['mensalidade'] = { 
        quantidade: 1, 
        precoUnitario: unidade.mensalidade,
        subtotal: unidade.mensalidade
      };
    }

    if (unidade.vidas && unidade.vidas > 0 && unidade.qtd_vidas && unidade.qtd_vidas > 0) {
      const valorVidas = unidade.vidas * unidade.qtd_vidas;
      total += valorVidas;
      detalhes['vidas (NR-1)'] = {
        quantidade: unidade.qtd_vidas,
        precoUnitario: unidade.vidas,
        subtotal: valorVidas
      };
    }

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

    const diaVencimento = unidade.dia_vencimento || 10;
    const ultimoDia = new Date(anoFaturamento, mesFaturamento, 0).getDate();
    const diaFinal = Math.min(diaVencimento, ultimoDia);
    const dataVencimento = new Date(anoFaturamento, mesFaturamento - 1, diaFinal);
    const dataVencimentoStr = dataVencimento.toISOString().split('T')[0];

    let registroExistente = mapaExistentes[nomeUnidade];
    
    if (registroExistente) {
      console.log(`🔄 Atualizando unidade existente: ${nomeUnidade}`);
      
      const dadosPreservados = {
        omie_os_id: registroExistente.omie_os_id || null,
        omie_status: registroExistente.omie_status || null,
        nota_emitida: registroExistente.nota_emitida || false,
        boleto_enviado: registroExistente.boleto_enviado || false,
        pago: registroExistente.pago || false,
        nota_numero: registroExistente.nota_numero || null,
        nota_status: registroExistente.nota_status || null,
        nota_data_emissao: registroExistente.nota_data_emissao || null,
        nota_valor: registroExistente.nota_valor || null
      };
      
      registrosParaAtualizar.push({
        id: registroExistente.id,
        unidade: nomeUnidade,
        mes: mesFaturamento,
        ano: anoFaturamento,
        valor_total: total,
        detalhes: detalhes,
        data_vencimento: dataVencimentoStr,
        ...dadosPreservados
      });
      
      unidadesAtualizadas.push(nomeUnidade);
      
    } else {
      console.log(`✅ Nova unidade: ${nomeUnidade}`);
      registrosParaInserir.push({
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
      unidadesNovas.push(nomeUnidade);
    }
  }

  if (registrosParaInserir.length === 0 && registrosParaAtualizar.length === 0) {
    throw new Error('Nenhuma unidade com itens para faturar.');
  }

  // ===== INSERIR NOVOS REGISTROS =====
  if (registrosParaInserir.length > 0) {
    console.log(`📥 Inserindo ${registrosParaInserir.length} novos registros...`);
    const { error: insertError } = await supabaseClient
      .from('faturamento')
      .insert(registrosParaInserir);
    
    if (insertError) throw insertError;
  }

  // ===== ATUALIZAR REGISTROS EXISTENTES =====
  if (registrosParaAtualizar.length > 0) {
    console.log(`📤 Atualizando ${registrosParaAtualizar.length} registros existentes...`);
    
    for (const registro of registrosParaAtualizar) {
      const { id, ...dados } = registro;
      const { error: updateError } = await supabaseClient
        .from('faturamento')
        .update(dados)
        .eq('id', id);
      
      if (updateError) throw updateError;
    }
  }

  const totalGeral = [...registrosParaInserir, ...registrosParaAtualizar].reduce((acc, r) => acc + r.valor_total, 0);

  console.log('📊 RESUMO DO PROCESSAMENTO:');
  console.log(`   Mês de faturamento: ${mesFaturamento}/${anoFaturamento}`);
  console.log(`   Total de registros: ${registrosParaInserir.length + registrosParaAtualizar.length}`);
  console.log(`   Unidades atualizadas: ${registrosParaAtualizar.length}`);
  console.log(`   Unidades novas: ${registrosParaInserir.length}`);
  console.log(`   Valor total: R$ ${totalGeral.toFixed(2)}`);
  console.log(`   Unidades na planilha: ${unidadesNaPlanilha.size}`);
  console.log(`   Unidades não encontradas: ${unidadesNaoEncontradas.length}`);

  return {
    totalRegistros: registrosParaInserir.length + registrosParaAtualizar.length,
    totalGeral,
    unidadesNaoEncontradas,
    mesProcessado: mesFaturamento,
    anoProcessado: anoFaturamento,
    unidadesAtualizadas: registrosParaAtualizar.length,
    unidadesNovas: registrosParaInserir.length,
    unidadesEncontradas: Object.keys(unidadesEncontradas).length,
    detalhesUnidades: {
      atualizadas: unidadesAtualizadas,
      novas: unidadesNovas
    }
  };
}

// ========================= FUNÇÕES DE BUSCA DE CLIENTES OTIMIZADAS =========================
async function buscarClientePorCnpjOmie(cnpj) {
  const cnpjLimpo = normalizarCnpj(cnpj);
  if (!cnpjLimpo || cnpjLimpo.length !== 14) {
    console.error(`❌ CNPJ inválido: ${cnpj}`);
    return null;
  }
  
  console.log(`🔍 Buscando cliente com CNPJ: ${cnpjLimpo}`);
  
  // TENTATIVA 1: Consulta direta
  try {
    const payload = {
      endpoint: 'geral/clientes',
      call: 'ConsultarCliente',
      param: [{ cnpj_cpf: cnpjLimpo }]
    };
    
    console.log('📤 Tentando consulta direta por CNPJ...');
    const response = await Promise.race([
      fetchOmieProxy(payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
    
    const data = await response.json();
    
    if (data && !data.fault) {
      const codigo = data.codigo_cliente_omie || data.codigo_cliente;
      if (codigo) {
        console.log(`✅ Cliente encontrado via consulta direta!`);
        return { ...data, codigo_cliente: codigo };
      }
    }
  } catch (err) {
    console.log('⚠️ Consulta direta falhou:', err.message);
  }
  
  // TENTATIVA 2: Listagem com filtro
  try {
    const payload = {
      endpoint: 'geral/clientes',
      call: 'ListarClientes',
      param: [{
        pagina: 1,
        registros_por_pagina: 100,
        filtrar_por_cnpj: cnpjLimpo
      }]
    };
    
    console.log('📤 Tentando listagem com filtro...');
    const response = await Promise.race([
      fetchOmieProxy(payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
    
    const data = await response.json();
    
    if (data && !data.fault) {
      const clientes = data.clientes_cadastro || data.clientes || [];
      for (const cliente of clientes) {
        const cnpjCliente = normalizarCnpj(cliente.cnpj_cpf || cliente.cnpj || '');
        if (cnpjCliente === cnpjLimpo) {
          const codigo = cliente.codigo_cliente_omie || cliente.codigo_cliente;
          console.log(`✅ Cliente encontrado via listagem com filtro!`);
          return { ...cliente, codigo_cliente: codigo };
        }
      }
    }
  } catch (err) {
    console.log('⚠️ Listagem com filtro falhou:', err.message);
  }
  
  // TENTATIVA 3: Busca paginada rápida
  try {
    console.log('📤 Buscando em páginas...');
    const cliente = await buscarClientePaginadoRapido(cnpjLimpo);
    if (cliente) return cliente;
  } catch (err) {
    console.log('⚠️ Busca paginada falhou:', err.message);
  }
  
  console.log(`❌ Cliente com CNPJ ${cnpj} não encontrado.`);
  return null;
}

async function buscarClientePaginadoRapido(cnpjLimpo) {
  const cacheKey = `busca_paginada_${cnpjLimpo}`;
  const cacheData = sessionStorage.getItem(cacheKey);
  if (cacheData) {
    try {
      const parsed = JSON.parse(cacheData);
      if (Date.now() - parsed.timestamp < 5 * 60 * 1000) {
        console.log('📦 Cliente encontrado no cache de busca paginada');
        return parsed.data;
      }
    } catch (e) {}
  }
  
  let pagina = 1;
  const MAX_PAGINAS = 10;
  
  for (let i = 0; i < MAX_PAGINAS; i++) {
    try {
      const payload = {
        endpoint: 'geral/clientes',
        call: 'ListarClientes',
        param: [{
          pagina: pagina,
          registros_por_pagina: 100
        }]
      };
      
      const response = await Promise.race([
        fetchOmieProxy(payload),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
      ]);
      
      const data = await response.json();
      
      if (data.fault) {
        if (data.faultstring && data.faultstring.includes('REDUNDANT')) {
          const waitTime = parseInt(data.faultstring.match(/\d+/)?.[0] || 5);
          await new Promise(resolve => setTimeout(resolve, (waitTime + 2) * 1000));
          continue;
        }
        pagina++;
        continue;
      }
      
      const clientes = data.clientes_cadastro || data.clientes || [];
      
      for (const cliente of clientes) {
        const cnpjCliente = normalizarCnpj(cliente.cnpj_cpf || cliente.cnpj || '');
        if (cnpjCliente === cnpjLimpo) {
          const codigo = cliente.codigo_cliente_omie || cliente.codigo_cliente;
          const resultado = { ...cliente, codigo_cliente: codigo };
          
          sessionStorage.setItem(cacheKey, JSON.stringify({
            data: resultado,
            timestamp: Date.now()
          }));
          
          return resultado;
        }
      }
      
      const totalPaginas = data.total_paginas || data.nTotPaginas || MAX_PAGINAS;
      if (pagina >= totalPaginas) break;
      
      pagina++;
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (err) {
      console.log(`Erro na página ${pagina}:`, err.message);
      pagina++;
    }
  }
  
  return null;
}

async function buscarCodigoClienteParaOS(unidade) {
  console.log(`🔍 Buscando código do cliente para: ${unidade}`);
  
  const cacheKey = `cliente_unidade_${unidade}`;
  const cacheData = sessionStorage.getItem(cacheKey);
  if (cacheData) {
    try {
      const parsed = JSON.parse(cacheData);
      if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
        console.log(`📦 Código encontrado no cache: ${parsed.codigo}`);
        return parsed.codigo;
      }
    } catch (e) {}
  }
  
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
    console.log(`✅ Código já existe no banco: ${unidadeData.codigo_cliente_omie}`);
    sessionStorage.setItem(cacheKey, JSON.stringify({
      codigo: unidadeData.codigo_cliente_omie,
      timestamp: Date.now()
    }));
    return unidadeData.codigo_cliente_omie;
  }
  
  if (!unidadeData.cnpj) {
    console.error('❌ Unidade sem CNPJ cadastrado');
    return null;
  }
  
  console.log(`🔍 Buscando cliente na OMIE com CNPJ: ${unidadeData.cnpj}`);
  
  const cliente = await buscarClientePorCnpjOmie(unidadeData.cnpj);
  
  if (!cliente) {
    console.error(`❌ Cliente não encontrado na OMIE para CNPJ: ${unidadeData.cnpj}`);
    return null;
  }
  
  const codigo = cliente.codigo_cliente_omie || cliente.codigo_cliente;
  console.log(`✅ Cliente encontrado: ${cliente.razao_social} (código: ${codigo})`);
  
  await supabaseClient
    .from('precos')
    .update({ codigo_cliente_omie: codigo })
    .eq('id', unidadeData.id);
  
  sessionStorage.setItem(cacheKey, JSON.stringify({
    codigo: codigo,
    timestamp: Date.now()
  }));
  
  return codigo;
}

async function buscarDadosClienteOmie(unidade) {
  try {
    const { data: unidadeData, error } = await supabaseClient
      .from('precos')
      .select('cnpj')
      .eq('unidade', unidade)
      .single();
    
    if (error || !unidadeData) return null;
    if (!unidadeData.cnpj) return null;
    
    const cliente = await buscarClientePorCnpjOmie(unidadeData.cnpj);
    if (!cliente) return null;
    
    const codigo = cliente.codigo_cliente_omie || cliente.codigo_cliente;
    return {
      cnpj: cliente.cnpj_cpf || cliente.cnpj || '',
      codigo_cliente: codigo,
      razao_social: cliente.razao_social
    };
  } catch (err) {
    console.error('Erro ao buscar dados do cliente na OMIE:', err);
    return null;
  }
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

// ========================= CRIAR OS EM LOTE =========================
let loteRegistros = [];
let loteStatus = {};
let loteProgresso = 0;

async function abrirModalCriarOSLote() {
  console.log('🚀 Abrindo modal de criar OS em lote...');
  
  const mes = parseInt(document.getElementById('filterMonth').value);
  const ano = parseInt(document.getElementById('filterYear').value);
  const filtroHolding = document.getElementById('filterHolding')?.value?.trim() || '';
  const filtroGrupo = document.getElementById('filterGrupo')?.value?.trim() || '';
  const filtroUnidade = document.getElementById('filterUnit')?.value?.trim() || '';
  
  let query = supabaseClient
    .from('faturamento')
    .select('*')
    .is('omie_os_id', null)
    .or('omie_status.is.null,omie_status.eq.erro');
  
  if (mes > 0) query = query.eq('mes', mes);
  if (ano > 0) query = query.eq('ano', ano);
  
  if (filtroHolding || filtroGrupo || filtroUnidade) {
    let queryPrecos = supabaseClient.from('precos').select('unidade, holding, grupo');
    
    if (filtroHolding) {
      queryPrecos = queryPrecos.ilike('holding', `%${filtroHolding}%`);
    }
    if (filtroGrupo) {
      queryPrecos = queryPrecos.ilike('grupo', `%${filtroGrupo}%`);
    }
    if (filtroUnidade) {
      queryPrecos = queryPrecos.ilike('unidade', `%${filtroUnidade}%`);
    }
    
    const { data: unidadesFiltradas } = await queryPrecos;
    if (unidadesFiltradas && unidadesFiltradas.length > 0) {
      const listaUnidades = unidadesFiltradas.map(u => u.unidade);
      query = query.in('unidade', listaUnidades);
    } else {
      mostrarAlerta('Nenhuma unidade encontrada com os filtros aplicados.', 'warning');
      return;
    }
  }
  
  const { data: registros, error } = await query;
  
  if (error) {
    mostrarAlerta('Erro ao buscar registros: ' + error.message, 'danger');
    return;
  }
  
  if (!registros || registros.length === 0) {
    mostrarAlerta('Nenhum registro sem OS encontrado com os filtros atuais.', 'info');
    return;
  }
  
  loteRegistros = registros;
  console.log(`📋 ${loteRegistros.length} registros para processar`);
  
  loteStatus = {};
  loteProgresso = 0;
  
  const modal = new bootstrap.Modal(document.getElementById('criarOSLoteModal'));
  modal.show();
  
  await renderizarJanelasLote();
}

async function renderizarJanelasLote() {
  const container = document.getElementById('loteJanelasContainer');
  const statusGeral = document.getElementById('loteStatusGeral');
  const progressBar = document.getElementById('loteProgressBar');
  const btnCriar = document.getElementById('btnCriarTodasOSLote');
  
  progressBar.style.display = 'block';
  atualizarProgressoLote(0);
  
  statusGeral.className = 'alert alert-info';
  statusGeral.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Verificando ${loteRegistros.length} unidades...`;
  
  btnCriar.disabled = true;
  btnCriar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
  
  for (let i = 0; i < loteRegistros.length; i++) {
    const registro = loteRegistros[i];
    const unidade = registro.unidade;
    
    if (registro.omie_os_id) {
      loteStatus[unidade] = {
        status: 'ja_criada',
        mensagem: 'OS já criada',
        codigoCliente: null
      };
      continue;
    }
    
    try {
      const codigoCliente = await buscarCodigoClienteParaOS(unidade);
      
      if (codigoCliente) {
        loteStatus[unidade] = {
          status: 'encontrado',
          mensagem: 'Cliente encontrado',
          codigoCliente: codigoCliente
        };
      } else {
        loteStatus[unidade] = {
          status: 'nao_encontrado',
          mensagem: '❌ Cliente não encontrado',
          codigoCliente: null
        };
      }
    } catch (err) {
      loteStatus[unidade] = {
        status: 'erro',
        mensagem: `❌ Erro: ${err.message}`,
        codigoCliente: null
      };
    }
    
    const percentual = Math.round(((i + 1) / loteRegistros.length) * 100);
    atualizarProgressoLote(percentual);
    
    let allHtml = '';
    for (let j = 0; j <= i; j++) {
      const reg = loteRegistros[j];
      const status = loteStatus[reg.unidade] || { status: 'verificando', mensagem: '⏳ Verificando...', codigoCliente: null };
      allHtml += criarJanelaUnidade(reg, status);
    }
    container.innerHTML = allHtml;
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const total = loteRegistros.length;
  const encontrados = Object.values(loteStatus).filter(s => s.status === 'encontrado').length;
  const naoEncontrados = Object.values(loteStatus).filter(s => s.status === 'nao_encontrado' || s.status === 'erro').length;
  const jaCriados = Object.values(loteStatus).filter(s => s.status === 'ja_criada').length;
  
  if (encontrados === 0 && jaCriados === total) {
    statusGeral.className = 'alert alert-warning';
    statusGeral.innerHTML = `⚠️ Todas as ${total} unidades já possuem OS criada ou nenhuma foi encontrada.`;
    btnCriar.disabled = true;
    btnCriar.innerHTML = '<i class="fas fa-check"></i> Nenhuma para criar';
  } else if (encontrados > 0) {
    statusGeral.className = 'alert alert-success';
    statusGeral.innerHTML = `
      <i class="fas fa-check-circle"></i> 
      <strong>${encontrados} unidades prontas para criar OS</strong>
      ${naoEncontrados > 0 ? ` | ${naoEncontrados} não encontradas` : ''}
      ${jaCriados > 0 ? ` | ${jaCriados} já criadas` : ''}
    `;
    btnCriar.disabled = false;
    btnCriar.innerHTML = `<i class="fas fa-file-invoice"></i> Criar ${encontrados} OS`;
  } else {
    statusGeral.className = 'alert alert-danger';
    statusGeral.innerHTML = `Nenhum cliente encontrado para criar OS.`;
    btnCriar.disabled = true;
    btnCriar.innerHTML = '<i class="fas fa-times"></i> Sem clientes';
  }
  
  setTimeout(() => {
    progressBar.style.display = 'none';
  }, 500);
}

function criarJanelaUnidade(registro, status) {
  const unidade = registro.unidade;
  const valor = registro.valor_total;
  
  let statusIcon = 'fa-clock';
  let statusColor = 'secondary';
  let statusText = 'Verificando...';
  let showRetry = false;
  
  if (status.status === 'encontrado') {
    statusIcon = 'fa-check-circle';
    statusColor = 'success';
    statusText = `✅ Cliente: ${status.codigoCliente}`;
  } else if (status.status === 'nao_encontrado') {
    statusIcon = 'fa-times-circle';
    statusColor = 'danger';
    statusText = '❌ Cliente não encontrado';
    showRetry = true;
  } else if (status.status === 'erro') {
    statusIcon = 'fa-exclamation-triangle';
    statusColor = 'danger';
    statusText = status.mensagem;
    showRetry = true;
  } else if (status.status === 'ja_criada') {
    statusIcon = 'fa-check-circle';
    statusColor = 'info';
    statusText = '✅ OS já criada';
  } else if (status.status === 'criado') {
    statusIcon = 'fa-check-circle';
    statusColor = 'success';
    statusText = `✅ OS ${status.osId || ''}`;
  } else if (status.status === 'erro_criacao') {
    statusIcon = 'fa-exclamation-triangle';
    statusColor = 'danger';
    statusText = status.mensagem;
    showRetry = true;
  } else {
    statusIcon = 'fa-spinner fa-spin';
    statusColor = 'secondary';
    statusText = '⏳ Verificando...';
  }
  
  const temErro = status.status === 'nao_encontrado' || status.status === 'erro' || status.status === 'erro_criacao';
  const jaCriada = status.status === 'ja_criada' || status.status === 'criado';
  const encontrado = status.status === 'encontrado';
  
  let borderClass = 'border-secondary';
  if (encontrado) borderClass = 'border-success';
  else if (temErro) borderClass = 'border-danger';
  else if (jaCriada) borderClass = 'border-info';
  
  const resumoItens = gerarResumoItens(registro.detalhes || {});
  
  return `
    <div class="col-md-6 col-lg-4">
      <div class="card border-2 ${borderClass} h-100" style="border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
        <div class="card-header bg-transparent d-flex justify-content-between align-items-center" style="border-bottom: 1px solid #e9ecef; padding: 10px 14px;">
          <div class="d-flex align-items-center gap-2" style="min-width: 0; flex: 1;">
            <span class="badge bg-${statusColor}"><i class="fas ${statusIcon}"></i></span>
            <strong style="font-size: 0.85rem; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${unidade}">${unidade}</strong>
          </div>
          <span class="badge bg-primary">R$ ${valor.toFixed(2)}</span>
        </div>
        <div class="card-body" style="padding: 10px 14px;">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-1">
            <span class="text-${statusColor}" style="font-size: 0.8rem;">
              <i class="fas ${statusIcon} me-1"></i> ${statusText}
            </span>
            <div class="d-flex gap-1">
              ${encontrado ? `<span class="badge bg-success" style="font-size: 0.7rem;"><i class="fas fa-check"></i> OK</span>` : ''}
              ${temErro ? `<span class="badge bg-danger" style="font-size: 0.7rem;"><i class="fas fa-times"></i> Erro</span>` : ''}
              ${jaCriada ? `<span class="badge bg-info" style="font-size: 0.7rem;"><i class="fas fa-check"></i> Criada</span>` : ''}
            </div>
          </div>
          ${status.codigoCliente ? `<div class="mt-1"><small class="text-muted">Código: ${status.codigoCliente}</small></div>` : ''}
          
          <div class="mt-2" style="font-size: 0.75rem; color: #6c757d; max-height: 50px; overflow: hidden; text-overflow: ellipsis;">
            ${resumoItens}
          </div>
          
          <div class="d-flex gap-1 mt-2">
            <button class="btn btn-outline-primary btn-sm flex-grow-1" 
                    style="font-size: 0.75rem; border-radius: 6px;"
                    onclick="abrirDescricaoOS(${registro.id})">
              <i class="fas fa-file-alt me-1"></i> Descrição
            </button>
            ${showRetry ? `
              <button class="btn btn-outline-warning btn-sm" 
                      style="font-size: 0.75rem; border-radius: 6px;"
                      onclick="tentarNovamenteBuscarCliente(${registro.id})"
                      title="Tentar buscar cliente novamente">
                <i class="fas fa-sync"></i>
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function tentarNovamenteBuscarCliente(registroId) {
  console.log(`🔄 Tentando buscar cliente novamente para o registro ${registroId}`);
  
  const registro = loteRegistros.find(r => r.id === registroId);
  if (!registro) {
    mostrarAlerta('Registro não encontrado.', 'danger');
    return;
  }
  
  const unidade = registro.unidade;
  
  loteStatus[unidade] = {
    status: 'verificando',
    mensagem: '⏳ Buscando novamente...',
    codigoCliente: null
  };
  
  const container = document.getElementById('loteJanelasContainer');
  let allHtml = '';
  for (const reg of loteRegistros) {
    const st = loteStatus[reg.unidade] || { status: 'verificando', mensagem: '⏳ Verificando...', codigoCliente: null };
    allHtml += criarJanelaUnidade(reg, st);
  }
  container.innerHTML = allHtml;
  
  const cacheKey = `cliente_unidade_${unidade}`;
  sessionStorage.removeItem(cacheKey);
  
  try {
    const codigoCliente = await buscarCodigoClienteParaOS(unidade);
    
    if (codigoCliente) {
      loteStatus[unidade] = {
        status: 'encontrado',
        mensagem: 'Cliente encontrado',
        codigoCliente: codigoCliente
      };
      mostrarAlerta(`✅ Cliente encontrado para ${unidade}!`, 'success');
    } else {
      loteStatus[unidade] = {
        status: 'nao_encontrado',
        mensagem: '❌ Cliente não encontrado',
        codigoCliente: null
      };
      mostrarAlerta(`❌ Cliente não encontrado para ${unidade}.`, 'danger');
    }
  } catch (err) {
    loteStatus[unidade] = {
      status: 'erro',
      mensagem: `❌ Erro: ${err.message}`,
      codigoCliente: null
    };
    mostrarAlerta(`Erro ao buscar cliente: ${err.message}`, 'danger');
  }
  
  let allHtmlFinal = '';
  for (const reg of loteRegistros) {
    const st = loteStatus[reg.unidade] || { status: 'verificando', mensagem: '⏳ Verificando...', codigoCliente: null };
    allHtmlFinal += criarJanelaUnidade(reg, st);
  }
  container.innerHTML = allHtmlFinal;
  
  const total = loteRegistros.length;
  const encontrados = Object.values(loteStatus).filter(s => s.status === 'encontrado').length;
  const naoEncontrados = Object.values(loteStatus).filter(s => s.status === 'nao_encontrado' || s.status === 'erro').length;
  const jaCriados = Object.values(loteStatus).filter(s => s.status === 'ja_criada').length;
  
  const statusGeral = document.getElementById('loteStatusGeral');
  const btnCriar = document.getElementById('btnCriarTodasOSLote');
  
  if (encontrados > 0) {
    statusGeral.className = 'alert alert-success';
    statusGeral.innerHTML = `
      <i class="fas fa-check-circle"></i> 
      <strong>${encontrados} unidades prontas para criar OS</strong>
      ${naoEncontrados > 0 ? ` | ${naoEncontrados} não encontradas` : ''}
      ${jaCriados > 0 ? ` | ${jaCriados} já criadas` : ''}
    `;
    btnCriar.disabled = false;
    btnCriar.innerHTML = `<i class="fas fa-file-invoice"></i> Criar ${encontrados} OS`;
  } else {
    statusGeral.className = 'alert alert-danger';
    statusGeral.innerHTML = `Nenhum cliente encontrado para criar OS.`;
    btnCriar.disabled = true;
    btnCriar.innerHTML = '<i class="fas fa-times"></i> Sem clientes';
  }
}

function gerarResumoItens(detalhes) {
  if (!detalhes || Object.keys(detalhes).length === 0) {
    return '⚠️ Nenhum item';
  }
  
  let itens = [];
  
  if (detalhes.mensalidade) {
    itens.push(`📌 Mensalidade`);
  }
  if (detalhes['vidas (NR-1)']) {
    itens.push(`👥 ${detalhes['vidas (NR-1)'].quantidade || 0} vidas`);
  }
  
  const exames = ['exame_clinico', 'audiometria', 'acuidade_visual', 'eletrocardiograma', 
                  'eletroencefalograma', 'espirometria', 'raio_x_torax', 'hemograma',
                  'anti_hbs', 'anti_hcv', 'anti_hbs_ag', 'vdrl', 'coprocultura',
                  'parasitologico', 'gama_gt', 'glicose', 'pesquisa_fungos', 
                  'dinamometria', 'visita_tec', 'transporte'];
  
  const nomesResumo = {
    'exame_clinico': 'Ex. Clínico',
    'audiometria': 'Audiometria',
    'acuidade_visual': 'Acuidade Visual',
    'eletrocardiograma': 'ECG',
    'eletroencefalograma': 'EEG',
    'espirometria': 'Espirometria',
    'raio_x_torax': 'Raio X',
    'hemograma': 'Hemograma',
    'anti_hbs': 'Anti Hbs',
    'anti_hcv': 'Anti Hcv',
    'anti_hbs_ag': 'Anti Hbs AG',
    'vdrl': 'VDRL',
    'coprocultura': 'Coprocultura',
    'parasitologico': 'Parasitológico',
    'gama_gt': 'Gama GT',
    'glicose': 'Glicose',
    'pesquisa_fungos': 'Fungos',
    'dinamometria': 'Dinamometria',
    'visita_tec': 'Visita Técnica',
    'transporte': 'Transporte'
  };
  
  for (const exame of exames) {
    if (detalhes[exame]) {
      const info = detalhes[exame];
      const qtd = info.quantidade || 0;
      if (qtd > 0) {
        itens.push(`${nomesResumo[exame] || exame} (${qtd})`);
      }
    }
  }
  
  return itens.length > 0 ? itens.join(' | ') : '⚠️ Nenhum item';
}

function gerarDescricaoOS(registro) {
  const detalhes = registro.detalhes || {};
  const mes = registro.mes;
  const ano = registro.ano;
  const unidade = registro.unidade;
  const valorTotal = registro.valor_total;
  
  let descricao = `📋 FATURAMENTO ${mes}/${ano}\n`;
  descricao += `🏢 UNIDADE: ${unidade}\n`;
  descricao += `💰 VALOR TOTAL: R$ ${valorTotal.toFixed(2)}\n`;
  descricao += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  if (detalhes.mensalidade) {
    const mens = detalhes.mensalidade;
    const valor = mens.precoUnitario || 0;
    descricao += `📌 MENSALIDADE:\n   Valor: R$ ${valor.toFixed(2)}\n\n`;
  }
  
  if (detalhes['vidas (NR-1)']) {
    const vidas = detalhes['vidas (NR-1)'];
    const qtd = vidas.quantidade || 0;
    const valor = vidas.precoUnitario || 0;
    const subtotal = qtd * valor;
    descricao += `👥 VIDAS NR-1:\n   Quantidade: ${qtd}\n   Valor unitário: R$ ${valor.toFixed(2)}\n   Subtotal: R$ ${subtotal.toFixed(2)}\n\n`;
  }
  
  const exames = ['exame_clinico', 'audiometria', 'acuidade_visual', 'eletrocardiograma', 
                  'eletroencefalograma', 'espirometria', 'raio_x_torax', 'hemograma',
                  'anti_hbs', 'anti_hcv', 'anti_hbs_ag', 'vdrl', 'coprocultura',
                  'parasitologico', 'gama_gt', 'glicose', 'pesquisa_fungos', 
                  'dinamometria', 'visita_tec', 'transporte'];
  
  const nomesExames = {
    'exame_clinico': 'Exame Clínico',
    'audiometria': 'Audiometria Ocupacional',
    'acuidade_visual': 'Acuidade Visual',
    'eletrocardiograma': 'Eletrocardiograma',
    'eletroencefalograma': 'Eletroencefalograma',
    'espirometria': 'Espirometria',
    'raio_x_torax': 'Raio X Tórax',
    'hemograma': 'Hemograma Completo',
    'anti_hbs': 'Anti Hbs',
    'anti_hcv': 'Anti Hcv',
    'anti_hbs_ag': 'Anti Hbs AG',
    'vdrl': 'VDRL',
    'coprocultura': 'Coprocultura',
    'parasitologico': 'Parasitológico',
    'gama_gt': 'Gama GT',
    'glicose': 'Glicose',
    'pesquisa_fungos': 'Pesquisa de Fungos',
    'dinamometria': 'Dinamometria',
    'visita_tec': 'Visita Técnica',
    'transporte': 'Transporte'
  };
  
  let temExames = false;
  for (const exame of exames) {
    if (detalhes[exame]) {
      const info = detalhes[exame];
      const qtd = info.quantidade || 0;
      const valor = info.precoUnitario || 0;
      const funcionarios = info.funcionarios || [];
      const subtotal = qtd * valor;
      
      if (qtd > 0 || valor > 0) {
        temExames = true;
        descricao += `🔬 ${nomesExames[exame] || exame}:\n   Quantidade: ${qtd}\n   Valor unitário: R$ ${valor.toFixed(2)}\n   Subtotal: R$ ${subtotal.toFixed(2)}\n`;
        
        if (funcionarios.length > 0) {
          descricao += `   Funcionários:\n`;
          funcionarios.forEach(f => {
            descricao += `      - ${f.nome} (${f.data || 'data não informada'})\n`;
          });
        }
        descricao += `\n`;
      }
    }
  }
  
  if (!temExames && !detalhes.mensalidade && !detalhes['vidas (NR-1)']) {
    descricao += `⚠️ Nenhum item encontrado para faturamento.\n`;
  }
  
  descricao += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📅 Vencimento: ${registro.data_vencimento || 'N/A'}\n`;
  
  return descricao;
}

function abrirDescricaoOS(registroId) {
  const registro = loteRegistros.find(r => r.id === registroId);
  if (!registro) {
    mostrarAlerta('Registro não encontrado.', 'danger');
    return;
  }
  
  const descricao = gerarDescricaoOS(registro);
  const unidade = registro.unidade;
  const valor = registro.valor_total;
  
  document.getElementById('descricaoModalTitle').textContent = `📋 Detalhes - ${unidade}`;
  document.getElementById('descricaoModalValor').textContent = `Valor Total: R$ ${valor.toFixed(2)}`;
  document.getElementById('descricaoModalBody').textContent = descricao;
  
  const modal = new bootstrap.Modal(document.getElementById('descricaoModal'));
  modal.show();
}

function copiarDescricao() {
  const texto = document.getElementById('descricaoModalBody').textContent;
  navigator.clipboard.writeText(texto).then(() => {
    mostrarAlerta('Descrição copiada para a área de transferência!', 'success');
  }).catch(() => {
    const textarea = document.createElement('textarea');
    textarea.value = texto;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    mostrarAlerta('Descrição copiada para a área de transferência!', 'success');
  });
}

function atualizarProgressoLote(percentual) {
  const progressBar = document.querySelector('#loteProgressBar .progress-bar');
  if (progressBar) {
    progressBar.style.width = percentual + '%';
    progressBar.textContent = percentual + '%';
  }
}

async function criarTodasOSLote() {
  const btnCriar = document.getElementById('btnCriarTodasOSLote');
  const statusGeral = document.getElementById('loteStatusGeral');
  const progressBar = document.getElementById('loteProgressBar');
  
  const registrosParaCriar = loteRegistros.filter(reg => {
    const status = loteStatus[reg.unidade];
    return status && status.status === 'encontrado' && status.codigoCliente;
  });
  
  if (registrosParaCriar.length === 0) {
    mostrarAlerta('Nenhuma OS pronta para criar.', 'warning');
    return;
  }
  
  if (!confirm(`Deseja criar ${registrosParaCriar.length} OS?`)) {
    return;
  }
  
  btnCriar.disabled = true;
  btnCriar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Criando...';
  progressBar.style.display = 'block';
  
  let criados = 0;
  let erros = 0;
  
  for (let i = 0; i < registrosParaCriar.length; i++) {
    const registro = registrosParaCriar[i];
    const status = loteStatus[registro.unidade];
    const codigoCliente = status.codigoCliente;
    
    const percentual = Math.round(((i + 1) / registrosParaCriar.length) * 100);
    atualizarProgressoLote(percentual);
    
    statusGeral.innerHTML = `
      <i class="fas fa-spinner fa-spin"></i> 
      Criando OS ${i + 1}/${registrosParaCriar.length}: ${registro.unidade}...
    `;
    
    try {
      const resultado = await criarOrdemServicoOmie(registro, codigoCliente);
      const osId = resultado.nCodOS || resultado.cabecalho?.nCodOS;
      
      if (osId) {
        await supabaseClient
          .from('faturamento')
          .update({
            omie_os_id: osId,
            omie_status: 'criado',
            nota_emitida: false,
            boleto_enviado: false
          })
          .eq('id', registro.id);
        
        criados++;
        loteStatus[registro.unidade] = {
          status: 'criado',
          mensagem: `✅ OS ${osId}`,
          codigoCliente: codigoCliente,
          osId: osId
        };
      } else {
        throw new Error('ID da OS não retornado');
      }
    } catch (err) {
      erros++;
      loteStatus[registro.unidade] = {
        status: 'erro_criacao',
        mensagem: `❌ Erro: ${err.message}`,
        codigoCliente: codigoCliente
      };
    }
    
    const container = document.getElementById('loteJanelasContainer');
    let allHtml = '';
    for (const reg of loteRegistros) {
      const st = loteStatus[reg.unidade] || { status: 'verificando', mensagem: '⏳ Verificando...', codigoCliente: null };
      allHtml += criarJanelaUnidade(reg, st);
    }
    container.innerHTML = allHtml;
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  progressBar.style.display = 'none';
  
  if (erros === 0) {
    statusGeral.className = 'alert alert-success';
    statusGeral.innerHTML = `<i class="fas fa-check-circle"></i> <strong>${criados} OS criadas com sucesso!</strong>`;
    mostrarAlerta(`${criados} OS criadas com sucesso!`, 'success');
  } else {
    statusGeral.className = 'alert alert-warning';
    statusGeral.innerHTML = `
      <i class="fas fa-exclamation-triangle"></i> 
      <strong>${criados} criadas, ${erros} erros</strong>
      <br><small>Verifique os detalhes nas janelas.</small>
    `;
    mostrarAlerta(`${criados} OS criadas, ${erros} erros.`, 'warning');
  }
  
  btnCriar.disabled = true;
  btnCriar.innerHTML = '<i class="fas fa-check"></i> Concluído';
  
  setTimeout(() => {
    const mes = parseInt(document.getElementById('filterMonth').value);
    const ano = parseInt(document.getElementById('filterYear').value);
    const unidade = document.getElementById('filterUnit').value.trim();
    carregarRelatorio(mes, ano, unidade, statusFiltroAtual);
  }, 2000);
}

// ========================= FUNÇÕES DE RELATÓRIO =========================
async function carregarRelatorio(mes = 0, ano = 0, filtroUnidade = '', status = 'todos') {
  const filtroHolding = document.getElementById('filterHolding')?.value?.trim() || '';
  const filtroGrupo = document.getElementById('filterGrupo')?.value?.trim() || '';
  
  let query = supabaseClient.from('faturamento').select('*');

  if (mes > 0) query = query.eq('mes', mes);
  if (ano > 0) query = query.eq('ano', ano);
  
  if (filtroHolding || filtroGrupo || filtroUnidade) {
    let queryPrecos = supabaseClient.from('precos').select('unidade, holding, grupo');
    
    if (filtroHolding) {
      queryPrecos = queryPrecos.ilike('holding', `%${filtroHolding}%`);
    }
    if (filtroGrupo) {
      queryPrecos = queryPrecos.ilike('grupo', `%${filtroGrupo}%`);
    }
    if (filtroUnidade) {
      queryPrecos = queryPrecos.ilike('unidade', `%${filtroUnidade}%`);
    }
    
    const { data: unidadesFiltradas } = await queryPrecos;
    
    if (unidadesFiltradas && unidadesFiltradas.length > 0) {
      const listaUnidades = unidadesFiltradas.map(u => u.unidade);
      query = query.in('unidade', listaUnidades);
    } else {
      const { data, error } = await query;
      if (error) {
        mostrarAlerta('Erro ao carregar relatório: ' + error.message, 'danger');
        return;
      }
      atualizarDashboards([]);
      const tbody = document.getElementById('resultsBody');
      tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">Nenhum registro encontrado</td></tr>`;
      return;
    }
  }

  if (status === 'pendentes') {
    query = query.is('omie_os_id', null);
  } else if (status === 'criado') {
    query = query.eq('omie_status', 'criado');
  } else if (status === 'faturado') {
    query = query.eq('omie_status', 'faturado');
  } else if (status === 'pago') {
    query = query.eq('pago', true);
  }

  const { data, error } = await query.order('ano', { ascending: false }).order('mes', { ascending: false });
  if (error) {
    mostrarAlerta('Erro ao carregar relatório: ' + error.message, 'danger');
    return;
  }

  let mapaUnidades = {};
  if (data && data.length > 0) {
    const unidades = [...new Set(data.map(item => item.unidade))];
    const { data: precosData } = await supabaseClient
      .from('precos')
      .select('unidade, holding, grupo')
      .in('unidade', unidades);
    
    if (precosData) {
      precosData.forEach(item => {
        mapaUnidades[item.unidade] = {
          holding: item.holding || 'N/A',
          grupo: item.grupo || 'N/A'
        };
      });
    }
  }

  atualizarDashboards(data);

  const tbody = document.getElementById('resultsBody');
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">Nenhum registro encontrado</td></tr>`;
    return;
  }

  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const hoje = new Date();

  let html = '';
  data.forEach(row => {
    const mesNome = meses[row.mes - 1];
    const infoUnidade = mapaUnidades[row.unidade] || { holding: 'N/A', grupo: 'N/A' };
    
    let statusOSClass = 'secondary';
    let statusOSText = 'Pendente';
    let statusOSIcon = 'fa-clock';

    if (row.omie_status === 'criado') {
      statusOSClass = 'primary';
      statusOSText = 'OS Criada';
      statusOSIcon = 'fa-file-invoice';
    } else if (row.omie_status === 'faturado' || row.omie_status === 'aprovado') {
      statusOSClass = 'success';
      statusOSText = 'Faturado ✅';
      statusOSIcon = 'fa-check-circle';
    } else if (row.omie_status === 'rejeitado') {
      statusOSClass = 'danger';
      statusOSText = 'Rejeitado ❌';
      statusOSIcon = 'fa-times-circle';
    } else if (row.omie_status === 'cancelado') {
      statusOSClass = 'secondary';
      statusOSText = 'Cancelado ⛔';
      statusOSIcon = 'fa-ban';
    } else if (row.omie_status === 'erro') {
      statusOSClass = 'danger';
      statusOSText = 'Erro';
      statusOSIcon = 'fa-exclamation-triangle';
    }
    
    let statusPagamentoClass = 'secondary';
    let statusPagamentoText = 'Pendente';
    let statusPagamentoIcon = 'fa-hourglass-half';
    
    if (row.pago) {
      statusPagamentoClass = 'success';
      statusPagamentoText = 'Pago';
      statusPagamentoIcon = 'fa-check-circle';
    } else if (row.data_vencimento) {
      const venc = new Date(row.data_vencimento + 'T00:00:00');
      const diffDays = Math.ceil((venc - hoje) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        statusPagamentoClass = 'danger';
        statusPagamentoText = 'Vencido';
        statusPagamentoIcon = 'fa-times-circle';
      } else if (diffDays <= 2) {
        statusPagamentoClass = 'warning';
        statusPagamentoText = 'Próx. venc.';
        statusPagamentoIcon = 'fa-exclamation-triangle';
      }
    }

    const dataVenc = row.data_vencimento ? new Date(row.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
    
    const temOs = row.omie_os_id && row.omie_status === 'criado';
    const osFaturada = row.omie_status === 'faturado' || row.omie_status === 'aprovado';
    const osErro = row.omie_status === 'erro' || row.omie_status === 'rejeitado' || row.omie_status === 'cancelado';

    const coresHolding = {
      'Métodos': 'primary',
      'DOP': 'success',
      'Eficaz': 'info',
      'Exata': 'warning',
      'VMK': 'danger',
      'WL': 'secondary'
    };
    const corHolding = coresHolding[infoUnidade.holding] || 'secondary';

    html += `<tr>
      <td><strong>${row.unidade}</strong></td>
      <td><span class="badge bg-${corHolding}">${infoUnidade.holding}</span></td>
      <td><span class="badge bg-secondary">${infoUnidade.grupo}</span></td>
      <td>${mesNome}/${row.ano}</td>
      <td class="text-end">R$ ${row.valor_total.toFixed(2)}</td>
      <td class="text-center">
        <span class="badge bg-${statusOSClass}">
          <i class="fas ${statusOSIcon}"></i> ${statusOSText}
        </span>
      </td>
      <td class="text-center">
        <span class="badge bg-${statusPagamentoClass}">
          <i class="fas ${statusPagamentoIcon}"></i> ${statusPagamentoText}
        </span>
      </td>
      <td class="text-center">${dataVenc}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-primary btn-detalhes" 
                data-id="${row.id}" 
                data-unidade="${row.unidade}"
                data-mes="${row.mes}"
                data-ano="${row.ano}"
                data-detalhes='${JSON.stringify(row.detalhes)}'
                title="Ver detalhes (ID: ${row.id})">
          <i class="fas fa-eye"></i>
        </button>
        ${!temOs && !osFaturada ? `
          <button class="btn btn-sm ${osErro ? 'btn-danger' : 'btn-outline-primary'} btn-criar-os" 
                  data-id="${row.id}" 
                  data-unidade="${row.unidade}"
                  data-valor="${row.valor_total}"
                  data-mes="${row.mes}"
                  data-ano="${row.ano}"
                  data-detalhes='${JSON.stringify(row.detalhes)}'
                  data-os-id="${row.omie_os_id || ''}"
                  data-os-status="${row.omie_status || ''}"
                  data-os-erro="${row.omie_erro || ''}"
                  title="${osErro ? 'Erro ao criar OS' : 'Criar OS na Etapa 50'}">
            <i class="fas ${osErro ? 'fa-exclamation-triangle' : 'fa-file-invoice'}"></i>
            ${osErro ? 'Erro' : 'Criar OS'}
          </button>
        ` : `
          <button class="btn btn-sm ${osFaturada ? 'btn-success' : 'btn-primary'}" disabled>
            <i class="fas ${osFaturada ? 'fa-check-circle' : 'fa-file-invoice'}"></i>
            ${osFaturada ? 'Faturado' : 'OS OK'}
          </button>
        `}
        ${(row.omie_status === 'faturado' || row.omie_status === 'aprovado') ? `
          <button class="btn btn-sm btn-outline-danger btn-cancelar-nfse" 
                  data-id="${row.id}" 
                  data-os-id="${row.omie_os_id}"
                  title="Cancelar NFS-e">
            <i class="fas fa-ban"></i> Cancelar
          </button>
        ` : ''}
        <button class="btn btn-sm btn-outline-info btn-atualizar-status-individual" 
                data-id="${row.id}" 
                title="Atualizar status desta OS">
          <i class="fas fa-sync"></i>
        </button>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;

  document.querySelectorAll('.btn-detalhes').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = parseInt(this.dataset.id);
      const unidade = this.dataset.unidade;
      const mes = parseInt(this.dataset.mes);
      const ano = parseInt(this.dataset.ano);
      const detalhes = JSON.parse(this.dataset.detalhes);
      mostrarDetalhes(id, unidade, mes, ano, detalhes);
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

  document.querySelectorAll('.btn-atualizar-status-individual').forEach(btn => {
    btn.addEventListener('click', async function() {
      const id = this.dataset.id;
      const originalHtml = this.innerHTML;
      
      this.disabled = true;
      this.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      
      try {
        await atualizarStatusOSIndividual(id);
        mostrarAlerta('Status atualizado com sucesso!', 'success');
        
        const mes = parseInt(document.getElementById('filterMonth').value);
        const ano = parseInt(document.getElementById('filterYear').value);
        const unidade = document.getElementById('filterUnit').value.trim();
        await carregarRelatorio(mes, ano, unidade, statusFiltroAtual);
        
      } catch (err) {
        mostrarAlerta('Erro ao atualizar: ' + err.message, 'danger');
      } finally {
        this.disabled = false;
        this.innerHTML = originalHtml;
      }
    });
  });

  // Evento para cancelar NFS-e
  document.querySelectorAll('.btn-cancelar-nfse').forEach(btn => {
    btn.addEventListener('click', async function() {
      const id = this.dataset.id;
      const osId = this.dataset.osId;
      
      if (!id || !osId) {
        mostrarAlerta('Dados insuficientes para cancelar.', 'danger');
        return;
      }
      
      try {
        const result = await cancelarNFSe(osId, '');
        
        if (result.success) {
          mostrarAlerta(result.message, 'success');
        } else if (result.jaCancelada) {
          mostrarAlerta(result.message, 'warning');
        } else {
          mostrarAlerta(result.message, 'danger');
        }
        
        const mes = parseInt(document.getElementById('filterMonth').value);
        const ano = parseInt(document.getElementById('filterYear').value);
        const unidade = document.getElementById('filterUnit').value.trim();
        await carregarRelatorio(mes, ano, unidade, statusFiltroAtual);
        
      } catch (err) {
        mostrarAlerta('Erro ao cancelar: ' + err.message, 'danger');
      }
    });
  });
}

// ========================= CARREGAR HOLDINGS E GRUPOS PARA FILTRO =========================
async function carregarHoldingsParaFiltro() {
  try {
    const { data, error } = await supabaseClient
      .from('precos')
      .select('holding')
      .order('holding');

    if (error) throw error;

    const holdings = [...new Set(data.map(item => item.holding).filter(Boolean))];
    const datalist = document.getElementById('holdingList');
    
    if (datalist) {
      datalist.innerHTML = holdings.map(h => `<option value="${h}">`).join('');
    }
    
    return holdings;
  } catch (err) {
    console.error('Erro ao carregar holdings:', err);
    return [];
  }
}

async function carregarGruposParaFiltro() {
  try {
    const { data, error } = await supabaseClient
      .from('precos')
      .select('grupo')
      .order('grupo');

    if (error) throw error;

    const grupos = [...new Set(data.map(item => item.grupo).filter(Boolean))];
    const datalist = document.getElementById('grupoList');
    
    if (datalist) {
      datalist.innerHTML = grupos.map(g => `<option value="${g}">`).join('');
    }
    
    return grupos;
  } catch (err) {
    console.error('Erro ao carregar grupos:', err);
    return [];
  }
}

function mostrarDetalhes(id, unidade, mes, ano, detalhes) {
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const mesNome = meses[mes - 1];
  const modalTitle = document.getElementById('detalhesModalLabel');
  modalTitle.textContent = `Detalhes - ${unidade} (${mesNome}/${ano})`;

  const body = document.getElementById('detalhesModalBody');
  if (!detalhes || Object.keys(detalhes).length === 0) {
    body.innerHTML = '<p class="text-muted">Nenhum detalhe disponível.</p>';
  } else {
    let listHtml = `
      <div class="alert alert-info">
        <strong>ID:</strong> ${id}
        <span class="ms-3"><strong>Unidade:</strong> ${unidade}</span>
        <span class="ms-3"><strong>Mês/Ano:</strong> ${mesNome}/${ano}</span>
      </div>
      <ul class="list-group">
    `;
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

      const nomeExame = {
        'mensalidade': '📌 Mensalidade',
        'vidas (NR-1)': '👥 Vidas (NR-1)',
        'exame_clinico': '🔬 Exame Clínico',
        'audiometria': '🔬 Audiometria Ocupacional',
        'acuidade_visual': '🔬 Acuidade Visual',
        'eletrocardiograma': '🔬 Eletrocardiograma',
        'eletroencefalograma': '🔬 Eletroencefalograma',
        'espirometria': '🔬 Espirometria',
        'raio_x_torax': '🔬 Raio X Tórax',
        'hemograma': '🔬 Hemograma Completo',
        'anti_hbs': '🔬 Anti Hbs',
        'anti_hcv': '🔬 Anti Hcv',
        'anti_hbs_ag': '🔬 Anti Hbs AG',
        'vdrl': '🔬 VDRL',
        'coprocultura': '🔬 Coprocultura',
        'parasitologico': '🔬 Parasitológico',
        'gama_gt': '🔬 Gama GT',
        'glicose': '🔬 Glicose',
        'pesquisa_fungos': '🔬 Pesquisa de Fungos',
        'dinamometria': '🔬 Dinamometria',
        'visita_tec': '🔬 Visita Técnica',
        'transporte': '🔬 Transporte'
      }[exame] || `🔬 ${exame}`;

      listHtml += `<li class="list-group-item">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <strong>${nomeExame}</strong>
            <span class="text-muted ms-2">(${qtd} unid. x R$ ${preco.toFixed(2)})</span>
            ${funcionariosHtml}
          </div>
          <span class="badge bg-primary rounded-pill">R$ ${subtotal.toFixed(2)}</span>
        </div>
      </li>`;
    }
    if (totalGeral > 0) {
      listHtml += `<li class="list-group-item d-flex justify-content-between align-items-center fw-bold" style="background: #f8f9fa;">
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
  const statusMessage = document.getElementById('osStatusMessage');
  
  const row = document.querySelector(`.btn-criar-os[data-id="${id}"]`);
  const osStatus = row ? row.dataset.osStatus : '';
  const osId = row ? row.dataset.osId : '';
  
  if (osStatus === 'criado' && osId) {
    statusMessage.innerHTML = `
      <div class="alert alert-success">
        <i class="fas fa-check-circle"></i> 
        <strong>OS já criada com sucesso!</strong><br>
        ID OMIE: <strong>${osId}</strong><br>
        <small>A OS está na Etapa 50 (Pronta para faturar).</small>
        <br><br>
        <div class="alert alert-info">
          <i class="fas fa-info-circle"></i> 
          Agora você pode usar o botão <strong>"Faturar em Lote"</strong> para enviar todas as OS para a Etapa 60.
        </div>
      </div>
    `;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-check-circle"></i> OS já criada';
    return;
  }
  
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando cliente...';
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

// ========================= FUNÇÕES AUXILIARES DE STATUS =========================
async function verificarStatusOS(idFaturamento) {
  const { data, error } = await supabaseClient
    .from('faturamento')
    .select('omie_os_id, omie_status')
    .eq('id', idFaturamento)
    .single();
  
  if (error) return null;
  return data;
}

async function atualizarStatusOSFaturadas() {
  try {
    const { data, error } = await supabaseClient
      .from('faturamento')
      .select('*')
      .eq('omie_status', 'criado');
    
    if (error) throw error;
    
    let atualizados = 0;
    
    for (const row of data) {
      if (!row.omie_os_id) continue;
      
      try {
        const payload = {
          endpoint: 'servicos/os',
          call: 'ConsultarOS',
          param: [{ nCodOS: parseInt(row.omie_os_id) }]
        };
        
        const response = await fetchOmieProxy(payload);
        const osData = await response.json();
        
        if (osData.fault) continue;
        
        const etapa = osData.Cabecalho?.cEtapa || osData.cabecalho?.cEtapa || '';
        const isFaturada = etapa === '60' || osData.Cabecalho?.cFaturada === 'S';
        
        if (isFaturada) {
          await supabaseClient
            .from('faturamento')
            .update({ 
              omie_status: 'faturado',
              nota_emitida: true,
              boleto_enviado: true
            })
            .eq('id', row.id);
          atualizados++;
        }
      } catch (err) {
        console.error(`Erro ao verificar OS ${row.omie_os_id}:`, err.message);
      }
    }
    
    console.log(`✅ ${atualizados} OS atualizadas para status "faturado"`);
    return atualizados;
    
  } catch (err) {
    console.error('❌ Erro:', err);
    return 0;
  }
}

async function consultarStatusFaturamentoOS() {
  console.log('🔍 Consultando status de faturamento das OS criadas pelo sistema...');
  
  try {
    const { data: registros, error } = await supabaseClient
      .from('faturamento')
      .select('*')
      .eq('omie_status', 'criado')
      .not('omie_os_id', 'is', null);
    
    if (error) throw error;
    
    if (registros.length === 0) {
      console.log('📋 Nenhuma OS aguardando faturamento.');
      mostrarAlerta('Nenhuma OS criada aguardando faturamento.', 'info');
      return { atualizados: 0, erros: 0 };
    }
    
    console.log(`📋 ${registros.length} OS para verificar status`);
    
    const payload = {
      endpoint: 'produtos/etapafat',
      call: 'ListarEtapasFaturamento',
      param: [{
        pagina: 1,
        registros_por_pagina: 100
      }]
    };
    
    console.log('📤 Buscando NFS-e na OMIE...');
    const response = await fetchOmieProxy(payload);
    const data = await response.json();
    
    if (data.fault) {
      throw new Error(`Erro ao consultar NFS-e: ${data.fault.faultstring}`);
    }
    
    const nfses = data.nfseEncontradas || [];
    console.log(`📋 ${nfses.length} NFS-e encontradas na OMIE`);
    
    let atualizados = 0;
    let erros = 0;
    let detalhesAtualizacao = [];
    
    for (const registro of registros) {
      try {
        const osId = registro.omie_os_id;
        console.log(`🔍 Verificando OS ${osId} - ${registro.unidade}`);
        
        const nfseVinculada = nfses.find(n => {
          const nCodOS = n.OrdemServico?.nCodigoOS || n.OrdemServico?.nCodOS;
          return nCodOS && parseInt(nCodOS) === parseInt(osId);
        });
        
        if (nfseVinculada) {
          const statusNFSe = nfseVinculada.Cabecalho?.cStatusNFSe || '';
          const numeroNFSe = nfseVinculada.Cabecalho?.nNumeroNFSe || '';
          const valorNFSe = nfseVinculada.Cabecalho?.nValorNFSe || 0;
          
          let statusMap = {
            'F': 'faturado',
            'A': 'aprovado',
            'R': 'rejeitado',
            'C': 'cancelado'
          };
          
          const novoStatus = statusMap[statusNFSe] || statusNFSe;
          
          await supabaseClient
            .from('faturamento')
            .update({
              omie_status: novoStatus,
              nota_emitida: true,
              boleto_enviado: true,
              nota_numero: numeroNFSe,
              nota_valor: valorNFSe,
              nota_status: novoStatus,
              nota_data_emissao: nfseVinculada.Emissao?.cDataEmissao || null
            })
            .eq('id', registro.id);
          
          console.log(`✅ OS ${osId} - NFS-e ${numeroNFSe} - Status: ${novoStatus}`);
          detalhesAtualizacao.push(`${registro.unidade}: NFS-e ${numeroNFSe} - ${novoStatus}`);
          atualizados++;
          
        } else {
          console.log(`⏳ OS ${osId} sem NFS-e encontrada, verificando etapa...`);
          
          const payloadOS = {
            endpoint: 'servicos/os',
            call: 'ConsultarOS',
            param: [{ nCodOS: parseInt(osId) }]
          };
          
          const responseOS = await fetchOmieProxy(payloadOS);
          const osData = await responseOS.json();
          
          if (osData.fault) {
            console.error(`❌ Erro ao consultar OS ${osId}:`, osData.fault.faultstring);
            erros++;
            continue;
          }
          
          const etapa = osData.Cabecalho?.cEtapa || osData.cabecalho?.cEtapa || '';
          const isFaturada = etapa === '60' || etapa === '70' || etapa === '80';
          
          if (isFaturada) {
            await supabaseClient
              .from('faturamento')
              .update({
                omie_status: 'faturado',
                nota_emitida: true,
                boleto_enviado: true
              })
              .eq('id', registro.id);
            
            console.log(`✅ OS ${osId} - Faturada (Etapa ${etapa})`);
            detalhesAtualizacao.push(`${registro.unidade}: Faturada (Etapa ${etapa})`);
            atualizados++;
          } else {
            console.log(`⏳ OS ${osId} - Etapa ${etapa} (aguardando faturamento)`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (err) {
        console.error(`❌ Erro ao processar OS ${registro.omie_os_id}:`, err.message);
        erros++;
      }
    }
    
    let mensagem = `${atualizados} OS atualizadas!`;
    if (detalhesAtualizacao.length > 0) {
      mensagem += '\n\n' + detalhesAtualizacao.join('\n');
    }
    if (erros > 0) {
      mensagem += `\n\n${erros} erros encontrados.`;
    }
    
    mostrarAlerta(mensagem, atualizados > 0 ? 'success' : 'info');
    console.log(`📊 ${atualizados} OS atualizadas, ${erros} erros`);
    return { atualizados, erros, detalhes: detalhesAtualizacao };
    
  } catch (err) {
    console.error('❌ Erro ao consultar status:', err);
    mostrarAlerta('Erro ao atualizar status: ' + err.message, 'danger');
    return { atualizados: 0, erros: 1 };
  }
}

async function atualizarStatusOSIndividual(idFaturamento) {
  console.log(`🔄 Atualizando status da OS ID: ${idFaturamento}`);
  
  try {
    const { data: registro, error } = await supabaseClient
      .from('faturamento')
      .select('*')
      .eq('id', idFaturamento)
      .single();
    
    if (error) throw error;
    
    if (!registro.omie_os_id) {
      throw new Error('Esta OS não possui ID na OMIE.');
    }
    
    const osId = registro.omie_os_id;
    
    const payload = {
      endpoint: 'produtos/etapafat',
      call: 'ListarEtapasFaturamento',
      param: [{
        pagina: 1,
        registros_por_pagina: 100
      }]
    };
    
    const response = await fetchOmieProxy(payload);
    const data = await response.json();
    
    if (data.fault) {
      throw new Error(`Erro ao consultar NFS-e: ${data.fault.faultstring}`);
    }
    
    const nfses = data.nfseEncontradas || [];
    const nfseVinculada = nfses.find(n => {
      const nCodOS = n.OrdemServico?.nCodigoOS || n.OrdemServico?.nCodOS;
      return nCodOS && parseInt(nCodOS) === parseInt(osId);
    });
    
    let updateData = {};
    
    if (nfseVinculada) {
      const statusNFSe = nfseVinculada.Cabecalho?.cStatusNFSe || '';
      const numeroNFSe = nfseVinculada.Cabecalho?.nNumeroNFSe || '';
      const valorNFSe = nfseVinculada.Cabecalho?.nValorNFSe || 0;
      
      let statusMap = {
        'F': 'faturado',
        'A': 'aprovado',
        'R': 'rejeitado',
        'C': 'cancelado'
      };
      
      const novoStatus = statusMap[statusNFSe] || statusNFSe;
      
      updateData = {
        omie_status: novoStatus,
        nota_emitida: true,
        boleto_enviado: true,
        nota_numero: numeroNFSe,
        nota_valor: valorNFSe,
        nota_status: novoStatus,
        nota_data_emissao: nfseVinculada.Emissao?.cDataEmissao || null
      };
      
      console.log(`✅ NFS-e ${numeroNFSe} encontrada - Status: ${novoStatus}`);
      
    } else {
      const payloadOS = {
        endpoint: 'servicos/os',
        call: 'ConsultarOS',
        param: [{ nCodOS: parseInt(osId) }]
      };
      
      const responseOS = await fetchOmieProxy(payloadOS);
      const osData = await responseOS.json();
      
      if (osData.fault) {
        throw new Error(`Erro ao consultar OS: ${osData.fault.faultstring}`);
      }
      
      const etapa = osData.Cabecalho?.cEtapa || osData.cabecalho?.cEtapa || '';
      const isFaturada = etapa === '60' || etapa === '70' || etapa === '80';
      
      if (isFaturada) {
        updateData = {
          omie_status: 'faturado',
          nota_emitida: true,
          boleto_enviado: true
        };
        console.log(`✅ OS faturada (Etapa ${etapa})`);
      } else {
        updateData = {
          omie_status: 'criado',
          nota_emitida: false,
          boleto_enviado: false
        };
        console.log(`⏳ OS ainda na Etapa ${etapa}`);
      }
    }
    
    await supabaseClient
      .from('faturamento')
      .update(updateData)
      .eq('id', idFaturamento);
    
    console.log('📊 Status atualizado:', updateData);
    return updateData;
    
  } catch (err) {
    console.error('❌ Erro:', err);
    throw err;
  }
}

// ========================= RECARREGAR TABELA =========================
function recarregarTabela() {
  console.log('🔄 Recarregando tabela...');
  const mes = parseInt(document.getElementById('filterMonth')?.value) || 0;
  const ano = parseInt(document.getElementById('filterYear')?.value) || new Date().getFullYear();
  const unidade = document.getElementById('filterUnit')?.value?.trim() || '';
  carregarRelatorio(mes, ano, unidade, statusFiltroAtual);
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
    
    carregarHoldingsParaFiltro();
    carregarGruposParaFiltro();
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

      if (result.unidadesAtualizadas > 0) {
        feedback.innerHTML += `
          <div class="alert alert-info alert-dismissible fade show mt-2" role="alert">
            <strong><i class="fas fa-sync"></i> Unidades atualizadas:</strong> ${result.unidadesAtualizadas} unidades
            <br><small>Dados de OS e status foram preservados.</small>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
          </div>
        `;
      }

      if (result.unidadesNovas > 0) {
        feedback.innerHTML += `
          <div class="alert alert-success alert-dismissible fade show mt-2" role="alert">
            <strong><i class="fas fa-plus"></i> Novas unidades:</strong> ${result.unidadesNovas} unidades
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
          </div>
        `;
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

  document.getElementById('clearFiltersBtn').addEventListener('click', function() {
    document.getElementById('filterMonth').value = '0';
    document.getElementById('filterYear').value = new Date().getFullYear();
    document.getElementById('filterHolding').value = '';
    document.getElementById('filterGrupo').value = '';
    document.getElementById('filterUnit').value = '';
    carregarRelatorio(0, new Date().getFullYear(), '', statusFiltroAtual);
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

  // ========================= CONFIRMAR CRIAR OS =========================
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
          <i class="fas fa-check-circle"></i> 
          <strong>OS criada com sucesso!</strong><br>
          ID OMIE: <strong>${osId}</strong><br>
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
      
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-check-circle"></i> OS criada';
      
      mostrarAlerta(`OS criada com sucesso! ID: ${osId} (Etapa 50)`, 'success');
      
      const mesF = parseInt(document.getElementById('filterMonth').value);
      const anoF = parseInt(document.getElementById('filterYear').value);
      const unidadeF = document.getElementById('filterUnit').value.trim();
      await carregarRelatorio(mesF, anoF, unidadeF, statusFiltroAtual);
      
      setTimeout(() => {
        const modal = bootstrap.Modal.getInstance(document.getElementById('criarOsModal'));
        if (modal) modal.hide();
      }, 3000);
      
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
      
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fas fa-save"></i> Criar OS (Etapa 50)';
      
      mostrarAlerta('Erro ao criar OS: ' + err.message, 'danger');
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

  // ========================= FATURAR EM LOTE =========================
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
      
      const resultado = await faturarLoteOSCorrigido('50');
      
      if (resultado && resultado.nIdLoteFat) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const atualizados = await atualizarStatusOSFaturadas();
        
        if (statusElement) {
          statusElement.innerHTML = `
            ✅ ${resultado.nQtdeFat || 0} OS enviadas para faturamento!<br>
            📋 ${atualizados} OS atualizadas para status "Faturado"<br>
            <small>ID do Lote: ${resultado.nIdLoteFat}</small>
            <br><br>
            <div class="alert alert-success">
              <i class="fas fa-check-circle"></i> 
              As OS foram movidas da <strong>Etapa 50</strong> para a <strong>Etapa 60</strong> (Faturadas).
            </div>
          `;
          statusElement.className = 'alert alert-success';
        }
        
        mostrarAlerta(`${resultado.nQtdeFat || 0} OS faturadas e ${atualizados} status atualizados!`, 'success');
        
        const mesF = parseInt(document.getElementById('filterMonth')?.value || 0);
        const anoF = parseInt(document.getElementById('filterYear')?.value || 0);
        const unidadeF = document.getElementById('filterUnit')?.value?.trim() || '';
        await carregarRelatorio(mesF, anoF, unidadeF, statusFiltroAtual || 'todos');
        
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

  // ========================= ATUALIZAR STATUS NFS-e =========================
  document.getElementById('btnAtualizarStatusNFSe').addEventListener('click', async function() {
    const btn = this;
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando...';
    
    try {
      const resultado = await consultarStatusFaturamentoOS();
      
      const mes = parseInt(document.getElementById('filterMonth').value);
      const ano = parseInt(document.getElementById('filterYear').value);
      const unidade = document.getElementById('filterUnit').value.trim();
      await carregarRelatorio(mes, ano, unidade, statusFiltroAtual);
      
    } catch (err) {
      mostrarAlerta('Erro ao atualizar status: ' + err.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  // ========================= EVENTO BOTÃO CRIAR OS EM LOTE =========================
  document.getElementById('btnCriarOSLote').addEventListener('click', abrirModalCriarOSLote);

  // ========================= EVENTO BOTÃO CRIAR TODAS OS =========================
  document.getElementById('btnCriarTodasOSLote').addEventListener('click', criarTodasOSLote);

  // ========================= FECHAR MODAL LOTE =========================
  document.getElementById('fecharModalLote').addEventListener('click', function() {
    const modal = bootstrap.Modal.getInstance(document.getElementById('criarOSLoteModal'));
    if (modal) modal.hide();
  });

  // ========================= BOTÃO ATUALIZAR NOME DA UNIDADE =========================
  const btnAtualizarNome = document.getElementById('btnAtualizarNomeUnidade');
  if (btnAtualizarNome) {
    btnAtualizarNome.addEventListener('click', async function() {
      const oldName = document.getElementById('oldUnitName')?.value?.trim() || '';
      const newName = document.getElementById('newUnitName')?.value?.trim() || '';
      const statusEl = document.getElementById('atualizarNomeStatus');
      
      if (!statusEl) return;
      
      if (!oldName || !newName) {
        statusEl.innerHTML = `<div class="alert alert-warning">Preencha o nome antigo e o novo nome.</div>`;
        return;
      }
      
      if (oldName === newName) {
        statusEl.innerHTML = `<div class="alert alert-info">Os nomes são iguais. Nenhuma alteração necessária.</div>`;
        return;
      }
      
      if (!confirm(`Deseja realmente alterar todas as ocorrências de "${oldName}" para "${newName}" no processamento?`)) {
        return;
      }
      
      this.disabled = true;
      this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando...';
      statusEl.innerHTML = `<div class="alert alert-info">⏳ Atualizando registros...</div>`;
      
      try {
        const resultado = await atualizarNomeUnidadeProcessamento(oldName, newName);
        
        if (resultado.success) {
          statusEl.innerHTML = `
            <div class="alert alert-success">
              <i class="fas fa-check-circle"></i> 
              ${resultado.message}
              <br><small>Recarregue a tabela para ver as alterações.</small>
            </div>
          `;
          const oldInput = document.getElementById('oldUnitName');
          const newInput = document.getElementById('newUnitName');
          if (oldInput) oldInput.value = '';
          if (newInput) newInput.value = '';
          
          const mes = parseInt(document.getElementById('filterMonth')?.value || 0);
          const ano = parseInt(document.getElementById('filterYear')?.value || new Date().getFullYear());
          const unidade = document.getElementById('filterUnit')?.value?.trim() || '';
          await carregarRelatorio(mes, ano, unidade, statusFiltroAtual);
          
        } else {
          statusEl.innerHTML = `
            <div class="alert alert-danger">
              <i class="fas fa-exclamation-triangle"></i> 
              ${resultado.message}
            </div>
          `;
        }
        
      } catch (err) {
        statusEl.innerHTML = `
          <div class="alert alert-danger">
            <i class="fas fa-exclamation-triangle"></i> 
            Erro ao atualizar: ${err.message}
          </div>
        `;
      } finally {
        this.disabled = false;
        this.innerHTML = '<i class="fas fa-sync me-1"></i> Atualizar Nome';
      }
    });
  }

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
      let csv = 'Unidade,Holding,Grupo,Mês/Ano,Valor Total (R$),Status OS,Status Pagamento,Vencimento\n';
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length >= 8) {
          const unidade = cols[0]?.textContent?.trim() || '';
          const holding = cols[1]?.textContent?.trim() || '';
          const grupo = cols[2]?.textContent?.trim() || '';
          const mesAno = cols[3]?.textContent?.trim() || '';
          const valor = cols[4]?.textContent?.trim()?.replace('R$ ', '') || '';
          const statusOS = cols[5]?.textContent?.trim() || '';
          const statusPagamento = cols[6]?.textContent?.trim() || '';
          const vencimento = cols[7]?.textContent?.trim() || '';
          csv += `"${unidade}","${holding}","${grupo}","${mesAno}",${valor},"${statusOS}","${statusPagamento}","${vencimento}"\n`;
        }
      });
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
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

  carregarHoldingsParaFiltro();
  carregarGruposParaFiltro();

});