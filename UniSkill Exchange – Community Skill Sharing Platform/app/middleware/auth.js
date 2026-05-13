"use strict";

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash("error", "Please log in.");
  res.redirect("/auth/login");
}

function guestOnly(req, res, next) {
  if (req.session && req.session.user) return res.redirect("/profile/dashboard");
  next();
}

module.exports = { requireAuth, guestOnly };
