// ========================= CONFIGURAÇÃO SUPABASE =========================
{
  const SUPABASE_URL = 'https://uvilxelwpvrwjxxdougw.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2aWx4ZWx3cHZyd2p4eGRvdWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUxODksImV4cCI6MjA5ODA3MTE4OX0.6YXJYNUFBxL-KQbpZQvRbvKejSFMTpKk6qbxOF_tdlM';
  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ========================= MAPEAMENTO DE EXAMES =========================
  const EXAME_MAP = {
  // ==================== EXAME CLÍNICO ====================
  'Avaliação Clínica Ocupacional (Anamnese e Exame físico)': 'exame_clinico',
  'Avaliação Clínica com ênfase Mental (Anamnese e Exame físico)': 'exame_clinico',
  'Avaliação Psicossocial': 'exame_clinico',

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
  'Hemoglobina glicada (A1 total)': 'hemograma',

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

  // ==================== PESQUISA DE FUNGOS ====================
  'Fungos, pesquisa a fresco': 'pesquisa_fungos',

  // ==================== DINAMOMETRIA ====================
  'DINAMOMETRIA': 'dinamometria',

  // ==================== (OPCIONAIS – CASO APAREÇAM) ====================
   'Visita Técnica': 'visita_tec',
   'Transporte': 'transporte',
};

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
      dashboardPage.classList.add('hidden');
    }

    function mostrarDashboard(user) {
    loginPage.classList.add('hidden');
    dashboardPage.classList.remove('hidden');
    userEmailSpan.textContent = user.email;
    statusFiltroAtual = 'todos';
    // Marcar o botão "Todos" como ativo
    document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
    const btnTodos = document.querySelector('[data-status="todos"]');
    if (btnTodos) btnTodos.classList.add('active');
    carregarRelatorio(0, 0, '', 'todos');
    carregarPrecos();
  }

    supabaseClient.auth.getSession().then(({ data }) => {
      if (data.session) {
        mostrarDashboard(data.session.user);
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
        mostrarDashboard(user);
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
    let precosDataGlobal = []; // Guarda todos os registros para filtro

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
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Nenhum registro encontrado</td></tr>`;
        return;
      }
      let html = '';
      dados.forEach(row => {
        html += `<tr>
          <td>${row.grupo || ''}</td>
          <td>${row.holding || ''}</td>
          <td><strong>${row.unidade}</strong></td>
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

      // Eventos de editar/excluir
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

    // Filtro em tempo real na tabela de preços
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
        return grupo.includes(termo) || holding.includes(termo) || unidade.includes(termo);
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

    // ========================= PROCESSAMENTO DE UPLOAD (com substituição) =========================
async function processarUpload(file, mesReferencia = 0, anoReferencia = 0) {
  // Se não foi passado mês/ano, usa o mês atual
  const now = new Date();
  const mes = mesReferencia || now.getMonth() + 1;
  const ano = anoReferencia || now.getFullYear();

  // ========================= 1. LER PLANILHA =========================
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Encontrar cabeçalho
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

  // ========================= 2. EXTRAIR UNIDADES E EXAMES DA PLANILHA =========================
  const examesPorUnidade = {}; // { unidadeNormalizada: [ {exameNormalizado, preco, mes, ano} ] }
  const unidadesPlanilha = new Set();

  for (let row of dataRows) {
    if (!row[0] && !row[1] && !row[2]) continue;
    const exameUpload = row[0]?.toString().trim();
    const unidadePlanilha = row[4]?.toString().trim();
    if (!exameUpload || !unidadePlanilha) continue;

    const exameNormalizado = normalizarNomeExame(exameUpload);
    if (!exameNormalizado) continue;

    const chaveUnidade = normalizarUnidade(unidadePlanilha);
    unidadesPlanilha.add(chaveUnidade);

    if (!examesPorUnidade[chaveUnidade]) {
      examesPorUnidade[chaveUnidade] = [];
    }
    examesPorUnidade[chaveUnidade].push({
      exame: exameNormalizado,
      nomeOriginal: exameUpload
    });
  }

  // ========================= 3. BUSCAR TODAS AS UNIDADES CADASTRADAS =========================
  const { data: todasUnidades, error: unidadesError } = await supabaseClient
    .from('precos')
    .select('*');

  if (unidadesError) throw unidadesError;

  // Mapa de normalização para encontrar a unidade cadastrada
  const mapaUnidades = {};
  todasUnidades.forEach(u => {
    const chave = normalizarUnidade(u.unidade);
    mapaUnidades[chave] = u;
  });

  // ========================= 4. COLETAR UNIDADES NÃO ENCONTRADAS =========================
  const unidadesNaoEncontradas = [];
  for (let chave of unidadesPlanilha) {
    if (!mapaUnidades[chave]) {
      unidadesNaoEncontradas.push(chave);
    }
  }

  // ========================= 5. PREPARAR REGISTROS PARA TODAS AS UNIDADES =========================
  const registros = [];

  for (let chave in mapaUnidades) {
    const unidade = mapaUnidades[chave];
    const nomeUnidade = unidade.unidade;

    // Inicializar detalhes e total
    const detalhes = {};
    let total = 0;

    // Adicionar mensalidade (se houver)
    if (unidade.mensalidade && unidade.mensalidade > 0) {
      total += unidade.mensalidade;
      detalhes['mensalidade'] = { quantidade: 1, precoUnitario: unidade.mensalidade };
    }

    // Adicionar vidas (se houver)
    if (unidade.vidas && unidade.qtd_vidas) {
      const valorVidas = unidade.vidas * unidade.qtd_vidas;
      total += valorVidas;
      detalhes['vidas (NR-1)'] = {
        quantidade: unidade.qtd_vidas,
        precoUnitario: unidade.vidas,
        subtotal: valorVidas
      };
    }

    // Adicionar exames da planilha para esta unidade
    if (examesPorUnidade[chave]) {
      // Buscar preços dos exames
      const examesList = examesPorUnidade[chave].map(e => e.exame);
      // Precisamos buscar os preços individualmente
      // Como já temos a unidade, podemos pegar o preço do campo correspondente
      for (let ex of examesPorUnidade[chave]) {
        const preco = unidade[ex.exame] || 0;
        if (preco === 0) {
          // Se for zero, alertamos (opcional)
          continue;
        }
        total += preco;
        if (!detalhes[ex.exame]) {
          detalhes[ex.exame] = { quantidade: 0, precoUnitario: preco };
        }
        detalhes[ex.exame].quantidade += 1;
      }
    }

    // Se o total for zero, não geramos registro? Vamos gerar mesmo assim, com valor zero, para manter controle.
    // Mas podemos gerar apenas se tiver pelo menos mensalidade, vidas ou exames.
    // O ideal é gerar para todas, pois o usuário quer ver todas as unidades.

    // Calcular data de vencimento
    const diaVencimento = unidade.dia_vencimento || 10;
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const diaFinal = Math.min(diaVencimento, ultimoDia);
    const dataVencimento = new Date(ano, mes - 1, diaFinal);

    registros.push({
      unidade: nomeUnidade,
      mes: mes,
      ano: ano,
      valor_total: total,
      detalhes: detalhes,
      data_vencimento: dataVencimento.toISOString().split('T')[0],
      nota_emitida: false,
      boleto_enviado: false,
      pago: false
    });
  }

  if (registros.length === 0) throw new Error('Nenhuma unidade cadastrada para gerar faturamento.');

  // ========================= 6. SUBSTITUIR DADOS ANTIGOS =========================
  // Deletar registros existentes para as mesmas unidades, mês e ano
  const { error: deleteError } = await supabaseClient
    .from('faturamento')
    .delete()
    .eq('mes', mes)
    .eq('ano', ano);

  if (deleteError) {
    console.warn('Erro ao deletar registros antigos:', deleteError);
  }

  // ========================= 7. INSERIR NOVOS REGISTROS =========================
  const { error: insertError } = await supabaseClient
    .from('faturamento')
    .insert(registros);

  if (insertError) throw insertError;

  const totalGeral = registros.reduce((acc, r) => acc + r.valor_total, 0);

  return {
    totalRegistros: registros.length,
    totalGeral,
    unidadesNaoEncontradas
  };
}

    // ========================= RELATÓRIO =========================
   async function carregarRelatorio(mes = 0, ano = 0, unidadeFiltro = '', status = 'todos') {
  let query = supabaseClient.from('faturamento').select('*');

  if (mes > 0) query = query.eq('mes', mes);
  if (ano > 0) query = query.eq('ano', ano);
  if (unidadeFiltro) query = query.ilike('unidade', `%${unidadeFiltro}%`);

  // Aplicar filtro de status
  if (status === 'pendentes') {
    query = query.eq('nota_emitida', false).eq('boleto_enviado', false).eq('pago', false);
  } else if (status === 'enviado') {
    query = query.eq('nota_emitida', true).eq('boleto_enviado', true).eq('pago', false);
  } else if (status === 'pago') {
    query = query.eq('pago', true);
  }
  // 'todos' não aplica filtro adicional

  const { data, error } = await query.order('ano', { ascending: false }).order('mes', { ascending: false });
  if (error) {
    mostrarAlerta('Erro ao carregar relatório: ' + error.message, 'danger');
    return;
  }

  const tbody = document.getElementById('resultsBody');
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Nenhum registro encontrado</td></tr>`;
    return;
  }

  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const hoje = new Date();

  let html = '';
  data.forEach(row => {
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
                data-unidade="${row.unidade}"
                data-mes="${row.mes}"
                data-ano="${row.ano}"
                data-detalhes='${JSON.stringify(row.detalhes)}'
                title="Ver detalhes">
          <i class="fas fa-eye"></i>
        </button>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;

  // Evento toggle status (Enviado e Pago)
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
        // Recarregar com os mesmos filtros
        const mesFiltro = parseInt(document.getElementById('filterMonth').value);
        const anoFiltro = parseInt(document.getElementById('filterYear').value);
        const unidadeFiltro = document.getElementById('filterUnit').value.trim();
        carregarRelatorio(mesFiltro, anoFiltro, unidadeFiltro, statusFiltroAtual);
      } catch (err) {
        mostrarAlerta('Erro ao atualizar status: ' + err.message, 'danger');
      }
    });
  });

  // Evento detalhes (olhinho)
  document.querySelectorAll('.btn-detalhes').forEach(btn => {
    btn.addEventListener('click', function() {
      const unidade = this.dataset.unidade;
      const mes = parseInt(this.dataset.mes);
      const ano = parseInt(this.dataset.ano);
      const detalhes = JSON.parse(this.dataset.detalhes);
      mostrarDetalhes(unidade, mes, ano, detalhes);
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
      let qtd, preco, subtotal;
      if (typeof info === 'object' && info !== null) {
        qtd = info.quantidade || 0;
        preco = info.precoUnitario || 0;
        subtotal = (info.subtotal !== undefined) ? info.subtotal : (qtd * preco);
      } else {
        qtd = info;
        preco = 0;
        subtotal = 'N/A';
      }
      const exibePreco = (preco > 0) ? `R$ ${preco.toFixed(2)}` : '—';
      const exibeSubtotal = (typeof subtotal === 'number') ? `R$ ${subtotal.toFixed(2)}` : subtotal;
      totalGeral += (typeof subtotal === 'number') ? subtotal : 0;
      listHtml += `<li class="list-group-item d-flex justify-content-between align-items-center">
        <div>
          <strong>${exame}</strong>
          <span class="text-muted ms-2">(${qtd} unid. x ${exibePreco})</span>
        </div>
        <span class="badge bg-primary rounded-pill">${exibeSubtotal}</span>
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

    function mostrarAlerta(mensagem, tipo = 'info') {
      const area = document.getElementById('alertArea');
      area.innerHTML = `<div class="alert alert-${tipo} alert-dismissible fade show" role="alert">
        ${mensagem}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>`;
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

  // Ler mês/ano dos filtros
  const mesFiltro = parseInt(document.getElementById('filterMonth').value) || 0;
  const anoFiltro = parseInt(document.getElementById('filterYear').value) || 0;
  const mesRef = mesFiltro || new Date().getMonth() + 1;
  const anoRef = anoFiltro || new Date().getFullYear();

  status.innerHTML = `<span class="text-info">Processando para ${mesRef}/${anoRef}...</span>`;
  feedback.innerHTML = '';

  try {
    const result = await processarUpload(fileInput.files[0], mesRef, anoRef);
    status.innerHTML = `<span class="text-success">✓ ${result.totalRegistros} unidades processadas. Total geral: R$ ${result.totalGeral.toFixed(2)}</span>`;

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

    // Recarregar relatório com os mesmos filtros
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

    // Filtros de status
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

    // Carregar dados iniciais
    carregarRelatorio();
    // carregarPrecos() é chamado dentro do mostrarDashboard
  });
}