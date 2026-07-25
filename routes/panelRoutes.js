const express = require("express");
const router = express.Router();

const panelController = require("../controllers/panelController");

// ================= NHC MEMBERS =================
// Used for dropdown when creating panel
router.get("/nhc/:id/members", panelController.getNhcMembers);

// ================= PANELS =================
// Get panels
// Optional query:
// /api/panels
// /api/panels?cnic=35202-xxxx
// /api/panels?nhcId=3
// /api/panels?nominationId=5
router.get("/panels", panelController.getPanels);

// Create panel
router.post("/panels", panelController.createPanel);

// ================= MY NOMINATION RESULT =================
// Keep this BEFORE /panels/:id/members
router.get(
  "/panels/my-nomination-result",
  panelController.getMyNominationResult
);

// ================= PANEL MEMBERS =================
// Get members of one panel
router.get("/panels/:id/members", panelController.getPanelMembers);

// ================= INVITATIONS =================
// Accept panel invitation
router.post("/panels/:id/members/accept", panelController.acceptInvitation);

// Decline panel invitation
router.post("/panels/:id/members/decline", panelController.declineInvitation);

// ================= RESIGN / LEAVE PANEL =================
// Accepted active member can leave after panel is approved
router.post("/panels/:panelId/resign", panelController.resignFromPanel);

module.exports = router;