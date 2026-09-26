-- 二期语音输入：user_settings 增加 ASR（语音识别）配置列。
-- 密文列由 lib/settings/crypto.ts 的 AES-256-GCM 写入，语义同 llm_api_key_enc。
alter table public.user_settings
  add column asr_base_url text,
  add column asr_api_key_enc text,
  add column asr_model text;
