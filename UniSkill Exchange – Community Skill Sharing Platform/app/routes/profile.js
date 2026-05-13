const crypto = require("crypto");
const express = require("express");
const db = require("../services/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function normaliseSkill(skill) {
  return {
    ...skill,
    tags: skill.tags ? skill.tags.split(", ").filter(Boolean) : [],
    verified_badge: Number(skill.verified_badge || 0) === 1,
  };
}

async function getUnreadCount(userId) {
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

router.get("/dashboard", requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const unreadNotificationCount = await getUnreadCount(userId);

    const profileRows = await db.query(
      `SELECT
          u.user_id,
          u.display_name,
          u.email,
          u.email_verified,
          u.account_type,
          u.created_at,
          p.bio,
          p.headline,
          p.location,
          p.avatar_initial,
          p.privacy_level,
          p.avg_rating,
          p.rating_count,
          (
            SELECT COUNT(*)
            FROM skill_test_attempts sta
            WHERE sta.user_id = u.user_id AND sta.passed = 1
          ) AS verified_badges
       FROM users u
       JOIN profiles p ON p.user_id = u.user_id
       WHERE u.user_id = ?
       LIMIT 1`,
      [userId]
    );

    const mySkills = await db.query(
      `SELECT
          s.skill_id,
          s.title,
          s.description,
          s.skill_type,
          s.mode,
          s.is_active,
          c.name AS category_name,
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
       LEFT JOIN categories c ON c.category_id = s.category_id
       LEFT JOIN profiles p ON p.user_id = s.owner_user_id
       LEFT JOIN organisations o ON o.org_id = s.org_id
       LEFT JOIN (
         SELECT stm.skill_id, GROUP_CONCAT(st.name ORDER BY st.name SEPARATOR ', ') AS tags
         FROM skill_tag_map stm
         JOIN skill_tags st ON st.tag_id = stm.tag_id
         GROUP BY stm.skill_id
       ) AS tag_map ON tag_map.skill_id = s.skill_id
       WHERE s.owner_user_id = ?
       ORDER BY s.updated_at DESC`,
      [userId]
    );

    const myExchanges = await db.query(
      `SELECT
          e.exchange_id,
          e.status,
          e.created_at,
          s.title AS skill_title,
          CASE
            WHEN e.requester_id = ? THEN provider.display_name
            ELSE requester.display_name
          END AS counterpart_name
       FROM exchange_requests e
       JOIN skills s ON s.skill_id = e.skill_id
       JOIN users requester ON requester.user_id = e.requester_id
       JOIN users provider ON provider.user_id = e.provider_id
       WHERE e.requester_id = ? OR e.provider_id = ?
       ORDER BY e.updated_at DESC
       LIMIT 8`,
      [userId, userId, userId]
    );

    const notifications = await db.query(
      `SELECT notification_id, type, message, is_read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );

    const memberships = await db.query(
      `SELECT o.org_name, m.role
       FROM memberships m
       JOIN organisations o ON o.org_id = m.org_id
       WHERE m.user_id = ? AND m.is_active = 1
       ORDER BY o.org_name ASC`,
      [userId]
    );

    let adminReports = [];
    if (req.session.user.is_admin) {
      adminReports = await db.query(
        `SELECT
            r.report_id,
            r.target_type,
            r.reason,
            r.notes,
            r.status,
            r.created_at,
            reporter.display_name AS reporter_name,
            target_user.display_name AS target_user_name,
            s.title AS target_skill_title
         FROM reports r
         JOIN users reporter ON reporter.user_id = r.created_by_user_id
         LEFT JOIN users target_user ON target_user.user_id = r.target_user_id
         LEFT JOIN skills s ON s.skill_id = r.target_skill_id
         WHERE r.status IN ('OPEN', 'IN_REVIEW')
         ORDER BY r.created_at DESC`
      );
    }

    res.render("pages/dashboard", {
      title: "Dashboard",
      pageClass: "page-dashboard",
      profile: profileRows[0],
      mySkills: mySkills.map(normaliseSkill),
      myExchanges,
      notifications,
      memberships,
      unreadNotificationCount,
      adminReports,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get("/edit", requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const profileRows = await db.query(
      `SELECT u.display_name, p.bio, p.headline, p.location, p.avatar_initial, p.privacy_level
       FROM users u
       JOIN profiles p ON p.user_id = u.user_id
       WHERE u.user_id = ?
       LIMIT 1`,
      [userId]
    );

    const unreadNotificationCount = await getUnreadCount(userId);

    res.render("pages/profile-edit", {
      title: "Edit profile",
      pageClass: "page-profile-edit",
      profile: profileRows[0],
      unreadNotificationCount,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.put("/edit", requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const bio = (req.body.bio || "").trim();
    const headline = (req.body.headline || "").trim();
    const location = (req.body.location || "").trim();
    const avatarInitialRaw = (req.body.avatar_initial || "").trim();
    const avatarInitial = avatarInitialRaw ? avatarInitialRaw.slice(0, 2).toUpperCase() : null;
    const privacyLevel = (req.body.privacy_level || "PUBLIC").trim().toUpperCase();

    await db.query(
      `UPDATE profiles
       SET bio = ?, headline = ?, location = ?, avatar_initial = ?, privacy_level = ?
       WHERE user_id = ?`,
      [bio, headline, location, avatarInitial, ["PUBLIC", "REGISTERED", "PRIVATE"].includes(privacyLevel) ? privacyLevel : "PUBLIC", userId]
    );

    await createNotification(userId, "PROFILE_UPDATED", "Your profile details were updated.");
    req.flash("success", "Profile updated successfully.");
    res.redirect("/profile/dashboard");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.put("/notifications/:notificationId/read", requireAuth, async (req, res, next) => {
  try {
    await db.query(
      "UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?",
      [req.params.notificationId, req.session.user.user_id]
    );
    res.redirect("/profile/dashboard");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.put("/notifications/read-all", requireAuth, async (req, res, next) => {
  try {
    await db.query(
      "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
      [req.session.user.user_id]
    );
    req.flash("success", "All notifications marked as read.");
    res.redirect("/profile/dashboard");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post("/:userId/report", requireAuth, async (req, res, next) => {
  try {
    if (req.params.userId === req.session.user.user_id) {
      req.flash("error", "You cannot report your own profile.");
      return res.redirect(`/profile/${req.params.userId}`);
    }

    const reason = (req.body.reason || "").trim();
    const notes = (req.body.notes || "").trim();
    const evidenceUrl = (req.body.evidence_url || "").trim() || null;

    if (!reason) {
      req.flash("error", "A report reason is required.");
      return res.redirect(`/profile/${req.params.userId}`);
    }

    await db.query(
      `INSERT INTO reports
       (report_id, created_by_user_id, target_type, target_user_id, reason, notes, evidence_url, status)
       VALUES (?, ?, 'USER', ?, ?, ?, ?, 'OPEN')`,
      [crypto.randomUUID(), req.session.user.user_id, req.params.userId, reason, notes, evidenceUrl]
    );

    await createNotification(
      req.session.user.user_id,
      "REPORT_CREATED",
      "Your user report has been sent to moderation."
    );

    req.flash("success", "User report submitted.");
    res.redirect(`/profile/${req.params.userId}`);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get("/:userId", async (req, res, next) => {
  try {
    const userRows = await db.query(
      `SELECT
          u.user_id,
          u.display_name,
          u.email_verified,
          p.bio,
          p.headline,
          p.location,
          p.avatar_initial,
          p.privacy_level,
          p.avg_rating,
          p.rating_count,
          (
            SELECT COUNT(*)
            FROM skill_test_attempts sta
            WHERE sta.user_id = u.user_id AND sta.passed = 1
          ) AS verified_badges
       FROM users u
       JOIN profiles p ON p.user_id = u.user_id
       WHERE u.user_id = ?
       LIMIT 1`,
      [req.params.userId]
    );

    if (!userRows.length) {
      return res.status(404).render("pages/404", {
        title: "Profile not found",
        pageClass: "page-404",
      });
    }

    const profile = userRows[0];
    const viewerId = req.session && req.session.user ? req.session.user.user_id : null;
    const canViewFull =
      profile.privacy_level === "PUBLIC" ||
      (profile.privacy_level === "REGISTERED" && !!viewerId) ||
      viewerId === profile.user_id;

    const skills = canViewFull
      ? await db.query(
          `SELECT
              s.skill_id,
              s.title,
              s.description,
              s.skill_type,
              s.mode,
              c.name AS category_name,
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
           LEFT JOIN categories c ON c.category_id = s.category_id
           LEFT JOIN profiles p ON p.user_id = s.owner_user_id
           LEFT JOIN (
             SELECT stm.skill_id, GROUP_CONCAT(st.name ORDER BY st.name SEPARATOR ', ') AS tags
             FROM skill_tag_map stm
             JOIN skill_tags st ON st.tag_id = stm.tag_id
             GROUP BY stm.skill_id
           ) AS tag_map ON tag_map.skill_id = s.skill_id
           WHERE s.owner_user_id = ? AND s.is_active = 1
           ORDER BY s.updated_at DESC`,
          [profile.user_id]
        )
      : [];

    const reviews = canViewFull
      ? await db.query(
          `SELECT r.score, r.comment, r.created_at, u.display_name AS rater_name
           FROM ratings r
           JOIN users u ON u.user_id = r.rater_id
           WHERE r.rated_id = ?
           ORDER BY r.created_at DESC
           LIMIT 8`,
          [profile.user_id]
        )
      : [];

    const unreadNotificationCount = viewerId ? await getUnreadCount(viewerId) : 0;

    res.render("pages/profile-public", {
      title: profile.display_name,
      pageClass: "page-profile-public",
      profile,
      skills: skills.map(normaliseSkill),
      reviews,
      canViewFull,
      unreadNotificationCount,
      isSelf: viewerId === profile.user_id,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

module.exports = router;
