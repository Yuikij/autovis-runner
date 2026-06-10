import { DatabaseSync } from "node:sqlite"

// This file defines the current schema snapshot for new databases only.
// Incremental schema changes must be added in db/migrations.ts.
export const createBaseSchema = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      test_base_url TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      items_json TEXT NOT NULL DEFAULT '[]',
      execution_mode TEXT,
      last_run_id TEXT,
      last_status TEXT,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS test_cases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      case_code TEXT NOT NULL,
      module_name TEXT,
      module_id TEXT,
      purpose TEXT NOT NULL,
      dependency_case_ids TEXT NOT NULL DEFAULT '[]',
      auth_profile_id TEXT,
      steps TEXT NOT NULL,
      expected_result TEXT NOT NULL,
      test_type TEXT NOT NULL,
      bug_id TEXT,
      note TEXT,
      ai_script TEXT,
      target_url_id TEXT,
      latest_script_id TEXT,
      last_verified_run_id TEXT,
      last_verified_status TEXT,
      last_verified_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      test_case_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      source TEXT NOT NULL,
      provider TEXT NOT NULL,
      prompt TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(test_case_id) REFERENCES test_cases(id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      script_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'execution',
      task_run_id TEXT,
      batch_order INTEGER,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      current_viewport TEXT NOT NULL,
      live_viewport TEXT,
      pending_human_handoff TEXT,
      orchestration_phase TEXT,
      current_precondition_case_id TEXT,
      completed_precondition_case_ids TEXT,
      precondition_summary TEXT,
      runtime_outputs TEXT,
      logs TEXT NOT NULL,
      steps TEXT NOT NULL,
      artifacts TEXT NOT NULL,
      test_base_url TEXT NOT NULL,
      target_url_id TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      test_base_url TEXT NOT NULL,
      target_url_id TEXT,
      total_count INTEGER NOT NULL,
      queued_count INTEGER NOT NULL,
      running_count INTEGER NOT NULL,
      passed_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      skipped_count INTEGER NOT NULL,
      run_ids TEXT NOT NULL,
      current_run_id TEXT,
      current_agent_id TEXT,
      last_agent_id TEXT,
      logs TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      schedule_trigger_id TEXT,
      attempt_no INTEGER,
      parent_task_run_id TEXT,
      effective_task_mode TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS llm_session (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      provider TEXT NOT NULL,
      proxy_endpoint TEXT NOT NULL,
      model TEXT NOT NULL,
      signed_in INTEGER NOT NULL,
      connection_status TEXT NOT NULL,
      base_url TEXT NOT NULL,
      login_mode TEXT NOT NULL,
      last_synced_at TEXT,
      last_error TEXT,
      pending_device_auth TEXT,
      feature_flags TEXT NOT NULL,
      copilot_secrets TEXT NOT NULL,
      configs_json TEXT,
      llm_secrets_json TEXT,
      active_config_id TEXT
    );

    CREATE TABLE IF NOT EXISTS llm_states (
      owner_key TEXT PRIMARY KEY,
      configs_json TEXT NOT NULL,
      llm_secrets_json TEXT,
      active_config_id TEXT,
      active_vision_config_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS project_workspaces (
      project_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      managed_root TEXT NOT NULL,
      git_repo_url TEXT NOT NULL DEFAULT '',
      local_source_path TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      ref TEXT NOT NULL DEFAULT '',
      last_commit_sha TEXT,
      git_auth_profile_id TEXT,
      status TEXT NOT NULL DEFAULT 'missing',
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS git_auth_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      host_pattern TEXT NOT NULL,
      username TEXT,
      secret TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      result_script_id TEXT,
      latest_script_id TEXT,
      latest_run_id TEXT,
      warmup_run_id TEXT,
      task_run_id TEXT,
      precondition_summary TEXT,
      final_summary TEXT,
      direct_result TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(test_case_id) REFERENCES test_cases(id)
    );

    CREATE TABLE IF NOT EXISTS agent_steps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      stage TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      detail TEXT,
      status TEXT NOT NULL,
      tool_name TEXT,
      timestamp TEXT NOT NULL,
      payload_json TEXT,
      screenshot_url TEXT,
      url TEXT,
      file_name TEXT,
      selector TEXT,
      run_id TEXT,
      script_id TEXT,
      position INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recorder_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      test_base_url TEXT NOT NULL,
      current_viewport TEXT NOT NULL,
      current_url TEXT,
      page_title TEXT,
      actions TEXT NOT NULL,
      artifacts TEXT NOT NULL,
      generated_script_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT,
      FOREIGN KEY(test_case_id) REFERENCES test_cases(id)
    );

    CREATE TABLE IF NOT EXISTS auth_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      source_case_id TEXT NOT NULL,
      validation_script_id TEXT,
      validation_script TEXT,
      validation_script_generated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(source_case_id) REFERENCES test_cases(id)
    );

    CREATE TABLE IF NOT EXISTS target_urls (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_profile_states (
      auth_profile_id TEXT NOT NULL,
      target_url_id TEXT NOT NULL,
      storage_state_json TEXT,
      last_refreshed_at TEXT,
      post_login_url_auto TEXT,
      post_login_url_override TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(auth_profile_id, target_url_id),
      FOREIGN KEY(auth_profile_id) REFERENCES auth_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY(target_url_id) REFERENCES target_urls(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS schedule_triggers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      at_time TEXT,
      cron_expr TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_fired_at TEXT,
      next_fire_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS validation_tasks (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_url_id TEXT,
      status TEXT NOT NULL,
      steps_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      check_result_json TEXT,
      result_profile_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(profile_id) REFERENCES auth_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_control_commands (
      id TEXT PRIMARY KEY,
      task_kind TEXT NOT NULL,
      task_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS task_leases (
      task_kind TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      recovery_policy TEXT NOT NULL,
      lease_owner TEXT,
      lease_acquired_at TEXT,
      lease_heartbeat_at TEXT,
      lease_expires_at TEXT,
      checkpoint_json TEXT,
      request_json TEXT,
      recovery_attempts INTEGER NOT NULL DEFAULT 0,
      last_recovery_started_at TEXT,
      last_recovered_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(task_kind, task_id)
    );

  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_test_cases_project_id ON test_cases(project_id);
    CREATE INDEX IF NOT EXISTS idx_test_cases_module_id ON test_cases(module_id);
    CREATE INDEX IF NOT EXISTS idx_scripts_test_case_id ON scripts(test_case_id);
    CREATE INDEX IF NOT EXISTS idx_runs_project_id ON runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_task_run_id ON runs(task_run_id);
    CREATE INDEX IF NOT EXISTS idx_task_runs_project_id ON task_runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_modules_project_id ON modules(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_workspaces_status ON project_workspaces(status);
    CREATE INDEX IF NOT EXISTS idx_project_workspaces_git_auth_profile_id ON project_workspaces(git_auth_profile_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_git_auth_profiles_name ON git_auth_profiles(name);
    CREATE INDEX IF NOT EXISTS idx_git_auth_profiles_host_pattern ON git_auth_profiles(host_pattern);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_id ON agent_sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_test_case_id ON agent_sessions(test_case_id);
    CREATE INDEX IF NOT EXISTS idx_agent_steps_session_id ON agent_steps(session_id, position ASC);
    CREATE INDEX IF NOT EXISTS idx_recorder_sessions_project_id ON recorder_sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_recorder_sessions_test_case_id ON recorder_sessions(test_case_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_test_cases_project_case_code ON test_cases(project_id, case_code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_project_name ON modules(project_id, name);
    CREATE INDEX IF NOT EXISTS idx_target_urls_project_id ON target_urls(project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_target_urls_project_url ON target_urls(project_id, url);
    CREATE INDEX IF NOT EXISTS idx_auth_profile_states_target_url ON auth_profile_states(target_url_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_triggers_project_id ON schedule_triggers(project_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_triggers_task_id ON schedule_triggers(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_runs_schedule_trigger_id ON task_runs(schedule_trigger_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_task_control_commands_task ON task_control_commands(task_kind, task_id, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_control_commands_status ON task_control_commands(status, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_leases_status_expires ON task_leases(status, lease_expires_at ASC);
    CREATE INDEX IF NOT EXISTS idx_task_leases_owner_status ON task_leases(lease_owner, status);
  `)

}
