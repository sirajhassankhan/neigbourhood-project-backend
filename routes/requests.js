const router = require("express").Router();
const controller = require("../controllers/requestController");

router.get("/", controller.getAllRequests);
router.get("/pending", controller.getPendingRequests);
router.post("/approve", controller.approveRequest);
router.post("/reject", controller.rejectRequest);
router.get("/pending-count", controller.getPendingCount);
router.post("/approve-change-council", controller.approveChangeCouncil);
router.post("/approve-add-council", controller.approveAddCouncil);
router.get("/user-councils/:cnic", controller.getUserCouncils);
router.post("/change-primary-council", controller.changePrimaryCouncil);
module.exports = router;