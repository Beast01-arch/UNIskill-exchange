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

async function getMembership(userId, orgId) {
  const rows = await db.query(
    `SELECT membership_id, role, is_active
     FROM memberships
     WHERE user_id = ? AND org_id = ?
     LIMIT 1`,
    [userId, orgId]
  );
  return rows[0] || null;
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;

    const orgs = await db.query(
      `SELECT
          o.org_id,
          o.org_name,
          o.domain,
          o.visibility,
          o.created_at,
          m.role,
          m.is_active,
          (
            SELECT COUNT(*)
            FROM memberships mm
            WHERE mm.org_id = o.org_id AND mm.is_active = 1
          ) AS member_count
       FROM memberships m
       JOIN organisations o ON o.org_id = m.org_id
       WHERE m.user_id = ? AND m.is_active = 1
       ORDER BY o.org_name ASC`,
      [userId]
    );

    const orgIds = orgs.map((org) => org.org_id);
    let membersByOrg = {};
    let invitesByOrg = {};

    if (orgIds.length) {
      const members = await db.query(
        `SELECT m.org_id, u.display_name, u.email, m.role, m.joined_at
         FROM memberships m
         JOIN users u ON u.user_id = m.user_id
         WHERE m.org_id IN (${orgIds.map(() => "?").join(",")}) AND m.is_active = 1
         ORDER BY u.display_name ASC`,
        orgIds
      );

      const invites = await db.query(
        `SELECT org_id, email, role, token, expires_at, used_at
         FROM invites
         WHERE org_id IN (${orgIds.map(() => "?").join(",")})
         ORDER BY expires_at DESC`,
        orgIds
      );

      membersByOrg = members.reduce((acc, member) => {
        acc[member.org_id] = acc[member.org_id] || [];
        acc[member.org_id].push(member);
        return acc;
      }, {});

      invitesByOrg = invites.reduce((acc, invite) => {
        acc[invite.org_id] = acc[invite.org_id] || [];
        acc[invite.org_id].push(invite);
        return acc;
      }, {});
    }

    const unreadNotificationCount = await getUnreadCount(userId);

    res.render("pages/org-dashboard", {
      title: "Organisation workspace",
      pageClass: "page-org-dashboard",
      organisations: orgs.map((org) => ({
        ...org,
        members: membersByOrg[org.org_id] || [],
        invites: invitesByOrg[org.org_id] || [],
      })),
      unreadNotificationCount,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const orgName = (req.body.org_name || "").trim();
    const domain = (req.body.domain || "").trim() || null;
    const visibility = (req.body.visibility || "PRIVATE").trim().toUpperCase();

    if (!orgName) {
      req.flash("error", "Organisation name is required.");
      return res.redirect("/org");
    }

    const orgId = crypto.randomUUID();
    await db.query(
      `INSERT INTO organisations (org_id, org_name, domain, visibility)
       VALUES (?, ?, ?, ?)`,
      [orgId, orgName, domain, ["PUBLIC", "PRIVATE", "INVITE_ONLY"].includes(visibility) ? visibility : "PRIVATE"]
    );

    await db.query(
      `INSERT INTO memberships (membership_id, user_id, org_id, role, is_active)
       VALUES (?, ?, ?, 'OWNER', 1)`,
      [crypto.randomUUID(), req.session.user.user_id, orgId]
    );

    await db.query(
      "UPDATE users SET account_type = 'ORGANISATION_MEMBER' WHERE user_id = ?",
      [req.session.user.user_id]
    );

    await createNotification(
      req.session.user.user_id,
      "ORG_CREATED",
      `Organisation workspace “${orgName}” has been created.`
    );

    req.flash("success", "Organisation workspace created.");
    res.redirect("/org");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post("/:orgId/invite", requireAuth, async (req, res, next) => {
  try {
    const membership = await getMembership(req.session.user.user_id, req.params.orgId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      req.flash("error", "Only organisation owners or admins can send invites.");
      return res.redirect("/org");
    }

    const email = (req.body.email || "").trim().toLowerCase();
    const role = (req.body.role || "MEMBER").trim().toUpperCase();

    if (!email) {
      req.flash("error", "Invite email is required.");
      return res.redirect("/org");
    }

    const token = crypto.randomBytes(20).toString("hex");
    await db.query(
      `INSERT INTO invites
       (invite_id, org_id, email, token, role, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [crypto.randomUUID(), req.params.orgId, email, token, ["OWNER", "ADMIN", "MEMBER"].includes(role) ? role : "MEMBER"]
    );

    req.flash(
      "success",
      `Invite created. Demo link: <a href="/org/join/${token}">Accept organisation invite</a>.`
    );
    res.redirect("/org");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get("/join/:token", requireAuth, async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT i.invite_id, i.org_id, i.email, i.role, i.expires_at, i.used_at, o.org_name
       FROM invites i
       JOIN organisations o ON o.org_id = i.org_id
       WHERE i.token = ?
       LIMIT 1`,
      [req.params.token]
    );

    if (!rows.length) {
      req.flash("error", "That invite could not be found.");
      return res.redirect("/org");
    }

    const invite = rows[0];
    if (invite.used_at) {
      req.flash("info", "This invite has already been used.");
      return res.redirect("/org");
    }

    if (new Date(invite.expires_at) < new Date()) {
      req.flash("error", "This invite has expired.");
      return res.redirect("/org");
    }

    if (invite.email !== req.session.user.email.toLowerCase()) {
      req.flash("error", "This invite was issued for a different email address.");
      return res.redirect("/org");
    }

    const existingMembership = await getMembership(req.session.user.user_id, invite.org_id);
    if (existingMembership) {
      await db.query(
        "UPDATE memberships SET role = ?, is_active = 1 WHERE membership_id = ?",
        [invite.role, existingMembership.membership_id]
      );
    } else {
      await db.query(
        `INSERT INTO memberships (membership_id, user_id, org_id, role, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [crypto.randomUUID(), req.session.user.user_id, invite.org_id, invite.role]
      );
    }

    await db.query("UPDATE invites SET used_at = NOW() WHERE invite_id = ?", [invite.invite_id]);
    await db.query(
      "UPDATE users SET account_type = 'ORGANISATION_MEMBER' WHERE user_id = ?",
      [req.session.user.user_id]
    );

    await createNotification(
      req.session.user.user_id,
      "ORG_JOINED",
      `You joined “${invite.org_name}” as ${invite.role}.`
    );

    req.flash("success", `You joined ${invite.org_name}.`);
    res.redirect("/org");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.put("/membership/:membershipId/role", requireAuth, async (req, res, next) => {
  try {
    const membershipRows = await db.query(
      `SELECT membership_id, org_id, user_id, role
       FROM memberships
       WHERE membership_id = ?
       LIMIT 1`,
      [req.params.membershipId]
    );

    if (!membershipRows.length) {
      req.flash("error", "Membership record not found.");
      return res.redirect("/org");
    }

    const targetMembership = membershipRows[0];
    const actingMembership = await getMembership(req.session.user.user_id, targetMembership.org_id);

    if (!actingMembership || !["OWNER", "ADMIN"].includes(actingMembership.role)) {
      req.flash("error", "You do not have permission to update organisation roles.");
      return res.redirect("/org");
    }

    const nextRole = (req.body.role || "MEMBER").trim().toUpperCase();
    await db.query(
      "UPDATE memberships SET role = ? WHERE membership_id = ?",
      [["OWNER", "ADMIN", "MEMBER"].includes(nextRole) ? nextRole : "MEMBER", targetMembership.membership_id]
    );

    await createNotification(
      targetMembership.user_id,
      "ORG_ROLE_UPDATED",
      `Your organisation role has been updated to ${nextRole}.`
    );

    req.flash("success", "Organisation role updated.");
    res.redirect("/org");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

module.exports = router;
