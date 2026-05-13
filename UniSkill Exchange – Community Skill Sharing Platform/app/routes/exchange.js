const crypto = require("crypto");
const express = require("express");
const db = require("../services/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

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

async function getExchangeById(exchangeId) {
  const rows = await db.query(
    `SELECT
        e.*,
        s.title AS skill_title,
        s.owner_user_id,
        s.is_active AS skill_is_active,
        requester.display_name AS requester_name,
        provider.display_name AS provider_name,
        sch.schedule_id,
        sch.confirmed_start_at,
        sch.confirmed_end_at,
        sch.mode AS schedule_mode,
        sch.location_url,
        sch.notes AS schedule_notes
     FROM exchange_requests e
     JOIN skills s ON s.skill_id = e.skill_id
     JOIN users requester ON requester.user_id = e.requester_id
     JOIN users provider ON provider.user_id = e.provider_id
     LEFT JOIN schedules sch ON sch.exchange_id = e.exchange_id
     WHERE e.exchange_id = ?
     LIMIT 1`,
    [exchangeId]
  );
  return rows[0] || null;
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;

    const sent = await db.query(
      `SELECT
          e.*,
          s.title AS skill_title,
          requester.display_name AS requester_name,
          provider.display_name AS counterpart_name,
          sch.confirmed_start_at,
          sch.confirmed_end_at,
          sch.mode AS schedule_mode,
          sch.location_url,
          sch.notes AS schedule_notes,
          (
            SELECT COUNT(*)
            FROM ratings r
            WHERE r.exchange_id = e.exchange_id AND r.rater_id = ?
          ) AS has_my_rating
       FROM exchange_requests e
       JOIN skills s ON s.skill_id = e.skill_id
       JOIN users requester ON requester.user_id = e.requester_id
       JOIN users provider ON provider.user_id = e.provider_id
       LEFT JOIN schedules sch ON sch.exchange_id = e.exchange_id
       WHERE e.requester_id = ?
       ORDER BY e.created_at DESC`,
      [userId, userId]
    );

    const received = await db.query(
      `SELECT
          e.*,
          s.title AS skill_title,
          requester.display_name AS counterpart_name,
          provider.display_name AS provider_name,
          sch.confirmed_start_at,
          sch.confirmed_end_at,
          sch.mode AS schedule_mode,
          sch.location_url,
          sch.notes AS schedule_notes,
          (
            SELECT COUNT(*)
            FROM ratings r
            WHERE r.exchange_id = e.exchange_id AND r.rater_id = ?
          ) AS has_my_rating
       FROM exchange_requests e
       JOIN skills s ON s.skill_id = e.skill_id
       JOIN users requester ON requester.user_id = e.requester_id
       JOIN users provider ON provider.user_id = e.provider_id
       LEFT JOIN schedules sch ON sch.exchange_id = e.exchange_id
       WHERE e.provider_id = ?
       ORDER BY e.created_at DESC`,
      [userId, userId]
    );

    const unreadNotificationCount = await getUnreadCount(userId);

    res.render("pages/my-exchanges", {
      title: "My exchanges",
      pageClass: "page-exchanges",
      sentExchanges: sent,
      receivedExchanges: received,
      unreadNotificationCount,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post("/request/:skillId", requireAuth, async (req, res, next) => {
  try {
    const skillRows = await db.query(
      `SELECT skill_id, owner_user_id, title, is_active, mode
       FROM skills
       WHERE skill_id = ?
       LIMIT 1`,
      [req.params.skillId]
    );

    if (!skillRows.length) {
      req.flash("error", "That skill listing no longer exists.");
      return res.redirect("/skills");
    }

    const skill = skillRows[0];
    if (!Number(skill.is_active)) {
      req.flash("error", "That skill listing is no longer active.");
      return res.redirect(`/skills/${req.params.skillId}`);
    }

    if (skill.owner_user_id === req.session.user.user_id) {
      req.flash("error", "You cannot request your own skill listing.");
      return res.redirect(`/skills/${req.params.skillId}`);
    }

    const blockedRows = await db.query(
      `SELECT blocker_id, blocked_id
       FROM user_blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`,
      [req.session.user.user_id, skill.owner_user_id, skill.owner_user_id, req.session.user.user_id]
    );

    if (blockedRows.length) {
      req.flash("error", "You cannot send a request because one of the accounts is blocked.");
      return res.redirect(`/skills/${req.params.skillId}`);
    }

    const message = (req.body.message || "").trim();
    const mode = (req.body.mode || skill.mode || "ONLINE").trim().toUpperCase();
    const proposedSlot1 = (req.body.proposed_slot_1 || "").trim() || null;
    const proposedSlot2 = (req.body.proposed_slot_2 || "").trim() || null;

    if (!message) {
      req.flash("error", "Add a short message to explain your exchange request.");
      return res.redirect(`/skills/${req.params.skillId}`);
    }

    const exchangeId = crypto.randomUUID();
    await db.query(
      `INSERT INTO exchange_requests
       (exchange_id, skill_id, requester_id, provider_id, status, message, mode, proposed_slot_1, proposed_slot_2, version)
       VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, 1)`,
      [
        exchangeId,
        skill.skill_id,
        req.session.user.user_id,
        skill.owner_user_id,
        message,
        ["ONLINE", "IN_PERSON", "BOTH"].includes(mode) ? mode : "ONLINE",
        proposedSlot1 || null,
        proposedSlot2 || null,
      ]
    );

    await createNotification(
      skill.owner_user_id,
      "EXCHANGE_REQUEST",
      `${req.session.user.display_name} requested “${skill.title}”.`
    );
    await createNotification(
      req.session.user.user_id,
      "EXCHANGE_REQUEST",
      `Your request for “${skill.title}” has been sent.`
    );

    req.flash("success", "Exchange request sent.");
    res.redirect("/exchanges");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.put("/:exchangeId/accept", requireAuth, async (req, res, next) => {
  try {
    const exchange = await getExchangeById(req.params.exchangeId);
    if (!exchange) {
      req.flash("error", "Exchange request not found.");
      return res.redirect("/exchanges");
    }

    if (exchange.provider_id !== req.session.user.user_id) {
      req.flash("error", "Only the provider can accept this exchange.");
      return res.redirect("/exchanges");
    }

    if (exchange.status !== "PENDING") {
      req.flash("error", "Only pending requests can be accepted.");
      return res.redirect("/exchanges");
    }

    const selectedSlot = (req.body.selected_slot || "").trim();
    const customStart = (req.body.custom_start || "").trim();
    const customEnd = (req.body.custom_end || "").trim();
    const notes = (req.body.notes || "").trim();
    const locationUrl = (req.body.location_url || "").trim() || null;
    const scheduleMode = (req.body.mode || exchange.mode || "ONLINE").trim().toUpperCase();

    let confirmedStart = null;
    let confirmedEnd = null;

    if (selectedSlot === "slot_1" && exchange.proposed_slot_1) {
      confirmedStart = exchange.proposed_slot_1;
    } else if (selectedSlot === "slot_2" && exchange.proposed_slot_2) {
      confirmedStart = exchange.proposed_slot_2;
    } else if (customStart) {
      confirmedStart = customStart;
    }

    if (customEnd) {
      confirmedEnd = customEnd;
    }

    if (!confirmedStart) {
      req.flash("error", "Choose one proposed slot or provide a custom confirmed time.");
      return res.redirect("/exchanges");
    }

    if (!confirmedEnd) {
      const baseTime = new Date(confirmedStart);
      confirmedEnd = new Date(baseTime.getTime() + 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
    }

    await db.query(
      `UPDATE exchange_requests
       SET status = 'ACCEPTED', confirmed_slot = ?, version = version + 1, decision_reason = NULL
       WHERE exchange_id = ?`,
      [confirmedStart, exchange.exchange_id]
    );

    if (exchange.schedule_id) {
      await db.query(
        `UPDATE schedules
         SET confirmed_start_at = ?, confirmed_end_at = ?, mode = ?, location_url = ?, notes = ?
         WHERE exchange_id = ?`,
        [confirmedStart, confirmedEnd, scheduleMode, locationUrl, notes, exchange.exchange_id]
      );
    } else {
      await db.query(
        `INSERT INTO schedules
         (schedule_id, exchange_id, confirmed_start_at, confirmed_end_at, mode, location_url, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), exchange.exchange_id, confirmedStart, confirmedEnd, scheduleMode, locationUrl, notes]
      );
    }

    await createNotification(
      exchange.requester_id,
      "EXCHANGE_ACCEPTED",
      `Your request for “${exchange.skill_title}” was accepted.`
    );
    req.flash("success", "Exchange accepted and scheduled.");
    res.redirect("/exchanges");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.put("/:exchangeId/reject", requireAuth, async (req, res, next) => {
  try {
    const exchange = await getExchangeById(req.params.exchangeId);
    if (!exchange) {
      req.flash("error", "Exchange request not found.");
      return res.redirect("/exchanges");
    }

    if (exchange.provider_id !== req.session.user.user_id) {
      req.flash("error", "Only the provider can reject this exchange.");
      return res.redirect("/exchanges");
    }

    if (exchange.status !== "PENDING") {
      req.flash("error", "Only pending requests can be rejected.");
      return res.redirect("/exchanges");
    }

    const reason = (req.body.reason || "").trim() || null;
    await db.query(
      `UPDATE exchange_requests
       SET status = 'REJECTED', decision_reason = ?, version = version + 1
       WHERE exchange_id = ?`,
      [reason, exchange.exchange_id]
    );

    await createNotification(
      exchange.requester_id,
      "EXCHANGE_REJECTED",
      reason
        ? `Your request for “${exchange.skill_title}” was rejected: ${reason}`
        : `Your request for “${exchange.skill_title}” was rejected.`
    );

    req.flash("success", "Exchange request rejected.");
    res.redirect("/exchanges");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.put("/:exchangeId/complete", requireAuth, async (req, res, next) => {
  try {
    const exchange = await getExchangeById(req.params.exchangeId);
    if (!exchange) {
      req.flash("error", "Exchange request not found.");
      return res.redirect("/exchanges");
    }

    const isParty =
      exchange.requester_id === req.session.user.user_id ||
      exchange.provider_id === req.session.user.user_id;

    if (!isParty) {
      req.flash("error", "Only participants can complete an exchange.");
      return res.redirect("/exchanges");
    }

    if (exchange.status === "COMPLETED") {
      req.flash("info", "This exchange has already been marked completed.");
      return res.redirect("/exchanges");
    }

    if (exchange.status !== "ACCEPTED") {
      req.flash("error", "Only accepted exchanges can be marked completed.");
      return res.redirect("/exchanges");
    }

    await db.query(
      "UPDATE exchange_requests SET status = 'COMPLETED', version = version + 1 WHERE exchange_id = ?",
      [exchange.exchange_id]
    );

    const otherUserId =
      exchange.requester_id === req.session.user.user_id ? exchange.provider_id : exchange.requester_id;

    await createNotification(
      otherUserId,
      "EXCHANGE_COMPLETED",
      `An exchange for “${exchange.skill_title}” has been marked completed.`
    );
    await createNotification(
      req.session.user.user_id,
      "EXCHANGE_COMPLETED",
      `You marked “${exchange.skill_title}” as completed.`
    );

    req.flash("success", "Exchange marked as completed. Ratings are now unlocked.");
    res.redirect("/exchanges");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post("/:exchangeId/rate", requireAuth, async (req, res, next) => {
  try {
    const exchange = await getExchangeById(req.params.exchangeId);
    if (!exchange) {
      req.flash("error", "Exchange request not found.");
      return res.redirect("/exchanges");
    }

    const isParty =
      exchange.requester_id === req.session.user.user_id ||
      exchange.provider_id === req.session.user.user_id;

    if (!isParty) {
      req.flash("error", "Only participants can rate this exchange.");
      return res.redirect("/exchanges");
    }

    if (exchange.status !== "COMPLETED") {
      req.flash("error", "Ratings unlock only after the exchange is completed.");
      return res.redirect("/exchanges");
    }

    const score = Number(req.body.score || 0);
    const comment = (req.body.comment || "").trim();
    const ratedId =
      exchange.requester_id === req.session.user.user_id ? exchange.provider_id : exchange.requester_id;

    if (score < 1 || score > 5) {
      req.flash("error", "Choose a rating score between 1 and 5.");
      return res.redirect("/exchanges");
    }

    const existing = await db.query(
      "SELECT rating_id FROM ratings WHERE exchange_id = ? AND rater_id = ? LIMIT 1",
      [exchange.exchange_id, req.session.user.user_id]
    );

    if (existing.length) {
      req.flash("info", "You have already rated this exchange.");
      return res.redirect("/exchanges");
    }

    await db.query(
      `INSERT INTO ratings
       (rating_id, exchange_id, rater_id, rated_id, score, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), exchange.exchange_id, req.session.user.user_id, ratedId, score, comment]
    );

    const aggregates = await db.query(
      "SELECT ROUND(AVG(score), 2) AS avg_rating, COUNT(*) AS rating_count FROM ratings WHERE rated_id = ?",
      [ratedId]
    );

    await db.query(
      "UPDATE profiles SET avg_rating = ?, rating_count = ? WHERE user_id = ?",
      [aggregates[0].avg_rating || 0, aggregates[0].rating_count || 0, ratedId]
    );

    await createNotification(
      ratedId,
      "EXCHANGE_RATED",
      `You received a new rating for “${exchange.skill_title}”.`
    );
    await createNotification(
      req.session.user.user_id,
      "EXCHANGE_RATED",
      `Your rating for “${exchange.skill_title}” has been saved.`
    );

    req.flash("success", "Thanks. Your rating has been recorded.");
    res.redirect("/exchanges");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

module.exports = router;
