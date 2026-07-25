const express = require("express");
const router = express.Router();

const budgetController = require("../controllers/budgetController");

// Committee creates budget request
router.post(
  "/complaint/:id/request",
  budgetController.createBudgetRequest
);

// Get all budget requests
router.get(
  "/",
  budgetController.getAllBudgetRequests
);

// Get budget request by complaint id
router.get(
  "/complaint/:complaintId",
  budgetController.getBudgetRequestByComplaint
);

// Get council treasury fund by NHC id
router.get(
  "/treasury/:nhcId",
  budgetController.getCouncilTreasuryFundByNhcId
);

// President approve/reject budget
router.post(
  "/:id/president-review",
  budgetController.presidentReviewBudgetRequest
);

// Treasurer release/reject budget
router.post(
  "/:id/treasurer-review",
  budgetController.treasurerReviewBudgetRequest
);

module.exports = router;