'use strict';

console.log(
    'eSocial navegador remoto: V10_20260916'
);

let wtEsocialRemoteToken = null;
let wtEsocialRemoteRfb = null;
let wtEsocialRemoteTimer = null;
let wtEsocialRemoteModule = null;

async function wtRemoteFetchJson(
    url,
    options = {}
) {
    const response =
        await fetch(
            url,
            {
                cache: 'no-store',
                ...options,
                headers: {
                    'Content-Type':
                        'application/json',
                    ...(options.headers || {})
                }
            }
        );

    const text =
        await response.text();

    let data = {};

    try {
        data =
            text
                ? JSON.parse(text)
                : {};
    } catch (_) {
        throw new Error(
            `Resposta inválida do servidor (HTTP ${response.status}).`
        );
    }

    if (!response.ok) {
        throw new Error(
            data?.error ||
            `HTTP ${response.status}`
        );
    }

    return data;
}

function wtGarantirBotaoRemote() {
    if (
        document.getElementById(
            'btnConectarEsocialRemoto'
        )
    ) {
        return true;
    }

    const antigo =
        document.getElementById(
            'btnConectarEsocialInterativo'
        );

    if (antigo) {
        antigo.style.display =
            'none';
    }

    const diagnostico =
        document.getElementById(
            'btnDiagnosticarRoboEsocial'
        );

    if (
        !diagnostico ||
        !diagnostico.parentElement
    ) {
        return false;
    }

    const botao =
        document.createElement(
            'button'
        );

    botao.type =
        'button';

    botao.id =
        'btnConectarEsocialRemoto';

    botao.className =
        'btn btn-primary btn-sm';

    botao.innerHTML =
        '<i class="fas fa-desktop me-1"></i> Conectar eSocial';

    botao.onclick =
        event => {
            event.preventDefault();
            abrirNavegadorRemotoEsocial();
        };

    diagnostico.parentElement.insertBefore(
        botao,
        diagnostico
    );

    return true;
}

function wtCriarModalRemote() {
    let modal =
        document.getElementById(
            'wtEsocialRemoteModal'
        );

    if (modal) return modal;

    modal =
        document.createElement(
            'div'
        );

    modal.id =
        'wtEsocialRemoteModal';

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
                Navegador remoto do eSocial
            </strong>

            <span id="wtEsocialRemoteStatus"
                  style="font-size:13px;color:#555;">
                Abrindo navegador...
            </span>

            <div style="flex:1;"></div>

            <button type="button"
                    id="wtEsocialRemoteSalvar"
                    class="btn btn-success btn-sm"
                    disabled>
                Salvar sessão e continuar
            </button>

            <button type="button"
                    id="wtEsocialRemoteCancelar"
                    class="btn btn-outline-danger btn-sm">
                Fechar
            </button>
        </div>

        <div style="
            background:#f8f9fa;
            border-bottom:1px solid #ddd;
            padding:6px 12px;
            font-size:13px;
        ">
            Este é o Chrome que está rodando no servidor.
            Clique e digite normalmente dentro da tela.
            Faça o login no gov.br e selecione o certificado quando ele aparecer.
        </div>

        <div id="wtEsocialRemoteScreen"
             tabindex="0"
             style="
                flex:1;
                min-height:0;
                background:#222;
                overflow:hidden;
                position:relative;
             ">
        </div>
    `;

    document.body.appendChild(
        modal
    );

    return modal;
}

async function wtCarregarRfb() {
    if (wtEsocialRemoteModule) {
        return wtEsocialRemoteModule;
    }

    wtEsocialRemoteModule =
        await import(
            '/esocial-novnc/core/rfb.js'
        );

    return wtEsocialRemoteModule;
}

async function wtAtualizarStatusRemote() {
    if (!wtEsocialRemoteToken) {
        return;
    }

    try {
        const data =
            await wtRemoteFetchJson(
                '/api/soc/relatorios-robo/navegador-remoto/status' +
                '?token=' +
                encodeURIComponent(
                    wtEsocialRemoteToken
                )
            );

        const status =
            document.getElementById(
                'wtEsocialRemoteStatus'
            );

        const salvar =
            document.getElementById(
                'wtEsocialRemoteSalvar'
            );

        if (data.autenticada) {
            if (status) {
                status.textContent =
                    'eSocial autenticado. Clique em "Salvar sessão e continuar".';

                status.style.color =
                    '#198754';
            }

            if (salvar) {
                salvar.disabled =
                    false;
            }

        } else {
            if (status) {
                const titulo =
                    data?.pagina?.titulo ||
                    'Aguardando autenticação';

                status.textContent =
                    titulo;

                status.style.color =
                    '#555';
            }

            if (salvar) {
                salvar.disabled =
                    true;
            }
        }

    } catch (error) {
        const status =
            document.getElementById(
                'wtEsocialRemoteStatus'
            );

        if (status) {
            status.textContent =
                error.message;

            status.style.color =
                '#dc3545';
        }
    }
}

async function wtFinalizarRemote() {
    if (!wtEsocialRemoteToken) {
        return;
    }

    const salvar =
        document.getElementById(
            'wtEsocialRemoteSalvar'
        );

    const status =
        document.getElementById(
            'wtEsocialRemoteStatus'
        );

    try {
        if (salvar) {
            salvar.disabled = true;
        }

        if (status) {
            status.textContent =
                'Salvando sessão do eSocial...';

            status.style.color =
                '#0d6efd';
        }

        await wtRemoteFetchJson(
            '/api/soc/relatorios-robo/navegador-remoto/finalizar',
            {
                method: 'POST',
                body:
                    JSON.stringify({
                        token:
                            wtEsocialRemoteToken
                    })
            }
        );

        if (status) {
            status.textContent =
                'Sessão salva. O robô já pode usar o eSocial.';

            status.style.color =
                '#198754';
        }

        setTimeout(
            () => {
                wtFecharModalRemote(
                    false
                );
            },
            900
        );

    } catch (error) {
        if (status) {
            status.textContent =
                error.message;

            status.style.color =
                '#dc3545';
        }

        if (salvar) {
            salvar.disabled = false;
        }
    }
}

async function wtFecharModalRemote(
    cancelarServidor = true
) {
    clearInterval(
        wtEsocialRemoteTimer
    );

    wtEsocialRemoteTimer = null;

    if (wtEsocialRemoteRfb) {
        try {
            wtEsocialRemoteRfb.disconnect();
        } catch (_) {}

        wtEsocialRemoteRfb = null;
    }

    const token =
        wtEsocialRemoteToken;

    wtEsocialRemoteToken = null;

    if (
        cancelarServidor &&
        token
    ) {
        try {
            await wtRemoteFetchJson(
                '/api/soc/relatorios-robo/navegador-remoto/cancelar',
                {
                    method: 'POST',
                    body:
                        JSON.stringify({
                            token
                        })
                }
            );
        } catch (_) {}
    }

    document
        .getElementById(
            'wtEsocialRemoteModal'
        )
        ?.remove();
}

async function abrirNavegadorRemotoEsocial() {
    const botao =
        document.getElementById(
            'btnConectarEsocialRemoto'
        );

    try {
        if (botao) {
            botao.disabled = true;
            botao.innerHTML =
                '<span class="spinner-border spinner-border-sm me-1"></span> Abrindo...';
        }

        const data =
            await wtRemoteFetchJson(
                '/api/soc/relatorios-robo/navegador-remoto/iniciar',
                {
                    method: 'POST',
                    body: '{}'
                }
            );

        wtEsocialRemoteToken =
            data.token;

        const modal =
            wtCriarModalRemote();

        const screen =
            modal.querySelector(
                '#wtEsocialRemoteScreen'
            );

        const status =
            modal.querySelector(
                '#wtEsocialRemoteStatus'
            );

        const {
            default: RFB
        } = await wtCarregarRfb();

        const protocolo =
            location.protocol ===
                'https:'
                ? 'wss:'
                : 'ws:';

        const wsUrl =
            protocolo +
            '//' +
            location.host +
            '/api/soc/relatorios-robo/navegador-remoto/ws' +
            '?token=' +
            encodeURIComponent(
                wtEsocialRemoteToken
            );

        wtEsocialRemoteRfb =
            new RFB(
                screen,
                wsUrl,
                {
                    shared: true
                }
            );

        wtEsocialRemoteRfb.scaleViewport =
            true;

        wtEsocialRemoteRfb.resizeSession =
            false;

        wtEsocialRemoteRfb.viewOnly =
            false;

        wtEsocialRemoteRfb.focusOnClick =
            true;

        wtEsocialRemoteRfb.addEventListener(
            'connect',
            () => {
                if (status) {
                    status.textContent =
                        'Navegador conectado. Faça o login normalmente.';

                    status.style.color =
                        '#198754';
                }

                try {
                    screen.focus();
                } catch (_) {}
            }
        );

        wtEsocialRemoteRfb.addEventListener(
            'disconnect',
            event => {
                if (
                    event?.detail?.clean
                ) {
                    return;
                }

                if (status) {
                    status.textContent =
                        'A conexão com o navegador remoto foi encerrada.';

                    status.style.color =
                        '#dc3545';
                }
            }
        );

        modal.querySelector(
            '#wtEsocialRemoteSalvar'
        ).onclick =
            wtFinalizarRemote;

        modal.querySelector(
            '#wtEsocialRemoteCancelar'
        ).onclick =
            () =>
                wtFecharModalRemote(
                    true
                );

        clearInterval(
            wtEsocialRemoteTimer
        );

        wtEsocialRemoteTimer =
            setInterval(
                wtAtualizarStatusRemote,
                1200
            );

        await wtAtualizarStatusRemote();

    } catch (error) {
        alert(
            'Não foi possível abrir o navegador remoto do eSocial: ' +
            error.message
        );

    } finally {
        if (botao) {
            botao.disabled = false;
            botao.innerHTML =
                '<i class="fas fa-desktop me-1"></i> Conectar eSocial';
        }
    }
}

window.abrirNavegadorRemotoEsocial =
    abrirNavegadorRemotoEsocial;

(function instalar() {
    if (!wtGarantirBotaoRemote()) {
        setTimeout(
            instalar,
            900
        );
    }
})();
