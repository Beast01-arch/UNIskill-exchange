"use strict";

const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../services/db");
const { requireAuth, guestOnly } = require("../middleware/auth");

const router = express.Router();

async function createNotification(userId, type, message) {
  await db.query(
    "INSERT INTO notifications (notification_id, user_id, type, message) VALUES (?, ?, ?, ?)",
    [crypto.randomUUID(), userId, type, message]
  );
}

async function createEmailVerification(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  await db.query(
    "INSERT INTO email_verification_tokens (token_id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 2 DAY))",
    [crypto.randomUUID(), userId, token]
  );
  return token;
}

router.get("/register", guestOnly, (req, res) => {
  res.render("pages/register", {
    title: "Create account", pageClass: "page-register",
    unreadNotificationCount: 0,
    values: { display_name: "", email: "" },
  });
});

router.post("/register", guestOnly, async (req, res, next) => {
  try {
    const displayName = (req.body.display_name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const confirmPassword = req.body.confirm_password || "";

    if (!displayName || !email || !password) {
      req.flash("error", "All fields are required.");
      return res.status(422).render("pages/register", {
        title: "Create account", pageClass: "page-register",
        unreadNotificationCount: 0, values: { display_name: displayName, email },
      });
    }
    if (password.length < 8) {
      req.flash("error", "Password must be at least 8 characters.");
      return res.status(422).render("pages/register", {
        title: "Create account", pageClass: "page-register",
        unreadNotificationCount: 0, values: { display_name: displayName, email },
      });
    }
    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.status(422).render("pages/register", {
        title: "Create account", pageClass: "page-register",
        unreadNotificationCount: 0, values: { display_name: displayName, email },
      });
    }

    const existing = await db.query("SELECT user_id FROM users WHERE email = ? LIMIT 1", [email]);
    if (existing.length) {
      req.flash("error", "An account already exists for that email.");
      return res.status(409).render("pages/register", {
        title: "Create account", pageClass: "page-register",
        unreadNotificationCount: 0, values: { display_name: displayName, email },
      });
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const avatarInitial = displayName.charAt(0).toUpperCase();

    await db.query(
      `INSERT INTO users
       (user_id, display_name, email, password_hash, avatar_initial, privacy_level,
        email_verified, is_suspended, is_admin, account_type)
       VALUES (?, ?, ?, ?, ?, 'PUBLIC', 0, 0, 0, 'INDIVIDUAL')`,
      [userId, displayName, email, passwordHash, avatarInitial]
    );

    const token = await createEmailVerification(userId);
    await createNotification(userId, "EMAIL_VERIFICATION", "Verify your email to increase trust on your profile.");

    req.flash("success", `Account created. Demo verification link: <a href="/auth/verify/${token}">Verify your email</a>.`);
    res.redirect("/auth/login");
  } catch (err) {
    next(err);
  }
});

router.get("/verify/:token", async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT token_id, user_id FROM email_verification_tokens
       WHERE token = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [req.params.token]
    );
    if (!rows.length) {
      req.flash("error", "That verification link is invalid or expired.");
      return res.redirect("/auth/login");
    }
    const record = rows[0];
    await db.query("UPDATE users SET email_verified = 1 WHERE user_id = ?", [record.user_id]);
    await db.query("UPDATE email_verification_tokens SET used_at = NOW() WHERE token_id = ?", [record.token_id]);
    await createNotification(record.user_id, "EMAIL_VERIFIED", "Your email has been verified.");
    if (req.session && req.session.user && req.session.user.user_id === record.user_id) {
      req.session.user.email_verified = 1;
    }
    req.flash("success", "Email verified successfully.");
    res.redirect(req.session && req.session.user ? "/profile/dashboard" : "/auth/login");
  } catch (err) {
    next(err);
  }
});

router.get("/resend-verification", async (req, res, next) => {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      req.flash("error", "Provide the email address for your account.");
      return res.redirect("/auth/login");
    }
    const users = await db.query("SELECT user_id, email_verified FROM users WHERE email = ? LIMIT 1", [email]);
    if (!users.length) {
      req.flash("error", "No account found for that email.");
      return res.redirect("/auth/login");
    }
    if (users[0].email_verified) {
      req.flash("info", "That account is already verified.");
      return res.redirect("/auth/login");
    }
    const token = await createEmailVerification(users[0].user_id);
    req.flash("success", `Demo verification link: <a href="/auth/verify/${token}">Verify your email</a>.`);
    res.redirect("/auth/login");
  } catch (err) {
    next(err);
  }
});

router.get("/login", guestOnly, (req, res) => {
  res.render("pages/login", {
    title: "Log in", pageClass: "page-login",
    unreadNotificationCount: 0,
    values: { email: req.query.email || "" },
  });
});

router.post("/login", guestOnly, async (req, res, next) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    const users = await db.query(
      `SELECT user_id, display_name, email, password_hash, email_verified, is_suspended, is_admin
       FROM users WHERE email = ? LIMIT 1`,
      [email]
    );

    if (!users.length) {
      req.flash("error", "Invalid email or password.");
      return res.status(401).render("pages/login", {
        title: "Log in", pageClass: "page-login", unreadNotificationCount: 0, values: { email },
      });
    }

    const user = users[0];
    if (user.is_suspended) {
      req.flash("error", "This account is suspended.");
      return res.redirect("/auth/login");
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      req.flash("error", "Invalid email or password.");
      return res.status(401).render("pages/login", {
        title: "Log in", pageClass: "page-login", unreadNotificationCount: 0, values: { email },
      });
    }

    req.session.user = {
      user_id: user.user_id,
      display_name: user.display_name,
      email: user.email,
      email_verified: Number(user.email_verified) === 1,
      is_admin: Number(user.is_admin) === 1,
    };

    await db.query("UPDATE users SET last_login_at = NOW() WHERE user_id = ?", [user.user_id]);
    await createNotification(user.user_id, "LOGIN", "You signed in to UniSkill Exchange.");

    if (!user.email_verified) {
      const token = await createEmailVerification(user.user_id);
      req.flash("warning", `Your email is not verified. Demo link: <a href="/auth/verify/${token}">Verify now</a>.`);
    }

    res.redirect("/profile/dashboard");
  } catch (err) {
    next(err);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    req.session.user = null;
    req.flash("success", "You have been logged out.");
    req.session.save((err) => {
      if (err) return next(err);
      res.clearCookie("uniskill.sid");
      res.redirect("/");
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;