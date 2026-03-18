const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");

passport.use(
 new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:5000/auth/google/callback", // hardcoded for now
  },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // find existing user or create new one
        let user = await User.findOne({ googleId: profile.id });

        const tokenExpiry = new Date(Date.now() + 3600 * 1000); // 1 hr from now

        if (user) {
          // update tokens on every login (they rotate)
          user.accessToken = accessToken;
          user.refreshToken = refreshToken || user.refreshToken;
          user.tokenExpiry = tokenExpiry;
          await user.save();
        } else {
          // first time login → create user
          user = await User.create({
            googleId: profile.id,
            email: profile.emails[0].value,
            name: profile.displayName,
            avatar: profile.photos[0]?.value,
            accessToken,
            refreshToken,
            tokenExpiry,
          });
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

module.exports = passport;
