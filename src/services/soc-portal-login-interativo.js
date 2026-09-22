'use strict';

console.log(
    'SOC login interativo: V9_20260916'
);

let wtSocPortalLoginToken = null;
let wtSocPortalLoginTimerFrame = null;
let wtSocPortalLoginTimerStatus = null;
let wtSocPortalLoginFechando = false;

async function wtSocPortalFetchJson(
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

    const texto =
        await response.text();

    let data = null;

    try {
        data =
            texto
                ? JSON.parse(texto)
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

function wtGarantirBotaoLoginInterativo() {
    if (
        document.getElementById(
            'btnConectarSocPortal'
        )
    ) {
        return true;
    }

    const diagnostico =
        document.getElementById(
            'btnBuscarDadosSoc'
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
        'btnConectarSocPortal';

    botao.className =
        'btn btn-primary btn-sm';

    botao.title =
        'Abrir login manual no portal do SOC.';

    botao.innerHTML =
        '<i class="fas fa-user-shield me-1"></i> Conectar SOC';

    botao.onclick =
        event => {
            event.preventDefault();

            abrirLoginInterativoSocPortal();
        };

    diagnostico.parentElement.insertBefore(
        botao,
        diagnostico
    );

    return true;
}

function wtCriarModalLoginInterativo() {
    let modal =
        document.getElementById(
            'wtSocPortalLoginInterativoModal'
        );

    if (modal) {
        return modal;
    }

    modal =
        document.createElement('div');

    modal.id =
        'wtSocPortalLoginInterativoModal';

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

                <span id="wtSocPortalLoginStatus"
                      style="font-size:13px;color:#555;">
                    Iniciando...
                </span>

                <div style="flex:1;"></div>

                <button type="button"
                        id="wtSocPortalLoginEsc"
                        class="btn btn-outline-secondary btn-sm">
                    Esc
                </button>

                <button type="button"
                        id="wtSocPortalLoginTab"
                        class="btn btn-outline-secondary btn-sm">
                    Tab
                </button>

                <button type="button"
                        id="wtSocPortalLoginEnter"
                        class="btn btn-outline-secondary btn-sm">
                    Enter
                </button>

                <button type="button"
                        id="wtSocPortalLoginFechar"
                        class="btn btn-outline-danger btn-sm">
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
                       id="wtSocPortalLoginTexto"
                       class="form-control form-control-sm"
                       placeholder="Se precisar digitar: clique no campo da tela abaixo, digite aqui e clique Enviar.">

                <button type="button"
                        id="wtSocPortalLoginEnviarTexto"
                        class="btn btn-outline-primary btn-sm">
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
                <img id="wtSocPortalLoginFrame"
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

    document.body.appendChild(
        modal
    );

    return modal;
}

async function wtEnviarTecla(key) {
    if (!wtSocPortalLoginToken) return;

    await wtSocPortalFetchJson(
        '/api/soc/portal-remoto/login-interativo/key',
        {
            method: 'POST',
            body: JSON.stringify({
                token:
                    wtSocPortalLoginToken,
                key
            })
        }
    );
}

async function wtAtualizarFrameLogin() {
    if (
        !wtSocPortalLoginToken ||
        wtSocPortalLoginFechando
    ) {
        return;
    }

    const img =
        document.getElementById(
            'wtSocPortalLoginFrame'
        );

    if (!img) return;

    img.src =
        '/api/soc/portal-remoto/login-interativo/frame' +
        '?token=' +
        encodeURIComponent(
            wtSocPortalLoginToken
        ) +
        '&t=' +
        Date.now();
}

async function wtAtualizarStatusLogin() {
    if (
        !wtSocPortalLoginToken ||
        wtSocPortalLoginFechando
    ) {
        return;
    }

    try {
        const data =
            await wtSocPortalFetchJson(
                '/api/soc/portal-remoto/login-interativo/status' +
                '?token=' +
                encodeURIComponent(
                    wtSocPortalLoginToken
                )
            );

        const status =
            document.getElementById(
                'wtSocPortalLoginStatus'
            );

        if (status) {
            if (data.autenticada) {
                status.textContent =
                    'Autenticado com sucesso. A sessão já pode ser usada pelo robô.';

                status.style.color =
                    '#198754';

            } else if (
                data.processandoCertificado
            ) {
                status.textContent =
                    'Validando certificado...';

                status.style.color =
                    '#0d6efd';

            } else if (
                data.ultimoErro
            ) {
                status.textContent =
                    data.ultimoErro;

                status.style.color =
                    '#dc3545';

            } else {
                status.textContent =
                    'Faça a login manual no SOC dentro da tela abaixo.';

                status.style.color =
                    '#555';
            }
        }

        if (data.autenticada) {
            setTimeout(
                () =>
                    fecharLoginInterativoSocPortal(
                        false
                    ),
                1400
            );
        }

    } catch (error) {
        const status =
            document.getElementById(
                'wtSocPortalLoginStatus'
            );

        if (status) {
            status.textContent =
                error.message;

            status.style.color =
                '#dc3545';
        }
    }
}

async function abrirLoginInterativoSocPortal() {
    try {
        const botao =
            document.getElementById(
                'btnConectarSocPortal'
            );

        if (botao) {
            botao.disabled = true;
            botao.innerHTML =
                '<span class="spinner-border spinner-border-sm me-1"></span> Abrindo...';
        }

        const data =
            await wtSocPortalFetchJson(
                '/api/soc/portal-remoto/login-interativo/iniciar',
                {
                    method: 'POST',
                    body: '{}'
                }
            );

        wtSocPortalLoginToken = data.token;
        wtSocPortalLoginFechando = false;

        const modal =
            wtCriarModalLoginInterativo();

        const img =
            modal.querySelector(
                '#wtSocPortalLoginFrame'
            );

        const registrarCliqueRemoto =
            async event => {
                if (!wtSocPortalLoginToken) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();

                const rect =
                    img.getBoundingClientRect();

                const x =
                    event.clientX -
                    rect.left;

                const y =
                    event.clientY -
                    rect.top;

                // Marcador visual para confirmar que o clique foi capturado.
                const marcador =
                    document.createElement('div');

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

                document.body.appendChild(
                    marcador
                );

                setTimeout(
                    () => marcador.remove(),
                    700
                );

                const status =
                    document.getElementById(
                        'wtSocPortalLoginStatus'
                    );

                if (status) {
                    status.textContent =
                        'Enviando clique para o navegador remoto...';

                    status.style.color =
                        '#0d6efd';
                }

                try {
                    const retorno =
                        await wtSocPortalFetchJson(
                            '/api/soc/portal-remoto/login-interativo/click',
                            {
                                method: 'POST',
                                body:
                                    JSON.stringify({
                                        token:
                                            wtSocPortalLoginToken,
                                        x,
                                        y,
                                        displayWidth:
                                            rect.width,
                                        displayHeight:
                                            rect.height
                                    })
                            }
                        );

                    console.log(
                        '[SOC interativo] Clique remoto enviado:',
                        {
                            x,
                            y,
                            displayWidth:
                                rect.width,
                            displayHeight:
                                rect.height,
                            etapa:
                                retorno?.etapa || null
                        }
                    );

                    await wtAtualizarFrameLogin();
                    await wtAtualizarStatusLogin();

                } catch (error) {
                    console.error(
                        'Erro clique login SOC:',
                        error
                    );

                    if (status) {
                        status.textContent =
                            'Erro ao enviar clique: ' +
                            error.message;

                        status.style.color =
                            '#dc3545';
                    }
                }
            };

        // pointerdown é mais confiável que onclick para a imagem
        // que recebe atualizações frequentes de src.
        img.addEventListener(
            'pointerdown',
            registrarCliqueRemoto,
            {
                passive: false
            }
        );

        img.addEventListener(
            'dragstart',
            event => {
                event.preventDefault();
            }
        );

        img.style.cursor =
            'crosshair';

        img.style.pointerEvents =
            'auto';

        img.onwheel =
            async event => {
                event.preventDefault();

                try {
                    await wtSocPortalFetchJson(
                        '/api/soc/portal-remoto/login-interativo/scroll',
                        {
                            method: 'POST',
                            body:
                                JSON.stringify({
                                    token:
                                        wtSocPortalLoginToken,
                                    deltaX:
                                        event.deltaX,
                                    deltaY:
                                        event.deltaY
                                })
                        }
                    );
                } catch (_) {}
            };

        modal.querySelector(
            '#wtSocPortalLoginFechar'
        ).onclick =
            () =>
                fecharLoginInterativoSocPortal();

        modal.querySelector(
            '#wtSocPortalLoginEsc'
        ).onclick =
            () =>
                wtEnviarTecla('Escape');

        modal.querySelector(
            '#wtSocPortalLoginTab'
        ).onclick =
            () =>
                wtEnviarTecla('Tab');

        modal.querySelector(
            '#wtSocPortalLoginEnter'
        ).onclick =
            () =>
                wtEnviarTecla('Enter');

        modal.querySelector(
            '#wtSocPortalLoginEnviarTexto'
        ).onclick =
            async () => {
                const campo =
                    modal.querySelector(
                        '#wtSocPortalLoginTexto'
                    );

                const text =
                    campo.value || '';

                if (!text) return;

                await wtSocPortalFetchJson(
                    '/api/soc/portal-remoto/login-interativo/type',
                    {
                        method: 'POST',
                        body:
                            JSON.stringify({
                                token:
                                    wtSocPortalLoginToken,
                                text
                            })
                    }
                );

                campo.value = '';
            };

        clearInterval(
            wtSocPortalLoginTimerFrame
        );

        clearInterval(
            wtSocPortalLoginTimerStatus
        );

        wtSocPortalLoginTimerFrame =
            setInterval(
                wtAtualizarFrameLogin,
                1200
            );

        wtSocPortalLoginTimerStatus =
            setInterval(
                wtAtualizarStatusLogin,
                900
            );

        await wtAtualizarFrameLogin();
        await wtAtualizarStatusLogin();

    } catch (error) {
        alert(
            'Não foi possível abrir a conexão interativa com o SOC: ' +
            error.message
        );

    } finally {
        const botao =
            document.getElementById(
                'btnConectarSocPortal'
            );

        if (botao) {
            botao.disabled = false;
            botao.innerHTML =
                '<i class="fas fa-user-shield me-1"></i> Conectar SOC';
        }
    }
}

async function fecharLoginInterativoSocPortal(
    encerrarServidor = true
) {
    if (wtSocPortalLoginFechando) {
        return;
    }

    wtSocPortalLoginFechando = true;

    clearInterval(
        wtSocPortalLoginTimerFrame
    );

    clearInterval(
        wtSocPortalLoginTimerStatus
    );

    const token =
        wtSocPortalLoginToken;

    wtSocPortalLoginToken = null;

    if (
        encerrarServidor &&
        token
    ) {
        try {
            await wtSocPortalFetchJson(
                '/api/soc/portal-remoto/login-interativo/fechar',
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

    const modal =
        document.getElementById(
            'wtSocPortalLoginInterativoModal'
        );

    if (modal) {
        modal.remove();
    }

    wtSocPortalLoginFechando = false;
}

window.abrirLoginInterativoSocPortal =
    abrirLoginInterativoSocPortal;

window.fecharLoginInterativoSocPortal =
    fecharLoginInterativoSocPortal;

(function instalar() {
    if (!wtGarantirBotaoLoginInterativo()) {
        setTimeout(
            instalar,
            900
        );
    }
})();
