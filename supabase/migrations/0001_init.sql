-- profiles：扩展 auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text,
  raw_text text not null,
  structured_json jsonb,
  created_at timestamptz not null default now()
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resume_id uuid not null references public.resumes(id) on delete cascade,
  position text not null,
  jd_text text,
  interview_type text not null check (interview_type in ('skill','project','behavioral','mixed')),
  question_count int not null default 6,
  status text not null default 'draft' check (status in ('draft','generating','ready','in_progress','completed','abandoned')),
  current_question_index int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  idx int not null,
  content text not null,
  type text not null check (type in ('skill','project','behavioral')),
  skill_tag text not null,
  followup_anchor text not null,
  created_at timestamptz not null default now(),
  unique (interview_id, idx)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  role text not null check (role in ('interviewer','candidate','followup')),
  content text not null,
  created_at timestamptz not null default now()
);

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null unique references public.questions(id) on delete cascade,
  scores jsonb not null,
  star_completeness numeric not null,
  strengths text not null,
  improvements text not null,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null unique references public.interviews(id) on delete cascade,
  overall_score numeric not null,
  dimension_scores jsonb not null,
  summary_md text not null,
  strengths_md text not null,
  improvements_md text not null,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.interviews enable row level security;
alter table public.questions enable row level security;
alter table public.messages enable row level security;
alter table public.evaluations enable row level security;
alter table public.reports enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own resumes" on public.resumes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own interviews" on public.interviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own questions" on public.questions
  for all using (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()));
create policy "own messages" on public.messages
  for all using (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()));
create policy "own evaluations" on public.evaluations
  for all using (exists (select 1 from public.questions q join public.interviews i on i.id = q.interview_id where q.id = question_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.questions q join public.interviews i on i.id = q.interview_id where q.id = question_id and i.user_id = auth.uid()));
create policy "own reports" on public.reports
  for all using (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()));

-- 新用户自动建 profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Storage：简历 PDF 桶 + 策略（路径约定 ${user_id}/${uuid}.pdf）
insert into storage.buckets (id, name, public) values ('resumes', 'resumes', false)
on conflict (id) do nothing;
create policy "own resume files" on storage.objects
  for all using (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);
