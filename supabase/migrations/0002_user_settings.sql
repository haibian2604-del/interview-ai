create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  llm_base_url text,
  llm_api_key_enc text,
  llm_chat_model text,
  llm_eval_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
