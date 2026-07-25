const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const complaintController = require("../controllers/complaintController");

// ================= UPLOAD FOLDERS =================
const complaintUploadDir = path.join(__dirname, "../uploads/complaints");
const resolutionUploadDir = path.join(__dirname, "../uploads/complaint-resolution");
const meetingMinutesDir = path.join(__dirname, "../uploads/meeting-minutes");

if (!fs.existsSync(complaintUploadDir)) {
  fs.mkdirSync(complaintUploadDir, { recursive: true });
}

if (!fs.existsSync(resolutionUploadDir)) {
  fs.mkdirSync(resolutionUploadDir, { recursive: true });
}

if (!fs.existsSync(meetingMinutesDir)) {
  fs.mkdirSync(meetingMinutesDir, { recursive: true });
}

// ================= IMAGE FILTER =================
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  const allowedExt = [".jpg", ".jpeg", ".png", ".webp"];
  const allowedMime = [
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/webp",
    "application/octet-stream",
  ];

  if (allowedExt.includes(ext) || allowedMime.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only image files allowed"), false);
  }
};

// ================= PDF FILTER =================
const pdfFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === ".pdf" || file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Only PDF files allowed"), false);
  }
};

// ================= STORAGE =================

// Complaint Images
const complaintStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, complaintUploadDir),
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + "_" + Math.floor(Math.random() * 1000000) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const uploadComplaintImages = multer({
  storage: complaintStorage,
  fileFilter,
  limits: { files: 5, fileSize: 5 * 1024 * 1024 },
});

// Resolution Images
const resolutionStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, resolutionUploadDir),
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + "_" + Math.floor(Math.random() * 1000000) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const uploadResolutionImages = multer({
  storage: resolutionStorage,
  fileFilter,
  limits: { files: 5, fileSize: 5 * 1024 * 1024 },
});

// Meeting PDF
const meetingStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, meetingMinutesDir),
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + "_" + Math.floor(Math.random() * 1000000) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const uploadMeetingPdf = multer({
  storage: meetingStorage,
  fileFilter: pdfFilter,
  limits: { files: 1, fileSize: 10 * 1024 * 1024 },
});


// ================= ROUTES =================

// 🔹 USERS BY NHC (for dropdown)


// ================= COMPLAINT =================

// Create complaint
router.post(
  "/",
  (req, res, next) => {
    uploadComplaintImages.array("images", 5)(req, res, function (err) {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  complaintController.createComplaint
);

// Get user's complaints
router.get("/my/:cnic", complaintController.getMyComplaints);

// Get complaints by NHC (President)
router.get("/nhc/:nhcId", complaintController.getComplaintsByNhc);
//get complaints by title
router.get("/title/:gettitle", complaintController.getComplaintsbytitle);

// Get counts
router.get("/nhc/:nhcId/counts", complaintController.getComplaintCountsByNhc);

// Committee member complaints
router.get("/committee/:cnic", complaintController.getCommitteeComplaints);

// Complaints by committee
router.get("/committee-id/:committeeId", complaintController.getComplaintsByCommitteeId);

// Complaint detail (IMPORTANT)
router.get("/detail/:id", complaintController.getComplaintById);

// Assign complaint
router.post("/:id/assign", complaintController.assignComplaintToCommittee);


// ================= MEETING =================

// Upload meeting minutes PDF
router.post(
  "/:id/meeting",
  (req, res, next) => {
    uploadMeetingPdf.single("minutesPdf")(req, res, function (err) {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  complaintController.uploadMeetingMinutes
);




// ================= RESOLUTION =================

// Committee resolves complaint
router.post(
  "/:id/resolve",
  (req, res, next) => {
    uploadResolutionImages.array("images", 5)(req, res, function (err) {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  complaintController.resolveComplaintByCommittee
);


// ================= PRESIDENT =================

// President review
router.post("/:id/review", complaintController.reviewResolvedComplaintByPresident);


module.exports = router;