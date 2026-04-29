const crypto = require("crypto");
const express = require("express");
const db = require("../services/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const skillTestQuestions = [
  {
    id: "q1",
    prompt: "What helps a peer-learning exchange stay useful for both people involved?",
    options: [
      "Setting a clear goal and expectation before the session",
      "Keeping the topic intentionally vague",
      "Skipping preparation and relying on improvisation",
      "Avoiding any form of feedback",
    ],
    answer: "Setting a clear goal and expectation before the session",
  },
  {
    id: "q2",
    prompt: "Which behaviour best demonstrates a trustworthy skill provider?",
    options: [
      "Overpromising advanced outcomes in one session",
      "Giving realistic scope, preparation steps, and follow-up guidance",
      "Avoiding questions from the learner",
      "Rejecting accessibility needs",
    ],
    answer: "Giving realistic scope, preparation steps, and follow-up guidance",
  },
  {
    id: "q3",
    prompt: "For an online exchange, which preparation is most important?",
    options: [
      "Ignoring meeting access details until the last minute",
      "Confirming time, access link, and any materials in advance",
      "Refusing to share learning resources",
      "Removing the schedule entirely",
    ],
    answer: "Confirming time, access link, and any materials in advance",
  },
  {
    id: "q4",
    prompt: "What should happen after a completed exchange on this platform?",
    options: [
      "Both sides may rate the exchange to support reputation accuracy",
      "The exchange is deleted immediately",
      "The requester must pay a fee",
      "The provider cannot receive feedback",
    ],
    answer: "Both sides may rate the exchange to support reputation accuracy",
  },
  {
    id: "q5",
    prompt: "Which action best supports safe platform moderation?",
    options: [
      "Ignoring suspicious behaviour",
      "Reporting harmful users or listings with a reason and notes",
      "Creating duplicate accounts to investigate others",
      "Sharing private data publicly",
    ],
    answer: "Reporting harmful users or listings with a reason and notes",
  },
];

function normaliseSkill(skill) {
  return {
    ...skill,
    tags: skill.tags ? skill.tags.split(", ").filter(Boolean) : [],
    verified_badge: Number(skill.verified_badge || 0) === 1,
  };
}

async function getUnreadCount(userId) {
  if (!userId) return 0;
  const rows = await db.query(
    "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND is_read = 0",
    [userId]
  );
  return rows[0] ? rows[0].total : 0;
}

async function createNotification(userId, type, message) {
  await db.query(
    "INSERT INTO notifications (notification_id, user_id, type, message) VALUES (?, ?, ?, ?)",
    [crypto.randomUUID(), userId, type, message]
  );
}

async function getCategories() {
  return db.query("SELECT category_id, name FROM categories ORDER BY name ASC");
}

async function getMyOrganisations(userId) {
  return db.query(
    `SELECT o.org_id, o.org_name, m.role
     FROM memberships m
     JOIN organisations o ON o.org_id = m.org_id
     WHERE m.user_id = ? AND m.is_active = 1
     ORDER BY o.org_name ASC`,
    [userId]
  );
}

async function ensureTagsForSkill(skillId, tagString) {
  const cleanedTags = Array.from(
    new Set(
      (tagString || "")
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10)
    )
  );

  await db.query("DELETE FROM skill_tag_map WHERE skill_id = ?", [skillId]);

  for (const tagName of cleanedTags) {
    let rows = await db.query("SELECT tag_id FROM skill_tags WHERE name = ? LIMIT 1", [tagName]);
    let tagId = rows.length ? rows[0].tag_id : null;

    if (!tagId) {
      tagId = crypto.randomUUID();
      await db.query("INSERT INTO skill_tags (tag_id, name) VALUES (?, ?)", [tagId, tagName]);
    }

    await db.query("INSERT INTO skill_tag_map (skill_id, tag_id) VALUES (?, ?)", [skillId, tagId]);
  }
}

async function findSkillById(skillId) {
  const rows = await db.query(
    `SELECT
        s.skill_id,
        s.owner_user_id,
        s.category_id,
        s.org_id,
        s.title,
        s.description,
        s.skill_type,
        s.mode,
        s.is_active,
        s.version,
        s.created_at,
        s.updated_at,
        c.name AS category_name,
        u.display_name AS owner_display_name,
        u.email_verified,
        p.bio,
        p.headline,
        p.location,
        p.avatar_initial,
        p.avg_rating,
        p.rating_count,
        o.org_name,
        tag_map.tags,
        EXISTS (
          SELECT 1
          FROM skill_test_attempts sta
          WHERE sta.skill_id = s.skill_id
            AND sta.user_id = s.owner_user_id
            AND sta.passed = 1
        ) AS verified_badge
     FROM skills s
     JOIN users u ON u.user_id = s.owner_user_id
     LEFT JOIN profiles p ON p.user_id = u.user_id
     LEFT JOIN categories c ON c.category_id = s.category_id
     LEFT JOIN organisations o ON o.org_id = s.org_id
     LEFT JOIN (
       SELECT stm.skill_id, GROUP_CONCAT(st.name ORDER BY st.name SEPARATOR ', ') AS tags
       FROM skill_tag_map stm
       JOIN skill_tags st ON st.tag_id = stm.tag_id
       GROUP BY stm.skill_id
     ) AS tag_map ON tag_map.skill_id = s.skill_id
     WHERE s.skill_id = ?
     LIMIT 1`,
    [skillId]
  );

  return rows.length ? normaliseSkill(rows[0]) : null;
}

router.get("/", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    const categoryId = (req.query.category || "").trim();
    const type = (req.query.type || "").trim().toUpperCase();
    const sort = (req.query.sort || "recent").trim().toLowerCase();
    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const limit = 9;
    const offset = (page - 1) * limit;

    const filters = ["s.is_active = 1"];
    const params = [];

    if (q) {
      filters.push("(s.title LIKE ? OR s.description LIKE ? OR tag_map.tags LIKE ? OR u.display_name LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    if (categoryId) {
      filters.push("s.category_id = ?");
      params.push(categoryId);
    }

    if (["OFFER", "REQUEST"].includes(type)) {
      filters.push("s.skill_type = ?");
      params.push(type);
    }

    const whereClause = filters.join(" AND ");
    const orderClause =
      sort === "rating"
        ? "COALESCE(p.avg_rating, 0) DESC, COALESCE(p.rating_count, 0) DESC, s.created_at DESC"
        : "s.created_at DESC";

    const countRows = await db.query(
      `SELECT COUNT(*) AS total
       FROM skills s
       JOIN users u ON u.user_id = s.owner_user_id
       LEFT JOIN profiles p ON p.user_id = u.user_id
       LEFT JOIN (
         SELECT stm.skill_id, GROUP_CONCAT(st.name ORDER BY st.name SEPARATOR ', ') AS tags
         FROM skill_tag_map stm
         JOIN skill_tags st ON st.tag_id = stm.tag_id
         GROUP BY stm.skill_id
       ) AS tag_map ON tag_map.skill_id = s.skill_id
       WHERE ${whereClause}`,
      params
    );

    const skills = await db.query(
      `SELECT
          s.skill_id,
          s.title,
          s.description,
          s.skill_type,
          s.mode,
          s.created_at,
          c.name AS category_name,
          u.display_name AS owner_display_name,
          p.avatar_initial,
          p.headline,
          p.avg_rating,
          p.rating_count,
          o.org_name,
          tag_map.tags,
          EXISTS (
            SELECT 1
            FROM skill_test_attempts sta
            WHERE sta.skill_id = s.skill_id
              AND sta.user_id = s.owner_user_id
              AND sta.passed = 1
          ) AS verified_badge
       FROM skills s
       JOIN users u ON u.user_id = s.owner_user_id
       LEFT JOIN profiles p ON p.user_id = u.user_id
       LEFT JOIN categories c ON c.category_id = s.category_id
       LEFT JOIN organisations o ON o.org_id = s.org_id
       LEFT JOIN (
         SELECT stm.skill_id, GROUP_CONCAT(st.name ORDER BY st.name SEPARATOR ', ') AS tags
         FROM skill_tag_map stm
         JOIN skill_tags st ON st.tag_id = stm.tag_id
         GROUP BY stm.skill_id
       ) AS tag_map ON tag_map.skill_id = s.skill_id
       WHERE ${whereClause}
       ORDER BY ${orderClause}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const categories = await getCategories();
    const unreadNotificationCount = await getUnreadCount(
      req.session && req.session.user ? req.session.user.user_id : null
    );

    res.render("pages/skills", {
      title: "Browse skills",
      pageClass: "page-skills",
      skills: skills.map(normaliseSkill),
      categories,
      unreadNotificationCount,
      filters: { q, category: categoryId, type, sort },
      pagination: {
        page,
        total: countRows[0] ? countRows[0].total : 0,
        pageCount: Math.max(Math.ceil(((countRows[0] && countRows[0].total) || 0) / limit), 1),
      },
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get("/new", requireAuth, async (req, res, next) => {
  try {
    const categories = await getCategories();
    const organisations = await getMyOrganisations(req.session.user.user_id);
    const unreadNotificationCount = await getUnreadCount(req.session.user.user_id);

    res.render("pages/skill-form", {
      title: "Add a skill",
      pageClass: "page-skill-form",
      formAction: "/skills",
      formMethod: "POST",
      skill: {
        title: "",
        description: "",
        skill_type: "OFFER",
        mode: "ONLINE",
        category_id: "",
        org_id: "",
        tags: "",
      },
      categories,
      organisations,
      unreadNotificationCount,
      submitLabel: "Publish skill",
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const title = (req.body.title || "").trim();
    const description = (req.body.description || "").trim();
    const categoryId = (req.body.category_id || "").trim();
    const skillType = (req.body.skill_type || "OFFER").trim().toUpperCase();
    const mode = (req.body.mode || "ONLINE").trim().toUpperCase();
    const orgId = (req.body.org_id || "").trim() || null;
    const tags = (req.body.tags || "").trim();

    if (!title || !description || !categoryId || !["OFFER", "REQUEST"].includes(skillType)) {
      req.flash("error", "Title, description, category, and a valid skill type are required.");
      const categories = await getCategories();
      const organisations = await getMyOrganisations(req.session.user.user_id);
      const unreadNotificationCount = await getUnreadCount(req.session.user.user_id);
      return res.status(422).render("pages/skill-form", {
        title: "Add a skill",
        pageClass: "page-skill-form",
        formAction: "/skills",
        formMethod: "POST",
        skill: {
          title,
          description,
          skill_type: skillType,
          mode,
          category_id: categoryId,
          org_id: orgId || "",
          tags,
        },
        categories,
        organisations,
        unreadNotificationCount,
        submitLabel: "Publish skill",
      });
    }

    if (orgId) {
      const memberships = await db.query(
        "SELECT membership_id FROM memberships WHERE user_id = ? AND org_id = ? AND is_active = 1 LIMIT 1",
        [req.session.user.user_id, orgId]
      );
      if (!memberships.length) {
        req.flash("error", "You can only publish organisation skills for organisations you belong to.");
        return res.redirect("/skills/new");
      }
    }

    const skillId = crypto.randomUUID();
    await db.query(
      `INSERT INTO skills
       (skill_id, owner_user_id, category_id, org_id, title, description, skill_type, mode, is_active, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [skillId, req.session.user.user_id, categoryId, orgId, title, description, skillType, mode]
    );

    await ensureTagsForSkill(skillId, tags);
    await createNotification(
      req.session.user.user_id,
      "SKILL_CREATED",
      `Your ${skillType.toLowerCase()} listing “${title}” is now live.`
    );

    req.flash("success", "Skill listing published successfully.");
    res.redirect(`/skills/${skillId}`);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get("/:skillId/edit", requireAuth, async (req, res, next) => {
  try {
    const skill = await findSkillById(req.params.skillId);
    if (!skill) {
      req.flash("error", "Skill not found.");
      return res.redirect("/skills");
    }

    if (skill.owner_user_id !== req.session.user.user_id) {
      req.flash("error", "You can only edit your own skill listings.");
      return res.redirect(`/skills/${skill.skill_id}`);
    }

    const categories = await getCategories();
    const organisations = await getMyOrganisations(req.session.user.user_id);
    const unreadNotificationCount = await getUnreadCount(req.session.user.user_id);

    res.render("pages/skill-form", {
      title: "Edit skill",
      pageClass: "page-skill-form",
      formAction: `/skills/${skill.skill_id}`,
      formMethod: "PUT",
      skill: {
        ...skill,
        tags: skill.tags.join(", "),
      },
      categories,
      organisations,
      unreadNotificationCount,
      submitLabel: "Save changes",
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.put("/:skillId", requireAuth, async (req, res, next) => {
  try {
    const skill = await findSkillById(req.params.skillId);
    if (!skill) {
      req.flash("error", "Skill not found.");
      return res.redirect("/skills");
    }

    if (skill.owner_user_id !== req.session.user.user_id) {
      req.flash("error", "You can only edit your own skill listings.");
      return res.redirect(`/skills/${skill.skill_id}`);
    }

    const title = (req.body.title || "").trim();
    const description = (req.body.description || "").trim();
    const categoryId = (req.body.category_id || "").trim();
    const skillType = (req.body.skill_type || skill.skill_type).trim().toUpperCase();
    const mode = (req.body.mode || skill.mode).trim().toUpperCase();
    const orgId = (req.body.org_id || "").trim() || null;
    const tags = (req.body.tags || "").trim();

    if (!title || !description || !categoryId || !["OFFER", "REQUEST"].includes(skillType)) {
      req.flash("error", "Please complete the required fields before saving.");
      return res.redirect(`/skills/${skill.skill_id}/edit`);
    }

    if (orgId) {
      const memberships = await db.query(
        "SELECT membership_id FROM memberships WHERE user_id = ? AND org_id = ? AND is_active = 1 LIMIT 1",
        [req.session.user.user_id, orgId]
      );
      if (!memberships.length) {
        req.flash("error", "You can only attach this listing to an organisation you belong to.");
        return res.redirect(`/skills/${skill.skill_id}/edit`);
      }
    }

    await db.query(
      `UPDATE skills
       SET category_id = ?, org_id = ?, title = ?, description = ?, skill_type = ?, mode = ?, version = version + 1
       WHERE skill_id = ?`,
      [categoryId, orgId, title, description, skillType, mode, skill.skill_id]
    );

    await ensureTagsForSkill(skill.skill_id, tags);
    req.flash("success", "Skill listing updated.");
    res.redirect(`/skills/${skill.skill_id}`);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.put("/:skillId/deactivate", requireAuth, async (req, res, next) => {
  try {
    const skill = await findSkillById(req.params.skillId);
    if (!skill) {
      req.flash("error", "Skill not found.");
      return res.redirect("/skills");
    }

    if (skill.owner_user_id !== req.session.user.user_id) {
      req.flash("error", "You can only archive your own skill listings.");
      return res.redirect(`/skills/${skill.skill_id}`);
    }

    await db.query("UPDATE skills SET is_active = 0 WHERE skill_id = ?", [skill.skill_id]);
    req.flash("success", "Skill listing archived.");
    res.redirect("/profile/dashboard");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get("/:skillId/test", requireAuth, async (req, res, next) => {
  try {
    const skill = await findSkillById(req.params.skillId);
    if (!skill) {
      req.flash("error", "Skill not found.");
      return res.redirect("/skills");
    }

    const attemptsRows = await db.query(
      `SELECT COUNT(*) AS total
       FROM skill_test_attempts
       WHERE skill_id = ? AND user_id = ? AND attempted_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [skill.skill_id, req.session.user.user_id]
    );

    const unreadNotificationCount = await getUnreadCount(req.session.user.user_id);

    res.render("pages/skill-test", {
      title: `Skill test · ${skill.title}`,
      pageClass: "page-skill-test",
      skill,
      unreadNotificationCount,
      questions: skillTestQuestions,
      attemptsThisWeek: attemptsRows[0] ? attemptsRows[0].total : 0,
      attemptLimit: 3,
      timerSeconds: 300,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post("/:skillId/test", requireAuth, async (req, res, next) => {
  try {
    const skill = await findSkillById(req.params.skillId);
    if (!skill) {
      req.flash("error", "Skill not found.");
      return res.redirect("/skills");
    }

    const attemptsRows = await db.query(
      `SELECT COUNT(*) AS total
       FROM skill_test_attempts
       WHERE skill_id = ? AND user_id = ? AND attempted_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [skill.skill_id, req.session.user.user_id]
    );

    const attemptsThisWeek = attemptsRows[0] ? attemptsRows[0].total : 0;
    if (attemptsThisWeek >= 3) {
      req.flash("error", "You have reached the maximum of 3 attempts for this skill in the last 7 days.");
      return res.redirect(`/skills/${skill.skill_id}/test`);
    }

    let correct = 0;
    for (const question of skillTestQuestions) {
      if ((req.body[question.id] || "").trim() === question.answer) {
        correct += 1;
      }
    }

    const score = Math.round((correct / skillTestQuestions.length) * 100);
    const passed = score >= 70;

    await db.query(
      "INSERT INTO skill_test_attempts (attempt_id, skill_id, user_id, score, passed) VALUES (?, ?, ?, ?, ?)",
      [crypto.randomUUID(), skill.skill_id, req.session.user.user_id, score, passed ? 1 : 0]
    );

    await createNotification(
      req.session.user.user_id,
      "SKILL_TEST",
      passed
        ? `You passed the verification test for “${skill.title}” with ${score}%.`
        : `You scored ${score}% on the “${skill.title}” test. You can try again if attempts remain.`
    );

    req.flash(
      passed ? "success" : "warning",
      passed
        ? `Verified badge unlocked with a score of ${score}%.`
        : `You scored ${score}%. A verified badge requires at least 70%.`
    );
    res.redirect(`/skills/${skill.skill_id}`);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post("/:skillId/report", requireAuth, async (req, res, next) => {
  try {
    const skill = await findSkillById(req.params.skillId);
    if (!skill) {
      req.flash("error", "Skill not found.");
      return res.redirect("/skills");
    }

    const reason = (req.body.reason || "").trim();
    const notes = (req.body.notes || "").trim();
    const evidenceUrl = (req.body.evidence_url || "").trim() || null;

    if (!reason) {
      req.flash("error", "A report reason is required.");
      return res.redirect(`/skills/${skill.skill_id}`);
    }

    const reportId = crypto.randomUUID();
    await db.query(
      `INSERT INTO reports
       (report_id, created_by_user_id, target_type, target_skill_id, reason, notes, evidence_url, status)
       VALUES (?, ?, 'SKILL', ?, ?, ?, ?, 'OPEN')`,
      [reportId, req.session.user.user_id, skill.skill_id, reason, notes, evidenceUrl]
    );

    await createNotification(
      req.session.user.user_id,
      "REPORT_CREATED",
      `Your report for “${skill.title}” has been submitted to moderation.`
    );

    req.flash("success", "Skill report submitted to moderation.");
    res.redirect(`/skills/${skill.skill_id}`);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get("/:skillId", async (req, res, next) => {
  try {
    const skill = await findSkillById(req.params.skillId);
    if (!skill) {
      return res.status(404).render("pages/404", {
        title: "Skill not found",
        pageClass: "page-404",
      });
    }

    const reviews = await db.query(
      `SELECT r.score, r.comment, r.created_at, u.display_name AS rater_name
       FROM ratings r
       JOIN users u ON u.user_id = r.rater_id
       WHERE r.rated_id = ?
       ORDER BY r.created_at DESC
       LIMIT 8`,
      [skill.owner_user_id]
    );

    const relatedSkills = await db.query(
      `SELECT
          s.skill_id,
          s.title,
          s.description,
          s.skill_type,
          s.mode,
          c.name AS category_name,
          u.display_name AS owner_display_name,
          p.avatar_initial,
          p.headline,
          p.avg_rating,
          p.rating_count,
          tag_map.tags,
          EXISTS (
            SELECT 1
            FROM skill_test_attempts sta
            WHERE sta.skill_id = s.skill_id
              AND sta.user_id = s.owner_user_id
              AND sta.passed = 1
          ) AS verified_badge
       FROM skills s
       JOIN users u ON u.user_id = s.owner_user_id
       LEFT JOIN profiles p ON p.user_id = u.user_id
       LEFT JOIN categories c ON c.category_id = s.category_id
       LEFT JOIN (
         SELECT stm.skill_id, GROUP_CONCAT(st.name ORDER BY st.name SEPARATOR ', ') AS tags
         FROM skill_tag_map stm
         JOIN skill_tags st ON st.tag_id = stm.tag_id
         GROUP BY stm.skill_id
       ) AS tag_map ON tag_map.skill_id = s.skill_id
       WHERE s.category_id = ? AND s.skill_id <> ? AND s.is_active = 1
       ORDER BY s.created_at DESC
       LIMIT 3`,
      [skill.category_id, skill.skill_id]
    );

    const unreadNotificationCount = await getUnreadCount(
      req.session && req.session.user ? req.session.user.user_id : null
    );
    let attemptsThisWeek = 0;

    if (req.session && req.session.user) {
      const attemptsRows = await db.query(
        `SELECT COUNT(*) AS total
         FROM skill_test_attempts
         WHERE skill_id = ? AND user_id = ? AND attempted_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
        [skill.skill_id, req.session.user.user_id]
      );
      attemptsThisWeek = attemptsRows[0] ? attemptsRows[0].total : 0;
    }

    res.render("pages/skill-detail", {
      title: skill.title,
      pageClass: "page-skill-detail",
      skill,
      reviews,
      relatedSkills: relatedSkills.map(normaliseSkill),
      unreadNotificationCount,
      attemptsThisWeek,
      canRequest:
        req.session && req.session.user
          ? req.session.user.user_id !== skill.owner_user_id && Number(skill.is_active) === 1
          : false,
      isOwner:
        req.session && req.session.user
          ? req.session.user.user_id === skill.owner_user_id
          : false,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

module.exports = router;
