const express = require("express");
const db = require("../services/db");

const router = express.Router();

const storyTicker = [
  "US01 Register with secure hashed credentials",
  "US02 Verify email with confirmation token",
  "US03 Log in with secure timed session",
  "US04 Edit profile with privacy controls",
  "US05 Publish offered skills",
  "US06 Publish learning requests",
  "US07 Search, filter, sort, and paginate skills",
  "US08 Send exchange requests with message and slots",
  "US09 Accept or reject exchanges with notification",
  "US10 Mark exchanges completed",
  "US11 Rate completed exchanges and update reputation",
  "US12 Receive in-app notifications",
  "US13 Report users or skills for moderation",
  "US14 Create organisation workspaces and invite members",
  "US15 Take skill tests and earn verified badges",
];

function normaliseSkill(skill) {
  return {
    ...skill,
    tags: skill.tags ? skill.tags.split(", ").filter(Boolean) : [],
    owner_display_name: skill.owner_display_name || skill.display_name,
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

router.get("/", async (req, res, next) => {
  try {
    const latestSkills = await db.query(
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
          tag_map.tags
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
       WHERE s.is_active = 1
       ORDER BY s.created_at DESC
       LIMIT 6`
    );

    const statsRows = await db.query(
      `SELECT
          (SELECT COUNT(*) FROM users WHERE is_suspended = 0) AS users_count,
          (SELECT COUNT(*) FROM skills WHERE is_active = 1) AS skills_count,
          (SELECT COUNT(*) FROM exchange_requests) AS exchanges_count,
          (SELECT COUNT(*) FROM organisations) AS organisations_count`
    );

    const unreadNotificationCount = await getUnreadCount(
      req.session && req.session.user ? req.session.user.user_id : null
    );

    res.render("pages/home", {
      title: "UniSkill Exchange",
      pageClass: "page-home",
      latestSkills: latestSkills.map(normaliseSkill),
      stats: statsRows[0] || {
        users_count: 0,
        skills_count: 0,
        exchanges_count: 0,
        organisations_count: 0,
      },
      storyTicker,
      unreadNotificationCount,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

module.exports = router;
