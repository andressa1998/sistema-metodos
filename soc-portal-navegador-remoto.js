'use strict';

console.log('SOC navegador remoto: V1');

let wtSocRemoteToken = null;
let wtSocRemoteRfb = null;
let wtSocRemoteTimer = null;
let wtSocRemoteModule = null;

async function wtSocRemoteFetchJson(url, options = {}) {
    const response = await fetch(url, {
        cache: 'no-store',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const text = await response.text();
    let data = {};

    try {
        data = text ? JSON.parse(text) : {};
    } catch (_) {
        throw new Error(`Resposta inválida do servidor (HTTP ${response.status}).`);
    }

    if (!response.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
    }

    return data;
}

function wtGarantirBotaoSocRemote() {
    if (document.getElementById('btnConectarSocRemoto')) {
        return true;
    }

    const botao = document.createElement('button');

    botao.type = 'button';
    botao.id = 'btnConectarSocRemoto';
    botao.className = 'btn btn-primary btn-sm';
    botao.innerHTML = '<i class="fas fa-desktop me-1"></i> Conectar SOC';

    botao.style.cssText = `
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 99998;
        box-shadow: 0 2px 8px rgba(0,0,0,.25);
    `;

    botao.onclick = event => {
        event.preventDefault();
        abrirNavegadorRemotoSoc();
    };

    document.body.appendChild(botao);

    return true;
}

function wtCriarModalSocRemote() {
    let modal = document.getElementById('wtSocRemoteModal');

    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'wtSocRemoteModal';

    modal.style.cssText = `
        position:fixed;
        inset:0;
        z-index:999999;
        background:#111;
        display:flex;
        flex-direction:column;
    `;

    modal.innerHTML = `
        <div style="
            min-height:54px;
            background:#fff;
            border-bottom:1px solid #ddd;
            display:flex;
            align-items:center;
            gap:10px;
            padding:8px 12px;
        ">
            <strong style="font-size:17px;">
                Navegador remoto do SOC
            </strong>

            <span id="wtSocRemoteStatus" style="font-size:13px;color:#555;">
                Abrindo navegador...
            </span>

            <div style="flex:1;"></div>

            <button type="button" id="wtSocRemoteSalvar" class="btn btn-success btn-sm" disabled>
                Salvar sessão e continuar
            </button>

            <button type="button" id="wtSocRemoteCancelar" class="btn btn-outline-danger btn-sm">
                Fechar
            </button>
        </div>

        <div style="
            background:#f8f9fa;
            border-bottom:1px solid #ddd;
            padding:6px 12px;
            font-size:13px;
        ">
            Este é o navegador do portal do SOC rodando no servidor.
            Faça o login normalmente (usuário, senha, ID) e resolva o captcha se aparecer.
        </div>

        <div id="wtSocRemoteScreen" tabindex="0" style="
            flex:1;
            min-height:0;
            background:#222;
            overflow:hidden;
            position:relative;
        "></div>
    `;

    document.body.appendChild(modal);

    return modal;
}

async function wtCarregarRfbSoc() {
    if (wtSocRemoteModule) {
        return wtSocRemoteModule;
    }

    wtSocRemoteModule = await import('/esocial-novnc/core/rfb.js');

    return wtSocRemoteModule;
}

async function wtAtualizarStatusSocRemote() {
    if (!wtSocRemoteToken) return;

    try {
        const data = await wtSocRemoteFetchJson(
            '/api/soc/portal-remoto/navegador-remoto/status?token=' +
            encodeURIComponent(wtSocRemoteToken)
        );

        const status = document.getElementById('wtSocRemoteStatus');
        const salvar = document.getElementById('wtSocRemoteSalvar');

        if (data.autenticada) {
            if (status) {
                status.textContent = 'SOC autenticado. Clique em "Salvar sessão e continuar".';
                status.style.color = '#198754';
            }

            if (salvar) salvar.disabled = false;

        } else {
            if (status) {
                status.textContent = data?.pagina?.titulo || 'Aguardando autenticação';
                status.style.color = '#555';
            }

            if (salvar) salvar.disabled = true;
        }

    } catch (error) {
        const status = document.getElementById('wtSocRemoteStatus');

        if (status) {
            status.textContent = error.message;
            status.style.color = '#dc3545';
        }
    }
}

async function wtFinalizarSocRemote() {
    if (!wtSocRemoteToken) return;

    const salvar = document.getElementById('wtSocRemoteSalvar');
    const status = document.getElementById('wtSocRemoteStatus');

    try {
        if (salvar) salvar.disabled = true;

        if (status) {
            status.textContent = 'Salvando sessão do SOC...';
            status.style.color = '#0d6efd';
        }

        await wtSocRemoteFetchJson('/api/soc/portal-remoto/navegador-remoto/finalizar', {
            method: 'POST',
            body: JSON.stringify({ token: wtSocRemoteToken })
        });

        if (status) {
            status.textContent = 'Sessão salva. O sistema já pode usar o SOC.';
            status.style.color = '#198754';
        }

        setTimeout(() => wtFecharModalSocRemote(false), 900);

    } catch (error) {
        if (status) {
            status.textContent = error.message;
            status.style.color = '#dc3545';
        }

        if (salvar) salvar.disabled = false;
    }
}

async function wtFecharModalSocRemote(cancelarServidor = true) {
    clearInterval(wtSocRemoteTimer);
    wtSocRemoteTimer = null;

    if (wtSocRemoteRfb) {
        try { wtSocRemoteRfb.disconnect(); } catch (_) {}
        wtSocRemoteRfb = null;
    }

    const token = wtSocRemoteToken;
    wtSocRemoteToken = null;

    if (cancelarServidor && token) {
        try {
            await wtSocRemoteFetchJson('/api/soc/portal-remoto/navegador-remoto/cancelar', {
                method: 'POST',
                body: JSON.stringify({ token })
            });
        } catch (_) {}
    }

    document.getElementById('wtSocRemoteModal')?.remove();
}

async function wtAguardarNavegadorProntoSoc(status, timeoutMs = 90000) {
    const inicio = Date.now();

    while (Date.now() - inicio < timeoutMs) {
        const data = await wtSocRemoteFetchJson(
            '/api/soc/portal-remoto/navegador-remoto/status?token=' +
            encodeURIComponent(wtSocRemoteToken)
        );

        if (data.erro) {
            throw new Error(data.erro);
        }

        if (data.pronta || data.telaPronta) {
            return;
        }

        if (status) {
            status.textContent = 'Abrindo navegador remoto no servidor... isso pode levar até 1 minuto.';
            status.style.color = '#555';
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    throw new Error('O navegador remoto demorou demais para abrir.');
}

async function abrirNavegadorRemotoSoc() {
    const botao = document.getElementById('btnConectarSocRemoto');

    try {
        if (botao) {
            botao.disabled = true;
            botao.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Abrindo...';
        }

        const data = await wtSocRemoteFetchJson('/api/soc/portal-remoto/navegador-remoto/iniciar', {
            method: 'POST',
            body: '{}'
        });

        wtSocRemoteToken = data.token;

        const modal = wtCriarModalSocRemote();
        const screen = modal.querySelector('#wtSocRemoteScreen');
        const status = modal.querySelector('#wtSocRemoteStatus');

        modal.querySelector('#wtSocRemoteCancelar').onclick = () => wtFecharModalSocRemote(true);

        await wtAguardarNavegadorProntoSoc(status);

        const { default: RFB } = await wtCarregarRfbSoc();

        const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:';

        const wsUrl =
            protocolo + '//' + location.host +
            '/api/soc/portal-remoto/navegador-remoto/ws?token=' +
            encodeURIComponent(wtSocRemoteToken);

        wtSocRemoteRfb = new RFB(screen, wsUrl, { shared: true });

        wtSocRemoteRfb.scaleViewport = true;
        wtSocRemoteRfb.resizeSession = false;
        wtSocRemoteRfb.viewOnly = false;
        wtSocRemoteRfb.focusOnClick = true;

        wtSocRemoteRfb.addEventListener('connect', () => {
            if (status) {
                status.textContent = 'Navegador conectado. Faça o login normalmente.';
                status.style.color = '#198754';
            }

            try { screen.focus(); } catch (_) {}
        });

        wtSocRemoteRfb.addEventListener('disconnect', event => {
            if (event?.detail?.clean) return;

            if (status) {
                status.textContent = 'A conexão com o navegador remoto foi encerrada.';
                status.style.color = '#dc3545';
            }
        });

        modal.querySelector('#wtSocRemoteSalvar').onclick = wtFinalizarSocRemote;

        clearInterval(wtSocRemoteTimer);
        wtSocRemoteTimer = setInterval(wtAtualizarStatusSocRemote, 1200);

        await wtAtualizarStatusSocRemote();

    } catch (error) {
        alert('Não foi possível abrir o navegador remoto do SOC: ' + error.message);
        wtFecharModalSocRemote(true);

    } finally {
        if (botao) {
            botao.disabled = false;
            botao.innerHTML = '<i class="fas fa-desktop me-1"></i> Conectar SOC';
        }
    }
}

window.abrirNavegadorRemotoSoc = abrirNavegadorRemotoSoc;

(function instalar() {
    wtGarantirBotaoSocRemote();
})();
