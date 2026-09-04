// src/routes/auth.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://uvilxelwpvrwjxxdougw.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2aWx4ZWx3cHZyd2p4eGRvdWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUxODksImV4cCI6MjA5ODA3MTE4OX0.6YXJYNUFBxL-KQbpZQvRbvKejSFMTpKk6qbxOF_tdlM';
const supabase = createClient(supabaseUrl, supabaseKey);

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        res.json({
            success: true,
            user: data.user,
            session: data.session
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(401).json({
            success: false,
            error: error.message || 'Credenciais inválidas'
        });
    }
});

// Registrar
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });
        
        if (error) throw error;
        
        res.json({
            success: true,
            user: data.user,
            message: 'Cadastro realizado com sucesso!'
        });
    } catch (error) {
        console.error('Erro no cadastro:', error);
        res.status(400).json({
            success: false,
            error: error.message || 'Erro ao cadastrar'
        });
    }
});

// Sessão atual
router.get('/session', async (req, res) => {
    try {
        const { data, error } = await supabase.auth.getSession();
        
        if (error) throw error;
        
        res.json({
            success: true,
            session: data.session,
            user: data.session?.user || null
        });
    } catch (error) {
        console.error('Erro ao buscar sessão:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao buscar sessão'
        });
    }
});

// Logout
router.post('/logout', async (req, res) => {
    try {
        const { error } = await supabase.auth.signOut();
        
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Logout realizado com sucesso'
        });
    } catch (error) {
        console.error('Erro no logout:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao fazer logout'
        });
    }
});

module.exports = router;