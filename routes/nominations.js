const express = require("express");
const router = express.Router();
const nominationController = require("../controllers/nominationController");

router.get("/", nominationController.getNominations);
router.post("/", nominationController.createNomination);
router.delete("/:id", nominationController.deleteNomination);
router.put("/end/:id", nominationController.endNomination);

router.get("/active/:nhcId", nominationController.getActiveNomination);
router.get("/:nominationId/candidates", nominationController.getNominationCandidates);
router.post("/:nominationId/support", nominationController.supportCandidate);

module.exports = router;