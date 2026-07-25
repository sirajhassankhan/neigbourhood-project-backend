const router = require("express").Router();
const controller = require("../controllers/nhcController");

router.get("/", controller.getZones);
router.post("/", controller.createZone);
router.post("/check-location", controller.checkLocation);
router.get("/count", controller.getNHCCount);
module.exports = router;
