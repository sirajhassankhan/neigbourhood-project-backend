const express = require("express");
const router = express.Router();
const suggestionController = require("../controllers/suggestionController");

router.post("/", suggestionController.createSuggestion);
router.get("/my/:cnic", suggestionController.getMySuggestions);
router.get("/nhc/:nhcId", suggestionController.getSuggestionsByNhc);

module.exports = router;