-- 简历自定义名称：用户可命名档案（空 = 回落档案编号 No.xxx）
alter table public.resumes
  add column name text;
