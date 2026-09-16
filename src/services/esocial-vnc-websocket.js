'use strict';

const net = require('net');
const { WebSocketServer } = require('ws');

const {
    VNC_PORT,
    validarTokenNavegadorRemoto
} = require('./esocial-navegador-remoto');

function instalarVncWebSocket(server) {
    const wss =
        new WebSocketServer({
            noServer: true,
            perMessageDeflate: false
        });

    server.on(
        'upgrade',
        (request, socket, head) => {
            let parsed;

            try {
                parsed =
                    new URL(
                        request.url,
                        'http://localhost'
                    );
            } catch (_) {
                return;
            }

            if (
                parsed.pathname !==
                '/api/soc/relatorios-robo/navegador-remoto/ws'
            ) {
                return;
            }

            const token =
                parsed.searchParams.get(
                    'token'
                ) || '';

            if (
                !validarTokenNavegadorRemoto(
                    token
                )
            ) {
                try {
                    socket.write(
                        'HTTP/1.1 403 Forbidden\r\n' +
                        'Connection: close\r\n' +
                        '\r\n'
                    );
                } catch (_) {}

                socket.destroy();
                return;
            }

            wss.handleUpgrade(
                request,
                socket,
                head,
                ws => {
                    wss.emit(
                        'connection',
                        ws,
                        request
                    );
                }
            );
        }
    );

    wss.on(
        'connection',
        ws => {
            const tcp =
                net.createConnection({
                    host:
                        '127.0.0.1',
                    port:
                        VNC_PORT
                });

            let encerrado =
                false;

            const fecharTudo =
                () => {
                    if (encerrado) return;
                    encerrado = true;

                    try {
                        tcp.destroy();
                    } catch (_) {}

                    try {
                        if (
                            ws.readyState ===
                                ws.OPEN
                        ) {
                            ws.close();
                        }
                    } catch (_) {}
                };

            tcp.on(
                'connect',
                () => {
                    console.log(
                        '🖥️ [eSocial remoto] Cliente noVNC conectado.'
                    );
                }
            );

            tcp.on(
                'data',
                data => {
                    if (
                        ws.readyState ===
                        ws.OPEN
                    ) {
                        ws.send(
                            data,
                            {
                                binary: true
                            }
                        );
                    }
                }
            );

            tcp.on(
                'error',
                error => {
                    console.error(
                        '❌ [eSocial remoto] Erro VNC TCP:',
                        error.message
                    );

                    fecharTudo();
                }
            );

            tcp.on(
                'close',
                fecharTudo
            );

            ws.on(
                'message',
                data => {
                    if (
                        !tcp.destroyed
                    ) {
                        tcp.write(
                            Buffer.from(
                                data
                            )
                        );
                    }
                }
            );

            ws.on(
                'error',
                fecharTudo
            );

            ws.on(
                'close',
                fecharTudo
            );
        }
    );

    return wss;
}

module.exports = {
    instalarVncWebSocket
};
