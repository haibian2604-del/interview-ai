-- 真实面试模式：interviews 增加模式列；questions 的 (interview_id, idx) 唯一化
-- （渐进出题的并发兜底：重复生成同一题号时第二个 insert 以 23505 失败）
alter table public.interviews
  add column mode text not null default 'practice';
alter table public.interviews
  add constraint interviews_mode_check check (mode in ('practice', 'real'));
create unique index questions_interview_idx_key on public.questions (interview_id, idx);
