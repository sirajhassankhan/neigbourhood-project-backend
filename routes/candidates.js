const router = require("express").Router();
const controller = require("../controllers/candidateController");

router.get("/", controller.getCandidates);
router.post("/", controller.nominateSelf);
router.post("/support/:id", controller.supportCandidate);

module.exports = router;
