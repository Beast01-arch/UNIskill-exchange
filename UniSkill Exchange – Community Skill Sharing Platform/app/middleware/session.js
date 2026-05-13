"use strict";

const db = require("../services/db");

async function sessionValidator(req, res, next) {
  try {
    if (!req.session || !req.session.user || !req.session.user.user_id) {
      return next();
    }

    const rows = await db.query(
      `SELECT user_id, display_name, email, account_type, email_verified, is_suspended, is_admin
       FROM users
       WHERE user_id = ?
       LIMIT 1`,
      [req.session.user.user_id]
    );

    if (!rows.length) {
      return req.session.destroy((err) => {
        if (err) {
          console.error(err);
          return next(err);
        }
        res.clearCookie("uniskill.sid");
        req.flash("error", "Your session is no longer valid. Please log in again.");
        return res.redirect("/auth/login");
      });
    }

    const liveUser = rows[0];

    if (Number(liveUser.is_suspended) === 1) {
      return req.session.destroy((err) => {
        if (err) {
          console.error(err);
          return next(err);
        }
        res.clearCookie("uniskill.sid");
        req.flash("error", "Your account has been suspended.");
        return res.redirect("/auth/login");
      });
    }

    req.session.user = {
      user_id: liveUser.user_id,
      display_name: liveUser.display_name,
      email: liveUser.email,
      account_type: liveUser.account_type,
      email_verified: Number(liveUser.email_verified) === 1,
      is_admin: Number(liveUser.is_admin) === 1,
    };

    return next();
  } catch (err) {
    console.error(err);
    return next(err);
  }
}

module.exports = sessionValidator;