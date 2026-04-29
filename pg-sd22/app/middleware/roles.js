"use strict";

const db = require("../services/db");

function redirectForLoggedInUser(req, res) {
  if (req.session && req.session.user && req.session.user.role === "ADMIN") {
    return res.redirect("/admin/dashboard");
  }
  return res.redirect("/profile/dashboard");
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  req.flash("error", "Please log in to continue.");
  return res.redirect("/auth/login");
}

function guestOnly(req, res, next) {
  if (req.session && req.session.user) {
    return redirectForLoggedInUser(req, res);
  }
  return next();
}

function adminOnly(req, res, next) {
  if (!req.session || !req.session.user) {
    req.flash("error", "Please log in to access this area.");
    return res.redirect("/admin/login");
  }
  if (req.session.user.role !== "ADMIN") {
    req.flash("error", "Access denied. Administrator privileges required.");
    return res.status(403).render("pages/403", {
      title: "Access Denied",
      pageClass: "page-403",
    });
  }
  return next();
}

function resolveMaybeFunction(valueOrResolver, req) {
  if (typeof valueOrResolver === "function") {
    return valueOrResolver(req);
  }
  return valueOrResolver;
}

function requireOwner(ownerUserIdOrResolver) {
  return async function requireOwnerMiddleware(req, res, next) {
    try {
      if (!req.session || !req.session.user) {
        req.flash("error", "Please log in to continue.");
        return res.redirect("/auth/login");
      }

      if (req.session.user.role === "ADMIN") {
        return next();
      }

      const ownerUserId = await resolveMaybeFunction(ownerUserIdOrResolver, req);

      if (!ownerUserId) {
        req.flash("error", "The requested resource could not be found.");
        return res.redirect("/skills");
      }

      if (ownerUserId !== req.session.user.user_id) {
        req.flash("error", "You do not have permission to manage this resource.");
        return res.status(403).render("pages/403", {
          title: "Access Denied",
          pageClass: "page-403",
        });
      }

      return next();
    } catch (err) {
      console.error(err);
      return next(err);
    }
  };
}

function requireParticipant(exchangeOrResolver) {
  return async function requireParticipantMiddleware(req, res, next) {
    try {
      if (!req.session || !req.session.user) {
        req.flash("error", "Please log in to continue.");
        return res.redirect("/auth/login");
      }

      if (req.session.user.role === "ADMIN") {
        return next();
      }

      const exchange = await resolveMaybeFunction(exchangeOrResolver, req);

      if (!exchange) {
        req.flash("error", "Exchange not found.");
        return res.redirect("/exchange/my");
      }

      const userId = req.session.user.user_id;
      const isParticipant =
        exchange.requester_id === userId || exchange.provider_id === userId;

      if (!isParticipant) {
        req.flash("error", "You are not a participant in this exchange.");
        return res.status(403).render("pages/403", {
          title: "Access Denied",
          pageClass: "page-403",
        });
      }

      req.exchangeResource = exchange;
      return next();
    } catch (err) {
      console.error(err);
      return next(err);
    }
  };
}

function requireOrgAdmin(orgIdOrResolver) {
  return async function requireOrgAdminMiddleware(req, res, next) {
    try {
      if (!req.session || !req.session.user) {
        req.flash("error", "Please log in to continue.");
        return res.redirect("/auth/login");
      }

      if (req.session.user.role === "ADMIN") {
        return next();
      }

      const orgId = await resolveMaybeFunction(orgIdOrResolver, req);

      if (!orgId) {
        req.flash("error", "Organisation not found.");
        return res.redirect("/org/create");
      }

      const rows = await db.query(
        `SELECT membership_id
         FROM memberships
         WHERE org_id = ?
           AND user_id = ?
           AND is_active = 1
           AND role IN ('OWNER', 'ADMIN')
         LIMIT 1`,
        [orgId, req.session.user.user_id]
      );

      if (!rows.length) {
        req.flash(
          "error",
          "You need OWNER or ADMIN permissions for this organisation."
        );
        return res.status(403).render("pages/403", {
          title: "Access Denied",
          pageClass: "page-403",
        });
      }

      req.orgMembership = rows[0];
      return next();
    } catch (err) {
      console.error(err);
      return next(err);
    }
  };
}

module.exports = {
  requireAuth,
  guestOnly,
  adminOnly,
  requireOwner,
  requireParticipant,
  requireOrgAdmin,
};