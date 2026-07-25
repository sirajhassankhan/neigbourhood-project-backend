const router = require("express").Router();
const controller = require("../controllers/requestController");

router.get("/", controller.getAllRequests);
router.get("/pending", controller.getPendingRequests);
router.get("/pending-count", controller.getPendingCount);

router.post("/approve", controller.approveRequest);
router.post("/reject", controller.rejectRequest);


module.exports = router;