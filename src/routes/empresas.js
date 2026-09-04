// src/routes/empresas.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://uvilxelwpvrwjxxdougw.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2aWx4ZWx3cHZyd2p4eGRvdWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUxODksImV4cCI6MjA5ODA3MTE4OX0.6YXJYNUFBxL-KQbpZQvRbvKejSFMTpKk6qbxOF_tdlM';
const supabase = createClient(supabaseUrl, supabaseKey);

// Listar empresas
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('precos')
            .select('*')
            .order('unidade', { ascending: true });
        
        if (error) throw error;
        
        res.json({
            success: true,
            empresas: data || []
        });
    } catch (error) {
        console.error('Erro ao listar empresas:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao listar empresas'
        });
    }
});

module.exports = router;