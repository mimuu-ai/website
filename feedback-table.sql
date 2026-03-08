-- Feedback Responses table for Mimuu
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/kyrybuwuxbvhzidxvlgd/sql/new

CREATE TABLE IF NOT EXISTS public.feedback_responses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  nome text,
  -- Bloco 1: Perfil de Uso
  frequencia text,
  usos text[],
  horario text,
  -- Bloco 2: Qualidade
  respostas_uteis int CHECK (respostas_uteis BETWEEN 1 AND 5),
  entende_bem int CHECK (entende_bem BETWEEN 1 AND 5),
  rapidez int CHECK (rapidez BETWEEN 1 AND 5),
  tom_agradavel int CHECK (tom_agradavel BETWEEN 1 AND 5),
  frequencia_erros text,
  -- Bloco 3: Experiencia
  mais_gostou text,
  melhorar text,
  falta_funcionalidade text,
  comparacao text,
  -- Bloco 4: Futuro
  recomendaria text,
  pagaria text,
  quanto_por_mes text,
  comentario_final text
);

-- Enable RLS
ALTER TABLE public.feedback_responses ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (the form submits without auth)
CREATE POLICY "Allow anonymous inserts" ON public.feedback_responses
  FOR INSERT TO anon WITH CHECK (true);

-- Only service role can read
CREATE POLICY "Service role reads all" ON public.feedback_responses
  FOR SELECT TO service_role USING (true);
