const express = require("express");
const router = express.Router();
const committeeController = require("../controllers/committeeController");

router.post("/", committeeController.createCommittee);
router.get("/nhc/:nhcId", committeeController.getCommitteesByNhc);
router.get("/members/:committeeId", committeeController.getCommitteeMembers);
router.get("/my/:cnic", committeeController.getMyCommittees);
router.post("/call-meeting", committeeController.callMeeting);
router.get( "/complaint/:complaintId/latest-meeting-call",committeeController.getLatestMeetingCallByComplaint);
router.post("/raise-money", committeeController.createRaiseMoneyRequest);
module.exports = router;