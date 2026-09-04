// src/config/supabase.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórios!');
    process.exit(1);
}

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

module.exports = supabaseClient;