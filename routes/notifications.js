const router = require("express").Router();
const controller = require("../controllers/notificationController");

router.post("/", controller.sendNotification);
router.get("/", controller.getNotifications);
router.post("/council", controller.sendCouncilNotification);


module.exports = router;
