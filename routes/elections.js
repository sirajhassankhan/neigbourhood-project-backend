const express = require("express");
const router = express.Router();

const electionController = require("../controllers/electionController");

// GET all elections
router.get("/", electionController.getElections);

// CREATE election
router.post("/", electionController.createElection);

// GET active election
router.get("/active/:nhcId", electionController.getActiveElection);

// GET election panels
router.get("/:electionId/panels", electionController.getElectionPanels);

// CAST vote
router.post("/vote", electionController.castVote);

// ADMIN RESULT ROUTES
router.get("/admin/councils-with-results", electionController.getCouncilsWithElectionResults);
router.get("/admin/council/:nhcId/elections", electionController.getCouncilElectionHistory);
router.get("/admin/election/:electionId/result", electionController.getAdminElectionResultByElectionId);

// GET latest ended election results by NHC
router.get("/ended-results/:nhcId", electionController.getEndedElectionResultsByNhc);

// GET results by election id
router.get("/results/:electionId", electionController.getResults);

// END election
router.put("/end/:id", electionController.endElection);

// DELETE election
router.delete("/:id", electionController.deleteElection);

module.exports = router;