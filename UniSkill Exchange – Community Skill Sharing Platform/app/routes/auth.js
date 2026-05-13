const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../services/db");
const { requireAuth, guestOnly } = require("../middleware/auth");

const router = express.Router();

function buildAvatarInitial(name) {
  if (!name) return "U";
  const cleaned = name.trim();
  if (!cleaned) return "U";
  return cleaned.charAt(0).toUpperCase();
}

function buildVerificationToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function createNotification(userId, type, message) {
  await db.query(
    "INSERT INTO notifications (notification_id, user_id, type, message) VALUES (?, ?, ?, ?)",
    [crypto.randomUUID(), userId, type, message]
  );
}

async function createEmailVerification(userId) {
  const token = buildVerificationToken();
  await db.query(
    "INSERT INTO email_verification_tokens (token_id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 2 DAY))",
    [crypto.randomUUID(), userId, token]
  );
  return token;
}

router.get("/register", guestOnly, async (req, res, next) => {
  try {
    res.render("pages/register", {
      title: "Create account",
      pageClass: "page-register",
      unreadNotificationCount: 0,
      values: {
        display_name: "",
        age: "",
        email: "",
      },
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post("/register", guestOnly, async (req, res, next) => {
  try {
    const displayName = (req.body.display_name || "").trim();
    const age = parseInt(req.body.age || "0", 10);
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const confirmPassword = req.body.confirm_password || "";

    if (!displayName || !email || !password) {
      req.flash("error", "Display name, email, and password are required.");
      return res.status(422).render("pages/register", {
        title: "Create account",
        pageClass: "page-register",
        unreadNotificationCount: 0,
        values: { display_name: displayName, age, email },
      });
    }

    if (!age || age < 13 || age > 120) {
      req.flash("error", "Please enter a valid age (13–120).");
      return res.status(422).render("pages/register", {
        title: "Create account",
        pageClass: "page-register",
        unreadNotificationCount: 0,
        values: { display_name: displayName, age, email },
      });
    }

    if (password.length < 8) {
      req.flash("error", "Password must be at least 8 characters long.");
      return res.status(422).render("pages/register", {
        title: "Create account",
        pageClass: "page-register",
        unreadNotificationCount: 0,
        values: { display_name: displayName, age, email },
      });
    }

    if (password !== confirmPassword) {
      req.flash("error", "Password confirmation does not match.");
      return res.status(422).render("pages/register", {
        title: "Create account",
        pageClass: "page-register",
        unreadNotificationCount: 0,
        values: { display_name: displayName, age, email },
      });
    }

    const existing = await db.query("SELECT user_id FROM users WHERE email = ? LIMIT 1", [email]);
    if (existing.length) {
      req.flash("error", "An account already exists for that email address.");
      return res.status(409).render("pages/register", {
        title: "Create account",
        pageClass: "page-register",
        unreadNotificationCount: 0,
        values: { display_name: displayName, age, email },
      });
    }

    const userId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const isAdmin = email.startsWith("admin@");

    await db.query(
      `INSERT INTO users
       (user_id, display_name, age, email, password_hash, account_type, email_verified, is_suspended, is_admin)
       VALUES (?, ?, ?, ?, ?, 'INDIVIDUAL', 0, 0, ?)`,
      [userId, displayName, age, email, passwordHash, isAdmin ? 1 : 0]
    );

    await db.query(
      `INSERT INTO profiles
       (profile_id, user_id, bio, headline, location, avatar_initial, privacy_level)
       VALUES (?, ?, '', '', '', ?, 'PUBLIC')`,
      [profileId, userId, buildAvatarInitial(displayName)]
    );

    const token = await createEmailVerification(userId);
    await createNotification(
      userId,
      "EMAIL_VERIFICATION",
      "Your verification link is ready. Verify your email to increase trust on your profile."
    );

    req.flash(
      "success",
      `Account created. Demo verification link: <a href="/auth/verify/${token}">Verify your email</a>.`
    );
    res.redirect("/auth/login");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get("/verify/:token", async (req, res, next) => {
  try {
    const token = req.params.token;
    const rows = await db.query(
      `SELECT token_id, user_id
       FROM email_verification_tokens
       WHERE token = ? AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [token]
    );

    if (!rows.length) {
      req.flash("error", "That verification link is invalid or has expired.");
      return res.redirect("/auth/login");
    }

    const record = rows[0];
    await db.query("UPDATE users SET email_verified = 1 WHERE user_id = ?", [record.user_id]);
    await db.query("UPDATE email_verification_tokens SET used_at = NOW() WHERE token_id = ?", [record.token_id]);
    await createNotification(record.user_id, "EMAIL_VERIFIED", "Your email address has been verified.");

    if (req.session && req.session.user && req.session.user.user_id === record.user_id) {
      req.session.user.email_verified = 1;
    }

    req.flash("success", "Email verified successfully. You can now use a fully trusted account.");
    res.redirect(req.session && req.session.user ? "/profile/dashboard" : "/auth/login");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get("/resend-verification", async (req, res, next) => {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) {
      req.flash("error", "Provide the email address used for your account.");
      return res.redirect("/auth/login");
    }

    const users = await db.query(
      "SELECT user_id, email_verified FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (!users.length) {
      req.flash("error", "No account was found for that email.");
      return res.redirect("/auth/login");
    }

    if (users[0].email_verified) {
      req.flash("info", "That account has already been verified.");
      return res.redirect("/auth/login");
    }

    const token = await createEmailVerification(users[0].user_id);
    await createNotification(
      users[0].user_id,
      "EMAIL_VERIFICATION",
      "A fresh email verification link has been generated for your account."
    );
    req.flash(
      "success",
      `New demo verification link: <a href="/auth/verify/${token}">Verify your email</a>.`
    );
    res.redirect("/auth/login");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get("/login", guestOnly, async (req, res, next) => {
  try {
    res.render("pages/login", {
      title: "Log in",
      pageClass: "page-login",
      unreadNotificationCount: 0,
      values: {
        email: req.query.email || "",
      },
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
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
        title: "Log in",
        pageClass: "page-login",
        unreadNotificationCount: 0,
        values: { email },
      });
    }

    const user = users[0];
    if (user.is_suspended) {
      req.flash("error", "This account is suspended. Contact an administrator.");
      return res.redirect("/auth/login");
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      req.flash("error", "Invalid email or password.");
      return res.status(401).render("pages/login", {
        title: "Log in",
        pageClass: "page-login",
        unreadNotificationCount: 0,
        values: { email },
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
      req.flash(
        "warning",
        `Your email is still unverified. Demo verification link: <a href="/auth/verify/${token}">Verify now</a>.`
      );
    }

    res.redirect("/profile/dashboard");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    req.session.user = null;
    req.flash("success", "You have been logged out.");
    req.session.save((err) => {
      if (err) {
        console.error(err);
        return next(err);
      }
      res.clearCookie("uniskill.sid");
      res.redirect("/");
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

module.exports = router;