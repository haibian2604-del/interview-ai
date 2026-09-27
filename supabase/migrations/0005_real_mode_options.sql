-- 真实面试模式选项化：题数（10/15/20）与难度（easy/medium/hard）由用户在创建时选择。
-- practice 模式不消费这两列（保持默认值）。
alter table public.interviews
  add column target_questions int not null default 10;
alter table public.interviews
  add constraint interviews_target_questions_check
  check (target_questions in (10, 15, 20));
alter table public.interviews
  add column difficulty text not null default 'medium';
alter table public.interviews
  add constraint interviews_difficulty_check
  check (difficulty in ('easy', 'medium', 'hard'));
