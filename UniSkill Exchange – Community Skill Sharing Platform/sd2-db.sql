SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS moderation_cases;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS ratings;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS exchange_requests;
DROP TABLE IF EXISTS skill_test_attempts;
DROP TABLE IF EXISTS skill_tag_map;
DROP TABLE IF EXISTS skill_tags;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS availability_slots;
DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS organisations;
DROP TABLE IF EXISTS email_verification_tokens;
DROP TABLE IF EXISTS user_blocks;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  user_id CHAR(36) PRIMARY KEY,
  display_name VARCHAR(120) NOT NULL,
  age TINYINT UNSIGNED NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  account_type ENUM('INDIVIDUAL','ORGANISATION_MEMBER') NOT NULL DEFAULT 'INDIVIDUAL',
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  is_suspended TINYINT(1) NOT NULL DEFAULT 0,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE profiles (
  profile_id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL UNIQUE,
  bio TEXT NULL,
  headline VARCHAR(180) NULL,
  location VARCHAR(180) NULL,
  avatar_initial CHAR(2) NULL,
  privacy_level VARCHAR(40) NOT NULL DEFAULT 'PUBLIC',
  avg_rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  rating_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE categories (
  category_id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  parent_category_id CHAR(36) NULL,
  CONSTRAINT fk_categories_parent FOREIGN KEY (parent_category_id) REFERENCES categories(category_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE organisations (
  org_id CHAR(36) PRIMARY KEY,
  org_name VARCHAR(180) NOT NULL,
  domain VARCHAR(180) NULL,
  visibility VARCHAR(40) NOT NULL DEFAULT 'PRIVATE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE memberships (
  membership_id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  org_id CHAR(36) NOT NULL,
  role ENUM('OWNER','ADMIN','MEMBER') NOT NULL DEFAULT 'MEMBER',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_membership_user_org (user_id, org_id),
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_memberships_org FOREIGN KEY (org_id) REFERENCES organisations(org_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE invites (
  invite_id CHAR(36) PRIMARY KEY,
  org_id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  role ENUM('OWNER','ADMIN','MEMBER') NOT NULL DEFAULT 'MEMBER',
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  CONSTRAINT fk_invites_org FOREIGN KEY (org_id) REFERENCES organisations(org_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE skills (
  skill_id CHAR(36) PRIMARY KEY,
  owner_user_id CHAR(36) NOT NULL,
  category_id CHAR(36) NOT NULL,
  org_id CHAR(36) NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  skill_type ENUM('OFFER','REQUEST') NOT NULL,
  mode ENUM('ONLINE','IN_PERSON','BOTH') NOT NULL DEFAULT 'ONLINE',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_skills_type_active_created (skill_type, is_active, created_at),
  INDEX idx_skills_owner (owner_user_id),
  CONSTRAINT fk_skills_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_skills_category FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE RESTRICT,
  CONSTRAINT fk_skills_org FOREIGN KEY (org_id) REFERENCES organisations(org_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE skill_tags (
  tag_id CHAR(36) PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE skill_tag_map (
  skill_id CHAR(36) NOT NULL,
  tag_id CHAR(36) NOT NULL,
  PRIMARY KEY (skill_id, tag_id),
  CONSTRAINT fk_skill_tag_map_skill FOREIGN KEY (skill_id) REFERENCES skills(skill_id) ON DELETE CASCADE,
  CONSTRAINT fk_skill_tag_map_tag FOREIGN KEY (tag_id) REFERENCES skill_tags(tag_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exchange_requests (
  exchange_id CHAR(36) PRIMARY KEY,
  skill_id CHAR(36) NOT NULL,
  requester_id CHAR(36) NOT NULL,
  provider_id CHAR(36) NOT NULL,
  status ENUM('PENDING','ACCEPTED','REJECTED','COMPLETED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  message TEXT NOT NULL,
  mode ENUM('ONLINE','IN_PERSON','BOTH') NOT NULL DEFAULT 'ONLINE',
  proposed_slot_1 DATETIME NULL,
  proposed_slot_2 DATETIME NULL,
  confirmed_slot DATETIME NULL,
  decision_reason VARCHAR(255) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_exchange_status_provider (provider_id, status),
  INDEX idx_exchange_status_requester (requester_id, status),
  CONSTRAINT fk_exchange_skill FOREIGN KEY (skill_id) REFERENCES skills(skill_id) ON DELETE CASCADE,
  CONSTRAINT fk_exchange_requester FOREIGN KEY (requester_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_exchange_provider FOREIGN KEY (provider_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE schedules (
  schedule_id CHAR(36) PRIMARY KEY,
  exchange_id CHAR(36) NOT NULL UNIQUE,
  confirmed_start_at DATETIME NOT NULL,
  confirmed_end_at DATETIME NOT NULL,
  mode ENUM('ONLINE','IN_PERSON','BOTH') NOT NULL DEFAULT 'ONLINE',
  location_url VARCHAR(255) NULL,
  notes TEXT NULL,
  CONSTRAINT fk_schedules_exchange FOREIGN KEY (exchange_id) REFERENCES exchange_requests(exchange_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ratings (
  rating_id CHAR(36) PRIMARY KEY,
  exchange_id CHAR(36) NOT NULL,
  rater_id CHAR(36) NOT NULL,
  rated_id CHAR(36) NOT NULL,
  score INT NOT NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_ratings_score CHECK (score BETWEEN 1 AND 5),
  UNIQUE KEY uniq_rating_per_rater_exchange (exchange_id, rater_id),
  CONSTRAINT fk_ratings_exchange FOREIGN KEY (exchange_id) REFERENCES exchange_requests(exchange_id) ON DELETE CASCADE,
  CONSTRAINT fk_ratings_rater FOREIGN KEY (rater_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_ratings_rated FOREIGN KEY (rated_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  notification_id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  type VARCHAR(80) NOT NULL,
  message VARCHAR(255) NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_user_read (user_id, is_read, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reports (
  report_id CHAR(36) PRIMARY KEY,
  created_by_user_id CHAR(36) NOT NULL,
  target_type ENUM('USER','SKILL') NOT NULL,
  target_user_id CHAR(36) NULL,
  target_skill_id CHAR(36) NULL,
  reason VARCHAR(180) NOT NULL,
  notes TEXT NULL,
  evidence_url VARCHAR(255) NULL,
  status ENUM('OPEN','IN_REVIEW','RESOLVED') NOT NULL DEFAULT 'OPEN',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_creator FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_target_user FOREIGN KEY (target_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_reports_target_skill FOREIGN KEY (target_skill_id) REFERENCES skills(skill_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE moderation_cases (
  case_id CHAR(36) PRIMARY KEY,
  report_id CHAR(36) NOT NULL UNIQUE,
  action ENUM('NONE','REMOVE_LISTING','SUSPEND_USER') NOT NULL DEFAULT 'NONE',
  admin_notes TEXT NULL,
  resolved_at DATETIME NULL,
  CONSTRAINT fk_moderation_cases_report FOREIGN KEY (report_id) REFERENCES reports(report_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE availability_slots (
  slot_id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  day_of_week INT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone VARCHAR(80) NOT NULL,
  CONSTRAINT fk_availability_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE skill_test_attempts (
  attempt_id CHAR(36) PRIMARY KEY,
  skill_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  score INT NOT NULL,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_skill_attempts_user_skill_time (user_id, skill_id, attempted_at),
  CONSTRAINT fk_skill_test_skill FOREIGN KEY (skill_id) REFERENCES skills(skill_id) ON DELETE CASCADE,
  CONSTRAINT fk_skill_test_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE email_verification_tokens (
  token_id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_email_tokens_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_blocks (
  blocker_id CHAR(36) NOT NULL,
  blocked_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT fk_user_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_user_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO categories (category_id, name, parent_category_id) VALUES
  (UUID(), 'Technology', NULL),
  (UUID(), 'Languages', NULL),
  (UUID(), 'Music', NULL),
  (UUID(), 'Arts & Design', NULL),
  (UUID(), 'Sports & Fitness', NULL),
  (UUID(), 'Science & Math', NULL),
  (UUID(), 'Business', NULL),
  (UUID(), 'Cooking', NULL),
  (UUID(), 'Photography', NULL),
  (UUID(), 'Other', NULL);
-- Seed ages for existing users
UPDATE users SET age = 22 WHERE user_id = 'u-001';
UPDATE users SET age = 25 WHERE user_id = 'u-002';
UPDATE users SET age = 19 WHERE user_id = 'u-003';
UPDATE users SET age = 31 WHERE user_id = 'u-004';
UPDATE users SET age = 28 WHERE user_id = 'u-005';
UPDATE users SET age = 24 WHERE user_id = 'u-006';
UPDATE users SET age = 27 WHERE user_id = 'u-007';
UPDATE users SET age = 35 WHERE user_id = 'u-008';
UPDATE users SET age = 29 WHERE user_id = 'u-admin';