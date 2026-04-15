const path = require("path"); 
const express = require("express");
const session = require("express-session");
const flash = require("connect-flash");
const methodOverride = require("method-override");

const homeRoutes = require("./routes/home");
const authRoutes = require("./routes/auth");
const skillsRoutes = require("./routes/skills");
const exchangeRoutes = require("./routes/exchange");
const profileRoutes = require("./routes/profile");
const orgRoutes = require("./routes/org");
const adminRoutes = require("./routes/admin");

const app = express();

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "../views"));
app.locals.basedir = path.join(__dirname, "../views");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "../static")));

app.use(
  session({
    name: "uniskill.sid",
    secret: process.env.SESSION_SECRET || "uniskill-exchange-session-secret",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: 1000 * 60 * 60 * 6,
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    },
  })
);

app.use(flash());

app.use((req, res, next) => {
  res.locals.currentUser = req.session && req.session.user ? req.session.user : null;
  res.locals.currentPath = req.originalUrl ? req.originalUrl.split("?")[0] : req.path;
  res.locals.flash = {
    success: req.flash("success"),
    error: req.flash("error"),
    warning: req.flash("warning"),
    info: req.flash("info"),
  };
  res.locals.unreadNotificationCount = 0;
  next();
});

app.use("/", homeRoutes);
app.use("/auth", authRoutes);
app.use("/skills", skillsRoutes);
app.use("/exchanges", exchangeRoutes);
app.use("/profile", profileRoutes);
app.use("/org", orgRoutes);
app.use("/admin", adminRoutes);

app.use((req, res) => {
  res.status(404).render("pages/404", {
    title: "Page not found",
    pageClass: "page-404",
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).render("pages/error", {
    title: "Application error",
    pageClass: "page-error",
    errorMessage: err.message || "Something went wrong while loading UniSkill Exchange.",
  });
});

app.listen(3000, function () {
  console.log("Server running at http://127.0.0.1:3000/");
});

module.exports = app;
