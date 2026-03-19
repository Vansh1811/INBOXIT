const express = require("express");
const router = express.Router();
const { getEmails, getEmailById, updateEmail, deleteEmail, archiveEmail } = require("../controllers/emailController");
const { protect } = require("../middleware/authMiddleware");
const { refreshGmailToken } = require("../middleware/tokenRefreshMiddleware");

router.use(protect);
router.use(refreshGmailToken);

router.get("/", getEmails);
router.get("/:id", getEmailById);
router.patch("/:id", updateEmail);
router.delete("/:id", deleteEmail);
router.post("/:id/archive", archiveEmail);


module.exports = router;
