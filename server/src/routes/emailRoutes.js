const express = require("express");
const router = express.Router();
const { getEmails, getEmailById, updateEmail, deleteEmail, archiveEmail, cancelAction, bulkArchiveEmails, bulkDeleteEmails, bulkCancelAction } = require("../controllers/emailController");
const { protect } = require("../middleware/authMiddleware");
const { refreshGmailToken } = require("../middleware/tokenRefreshMiddleware");

router.use(protect);
router.use(refreshGmailToken);

router.get("/", getEmails);
router.get("/:id", getEmailById);
router.patch("/:id", updateEmail);
router.post("/bulk/archive", bulkArchiveEmails);
router.post("/bulk/delete", bulkDeleteEmails);
router.post("/bulk/cancel-action", bulkCancelAction);
router.delete("/:id", deleteEmail);
router.post("/:id/archive", archiveEmail);
router.post("/:id/cancel-action", cancelAction);


module.exports = router;
