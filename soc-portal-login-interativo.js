'use strict';

console.log('SOC login interativo: V1');

let wtSocLoginToken = null;
let wtSocLoginTimerFrame = null;
let wtSocLoginTimerStatus = null;
let wtSocLoginFechando = false;

async function wtSocFetchJson(url, options = {}) {
    const response = await fetch(url, {
        cache: 'no-store',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const texto = await response.text();
    let data = null;

    try {
        data = texto ? JSON.parse(texto) : {};
    } catch (_) {
        throw new Error(`Resposta inválida do servidor (HTTP ${response.status}).`);
    }

    if (!response.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
    }

    return data;
}

function wtGarantirBotaoSocLogin() {
    if (document.getElementById('btnConectarSocRemoto')) {
        return true;
    }

    const botao = document.createElement('button');

    botao.type = 'button';
    botao.id = 'btnConectarSocRemoto';
    botao.className = 'btn btn-primary btn-sm';
    botao.title = 'Abrir autenticação manual do portal do SOC.';
    botao.innerHTML = '<i class="fas fa-user-shield me-1"></i> Conectar SOC';

    botao.style.cssText = `
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 99998;
        box-shadow: 0 2px 8px rgba(0,0,0,.25);
    `;

    botao.onclick = event => {
        event.preventDefault();
        abrirLoginInterativoSoc();
    };

    document.body.appendChild(botao);

    return true;
}

function wtCriarModalSocLogin() {
    let modal = document.getElementById('wtSocLoginInterativoModal');

    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'wtSocLoginInterativoModal';

    modal.style.cssText = `
        position:fixed;
        inset:0;
        z-index:999999;
        background:rgba(0,0,0,.72);
        display:flex;
        align-items:center;
        justify-content:center;
        padding:12px;
    `;

    modal.innerHTML = `
        <div style="
            width:min(1450px,98vw);
            height:min(900px,96vh);
            background:#fff;
            border-radius:10px;
            box-shadow:0 12px 40px rgba(0,0,0,.35);
            display:flex;
            flex-direction:column;
            overflow:hidden;
        ">
            <div style="
                display:flex;
                align-items:center;
                gap:10px;
                padding:10px 12px;
                border-bottom:1px solid #ddd;
            ">
                <strong>Conectar ao SOC</strong>

                <span id="wtSocLoginStatus" style="font-size:13px;color:#555;">
                    Iniciando...
                </span>

                <div style="flex:1;"></div>

                <button type="button" id="wtSocLoginEsc" class="btn btn-outline-secondary btn-sm">
                    Esc
                </button>

                <button type="button" id="wtSocLoginTab" class="btn btn-outline-secondary btn-sm">
                    Tab
                </button>

                <button type="button" id="wtSocLoginEnter" class="btn btn-outline-secondary btn-sm">
                    Enter
                </button>

                <button type="button" id="wtSocLoginFechar" class="btn btn-outline-danger btn-sm">
                    Fechar
                </button>
            </div>

            <div style="
                padding:8px 12px;
                border-bottom:1px solid #eee;
                display:flex;
                gap:8px;
            ">
                <input type="text"
                       id="wtSocLoginTexto"
                       class="form-control form-control-sm"
                       placeholder="Se precisar digitar: clique no campo da tela abaixo, digite aqui e clique Enviar.">

                <button type="button" id="wtSocLoginEnviarTexto" class="btn btn-outline-primary btn-sm">
                    Enviar
                </button>
            </div>

            <div style="
                flex:1;
                overflow:auto;
                background:#1f1f1f;
                display:flex;
                align-items:flex-start;
                justify-content:center;
                padding:8px;
            ">
                <img id="wtSocLoginFrame"
                     alt="Navegador remoto do SOC"
                     draggable="false"
                     style="
                        width:min(1365px,100%);
                        height:auto;
                        display:block;
                        cursor:default;
                        user-select:none;
                        background:#fff;
                     ">
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    return modal;
}

async function wtEnviarTeclaSoc(key) {
    if (!wtSocLoginToken) return;

    await wtSocFetchJson('/api/soc/portal-remoto/login-interativo/key', {
        method: 'POST',
        body: JSON.stringify({ token: wtSocLoginToken, key })
    });
}

async function wtAtualizarFrameSocLogin() {
    if (!wtSocLoginToken || wtSocLoginFechando) return;

    const img = document.getElementById('wtSocLoginFrame');

    if (!img) return;

    img.src =
        '/api/soc/portal-remoto/login-interativo/frame' +
        '?token=' + encodeURIComponent(wtSocLoginToken) +
        '&t=' + Date.now();
}

async function wtAtualizarStatusSocLogin() {
    if (!wtSocLoginToken || wtSocLoginFechando) return;

    try {
        const data = await wtSocFetchJson(
            '/api/soc/portal-remoto/login-interativo/status?token=' +
            encodeURIComponent(wtSocLoginToken)
        );

        const status = document.getElementById('wtSocLoginStatus');

        if (status) {
            if (data.autenticada) {
                status.textContent = 'Autenticado com sucesso. A sessão já pode ser usada pelo sistema.';
                status.style.color = '#198754';

            } else if (data.ultimoErro) {
                status.textContent = data.ultimoErro;
                status.style.color = '#dc3545';

            } else {
                status.textContent = 'Faça o login manualmente na tela abaixo (usuário/senha/ID já preenchidos, resolva o captcha se aparecer).';
                status.style.color = '#555';
            }
        }

        if (data.autenticada) {
            setTimeout(() => fecharLoginInterativoSoc(false), 1400);
        }

    } catch (error) {
        const status = document.getElementById('wtSocLoginStatus');

        if (status) {
            status.textContent = error.message;
            status.style.color = '#dc3545';
        }
    }
}

async function abrirLoginInterativoSoc() {
    try {
        const botao = document.getElementById('btnConectarSocRemoto');

        if (botao) {
            botao.disabled = true;
            botao.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Abrindo...';
        }

        const data = await wtSocFetchJson('/api/soc/portal-remoto/login-interativo/iniciar', {
            method: 'POST',
            body: '{}'
        });

        wtSocLoginToken = data.token;
        wtSocLoginFechando = false;

        const modal = wtCriarModalSocLogin();
        const img = modal.querySelector('#wtSocLoginFrame');

        const registrarCliqueRemoto = async event => {
            if (!wtSocLoginToken) return;

            event.preventDefault();
            event.stopPropagation();

            const rect = img.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const marcador = document.createElement('div');

            marcador.style.cssText = `
                position:fixed;
                left:${event.clientX - 7}px;
                top:${event.clientY - 7}px;
                width:14px;
                height:14px;
                border:2px solid #dc3545;
                border-radius:50%;
                z-index:1000001;
                pointer-events:none;
                background:rgba(255,255,255,.35);
            `;

            document.body.appendChild(marcador);

            setTimeout(() => marcador.remove(), 700);

            const status = document.getElementById('wtSocLoginStatus');

            if (status) {
                status.textContent = 'Enviando clique para o navegador remoto...';
                status.style.color = '#0d6efd';
            }

            try {
                await wtSocFetchJson('/api/soc/portal-remoto/login-interativo/click', {
                    method: 'POST',
                    body: JSON.stringify({
                        token: wtSocLoginToken,
                        x,
                        y,
                        displayWidth: rect.width,
                        displayHeight: rect.height
                    })
                });

                await wtAtualizarFrameSocLogin();
                await wtAtualizarStatusSocLogin();

            } catch (error) {
                console.error('Erro clique login SOC:', error);

                if (status) {
                    status.textContent = 'Erro ao enviar clique: ' + error.message;
                    status.style.color = '#dc3545';
                }
            }
        };

        img.addEventListener('pointerdown', registrarCliqueRemoto, { passive: false });

        img.addEventListener('dragstart', event => event.preventDefault());

        img.style.cursor = 'crosshair';
        img.style.pointerEvents = 'auto';

        img.onwheel = async event => {
            event.preventDefault();

            try {
                await wtSocFetchJson('/api/soc/portal-remoto/login-interativo/scroll', {
                    method: 'POST',
                    body: JSON.stringify({
                        token: wtSocLoginToken,
                        deltaX: event.deltaX,
                        deltaY: event.deltaY
                    })
                });
            } catch (_) {}
        };

        modal.querySelector('#wtSocLoginFechar').onclick = () => fecharLoginInterativoSoc();
        modal.querySelector('#wtSocLoginEsc').onclick = () => wtEnviarTeclaSoc('Escape');
        modal.querySelector('#wtSocLoginTab').onclick = () => wtEnviarTeclaSoc('Tab');
        modal.querySelector('#wtSocLoginEnter').onclick = () => wtEnviarTeclaSoc('Enter');

        modal.querySelector('#wtSocLoginEnviarTexto').onclick = async () => {
            const campo = modal.querySelector('#wtSocLoginTexto');
            const text = campo.value || '';

            if (!text) return;

            await wtSocFetchJson('/api/soc/portal-remoto/login-interativo/type', {
                method: 'POST',
                body: JSON.stringify({ token: wtSocLoginToken, text })
            });

            campo.value = '';
        };

        clearInterval(wtSocLoginTimerFrame);
        clearInterval(wtSocLoginTimerStatus);

        wtSocLoginTimerFrame = setInterval(wtAtualizarFrameSocLogin, 1200);
        wtSocLoginTimerStatus = setInterval(wtAtualizarStatusSocLogin, 900);

        await wtAtualizarFrameSocLogin();
        await wtAtualizarStatusSocLogin();

    } catch (error) {
        alert('Não foi possível abrir a autenticação interativa do SOC: ' + error.message);

    } finally {
        const botao = document.getElementById('btnConectarSocRemoto');

        if (botao) {
            botao.disabled = false;
            botao.innerHTML = '<i class="fas fa-user-shield me-1"></i> Conectar SOC';
        }
    }
}

async function fecharLoginInterativoSoc(encerrarServidor = true) {
    if (wtSocLoginFechando) return;

    wtSocLoginFechando = true;

    clearInterval(wtSocLoginTimerFrame);
    clearInterval(wtSocLoginTimerStatus);

    const token = wtSocLoginToken;
    wtSocLoginToken = null;

    if (encerrarServidor && token) {
        try {
            await wtSocFetchJson('/api/soc/portal-remoto/login-interativo/fechar', {
                method: 'POST',
                body: JSON.stringify({ token })
            });
        } catch (_) {}
    }

    const modal = document.getElementById('wtSocLoginInterativoModal');

    if (modal) modal.remove();

    wtSocLoginFechando = false;
}

window.abrirLoginInterativoSoc = abrirLoginInterativoSoc;
window.fecharLoginInterativoSoc = fecharLoginInterativoSoc;

(function instalar() {
    wtGarantirBotaoSocLogin();
})();
