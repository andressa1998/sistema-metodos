// ============================================================
// SERVER.JS - PONTO DE ENTRADA PRINCIPAL
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createLogger, transports, format } = require('winston');
const path = require('path');
const fs = require('fs');

// Importar rotas
const authRoutes = require('./src/routes/auth');
const empresaRoutes = require('./src/routes/empresas');
const funcionarioRoutes = require('./src/routes/funcionarios');
const eventoRoutes = require('./src/routes/eventos');
const certificadoRoutes = require('./src/routes/certificados');
const permissaoRoutes = require('./src/routes/permissoes');
const filaRoutes = require('./src/routes/fila');
const dashboardRoutes = require('./src/routes/dashboard');
const integracaoRoutes = require('./src/routes/integracao');

// Inicializar app
const app = express();
const PORT = process.env.PORT || 3002;

// ============================================================
// CONFIGURAÇÃO DE LOGS
// ============================================================

const logDir = 'logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.json()
    ),
    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.simple()
            )
        }),
        new transports.File({
            filename: path.join(logDir, 'esocial.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5,
        }),
        new transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 10485760,
            maxFiles: 5,
        })
    ]
});

// ============================================================
// MIDDLEWARES
// ============================================================

app.use(helmet({
    contentSecurityPolicy: false,
}));

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 requisições por IP
    message: 'Muitas requisições, tente novamente mais tarde.'
});
app.use('/api/', limiter);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware de log
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url} - ${req.ip}`);
    next();
});

// ============================================================
// ROTAS
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/esocial/empresas', empresaRoutes);
app.use('/api/esocial/funcionarios', funcionarioRoutes);
app.use('/api/esocial/eventos', eventoRoutes);
app.use('/api/esocial/certificados', certificadoRoutes);
app.use('/api/esocial/permissoes', permissaoRoutes);
app.use('/api/esocial/fila', filaRoutes);
app.use('/api/esocial/dashboard', dashboardRoutes);
app.use('/api/esocial/integracao', integracaoRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ============================================================
// TRATAMENTO DE ERROS GLOBAL
// ============================================================

app.use((err, req, res, next) => {
    logger.error('Erro global:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip
    });

    res.status(err.status || 500).json({
        error: err.message || 'Erro interno do servidor',
        code: err.code || 'INTERNAL_ERROR'
    });
});

// ============================================================
// INICIAR SERVIDOR E PROCESSADOR
// ============================================================

const { iniciarProcessador } = require('./src/modules/processador');

app.listen(PORT, async () => {
    logger.info(`🚀 Servidor e-Social rodando na porta ${PORT}`);
    logger.info(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`🔐 e-Social Ambiente: ${process.env.ESOCIAL_AMBIENTE || 'homologacao'}`);
    
    try {
        await iniciarProcessador();
        logger.info('✅ Processador e-Social iniciado com sucesso');
    } catch (error) {
        logger.error('❌ Erro ao iniciar processador:', error);
    }
});

// ============================================================
// TRATAMENTO DE SINAL DE ENCERRAMENTO
// ============================================================

process.on('SIGTERM', () => {
    logger.info('SIGTERM recebido, encerrando...');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT recebido, encerrando...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    logger.error('Exceção não capturada:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Promise rejeitada não tratada:', reason);
});

module.exports = { app, logger };