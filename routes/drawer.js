const express = require("express");
const router = express.Router();
const drawerController = require("../controllers/drawerController");

const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ================= UPLOAD FOLDER =================
const uploadDir = "uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ================= STORAGE =================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

// ================= FILE FILTER (WEB + MOBILE FIX) =================
const fileFilter = (req, file, cb) => {
  console.log("Uploaded MIME:", file.mimetype);
  console.log("Uploaded name:", file.originalname);

  const allowedMimeTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/octet-stream" // for Flutter Web
  ];

  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = [".jpg", ".jpeg", ".png", ".webp"];

  if (allowedMimeTypes.includes(file.mimetype) && allowedExts.includes(ext)) {
    return cb(null, true);
  }

  return cb(
    new Error(`Invalid file type: ${file.mimetype} ${ext}`),
    false
  );
};

// ================= MULTER =================
const profileUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ================= ROUTES =================

// Edit Profile
router.put("/edit-profile", drawerController.editProfile);

// Change Profile Picture (SAFE HANDLING)
router.put("/profile-picture/:cnic", (req, res) => {
  profileUpload.single("profileImage")(req, res, async function (err) {
    if (err) {
      console.error("Upload error:", err.message);
      return res.status(400).json({
        success: false,
        error: err.message || "Image upload failed",
      });
    }

    return drawerController.changeProfilePicture(req, res);
  });
});

// Councils
router.get("/councils", drawerController.getAllCouncils);

// Requests
router.post("/request-neighbourhood", drawerController.requestNeighbourhood);
router.post("/add-new-council", drawerController.addNewCouncilRequest);
router.post("/change-council", drawerController.changeCouncilRequest);
router.get("/my-requests/:cnic", drawerController.getMyRequests);

// Logout
router.post("/logout", drawerController.logout);

module.exports = router;