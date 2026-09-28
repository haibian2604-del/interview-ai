-- LLM 端点预设：系统级全局数据（设置页 01 栏点选即填端点），用户只需再填模型名与密钥
create table public.llm_endpoint_presets (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  url text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.llm_endpoint_presets enable row level security;

create policy "authenticated read presets" on public.llm_endpoint_presets
  for select to authenticated using (true);

insert into public.llm_endpoint_presets (label, url, sort_order) values
  ('DeepSeek', 'https://api.deepseek.com', 10),
  ('GLM', 'https://open.bigmodel.cn/api/paas/v4/', 20),
  ('GLM Coding Plan', 'https://open.bigmodel.cn/api/v1', 30),
  ('Kimi', 'https://api.moonshot.cn', 40);
