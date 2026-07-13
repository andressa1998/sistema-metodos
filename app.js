// ========================= CONFIGURAÇÃO SUPABASE =========================
// Removido o bloco { } para que supabaseClient seja global
const SUPABASE_URL = 'https://uvilxelwpvrwjxxdougw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2aWx4ZWx3cHZyd2p4eGRvdWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUxODksImV4cCI6MjA5ODA3MTE4OX0.6YXJYNUFBxL-KQbpZQvRbvKejSFMTpKk6qbxOF_tdlM';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========================= MAPEAMENTO DE EXAMES =========================
const EXAME_MAP = {
  // ==================== EXAME CLÍNICO ====================
  'Avaliação Clínica Ocupacional (Anamnese e Exame físico)': 'exame_clinico',
  'Avaliação Clínica com ênfase Mental (Anamnese e Exame físico)': 'exame_clinico',

  // ==================== AUDIOMETRIA ====================
  'Audiometria tonal ocupacional': 'audiometria',

  // ==================== ACUIDADE VISUAL ====================
  'Avaliação da acuidade visual': 'acuidade_visual',

  // ==================== ELETROCARDIOGRAMA ====================
  'ECG (Eletrocardiograma) convencional de até 12 derivações': 'eletrocardiograma',

  // ==================== ELETROENCEFALOGRAMA ====================
  'EEG (Eletroencefalograma) de rotina': 'eletroencefalograma',

  // ==================== ESPIROMETRIA ====================
  'Prova de função pulmonar completa (ou espirometria)': 'espirometria',

  // ==================== RAIO X TÓRAX ====================
  'Radiografia de tórax em duas incidências': 'raio_x_torax',

  // ==================== HEMOGRAMA COMPLETO ====================
  'Hemograma com contagem de plaquetas ou frações (eritrograma, leucograma, plaquetas)': 'hemograma',

  // ==================== ANTI HBS ====================
  'Hepatite B - HBsAC (anti-HBs)': 'anti_hbs',

  // ==================== ANTI HCV ====================
  'Anti-HCV': 'anti_hcv',

  // ==================== ANTI HBS AG ====================
  'Hepatite B - HBsAG': 'anti_hbs_ag',
  'Hepatite B - HBeAG': 'anti_hbs_ag',

  // ==================== VDRL ====================
  'Sífilis - VDRL': 'vdrl',

  // ==================== COPROCULTURA ====================
  'Cultura nas fezes: salmonela, shigellae e E. coli enteropatogênicas, enteroinvasora (sorol. incluída) + campylobacter SP. + E. coli enterohemorrágica': 'coprocultura',

  // ==================== PARASITOLÓGICO ====================
  'Parasitológico de fezes': 'parasitologico',

  // ==================== GAMA GT ====================
  'Gama-glutamil transferase (Gama-GT)': 'gama_gt',

  // ==================== GLICOSE ====================
  'Glicemia': 'glicose',
  'Hemoglobina glicada (A1 total)': 'glicose',

  // ==================== PESQUISA DE FUNGOS ====================
  'Fungos, pesquisa a fresco': 'pesquisa_fungos',

  // ==================== DINAMOMETRIA ====================
  'DINAMOMETRIA': 'dinamometria',

  // ==================== (OPCIONAIS – CASO APAREÇAM) ====================
  'Visita Técnica': 'visita_tec',
  'Transporte': 'transporte',
};

// ========================= UNIDADES IGNORADAS (não são mais clientes) =========================
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
let mapaUnidadeHolding = {};

function processarDadosPorMes(dados, ano) {
  // Inicializa arrays para os 12 meses
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const totalPorMes = new Array(12).fill(0);
  const examesPorMes = new Array(12).fill(0);
  const mensalidadePorMes = new Array(12).fill(0);

  dados.forEach(row => {
    // Se o ano for passado, filtra; se ano=0, considera todos
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
          // Exames (inclui exame_clinico e outros)
          examesPorMes[mesIndex] += qtd * preco;
        }
      }
    }
  });

  return { meses, totalPorMes, examesPorMes, mensalidadePorMes };
}

function renderizarGraficos(dados, ano) {
  const { meses, totalPorMes, examesPorMes, mensalidadePorMes } = processarDadosPorMes(dados, ano);

  // Função auxiliar para criar ou atualizar gráfico
  function criarOuAtualizarGrafico(canvasId, label, data, cor) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    let chart = null;
    // Verifica se já existe um gráfico associado a este canvas (usando uma propriedade personalizada)
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
          plugins: {
            legend: { display: false }
          },
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

// Função para normalizar e verificar se a unidade está na lista de ignorados
function isUnidadeIgnorada(nome) {
  if (!nome) return false;
  const normalizado = normalizarUnidade(nome);
  return UNIDADES_IGNORADAS.some(ignorada => {
    return normalizarUnidade(ignorada) === normalizado;
  });
}

function formatarMoeda(valor) {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ========================= NORMALIZAÇÃO DE NOMES DE UNIDADES =========================
function normalizarUnidade(nome) {
  if (!nome) return '';

  // Remove acentos
  let normalizado = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Remove pontuação (parênteses, pontos, vírgulas, hífens, etc.)
  normalizado = normalizado.replace(/[()\-.,/]/g, ' ');

  // Remove sufixos comuns (case insensitive), mas NÃO remove FILIAL, MATRIZ, etc.
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

  // Remove espaços extras e converte para maiúsculas
  normalizado = normalizado.replace(/\s+/g, ' ').trim().toUpperCase();

  return normalizado;
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

// ========================= EXPORTAR PREÇOS PARA EXCEL =========================
async function exportarPrecos() {
  try {
    // Buscar todos os dados da tabela precos
    const { data, error } = await supabaseClient
      .from('precos')
      .select('*')
      .order('unidade', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) {
      mostrarAlerta('Nenhum dado para exportar.', 'warning');
      return;
    }

    // Definir as colunas (cabeçalho) e o mapeamento para os campos do banco
    const colunas = [
      { header: 'Grupo', field: 'grupo' },
      { header: 'Holding', field: 'holding' },
      { header: 'Unidade', field: 'unidade' },
      { header: 'Razão Social', field: 'razao_social' },
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

    // Construir o array de dados para a planilha
    const rows = data.map(item => {
      const row = {};
      colunas.forEach(col => {
        const valor = item[col.field];
        // Se for número, formatar com 2 casas decimais
        if (typeof valor === 'number' && col.field !== 'qtd_vidas') {
          row[col.header] = valor.toFixed(2);
        } else {
          row[col.header] = valor ?? '';
        }
      });
      return row;
    });

    // Criar workbook e worksheet
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Preços');

    // Ajustar largura das colunas (opcional)
    const colWidths = colunas.map(() => ({ wch: 18 }));
    ws['!cols'] = colWidths;

    // Gerar arquivo e baixar
    const fileName = `precos_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    mostrarAlerta(`Arquivo "${fileName}" exportado com sucesso!`, 'success');
  } catch (err) {
    mostrarAlerta('Erro ao exportar: ' + err.message, 'danger');
  }
}

document.addEventListener('DOMContentLoaded', function () {
  // ========================= REFERÊNCIAS AOS ELEMENTOS =========================
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
    // Resetar status
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
  }

  // ========================= EVENTOS DO MENU =========================
  document.querySelectorAll('.menu-card').forEach(card => {
    card.addEventListener('click', function() {
      const target = this.dataset.target;
      if (target === 'faturamento') {
        mostrarDashboard((supabaseClient.auth.getUser())?.data?.user || { email: userEmailSpan.textContent });
      }
      // Futuramente: 'esocial'
    });
  });

  // ========================= AUTENTICAÇÃO - SESSÃO =========================
  let statusFiltroAtual = 'todos';

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

    // ===== ATUALIZA O MAPA UNIDADE → HOLDING (para filtro na aba Processamento) =====
    mapaUnidadeHolding = {};
    if (data) {
      data.forEach(item => {
        if (item.unidade && item.holding) {
          mapaUnidadeHolding[item.unidade] = item.holding;
        }
      });
    }
    console.log('🗺️ Mapa unidade→holding atualizado com', Object.keys(mapaUnidadeHolding).length, 'registros');
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
        <td>${row.razao_social || ''}</td>
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

  // Evento de busca no cadastro de preços (MANTIDO)
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
      const razao = (item.razao_social || '').toLowerCase();
      return grupo.includes(termo) || holding.includes(termo) || unidade.includes(termo) || razao.includes(termo);
    });
    renderizarTabelaPrecos(filtrados);
  });

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
    document.getElementById('precoExameClinico').value = dados.exame_clinico ?? '';
    document.getElementById('precoMensalidade').value = dados.mensalidade ?? '';
    document.getElementById('precoVidas').value = dados.vidas ?? '';
    document.getElementById('precoQtdVidas').value = dados.qtd_vidas ?? '';
    document.getElementById('precoAudiometria').value = dados.audiometria ?? '';
    document.getElementById('precoAcuidade').value = dados.acuidade_visual ?? '';
    document.getElementById('precoEcg').value = dados.eletrocardiograma ?? '';
    document.getElementById('precoEeg').value = dados.eletroencefalograma ?? '';
    document.getElementById('precoEspirometria').value = dados.espirometria ?? '';
    document.getElementById('precoRaioX').value = dados.raio_x_torax ?? '';
    document.getElementById('precoHemograma').value = dados.hemograma ?? '';
    document.getElementById('precoAntiHbs').value = dados.anti_hbs ?? '';
    document.getElementById('precoAntiHcv').value = dados.anti_hcv ?? '';
    document.getElementById('precoAntiHbsAg').value = dados.anti_hbs_ag ?? '';
    document.getElementById('precoVdrl').value = dados.vdrl ?? '';
    document.getElementById('precoCoprocultura').value = dados.coprocultura ?? '';
    document.getElementById('precoParasitologico').value = dados.parasitologico ?? '';
    document.getElementById('precoGamaGt').value = dados.gama_gt ?? '';
    document.getElementById('precoGlicose').value = dados.glicose ?? '';
    document.getElementById('precoPesquisaFungos').value = dados.pesquisa_fungos ?? '';
    document.getElementById('precoDinamometria').value = dados.dinamometria ?? '';
    document.getElementById('precoVisitaTec').value = dados.visita_tec ?? '';
    document.getElementById('precoTransporte').value = dados.transporte ?? '';
    document.getElementById('precoDiaVencimento').value = dados.dia_vencimento ?? 10;
  }

  function lerFormulario() {
    const id = document.getElementById('precoId').value;
    const getNumber = (id) => {
      const val = document.getElementById(id).value.trim();
      return val === '' ? null : parseFloat(val);
    };
    const getInt = (id) => {
      const val = document.getElementById(id).value.trim();
      return val === '' ? null : parseInt(val);
    };
    return {
      id: id ? parseInt(id) : null,
      grupo: document.getElementById('precoGrupo').value || null,
      holding: document.getElementById('precoHolding').value || null,
      unidade: document.getElementById('precoUnidade').value.trim(),
      razao_social: document.getElementById('precoRazaoSocial').value.trim() || null,
      exame_clinico: getNumber('precoExameClinico'),
      mensalidade: getNumber('precoMensalidade'),
      vidas: getNumber('precoVidas'),
      qtd_vidas: getInt('precoQtdVidas') || 0,
      audiometria: getNumber('precoAudiometria'),
      acuidade_visual: getNumber('precoAcuidade'),
      eletrocardiograma: getNumber('precoEcg'),
      eletroencefalograma: getNumber('precoEeg'),
      espirometria: getNumber('precoEspirometria'),
      raio_x_torax: getNumber('precoRaioX'),
      hemograma: getNumber('precoHemograma'),
      anti_hbs: getNumber('precoAntiHbs'),
      anti_hcv: getNumber('precoAntiHcv'),
      anti_hbs_ag: getNumber('precoAntiHbsAg'),
      vdrl: getNumber('precoVdrl'),
      coprocultura: getNumber('precoCoprocultura'),
      parasitologico: getNumber('precoParasitologico'),
      gama_gt: getNumber('precoGamaGt'),
      glicose: getNumber('precoGlicose'),
      pesquisa_fungos: getNumber('precoPesquisaFungos'),
      dinamometria: getNumber('precoDinamometria'),
      visita_tec: getNumber('precoVisitaTec'),
      transporte: getNumber('precoTransporte'),
      dia_vencimento: getInt('precoDiaVencimento') || 10,
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

  // ========================= PROCESSAMENTO DE UPLOAD =========================
  async function processarUpload(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // --- 1) Localizar cabeçalho ---
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

  // --- 2) Extrair datas para determinar o mês de referência ---
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

  // --- 3) Ler exames por unidade (a partir da planilha) ---
  const examesPorUnidade = {};
  const unidadesNaPlanilha = new Set();

  // Primeiro, identificar todas as unidades que aparecem na planilha
  for (let row of dataRows) {
    if (!row[0] && !row[1] && !row[2]) continue;
    const unidadePlanilha = row[4]?.toString().trim();
    if (!unidadePlanilha) continue;
    if (isUnidadeIgnorada(unidadePlanilha)) continue;
    const chave = normalizarUnidade(unidadePlanilha);
    unidadesNaPlanilha.add(chave);
  }

  // Depois, associar exames a essas unidades
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

    const chave = normalizarUnidade(unidadePlanilha);
    if (!examesPorUnidade[chave]) {
      examesPorUnidade[chave] = [];
    }
    examesPorUnidade[chave].push({
      exame: exameNormalizado,
      nomeOriginal: exameUpload,
      funcionario: funcionario || 'N/A',
      dataExame: dataExameStr || '—'
    });
  }

  // --- 4) Buscar TODAS as unidades cadastradas (precos) ---
  const { data: todasUnidades, error: unidadesError } = await supabaseClient
    .from('precos')
    .select('*');

  if (unidadesError) throw unidadesError;

  // Mapear unidades por nome normalizado e razão social
  const mapaUnidades = {};
  const mapaRazaoSocial = {};
  todasUnidades.forEach(u => {
    const chaveUnidade = normalizarUnidade(u.unidade);
    mapaUnidades[chaveUnidade] = u;
    if (u.razao_social) {
      const chaveRazao = normalizarUnidade(u.razao_social);
      mapaRazaoSocial[chaveRazao] = u;
    }
  });

  // --- 5) Criar registros para TODAS as unidades cadastradas ---
  const registros = [];
  const unidadesNaoEncontradas = []; // unidades da planilha que não estão no cadastro

  for (let chave of unidadesNaPlanilha) {
    let unidade = mapaUnidades[chave] || mapaRazaoSocial[chave];
    if (!unidade) {
      unidadesNaoEncontradas.push(chave);
    }
  }

  // Agora, iteramos sobre todas as unidades cadastradas
  for (let unidade of todasUnidades) {
    // Pular se for ignorada (já tratado)
    const nomeUnidade = unidade.unidade;
    const chave = normalizarUnidade(nomeUnidade);
    // Se a unidade foi marcada como ignorada, pular (mas já tratamos)
    // Podemos também pular se a unidade não tem mensalidade e nem vidas e não tem exames?
    // Mas vamos incluir todas, mesmo que o total seja 0.

    const detalhes = {};
    let total = 0;

    // Adiciona mensalidade (se > 0)
    if (unidade.mensalidade && unidade.mensalidade > 0) {
      total += unidade.mensalidade;
      detalhes['mensalidade'] = { quantidade: 1, precoUnitario: unidade.mensalidade };
    }

    // Adiciona vidas (se houver valor e quantidade)
    if (unidade.vidas && unidade.qtd_vidas) {
      const valorVidas = unidade.vidas * unidade.qtd_vidas;
      total += valorVidas;
      detalhes['vidas (NR-1)'] = {
        quantidade: unidade.qtd_vidas,
        precoUnitario: unidade.vidas,
        subtotal: valorVidas
      };
    }

    // Adiciona exames (se esta unidade apareceu na planilha)
    if (examesPorUnidade[chave]) {
      for (let ex of examesPorUnidade[chave]) {
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

    // Data de vencimento
    const diaVencimento = unidade.dia_vencimento || 10;
    const ultimoDia = new Date(anoFaturamento, mesFaturamento, 0).getDate();
    const diaFinal = Math.min(diaVencimento, ultimoDia);
    const dataVencimento = new Date(anoFaturamento, mesFaturamento - 1, diaFinal);

    registros.push({
      unidade: nomeUnidade,
      mes: mesFaturamento,
      ano: anoFaturamento,
      valor_total: total,
      detalhes: detalhes,
      data_vencimento: dataVencimento.toISOString().split('T')[0],
      nota_emitida: false,
      boleto_enviado: false,
      pago: false
    });
  }

  // --- 6) Deletar registros antigos do mesmo mês/ano e inserir ---
  const { error: deleteError } = await supabaseClient
    .from('faturamento')
    .delete()
    .eq('mes', mesFaturamento)
    .eq('ano', anoFaturamento);

  if (deleteError) {
    console.warn('Erro ao deletar registros antigos:', deleteError);
  }

  const { error: insertError } = await supabaseClient
    .from('faturamento')
    .insert(registros);

  if (insertError) throw insertError;

  const totalGeral = registros.reduce((acc, r) => acc + r.valor_total, 0);

  return {
    totalRegistros: registros.length,
    totalGeral,
    unidadesNaoEncontradas, // agora são as unidades da planilha que não estão cadastradas
    mesProcessado: mesFaturamento,
    anoProcessado: anoFaturamento
  };
}

  // ========================= RELATÓRIO =========================
  async function carregarRelatorio(mes = 0, ano = 0, unidadeFiltro = '', status = 'todos') {
    let query = supabaseClient.from('faturamento').select('*');

    if (mes > 0) query = query.eq('mes', mes);
    if (ano > 0) query = query.eq('ano', ano);

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

    // ===== FILTRO POR NOME DA UNIDADE OU HOLDING (em memória) =====
    let dadosFiltrados = data;
    if (unidadeFiltro && unidadeFiltro.trim() !== '') {
      const termo = unidadeFiltro.toLowerCase().trim();
      dadosFiltrados = data.filter(row => {
        const unidade = (row.unidade || '').toLowerCase();
        const holding = (mapaUnidadeHolding[row.unidade] || '').toLowerCase();
        return unidade.includes(termo) || holding.includes(termo);
      });
    }

    atualizarDashboards(dadosFiltrados);

    const tbody = document.getElementById('resultsBody');
    if (!dadosFiltrados || dadosFiltrados.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Nenhum registro encontrado</td></tr>`;
      return;
    }

    const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const hoje = new Date();

    let html = '';
    dadosFiltrados.forEach(row => {
      const mesNome = meses[row.mes - 1];
      let totalItens = 0;
      if (row.detalhes && typeof row.detalhes === 'object') {
        for (let key in row.detalhes) {
          const info = row.detalhes[key];
          if (typeof info === 'object' && info !== null && info.quantidade !== undefined) {
            totalItens += info.quantidade;
          } else if (typeof info === 'number') {
            totalItens += info;
          }
        }
      }
      const resumo = totalItens > 0 ? `${totalItens} ${totalItens === 1 ? 'item' : 'itens'}` : '—';

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
                  title="Ver detalhes">
            <i class="fas fa-eye"></i>
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
  }

  function mostrarDetalhes(unidade, mes, ano, detalhes) {
    try {
      const oldModal = document.getElementById('detalhesModalCustom');
      if (oldModal) oldModal.remove();
      const oldBackdrops = document.querySelectorAll('.modal-backdrop');
      oldBackdrops.forEach(b => b.remove());
      document.body.classList.remove('modal-open');

      const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      const mesNome = meses[mes - 1];

      let bodyContent = '';
      if (!detalhes || Object.keys(detalhes).length === 0) {
        bodyContent = '<p class="text-muted">Nenhum detalhe disponível.</p>';
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
        bodyContent = listHtml;
      }

      const modalHTML = `
        <div id="detalhesModalCustom" class="modal show" tabindex="-1" style="
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
            opacity: 1 !important;
            visibility: visible !important;
          ">
            <div class="modal-content" style="
              background: #fff !important;
              border-radius: 16px !important;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3) !important;
            ">
              <div class="modal-header" style="
                background: #213b7c !important;
                color: #fff !important;
                border-radius: 16px 16px 0 0 !important;
                padding: 16px 20px !important;
                border-bottom: none !important;
              ">
                <h5 class="modal-title" style="color: #fff !important; font-weight: 600;">
                  <i class="fas fa-file-invoice me-2"></i> Detalhes - ${unidade} (${mesNome}/${ano})
                </h5>
                <button type="button" class="btn-close btn-close-white" onclick="fecharModalCustom()" style="
                  background: transparent !important;
                  border: none !important;
                  font-size: 1.5rem !important;
                  color: #fff !important;
                  opacity: 0.8 !important;
                "></button>
              </div>
              <div class="modal-body" style="padding: 20px !important; max-height: 400px !important; overflow-y: auto !important;">
                ${bodyContent}
              </div>
              <div class="modal-footer" style="
                border-top: 1px solid #e9ecef !important;
                padding: 12px 20px !important;
                border-radius: 0 0 16px 16px !important;
              ">
                <button type="button" class="btn btn-secondary" onclick="fecharModalCustom()" style="
                  border-radius: 30px !important;
                  padding: 8px 24px !important;
                  font-weight: 500 !important;
                ">Fechar</button>
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHTML);

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') fecharModalCustom();
      });

      const modalElement = document.getElementById('detalhesModalCustom');
      modalElement.addEventListener('click', function(e) {
        if (e.target === this) {
          fecharModalCustom();
        }
      });

      console.log('✅ Modal criado do zero com sucesso!');
    } catch (err) {
      console.error('Erro em mostrarDetalhes:', err);
      mostrarAlerta('Erro ao exibir detalhes: ' + err.message, 'danger');
    }
  }

  window.fecharModalCustom = function() {
    const modal = document.getElementById('detalhesModalCustom');
    if (modal) modal.remove();
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(b => b.remove());
    document.body.classList.remove('modal-open');
  };

  function mostrarAlerta(mensagem, tipo = 'info') {
    const area = document.getElementById('alertArea');
    area.innerHTML = `<div class="alert alert-${tipo} alert-dismissible fade show" role="alert">
      ${mensagem}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>`;
  }

  document.getElementById('btnVoltarMenu').addEventListener('click', function() {
    supabaseClient.auth.getUser().then(({ data }) => {
      if (data.user) {
        mostrarMenu(data.user);
      } else {
        const email = document.getElementById('userEmail').textContent;
        mostrarMenu({ email: email });
      }
    });
  });

  // ========================= DASHBOARDS =========================
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

    const soma = totalMensalidade + totalExamesValor + totalVidasValor;
    const somaEl = document.getElementById('somaVerificacao');
    const statusEl = document.getElementById('somaStatus');
    if (somaEl) {
      somaEl.textContent = 'R$ ' + formatarMoeda(soma);
    }
    if (statusEl) {
      const diff = Math.abs(soma - valorTotal);
      if (diff < 0.01) {
        statusEl.innerHTML = '<i class="fas fa-check-circle text-success"></i> OK';
      } else {
        statusEl.innerHTML = `<i class="fas fa-exclamation-circle text-danger"></i> Diferença: R$ ${formatarMoeda(diff)}`;
      }
    }
  }

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
    const dashboardTab = document.getElementById('dashboard');
    if (dashboardTab.classList.contains('show')) {
      carregarDadosDashboard(mes, ano);
    }
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

  // ========================= EXCLUSÃO DE PROCESSAMENTO (MODAL CUSTOMIZADO) =========================
  // ===== Botão para abrir o modal de exclusão =====
  document.getElementById('btnExcluirProcessamento').addEventListener('click', function() {
    abrirModalExclusao();
  });

  // ===== MODAL CUSTOMIZADO DE EXCLUSÃO =====
  function abrirModalExclusao() {
    // Remove qualquer modal antigo
    const oldModal = document.getElementById('excluirModalCustom');
    if (oldModal) oldModal.remove();
    const oldBackdrops = document.querySelectorAll('.modal-backdrop');
    oldBackdrops.forEach(b => b.remove());
    document.body.classList.remove('modal-open');

    // Popula selects com meses e anos
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

    // HTML do modal
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

    // Adiciona eventos
    const modalElement = document.getElementById('excluirModalCustom');
    modalElement.addEventListener('click', function(e) {
      if (e.target === this) fecharModalExclusao();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') fecharModalExclusao();
    });

    // Evento do botão confirmar
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

        // Recarrega a lista
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

  // Função para fechar o modal customizado
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

  document.getElementById('tab-dashboard').addEventListener('shown.bs.tab', function () {
    const select = document.getElementById('dashboardYear');
    if (select && select.options.length === 0) {
      popularAnosDashboard();
    }
    const mes = parseInt(document.getElementById('dashboardMonth').value);
    const ano = parseInt(document.getElementById('dashboardYear').value);
    carregarCards(mes, ano);
    carregarGraficos(ano);
  });

  document.getElementById('applyDashboardFilters').addEventListener('click', function() {
    const mes = parseInt(document.getElementById('dashboardMonth').value);
    const ano = parseInt(document.getElementById('dashboardYear').value);
    carregarCards(mes, ano);
    carregarGraficos(ano);
  });

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

  // ========================= OUTROS EVENTOS =========================
  function popularAnos() {
    const select = document.getElementById('filterYear');
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

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const table = document.getElementById('resultsTable');
    let csv = 'Unidade,Mês/Ano,Valor Total (R$),Detalhes\n';
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const cols = row.querySelectorAll('td');
      if (cols.length === 4) {
        const unidade = cols[0].textContent.trim();
        const mesAno = cols[1].textContent.trim();
        const valor = cols[2].textContent.trim().replace('R$ ', '');
        const detalhes = cols[3].textContent.trim();
        csv += `"${unidade}","${mesAno}",${valor},"${detalhes}"\n`;
      }
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'faturamento.csv';
    link.click();
  });

  // ================================================================
  // ===== NOVAS FUNÇÕES – Upload de Vidas e Atualização por Holding =
  // ================================================================

  async function carregarHoldings() {
    const select = document.getElementById('holdingSelect');
    if (!select) {
      console.error('Elemento holdingSelect não encontrado');
      return;
    }

    select.innerHTML = '<option value="">⏳ Carregando holdings...</option>';
    select.disabled = true;

    try {
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) {
        console.error('Erro ao verificar sessão:', sessionError);
        select.innerHTML = '<option value="">❌ Erro de autenticação</option>';
        select.disabled = false;
        return;
      }
      if (!sessionData.session) {
        console.warn('Usuário não autenticado');
        select.innerHTML = '<option value="">🔒 Faça login novamente</option>';
        select.disabled = false;
        return;
      }
      console.log('✅ Usuário autenticado:', sessionData.session.user.email);

      const { data, error } = await supabaseClient
        .from('precos')
        .select('holding')
        .not('holding', 'is', null)
        .order('holding', { ascending: true });

      if (error) {
        console.error('❌ Erro Supabase:', error);
        select.innerHTML = `<option value="">❌ Erro: ${error.message}</option>`;
        select.disabled = false;
        return;
      }

      console.log('📊 Dados recebidos:', data);

      const holdings = [...new Set(data.map(item => item.holding).filter(Boolean))];
      console.log('🏷️ Holdings encontradas:', holdings);

      if (holdings.length === 0) {
        select.innerHTML = '<option value="">⚠️ Nenhuma holding cadastrada</option>';
        select.disabled = false;
        return;
      }

      select.innerHTML = '<option value="">Selecione uma holding</option>';
      holdings.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        select.appendChild(opt);
      });
      select.disabled = false;
      console.log('✅ Holdings carregadas com sucesso!');

    } catch (err) {
      console.error('❌ Erro inesperado:', err);
      select.innerHTML = `<option value="">❌ Erro: ${err.message}</option>`;
      select.disabled = false;
    }
  }

  async function processarUploadVidas(file) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    let headerIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.length >= 2) {
        const col0 = row[0]?.toString().trim().toUpperCase();
        const col1 = row[1]?.toString().trim().toUpperCase();
        if ((col0 === 'UNIDADE' || col0 === 'EMPRESA' || col0 === 'RAZÃO SOCIAL') &&
            (col1 === 'FUNC.' || col1 === 'FUNCIONÁRIOS' || col1 === 'QTDE' || col1 === 'QUANTIDADE')) {
          headerIndex = i;
          break;
        }
      }
    }
    if (headerIndex === -1) {
      throw new Error('Cabeçalho não encontrado. Procure por colunas "UNIDADE" e "Func." (ou similar).');
    }

    const dataRows = rows.slice(headerIndex + 1);
    const atualizados = [];
    const naoEncontrados = [];

    const { data: precos, error } = await supabaseClient.from('precos').select('*');
    if (error) throw error;

    const mapaUnidade = {};
    const mapaRazao = {};
    precos.forEach(item => {
      const chaveUnidade = normalizarUnidade(item.unidade);
      mapaUnidade[chaveUnidade] = item;
      if (item.razao_social) {
        const chaveRazao = normalizarUnidade(item.razao_social);
        mapaRazao[chaveRazao] = item;
      }
    });

    for (let row of dataRows) {
      if (!row[0] && !row[1]) continue;
      const nomePlanilha = row[0]?.toString().trim();
      const qtdVidas = parseInt(row[1]?.toString().trim()) || 0;
      if (!nomePlanilha) continue;

      const chave = normalizarUnidade(nomePlanilha);
      let registro = mapaUnidade[chave] || mapaRazao[chave];
      if (!registro) {
        naoEncontrados.push(nomePlanilha);
        continue;
      }

      const { error: updateError } = await supabaseClient
        .from('precos')
        .update({ qtd_vidas: qtdVidas })
        .eq('id', registro.id);

      if (updateError) {
        throw new Error(`Erro ao atualizar ${registro.unidade}: ${updateError.message}`);
      }
      atualizados.push(registro.unidade);
    }

    return { atualizados, naoEncontrados, totalAtualizados: atualizados.length, totalNaoEncontrados: naoEncontrados.length };
  }

  async function atualizarVidasPorHolding(holding, novoValor) {
    if (!holding || !novoValor || novoValor < 0) {
      throw new Error('Selecione uma holding e informe um valor válido.');
    }

    const { data, error } = await supabaseClient
      .from('precos')
      .update({ vidas: novoValor })
      .eq('holding', holding)
      .select();

    if (error) throw error;
    return { holding, novoValor, affected: data?.length || 0 };
  }

  // ===== EVENTOS DAS NOVAS FUNCIONALIDADES =====

  document.getElementById('processUploadVidasBtn').addEventListener('click', async function() {
    const input = document.getElementById('uploadVidasInput');
    const status = document.getElementById('uploadVidasStatus');
    const feedback = document.getElementById('uploadVidasFeedback');

    if (!input.files || input.files.length === 0) {
      status.innerHTML = '<span class="text-warning">Selecione um arquivo.</span>';
      feedback.innerHTML = '';
      return;
    }

    status.innerHTML = '<span class="text-info">Processando...</span>';
    feedback.innerHTML = '';

    try {
      const result = await processarUploadVidas(input.files[0]);
      status.innerHTML = `<span class="text-success">✓ ${result.totalAtualizados} unidades atualizadas. ${result.totalNaoEncontrados} não encontradas.</span>`;

      if (result.naoEncontrados.length > 0) {
        let lista = result.naoEncontrados.map(u => `<li class="list-unstyled">${u}</li>`).join('');
        feedback.innerHTML = `
          <div class="alert alert-warning alert-dismissible fade show" role="alert">
            <strong><i class="fas fa-exclamation-triangle"></i> Unidades não encontradas:</strong>
            <ul class="mb-0 mt-1" style="list-style: none; padding-left: 0;">${lista}</ul>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
          </div>
        `;
      } else {
        feedback.innerHTML = `<div class="alert alert-success">Todas as unidades foram atualizadas com sucesso!</div>`;
      }
      carregarPrecos();
    } catch (err) {
      status.innerHTML = `<span class="text-danger">Erro: ${err.message}</span>`;
      feedback.innerHTML = '';
    }
  });

  document.getElementById('atualizarVidasHoldingBtn').addEventListener('click', async function() {
    const holding = document.getElementById('holdingSelect').value;
    const valor = parseFloat(document.getElementById('novoValorVidas').value);
    const status = document.getElementById('holdingUpdateStatus');

    if (!holding) {
      status.innerHTML = '<span class="text-warning">Selecione uma holding.</span>';
      return;
    }
    if (isNaN(valor) || valor < 0) {
      status.innerHTML = '<span class="text-warning">Informe um valor válido (R$).</span>';
      return;
    }

    if (!confirm(`Deseja realmente alterar o valor de "Vidas" para R$ ${valor.toFixed(2)} em TODAS as unidades da holding "${holding}"?`)) {
      return;
    }

    status.innerHTML = '<span class="text-info">Atualizando...</span>';
    try {
      const result = await atualizarVidasPorHolding(holding, valor);
      status.innerHTML = `<span class="text-success">✓ ${result.affected} unidades da holding "${holding}" atualizadas para R$ ${result.novoValor.toFixed(2)}.</span>`;
      carregarPrecos();
    } catch (err) {
      status.innerHTML = `<span class="text-danger">Erro: ${err.message}</span>`;
    }
  });

  document.getElementById('tab-cadastro').addEventListener('shown.bs.tab', function() {
    carregarHoldings();
  });

  setTimeout(() => {
    if (document.getElementById('cadastro')?.classList.contains('show')) {
      carregarHoldings();
    }
  }, 500);

  document.getElementById('btnRecarregarHoldings')?.addEventListener('click', function() {
    carregarHoldings();
    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    setTimeout(() => {
      this.innerHTML = '<i class="fas fa-sync"></i>';
    }, 1500);
  });

  // ===== DELEGAÇÃO DE EVENTO PARA BOTÃO DE DETALHES =====
  document.getElementById('resultsBody').addEventListener('click', async function(e) {
    const btn = e.target.closest('.btn-detalhes');
    if (!btn) return;

    const id = parseInt(btn.dataset.id);
    if (isNaN(id)) {
      mostrarAlerta('ID inválido.', 'warning');
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from('faturamento')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      if (!data) {
        mostrarAlerta('Registro não encontrado.', 'warning');
        return;
      }

      mostrarDetalhes(data.unidade, data.mes, data.ano, data.detalhes);
    } catch (err) {
      console.error('Erro no detalhe:', err);
      mostrarAlerta('Erro ao carregar detalhes: ' + err.message, 'danger');
    }
  });

}); // fim DOMContentLoaded