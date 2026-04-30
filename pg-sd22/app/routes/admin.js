"use strict";

const crypto = require("crypto");
const express = require("express");
const db = require("../services/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.is_admin) {
    return next();
  }
  req.flash("error", "Administrator access is required.");
  return res.redirect("/profile/dashboard");
}

async function createNotification(userId, type, message) {
  await db.query(
    "INSERT INTO notifications (notification_id, user_id, type, message) VALUES (?, ?, ?, ?)",
    [crypto.randomUUID(), userId, type, message]
  );
}

// GET /admin — Stats dashboard
router.get("/", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const stats = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users)                                         AS total_users,
        (SELECT COUNT(*) FROM users WHERE is_suspended = 1)                 AS suspended_users,
        (SELECT COUNT(*) FROM users WHERE is_admin = 1)                     AS admin_users,
        (SELECT COUNT(*) FROM skills)                                        AS total_skills,
        (SELECT COUNT(*) FROM skills WHERE is_active = 1)                   AS active_skills,
        (SELECT COUNT(*) FROM exchange_requests)                             AS total_exchanges,
        (SELECT COUNT(*) FROM exchange_requests WHERE status = 'PENDING')   AS pending_exchanges,
        (SELECT COUNT(*) FROM exchange_requests WHERE status = 'COMPLETED') AS completed_exchanges,
        (SELECT COUNT(*) FROM reports WHERE status = 'OPEN')                AS open_reports
    `);

    const recentUsers = await db.query(
      `SELECT user_id, display_name, email, is_admin, is_suspended, created_at
       FROM users ORDER BY created_at DESC LIMIT 5`
    );

    res.render("pages/admin/index", {
      title: "Admin Dashboard",
      pageClass: "page-admin",
      stats: stats[0],
      recentUsers,
      unreadNotificationCount: 0,
    });
  } catch (err) { console.error(err); next(err); }
});

// GET /admin/users
router.get("/users", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const search = (req.query.search || "").trim();
    const users = search
      ? await db.query(
          `SELECT user_id, display_name, email, is_admin, is_suspended, account_type, created_at, last_login_at
           FROM users WHERE display_name LIKE ? OR email LIKE ? ORDER BY created_at DESC`,
          [`%${search}%`, `%${search}%`]
        )
      : await db.query(
          `SELECT user_id, display_name, email, is_admin, is_suspended, account_type, created_at, last_login_at
           FROM users ORDER BY created_at DESC`
        );

    res.render("pages/admin/users", {
      title: "Manage Users", pageClass: "page-admin",
      users, search, unreadNotificationCount: 0,
    });
  } catch (err) { console.error(err); next(err); }
});

// GET /admin/users/:userId
router.get("/users/:userId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT u.user_id, u.display_name, u.email, u.is_admin, u.is_suspended,
              u.account_type, u.email_verified, u.created_at, u.last_login_at,
              p.bio, p.headline, p.location, p.avg_rating, p.rating_count
       FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id
       WHERE u.user_id = ? LIMIT 1`,
      [req.params.userId]
    );
    if (!rows.length) { req.flash("error", "User not found."); return res.redirect("/admin/users"); }

    const user = rows[0];
    const skills = await db.query(
      `SELECT skill_id, title, skill_type, is_active, created_at FROM skills
       WHERE owner_user_id = ? ORDER BY created_at DESC`,
      [user.user_id]
    );
    const exchanges = await db.query(
      `SELECT e.exchange_id, e.status, e.created_at, s.title AS skill_title
       FROM exchange_requests e JOIN skills s ON s.skill_id = e.skill_id
       WHERE e.requester_id = ? OR e.provider_id = ? ORDER BY e.created_at DESC LIMIT 10`,
      [user.user_id, user.user_id]
    );

    res.render("pages/admin/user-detail", {
      title: `User: ${user.display_name}`, pageClass: "page-admin",
      user, skills, exchanges, unreadNotificationCount: 0,
    });
  } catch (err) { console.error(err); next(err); }
});

// POST /admin/users/:userId/suspend
router.post("/users/:userId/suspend", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (userId === req.session.user.user_id) {
      req.flash("error", "You cannot suspend your own account.");
      return res.redirect(`/admin/users/${userId}`);
    }
    await db.query("UPDATE users SET is_suspended = 1 WHERE user_id = ?", [userId]);
    await createNotification(userId, "MODERATION_ACTION", "Your account has been suspended by an administrator.");
    req.flash("success", "User suspended.");
    res.redirect(`/admin/users/${userId}`);
  } catch (err) { console.error(err); next(err); }
});

// POST /admin/users/:userId/unsuspend
router.post("/users/:userId/unsuspend", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await db.query("UPDATE users SET is_suspended = 0 WHERE user_id = ?", [req.params.userId]);
    await createNotification(req.params.userId, "MODERATION_ACTION", "Your account suspension has been lifted.");
    req.flash("success", "User unsuspended.");
    res.redirect(`/admin/users/${req.params.userId}`);
  } catch (err) { console.error(err); next(err); }
});

// POST /admin/users/:userId/impersonate
router.post("/users/:userId/impersonate", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.query(
      "SELECT user_id, display_name, email, is_admin, email_verified FROM users WHERE user_id = ? LIMIT 1",
      [req.params.userId]
    );
    if (!rows.length) { req.flash("error", "User not found."); return res.redirect("/admin/users"); }
    const target = rows[0];
    req.session.admin_user = req.session.user;
    req.session.impersonating_as = target.user_id;
    req.session.user = {
      user_id: target.user_id,
      display_name: target.display_name,
      email: target.email,
      email_verified: Number(target.email_verified) === 1,
      is_admin: false,
    };
    req.flash("warning", `Impersonating ${target.display_name}. Visit /admin/stop-impersonating to return.`);
    res.redirect("/profile/dashboard");
  } catch (err) { console.error(err); next(err); }
});

// GET /admin/stop-impersonating
router.get("/stop-impersonating", async (req, res) => {
  if (req.session.admin_user) {
    req.session.user = req.session.admin_user;
    req.session.admin_user = null;
    req.session.impersonating_as = null;
    req.flash("success", "Returned to admin account.");
  }
  res.redirect("/admin");
});

// GET /admin/skills
router.get("/skills", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const search = (req.query.search || "").trim();
    const skills = search
      ? await db.query(
          `SELECT s.skill_id, s.title, s.skill_type, s.is_active, s.created_at,
                  u.display_name AS owner_name, u.email AS owner_email, c.name AS category_name
           FROM skills s JOIN users u ON u.user_id = s.owner_user_id
           LEFT JOIN categories c ON c.category_id = s.category_id
           WHERE s.title LIKE ? OR u.display_name LIKE ? ORDER BY s.created_at DESC`,
          [`%${search}%`, `%${search}%`]
        )
      : await db.query(
          `SELECT s.skill_id, s.title, s.skill_type, s.is_active, s.created_at,
                  u.display_name AS owner_name, u.email AS owner_email, c.name AS category_name
           FROM skills s JOIN users u ON u.user_id = s.owner_user_id
           LEFT JOIN categories c ON c.category_id = s.category_id
           ORDER BY s.created_at DESC`
        );

    res.render("pages/admin/skills", {
      title: "Manage Skills", pageClass: "page-admin",
      skills, search, unreadNotificationCount: 0,
    });
  } catch (err) { console.error(err); next(err); }
});

// POST /admin/skills/:skillId/delete
router.post("/skills/:skillId/delete", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.query(
      "SELECT skill_id, owner_user_id, title FROM skills WHERE skill_id = ? LIMIT 1",
      [req.params.skillId]
    );
    if (!rows.length) { req.flash("error", "Skill not found."); return res.redirect("/admin/skills"); }
    await db.query("UPDATE skills SET is_active = 0 WHERE skill_id = ?", [req.params.skillId]);
    await createNotification(rows[0].owner_user_id, "MODERATION_ACTION",
      `Your skill listing "${rows[0].title}" was removed by an administrator.`);
    req.flash("success", "Skill removed.");
    res.redirect("/admin/skills");
  } catch (err) { console.error(err); next(err); }
});

// POST /admin/skills/:skillId/restore
router.post("/skills/:skillId/restore", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await db.query("UPDATE skills SET is_active = 1 WHERE skill_id = ?", [req.params.skillId]);
    req.flash("success", "Skill restored.");
    res.redirect("/admin/skills");
  } catch (err) { console.error(err); next(err); }
});

// GET /admin/exchanges
router.get("/exchanges", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const exchanges = await db.query(
      `SELECT e.exchange_id, e.status, e.created_at,
              s.title AS skill_title,
              req.display_name AS requester_name,
              pro.display_name AS provider_name
       FROM exchange_requests e
       JOIN skills s ON s.skill_id = e.skill_id
       JOIN users req ON req.user_id = e.requester_id
       JOIN users pro ON pro.user_id = e.provider_id
       ORDER BY e.created_at DESC`
    );
    res.render("pages/admin/exchanges", {
      title: "Manage Exchanges", pageClass: "page-admin",
      exchanges, unreadNotificationCount: 0,
    });
  } catch (err) { console.error(err); next(err); }
});

// POST /admin/exchanges/:exchangeId/delete
router.post("/exchanges/:exchangeId/delete", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.query(
      "SELECT exchange_id FROM exchange_requests WHERE exchange_id = ? LIMIT 1",
      [req.params.exchangeId]
    );
    if (!rows.length) { req.flash("error", "Exchange not found."); return res.redirect("/admin/exchanges"); }
    await db.query("DELETE FROM exchange_requests WHERE exchange_id = ?", [req.params.exchangeId]);
    req.flash("success", "Exchange deleted.");
    res.redirect("/admin/exchanges");
  } catch (err) { console.error(err); next(err); }
});

// GET /admin/reports
router.get("/reports", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const reports = await db.query(
      `SELECT r.report_id, r.target_type, r.reason, r.status, r.created_at,
              reporter.display_name AS reporter_name,
              target_u.display_name AS target_user_name,
              s.title AS target_skill_title,
              mc.action AS resolved_action, mc.admin_notes
       FROM reports r
       JOIN users reporter ON reporter.user_id = r.created_by_user_id
       LEFT JOIN users target_u ON target_u.user_id = r.target_user_id
       LEFT JOIN skills s ON s.skill_id = r.target_skill_id
       LEFT JOIN moderation_cases mc ON mc.report_id = r.report_id
       ORDER BY FIELD(r.status, 'OPEN', 'RESOLVED'), r.created_at DESC`
    );
    res.render("pages/admin/reports", {
      title: "Moderation Reports", pageClass: "page-admin",
      reports, unreadNotificationCount: 0,
    });
  } catch (err) { console.error(err); next(err); }
});

// PUT /admin/reports/:reportId/review
router.put("/reports/:reportId/review", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT report_id, created_by_user_id, target_type, target_user_id, target_skill_id, status
       FROM reports WHERE report_id = ? LIMIT 1`,
      [req.params.reportId]
    );
    if (!rows.length) { req.flash("error", "Report not found."); return res.redirect("/admin/reports"); }

    const report = rows[0];
    const action = (req.body.action || "NONE").trim().toUpperCase();
    const adminNotes = (req.body.admin_notes || "").trim();

    if (!["NONE", "REMOVE_LISTING", "SUSPEND_USER"].includes(action)) {
      req.flash("error", "Invalid action."); return res.redirect("/admin/reports");
    }

    if (action === "REMOVE_LISTING" && report.target_skill_id)
      await db.query("UPDATE skills SET is_active = 0 WHERE skill_id = ?", [report.target_skill_id]);

    if (action === "SUSPEND_USER" && report.target_user_id) {
      await db.query("UPDATE users SET is_suspended = 1 WHERE user_id = ?", [report.target_user_id]);
      await createNotification(report.target_user_id, "MODERATION_ACTION", "Your account was suspended after moderation review.");
    }

    await db.query("UPDATE reports SET status = 'RESOLVED' WHERE report_id = ?", [report.report_id]);

    const existingCase = await db.query(
      "SELECT case_id FROM moderation_cases WHERE report_id = ? LIMIT 1", [report.report_id]
    );
    if (existingCase.length) {
      await db.query(
        "UPDATE moderation_cases SET action = ?, admin_notes = ?, resolved_at = NOW() WHERE report_id = ?",
        [action, adminNotes, report.report_id]
      );
    } else {
      await db.query(
        `INSERT INTO moderation_cases (case_id, report_id, action, admin_notes, resolved_at) VALUES (?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), report.report_id, action, adminNotes]
      );
    }

    await createNotification(report.created_by_user_id, "REPORT_RESOLVED",
      `Your report has been reviewed. Action: ${action.replace(/_/g, " ")}.`);

    req.flash("success", "Report resolved.");
    res.redirect("/admin/reports");
  } catch (err) { console.error(err); next(err); }
});

module.exports = router;

// GET /admin/organisations
router.get("/organisations", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const search = (req.query.search || "").trim();
    const orgs = search
      ? await db.query(
          `SELECT o.org_id, o.org_name, o.domain, o.visibility, o.created_at,
                  COUNT(DISTINCT m.user_id) AS member_count,
                  COUNT(DISTINCT s.skill_id) AS skill_count
           FROM organisations o
           LEFT JOIN memberships m ON m.org_id = o.org_id AND m.is_active = 1
           LEFT JOIN skills s ON s.org_id = o.org_id AND s.is_active = 1
           WHERE o.org_name LIKE ? OR o.domain LIKE ?
           GROUP BY o.org_id ORDER BY o.created_at DESC`,
          [`%${search}%`, `%${search}%`]
        )
      : await db.query(
          `SELECT o.org_id, o.org_name, o.domain, o.visibility, o.created_at,
                  COUNT(DISTINCT m.user_id) AS member_count,
                  COUNT(DISTINCT s.skill_id) AS skill_count
           FROM organisations o
           LEFT JOIN memberships m ON m.org_id = o.org_id AND m.is_active = 1
           LEFT JOIN skills s ON s.org_id = o.org_id AND s.is_active = 1
           GROUP BY o.org_id ORDER BY o.created_at DESC`
        );

    res.render("pages/admin/organisations", {
      title: "Manage Organisations", pageClass: "page-admin",
      orgs, search, unreadNotificationCount: 0,
    });
  } catch (err) { console.error(err); next(err); }
});

// GET /admin/organisations/:orgId
router.get("/organisations/:orgId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT * FROM organisations WHERE org_id = ? LIMIT 1`,
      [req.params.orgId]
    );
    if (!rows.length) { req.flash("error", "Organisation not found."); return res.redirect("/admin/organisations"); }

    const org = rows[0];
    const members = await db.query(
      `SELECT m.membership_id, m.role, m.is_active, m.joined_at,
              u.user_id, u.display_name, u.email
       FROM memberships m JOIN users u ON u.user_id = m.user_id
       WHERE m.org_id = ? ORDER BY m.role, m.joined_at`,
      [org.org_id]
    );
    const skills = await db.query(
      `SELECT skill_id, title, skill_type, is_active, created_at
       FROM skills WHERE org_id = ? ORDER BY created_at DESC`,
      [org.org_id]
    );
    const invites = await db.query(
      `SELECT invite_id, email, role, expires_at, used_at FROM invites
       WHERE org_id = ? ORDER BY expires_at DESC`,
      [org.org_id]
    );

    res.render("pages/admin/org-detail", {
      title: `Org: ${org.org_name}`, pageClass: "page-admin",
      org, members, skills, invites, unreadNotificationCount: 0,
    });
  } catch (err) { console.error(err); next(err); }
});

// POST /admin/organisations/:orgId/delete
router.post("/organisations/:orgId/delete", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.query("SELECT org_id, org_name FROM organisations WHERE org_id = ? LIMIT 1", [req.params.orgId]);
    if (!rows.length) { req.flash("error", "Organisation not found."); return res.redirect("/admin/organisations"); }
    await db.query("DELETE FROM organisations WHERE org_id = ?", [req.params.orgId]);
    req.flash("success", `Organisation deleted.`);
    res.redirect("/admin/organisations");
  } catch (err) { console.error(err); next(err); }
});

// POST /admin/organisations/:orgId/members/:userId/remove
router.post("/organisations/:orgId/members/:userId/remove", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await db.query("DELETE FROM memberships WHERE org_id = ? AND user_id = ?", [req.params.orgId, req.params.userId]);
    await createNotification(req.params.userId, "MODERATION_ACTION", "You have been removed from an organisation by an administrator.");
    req.flash("success", "Member removed.");
    res.redirect(`/admin/organisations/${req.params.orgId}`);
  } catch (err) { console.error(err); next(err); }
});

// POST /admin/organisations/:orgId/visibility
router.post("/organisations/:orgId/visibility", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const visibility = req.body.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';
    await db.query("UPDATE organisations SET visibility = ? WHERE org_id = ?", [visibility, req.params.orgId]);
    req.flash("success", `Visibility updated to ${visibility}.`);
    res.redirect(`/admin/organisations/${req.params.orgId}`);
  } catch (err) { console.error(err); next(err); }
});
