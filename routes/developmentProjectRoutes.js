const express = require("express");
const router = express.Router();

const developmentProjectController = require("../controllers/developmentProjectController");

// Create project
router.post("/", developmentProjectController.createProject);

// Get projects by council
router.get("/nhc/:nhcId", developmentProjectController.getProjectsByNhc);

// Update project status
router.put("/:id/status", developmentProjectController.updateProjectStatus);

module.exports = router;