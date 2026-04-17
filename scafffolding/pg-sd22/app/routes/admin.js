"use strict";

const crypto = require("crypto");
const express = require("express");
const db = require("../services/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.is_admin) return next();
  req.flash("error", "Administrator access required.");
  return res.redirect("/profile/dashboard");
}

async function createNotification(userId, type, message) {
  await db.query(
    "INSERT INTO notifications (notification_id, user_id, type, message) VALUES (?, ?, ?, ?)",
    [crypto.randomUUID(), userId, type, message]
  );
}

router.get("/", requireAuth, requireAdmin, (req, res) => {
  res.redirect("/profile/dashboard?tab=admin");
});

router.put("/reports/:reportId/review", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT report_id, created_by_user_id, target_type, target_user_id, target_skill_id, status
       FROM reports WHERE report_id = ? LIMIT 1`,
      [req.params.reportId]
    );
    if (!rows.length) {
      req.flash("error", "Report not found.");
      return res.redirect("/profile/dashboard?tab=admin");
    }

    const report = rows[0];
    const action = (req.body.action || "NONE").trim().toUpperCase();
    const adminNotes = (req.body.admin_notes || "").trim();

    if (!["NONE", "REMOVE_LISTING", "SUSPEND_USER"].includes(action)) {
      req.flash("error", "Invalid action.");
      return res.redirect("/profile/dashboard?tab=admin");
    }

    if (action === "REMOVE_LISTING" && report.target_skill_id) {
      await db.query("UPDATE skills SET is_active = 0 WHERE skill_id = ?", [report.target_skill_id]);
    }
    if (action === "SUSPEND_USER" && report.target_user_id) {
      await db.query("UPDATE users SET is_suspended = 1 WHERE user_id = ?", [report.target_user_id]);
      await createNotification(report.target_user_id, "MODERATION_ACTION", "Your account was suspended after review.");
    }

    await db.query(
      `UPDATE reports SET status = 'RESOLVED', mod_action = ?, admin_notes = ?, resolved_at = NOW()
       WHERE report_id = ?`,
      [action, adminNotes, report.report_id]
    );

    await createNotification(
      report.created_by_user_id, "REPORT_RESOLVED",
      `Your report was reviewed. Action taken: ${action.replace(/_/g, " ")}.`
    );

    req.flash("success", "Moderation case resolved.");
    res.redirect("/profile/dashboard?tab=admin");
  } catch (err) {
    next(err);
  }
});

module.exports = router;