'use strict';

// ============================================================
// SERVER.JS - PONTO DE ENTRADA PRINCIPAL
// ============================================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const {
    createLogger,
    transports,
    format,
} = require('winston');

const path = require('path');
const fs = require('fs');

// ============================================================
// INICIALIZAR APP
// ============================================================

const app = express();
const PORT = Number(process.env.PORT) || 3002;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Quando estiver atrás de proxy, como Render, Railway ou Nginx,
// isso permite que o Express identifique corretamente o IP.
if (NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// ============================================================
// CONFIGURAÇÃO DE LOGS
// ============================================================

const logDir = path.join(__dirname, 'logs');

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, {
        recursive: true,
    });
}

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',

    format: format.combine(
        format.timestamp(),
        format.errors({
            stack: true,
        }),
        format.json()
    ),

    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss',
                }),
                format.printf(
                    ({
                        timestamp,
                        level,
                        message,
                        stack,
                    }) => {
                        return (
                            `${timestamp} ${level}: ` +
                            `${stack || message}`
                        );
                    }
                )
            ),
        }),

        new transports.File({
            filename: path.join(
                logDir,
                'esocial.log'
            ),
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
        }),

        new transports.File({
            filename: path.join(
                logDir,
                'error.log'
            ),
            level: 'error',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
        }),
    ],
});

// ============================================================
// SEGURANÇA
// ============================================================

app.disable('x-powered-by');

app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: {
            policy: 'cross-origin',
        },
    })
);

// ============================================================
// CORS
// ============================================================

const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',

    'http://localhost:3001',
    'http://127.0.0.1:3001',

    'http://localhost:3002',
    'http://127.0.0.1:3002',

    'http://localhost:5500',
    'http://127.0.0.1:5500',

    'http://localhost:5501',
    'http://127.0.0.1:5501',

    'http://localhost:5502',
    'http://127.0.0.1:5502',
];

// Permite adicionar outras origens pelo .env:
//
// CORS_ORIGINS=https://site1.com.br,https://site2.com.br

const extraOrigins = String(
    process.env.CORS_ORIGINS || ''
)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

allowedOrigins.push(...extraOrigins);

app.use(
    cors({
        origin(origin, callback) {
            // Requisições do próprio servidor, Postman e curl
            // podem não possuir cabeçalho Origin.
            if (!origin) {
                return callback(null, true);
            }

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            if (NODE_ENV !== 'production') {
                logger.warn(
                    `Origem não cadastrada, mas liberada ` +
                    `em desenvolvimento: ${origin}`
                );

                return callback(null, true);
            }

            logger.warn(
                `Origem bloqueada pelo CORS: ${origin}`
            );

            const error = new Error(
                'Origem não permitida pelo CORS.'
            );

            error.status = 403;

            return callback(error);
        },

        credentials: true,

        methods: [
            'GET',
            'POST',
            'PUT',
            'DELETE',
            'OPTIONS',
            'PATCH',
        ],

        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Requested-With',
            'Accept',
        ],
    })
);

// ============================================================
// RATE LIMIT
// ============================================================

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,

    standardHeaders: 'draft-7',
    legacyHeaders: false,

    message: {
        success: false,
        error:
            'Muitas requisições. Tente novamente mais tarde.',
    },
});

app.use('/api/', apiLimiter);

// ============================================================
// BODY PARSER
// ============================================================

app.use(
    express.json({
        limit: '50mb',
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: '50mb',
    })
);

// ============================================================
// LOG DAS REQUISIÇÕES
// ============================================================

app.use((req, res, next) => {
    const startedAt = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - startedAt;

        logger.info(
            `${req.method} ${req.originalUrl} ` +
            `${res.statusCode} - ${duration}ms - ${req.ip}`
        );
    });

    next();
});

// ============================================================
// HEALTH CHECK
// Colocado antes das outras rotas para teste rápido
// ============================================================

app.get('/health', (req, res) => {
    return res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        environment: NODE_ENV,
    });
});

// ============================================================
// ROTAS DA API
// ============================================================

// ------------------------------------------------------------
// AUTENTICAÇÃO
// ------------------------------------------------------------

const authRoutes = require(
    './src/routes/auth'
);

app.use(
    '/api/auth',
    authRoutes
);

// ------------------------------------------------------------
// E-SOCIAL
// ------------------------------------------------------------

const empresaRoutes = require(
    './src/routes/empresas'
);

const funcionarioRoutes = require(
    './src/routes/funcionarios'
);

const eventoRoutes = require(
    './src/routes/eventos'
);

const certificadoRoutes = require(
    './src/routes/certificados'
);

const filaRoutes = require(
    './src/routes/fila'
);

const dashboardRoutes = require(
    './src/routes/dashboard'
);

app.use(
    '/api/esocial/empresas',
    empresaRoutes
);

app.use(
    '/api/esocial/funcionarios',
    funcionarioRoutes
);

app.use(
    '/api/esocial/eventos',
    eventoRoutes
);

app.use(
    '/api/esocial/certificados',
    certificadoRoutes
);

app.use(
    '/api/esocial/fila',
    filaRoutes
);

app.use(
    '/api/esocial/dashboard',
    dashboardRoutes
);

// ------------------------------------------------------------
// INTEGRAÇÃO ANTIGA
// ------------------------------------------------------------

const integracaoRoutes = require(
    './src/routes/integracao'
);

app.use(
    '/api/esocial/integracao',
    integracaoRoutes
);

// ------------------------------------------------------------
// INTEGRAÇÃO SOC
// ------------------------------------------------------------

const socIntegrationRoutes = require(
    './src/routes/soc-integration'
);

app.use(
    '/api/soc',
    socIntegrationRoutes
);

// ============================================================
// ARQUIVOS ESTÁTICOS DO FRONTEND
// ============================================================

app.use(
    express.static(
        path.join(__dirname, '/')
    )
);

app.get('/', (req, res) => {
    return res.sendFile(
        path.join(
            __dirname,
            'index.html'
        )
    );
});

// ============================================================
// ROTA NÃO ENCONTRADA
// ============================================================

app.use((req, res) => {
    return res.status(404).json({
        success: false,
        error: 'Rota não encontrada.',
        method: req.method,
        path: req.originalUrl,
    });
});

// ============================================================
// TRATAMENTO GLOBAL DE ERROS
// ============================================================

app.use((err, req, res, next) => {
    logger.error('Erro global', {
        error: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
    });

    if (res.headersSent) {
        return next(err);
    }

    return res
        .status(err.status || 500)
        .json({
            success: false,

            error:
                err.message ||
                'Erro interno do servidor.',

            code:
                err.code ||
                'INTERNAL_ERROR',
        });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

const server = app.listen(PORT, () => {
    logger.info(
        `Servidor rodando na porta ${PORT}`
    );

    logger.info(
        `Ambiente: ${NODE_ENV}`
    );

    logger.info(
        `eSocial Ambiente: ` +
        `${
            process.env.ESOCIAL_AMBIENTE ||
            'homologacao'
        }`
    );

    console.log('');
    console.log(
        '✅ Servidor iniciado com sucesso!'
    );

    console.log(
        `📊 Dashboard: http://localhost:${PORT}`
    );

    console.log(
        `❤️ Health: http://localhost:${PORT}/health`
    );

    console.log(
        `🔌 SOC status: ` +
        `http://localhost:${PORT}` +
        `/api/soc/status-integracao`
    );

    console.log('');
    console.log('📋 Rotas de autenticação:');
    console.log('   POST /api/auth/login');
    console.log('   POST /api/auth/register');
    console.log('   GET  /api/auth/session');
    console.log('   POST /api/auth/logout');

    console.log('');
    console.log('📋 Rotas eSocial:');
    console.log('   GET  /api/esocial/empresas');
    console.log('   GET  /api/esocial/eventos');
    console.log('   GET  /api/esocial/eventos/stats');
    console.log('   POST /api/esocial/eventos');

    console.log('');
    console.log('📋 Rotas SOC:');
    console.log(
        '   GET  /api/soc/status-integracao'
    );

    console.log(
        '   POST /api/soc/exporta-dados'
    );

    console.log(
        '   POST /api/soc/buscar-dados-esocial'
    );

    console.log(
        '   GET  /api/soc/eventos-salvos'
    );

    console.log(
        '   GET  /api/soc/evento-xml/:id'
    );

    console.log(
        '   POST /api/soc/cancelar-evento/:id'
    );

    console.log('');
});

// ============================================================
// ENCERRAMENTO SEGURO
// ============================================================

function encerrarServidor(signal) {
    logger.info(
        `${signal} recebido. Encerrando servidor...`
    );

    server.close((error) => {
        if (error) {
            logger.error(
                'Erro ao encerrar servidor',
                {
                    error: error.message,
                    stack: error.stack,
                }
            );

            process.exit(1);
        }

        logger.info(
            'Servidor encerrado com sucesso.'
        );

        process.exit(0);
    });

    // Evita que o processo fique travado indefinidamente.
    setTimeout(() => {
        logger.error(
            'Encerramento forçado após 10 segundos.'
        );

        process.exit(1);
    }, 10000).unref();
}

process.on('SIGTERM', () => {
    encerrarServidor('SIGTERM');
});

process.on('SIGINT', () => {
    encerrarServidor('SIGINT');
});

// ============================================================
// ERROS NÃO CAPTURADOS
// ============================================================

process.on(
    'uncaughtException',
    (error) => {
        logger.error(
            'Exceção não capturada',
            {
                error: error.message,
                stack: error.stack,
            }
        );

        encerrarServidor(
            'uncaughtException'
        );
    }
);

process.on(
    'unhandledRejection',
    (reason) => {
        const error =
            reason instanceof Error
                ? reason
                : new Error(
                    String(reason)
                );

        logger.error(
            'Promise rejeitada não tratada',
            {
                error: error.message,
                stack: error.stack,
            }
        );
    }
);

module.exports = {
    app,
    server,
    logger,
};