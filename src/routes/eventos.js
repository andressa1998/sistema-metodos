// src/routes/eventos.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://uvilxelwpvrwjxxdougw.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2aWx4ZWx3cHZyd2p4eGRvdWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUxODksImV4cCI6MjA5ODA3MTE4OX0.6YXJYNUFBxL-KQbpZQvRbvKejSFMTpKk6qbxOF_tdlM';
const supabase = createClient(supabaseUrl, supabaseKey);

// Listar eventos
router.get('/', async (req, res) => {
    try {
        const { limit = 200, status, tipo_evento, empresa_id } = req.query;
        
        let query = supabase
            .from('esocial_eventos')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));
        
        if (status) query = query.eq('status', status);
        if (tipo_evento) query = query.eq('tipo_evento', tipo_evento);
        if (empresa_id) query = query.eq('codigo_empresa', empresa_id);
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        res.json({
            success: true,
            eventos: data || []
        });
    } catch (error) {
        console.error('Erro ao listar eventos:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao listar eventos'
        });
    }
});

// Criar evento
router.post('/', async (req, res) => {
    try {
        const evento = req.body;
        
        const { data, error } = await supabase
            .from('esocial_eventos')
            .insert([evento])
            .select();
        
        if (error) throw error;
        
        res.json({
            success: true,
            evento: data[0]
        });
    } catch (error) {
        console.error('Erro ao criar evento:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao criar evento'
        });
    }
});

// Enviar evento
router.post('/:id/enviar', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Simular envio
        const { data, error } = await supabase
            .from('esocial_eventos')
            .update({
                status: 'sucesso',
                numero_recibo: 'REC-' + Date.now(),
                data_envio: new Date().toISOString()
            })
            .eq('id', id)
            .select();
        
        if (error) throw error;
        
        res.json({
            success: true,
            evento: data[0]
        });
    } catch (error) {
        console.error('Erro ao enviar evento:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao enviar evento'
        });
    }
});

// Estatísticas
router.get('/stats', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('esocial_eventos')
            .select('status');
        
        if (error) throw error;
        
        const stats = {
            total: data.length,
            status: {}
        };
        
        data.forEach(item => {
            stats.status[item.status] = (stats.status[item.status] || 0) + 1;
        });
        
        res.json(stats);
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao buscar estatísticas'
        });
    }
});

module.exports = router;