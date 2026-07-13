import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== FUNÇÃO AUXILIAR PARA RESPOSTAS CORS =====
function corsResponse(body: any, status: number = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*", // Permite qualquer origem
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

serve(async (req) => {
  // ===== RESPOSTA PARA PREFLIGHT (OPTIONS) =====
  if (req.method === "OPTIONS") {
    return corsResponse({}, 200);
  }

  try {
    const { id_faturamento, cnpj, valor_total, descricao_detalhada } = await req.json();

    if (!cnpj) {
      return corsResponse({ success: false, error: "CNPJ não informado." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    // Busca credenciais da Omie
    const { data: settings, error: settingsError } = await supabase
      .from("app_settings")
      .select("chave, valor");

    if (settingsError) throw settingsError;

    const appKey = settings.find(s => s.chave === "omie_app_key")?.valor;
    const appSecret = settings.find(s => s.chave === "omie_app_secret")?.valor;

    if (!appKey || !appSecret) {
      return corsResponse({ success: false, error: "Credenciais da Omie não configuradas." }, 500);
    }

    // 1) Consultar cliente pelo CNPJ
    const cnpjLimpo = cnpj.replace(/[^0-9]/g, '');
    const clientesPayload = {
      call: "ListarClientes",
      app_key: appKey,
      app_secret: appSecret,
      param: [
        {
          filtrar_por_cnpj: cnpjLimpo,
          pagina: 1,
          registros_por_pagina: 10,
        }
      ],
    };

    const clientesResponse = await fetch("https://app.omie.com.br/api/v1/geral/clientes/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clientesPayload),
    });

    const clientesResult = await clientesResponse.json();

    if (!clientesResponse.ok || clientesResult.fault) {
      return corsResponse({ 
        success: false, 
        error: "Erro ao buscar cliente: " + (clientesResult.fault?.string || "Cliente não encontrado") 
      }, 400);
    }

    const clientes = clientesResult?.response?.cadastros || [];
    if (clientes.length === 0) {
      return corsResponse({ 
        success: false, 
        error: `Nenhum cliente com CNPJ ${cnpj}. Cadastre-o na Omie primeiro.` 
      }, 404);
    }

    const cliente = clientes[0];
    const codigoCliente = cliente.nCodCli;
    const emailCliente = cliente.cEmail || cliente.email || null;

    // 2) Criar a OS
    const payload = {
      call: "IncluirOS",
      app_key: appKey,
      app_secret: appSecret,
      param: [
        {
          Cabecalho: {
            nCodCli: codigoCliente,
            dDtPrevisao: new Date().toLocaleDateString("pt-BR"),
            cEtapa: "10",
            nQtdeParc: 1,
            cCodParc: "999",
          },
          Email: {
            cEnvBoleto: "S",
            cEnvLink: "S",
            cEnviarPara: emailCliente || "financeiro@cliente.com",
          },
          ServicosPrestados: [
            {
              cDescServ: "Serviços de medicina e segurança do trabalho",
              nQtde: 1,
              nValUnit: valor_total,
              cTribServ: "01",
              cCodServMun: "17.12.01",
              cCodServLC116: "7.07",
              cRetemISS: "N",
              impostos: {
                nAliqISS: 2.01,
                cRetemIRRF: "N",
                cRetemPIS: "N",
                cRetemCOFINS: "N",
                cRetemCSLL: "N",
                cRetemINSS: "N",
              },
              cDadosAdicItem: descricao_detalhada,
            },
          ],
          InformacoesAdicionais: {
            cDadosAdicNF: `OS gerada pelo sistema Métodos - ${new Date().toISOString().slice(0,10)}`,
          },
        },
      ],
    };

    const osResponse = await fetch("https://app.omie.com.br/api/v1/servicos/os/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const osResult = await osResponse.json();

    if (!osResponse.ok || osResult.fault) {
      return corsResponse({ 
        success: false, 
        error: "Erro ao criar OS: " + (osResult.fault?.string || "Erro desconhecido") 
      }, 400);
    }

    const osStatus = osResult?.response?.osStatus || osResult;

    // 3) Atualizar faturamento
    const { error: updateError } = await supabase
      .from("faturamento")
      .update({
        codigo_os_omie: osStatus.nCodOS || null,
        numero_os_omie: osStatus.cNumOS || null,
        status_os_omie: "emitido",
        codigo_pedido_omie: osStatus.nCodOS || null,
      })
      .eq("id", id_faturamento);

    if (updateError) throw updateError;

    // 4) Trocar etapa para faturado
    const faturaPayload = {
      call: "TrocarEtapaOS",
      app_key: appKey,
      app_secret: appSecret,
      param: [
        {
          nCodOS: osStatus.nCodOS,
          cEtapa: "50",
        },
      ],
    };

    const faturaResponse = await fetch("https://app.omie.com.br/api/v1/servicos/os/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(faturaPayload),
    });

    const faturaResult = await faturaResponse.json();

    if (faturaResult.fault) {
      console.warn("Erro ao faturar OS (não crítico):", faturaResult.fault);
    } else {
      await supabase
        .from("faturamento")
        .update({ status_os_omie: "faturado" })
        .eq("id", id_faturamento);
    }

    return corsResponse({
      success: true,
      os: osStatus,
      message: "OS criada e faturada com sucesso!",
    });

  } catch (error) {
    console.error("Erro:", error);
    return corsResponse({
      success: false,
      error: error.message || "Erro interno",
    }, 500);
  }
});