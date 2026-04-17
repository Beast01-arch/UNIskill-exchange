-- ============================================================
--  UniSkill Exchange — Simplified Database (13 tables)
--  Compatible with all existing route queries
-- ============================================================

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
DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS organisations;
DROP TABLE IF EXISTS email_verification_tokens;
DROP TABLE IF EXISTS user_blocks;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- ── 1. USERS ─────────────────────────────────────────────────
-- Stores every registered account.
-- profiles table is merged in here (was a pointless 1-to-1 split).
CREATE TABLE users (
  user_id        CHAR(36)     PRIMARY KEY,
  display_name   VARCHAR(120) NOT NULL,
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  bio            TEXT         NULL,
  headline       VARCHAR(180) NULL,
  location       VARCHAR(180) NULL,
  avatar_initial CHAR(2)      NULL,
  privacy_level  VARCHAR(40)  NOT NULL DEFAULT 'PUBLIC',
  avg_rating     DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  rating_count   INT          NOT NULL DEFAULT 0,
  email_verified TINYINT(1)   NOT NULL DEFAULT 0,
  is_suspended   TINYINT(1)   NOT NULL DEFAULT 0,
  is_admin       TINYINT(1)   NOT NULL DEFAULT 0,
  last_login_at  DATETIME     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. CATEGORIES ────────────────────────────────────────────
CREATE TABLE categories (
  category_id CHAR(36)     PRIMARY KEY,
  name        VARCHAR(120) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. ORGANISATIONS ─────────────────────────────────────────
CREATE TABLE organisations (
  org_id     CHAR(36)     PRIMARY KEY,
  org_name   VARCHAR(180) NOT NULL,
  domain     VARCHAR(180) NULL,
  visibility VARCHAR(40)  NOT NULL DEFAULT 'PRIVATE',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. MEMBERSHIPS ───────────────────────────────────────────
CREATE TABLE memberships (
  membership_id CHAR(36)   PRIMARY KEY,
  user_id       CHAR(36)   NOT NULL,
  org_id        CHAR(36)   NOT NULL,
  role          ENUM('OWNER','ADMIN','MEMBER') NOT NULL DEFAULT 'MEMBER',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  joined_at     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_org (user_id, org_id),
  CONSTRAINT fk_mem_user FOREIGN KEY (user_id) REFERENCES users(user_id)         ON DELETE CASCADE,
  CONSTRAINT fk_mem_org  FOREIGN KEY (org_id)  REFERENCES organisations(org_id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. INVITES ───────────────────────────────────────────────
CREATE TABLE invites (
  invite_id  CHAR(36)     PRIMARY KEY,
  org_id     CHAR(36)     NOT NULL,
  email      VARCHAR(255) NOT NULL,
  token      VARCHAR(255) NOT NULL UNIQUE,
  role       ENUM('OWNER','ADMIN','MEMBER') NOT NULL DEFAULT 'MEMBER',
  expires_at DATETIME     NOT NULL,
  used_at    DATETIME     NULL,
  CONSTRAINT fk_inv_org FOREIGN KEY (org_id) REFERENCES organisations(org_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. SKILLS ────────────────────────────────────────────────
CREATE TABLE skills (
  skill_id      CHAR(36)     PRIMARY KEY,
  owner_user_id CHAR(36)     NOT NULL,
  category_id   CHAR(36)     NOT NULL,
  org_id        CHAR(36)     NULL,
  title         VARCHAR(180) NOT NULL,
  description   TEXT         NOT NULL,
  skill_type    ENUM('OFFER','REQUEST') NOT NULL,
  mode          ENUM('ONLINE','IN_PERSON','BOTH') NOT NULL DEFAULT 'ONLINE',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  version       INT          NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_skills_browse (is_active, created_at),
  INDEX idx_skills_owner  (owner_user_id),
  FULLTEXT INDEX ft_skills (title, description),
  CONSTRAINT fk_skill_owner    FOREIGN KEY (owner_user_id) REFERENCES users(user_id)          ON DELETE CASCADE,
  CONSTRAINT fk_skill_category FOREIGN KEY (category_id)  REFERENCES categories(category_id)  ON DELETE RESTRICT,
  CONSTRAINT fk_skill_org      FOREIGN KEY (org_id)        REFERENCES organisations(org_id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 7. SKILL_TAGS ────────────────────────────────────────────
CREATE TABLE skill_tags (
  tag_id CHAR(36)    PRIMARY KEY,
  name   VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 8. SKILL_TAG_MAP ─────────────────────────────────────────
CREATE TABLE skill_tag_map (
  skill_id CHAR(36) NOT NULL,
  tag_id   CHAR(36) NOT NULL,
  PRIMARY KEY (skill_id, tag_id),
  CONSTRAINT fk_stm_skill FOREIGN KEY (skill_id) REFERENCES skills(skill_id)   ON DELETE CASCADE,
  CONSTRAINT fk_stm_tag   FOREIGN KEY (tag_id)   REFERENCES skill_tags(tag_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 9. EXCHANGE_REQUESTS ─────────────────────────────────────
-- Schedule columns merged in (schedules was a separate 1-to-1 table).
CREATE TABLE exchange_requests (
  exchange_id        CHAR(36)     PRIMARY KEY,
  skill_id           CHAR(36)     NOT NULL,
  requester_id       CHAR(36)     NOT NULL,
  provider_id        CHAR(36)     NOT NULL,
  status             ENUM('PENDING','ACCEPTED','REJECTED','COMPLETED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  message            TEXT         NOT NULL,
  mode               ENUM('ONLINE','IN_PERSON','BOTH') NOT NULL DEFAULT 'ONLINE',
  proposed_slot_1    DATETIME     NULL,
  proposed_slot_2    DATETIME     NULL,
  confirmed_slot     DATETIME     NULL,
  decision_reason    VARCHAR(255) NULL,
  schedule_id        CHAR(36)     NULL,
  confirmed_start_at DATETIME     NULL,
  confirmed_end_at   DATETIME     NULL,
  schedule_mode      ENUM('ONLINE','IN_PERSON','BOTH') NULL,
  location_url       VARCHAR(255) NULL,
  schedule_notes     TEXT         NULL,
  version            INT          NOT NULL DEFAULT 1,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ex_provider  (provider_id,  status),
  INDEX idx_ex_requester (requester_id, status),
  CONSTRAINT fk_ex_skill     FOREIGN KEY (skill_id)     REFERENCES skills(skill_id) ON DELETE CASCADE,
  CONSTRAINT fk_ex_requester FOREIGN KEY (requester_id) REFERENCES users(user_id)   ON DELETE CASCADE,
  CONSTRAINT fk_ex_provider  FOREIGN KEY (provider_id)  REFERENCES users(user_id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 10. RATINGS ──────────────────────────────────────────────
CREATE TABLE ratings (
  rating_id   CHAR(36) PRIMARY KEY,
  exchange_id CHAR(36) NOT NULL,
  rater_id    CHAR(36) NOT NULL,
  rated_id    CHAR(36) NOT NULL,
  score       INT      NOT NULL,
  comment     TEXT     NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_score CHECK (score BETWEEN 1 AND 5),
  UNIQUE KEY uniq_rating (exchange_id, rater_id),
  INDEX idx_ratings_rated (rated_id),
  CONSTRAINT fk_rat_exchange FOREIGN KEY (exchange_id) REFERENCES exchange_requests(exchange_id) ON DELETE CASCADE,
  CONSTRAINT fk_rat_rater    FOREIGN KEY (rater_id)    REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_rat_rated    FOREIGN KEY (rated_id)    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 11. NOTIFICATIONS ────────────────────────────────────────
CREATE TABLE notifications (
  notification_id CHAR(36)     PRIMARY KEY,
  user_id         CHAR(36)     NOT NULL,
  type            VARCHAR(80)  NOT NULL,
  message         VARCHAR(255) NOT NULL,
  is_read         TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif (user_id, is_read, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 12. REPORTS ──────────────────────────────────────────────
-- moderation_cases merged in (was a separate 1-to-1 table).
CREATE TABLE reports (
  report_id          CHAR(36)     PRIMARY KEY,
  created_by_user_id CHAR(36)     NOT NULL,
  target_type        ENUM('USER','SKILL') NOT NULL,
  target_user_id     CHAR(36)     NULL,
  target_skill_id    CHAR(36)     NULL,
  reason             VARCHAR(180) NOT NULL,
  notes              TEXT         NULL,
  evidence_url       VARCHAR(255) NULL,
  status             ENUM('OPEN','IN_REVIEW','RESOLVED') NOT NULL DEFAULT 'OPEN',
  mod_action         ENUM('NONE','REMOVE_LISTING','SUSPEND_USER') NULL,
  admin_notes        TEXT         NULL,
  resolved_at        DATETIME     NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rep_creator      FOREIGN KEY (created_by_user_id) REFERENCES users(user_id)   ON DELETE CASCADE,
  CONSTRAINT fk_rep_target_user  FOREIGN KEY (target_user_id)     REFERENCES users(user_id)   ON DELETE SET NULL,
  CONSTRAINT fk_rep_target_skill FOREIGN KEY (target_skill_id)    REFERENCES skills(skill_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 13. EMAIL_VERIFICATION_TOKENS ────────────────────────────
CREATE TABLE email_verification_tokens (
  token_id   CHAR(36)     PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  token      VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME     NOT NULL,
  used_at    DATETIME     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_evt_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
--  SEED DATA
-- ============================================================

INSERT INTO categories (category_id, name) VALUES
  (UUID(), 'Technology'),
  (UUID(), 'Languages'),
  (UUID(), 'Music'),
  (UUID(), 'Arts & Design'),
  (UUID(), 'Sports & Fitness'),
  (UUID(), 'Science & Math'),
  (UUID(), 'Business'),
  (UUID(), 'Cooking'),
  (UUID(), 'Photography'),
  (UUID(), 'Other');

-- Seeded admin account (password: Admin1234!)
INSERT INTO users (
  user_id, display_name, email, password_hash,
  bio, headline, avatar_initial, privacy_level,
  email_verified, is_suspended, is_admin
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Platform Admin',
  'admin@uniskill.local',
  '$2a$12$LWY8LLkJVqSQ0gCR9RqbBOaQLDH7oXLnD7/K.jKK8UYPV/XlFkZGS',
  'Platform administrator.', 'Admin', 'A', 'PRIVATE',
  1, 0, 1
);