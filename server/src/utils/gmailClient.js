const { google } = require("googleapis");

const getGmailClient = (user) => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );

  auth.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
  });

  return google.gmail({ version: "v1", auth });
};

module.exports = { getGmailClient };
