const { sql, getPool } = require("../db");

async function checkUrgentCommitteeComplaintFirst(pool, complaintId, committeeId) {
  const currentResult = await pool
    .request()
    .input("ComplaintId", sql.Int, complaintId)
    .query(`
      SELECT TOP 1
        Id,
        CommitteeId,
        IsUrgent,
        Status
      FROM Complaints
      WHERE Id = @ComplaintId
    `);

  if (currentResult.recordset.length === 0) {
    return {
      allowed: false,
      status: 404,
      error: "Complaint not found",
    };
  }

  const currentComplaint = currentResult.recordset[0];

  if (currentComplaint.IsUrgent === true || currentComplaint.IsUrgent === 1) {
    return { allowed: true };
  }

  const urgentResult = await pool
    .request()
    .input("CommitteeId", sql.Int, committeeId)
    .query(`
      SELECT TOP 1
        Id,
        Title,
        Status
      FROM Complaints
      WHERE CommitteeId = @CommitteeId
        AND IsUrgent = 1
        AND Status NOT IN ('Completed')
      ORDER BY CreatedDate ASC
    `);

  if (urgentResult.recordset.length > 0) {
    return {
      allowed: false,
      status: 400,
      error: "Committee must handle urgent complaints first",
      urgentComplaint: urgentResult.recordset[0],
    };
  }

  return { allowed: true };
}

// ================= CREATE COMPLAINT =================
exports.createComplaint = async (req, res) => {
  let transaction;

  try {
    const pool = await getPool();

    const {
      userCnic,
      nhcId,
      title,
      detail,
      complaintType,
      againstPersonCnic,
      budgetAmount,
      budgetDetail,
      Isopen,
    } = req.body;

    if (!userCnic || !nhcId || !title || !detail) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({
        error: "Invalid NHC id",
      });
    }

    const cleanUserCnic = userCnic.toString().trim();

    const finalComplaintType =
      complaintType && complaintType.trim() !== ""
        ? complaintType.trim()
        : "Normal";

    if (
      finalComplaintType !== "Normal" &&
      finalComplaintType !== "AgainstPerson" &&
      finalComplaintType !== "Budget"
    ) {
      return res.status(400).json({
        error: "Invalid complaint type",
      });
    }

    const cleanIsopen=
      Isopen === true ||
      Isopen=== "true" ||
      Isopen=== "1" ||
      Isopen=== 1
        ? 1
        : 0;

    const filerMembership = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cleanUserCnic)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1 Id
        FROM UserNHCs
        WHERE UserCNIC = @UserCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    if (filerMembership.recordset.length === 0) {
      return res.status(403).json({
        error: "You are not a member of this neighbourhood council",
      });
    }

    let cleanAgainstPersonCnic = null;
    let cleanAgainstPersonName = null;

    if (finalComplaintType === "AgainstPerson") {
      if (!againstPersonCnic || againstPersonCnic.trim() === "") {
        return res.status(400).json({
          error: "Please select a person",
        });
      }

      cleanAgainstPersonCnic = againstPersonCnic.toString().trim();

      if (cleanAgainstPersonCnic === cleanUserCnic) {
        return res.status(400).json({
          error: "You cannot file a complaint against yourself",
        });
      }

      const personResult = await pool
        .request()
        .input("CNIC", sql.NVarChar, cleanAgainstPersonCnic)
        .input("NHC_Id", sql.Int, parsedNhcId)
        .query(`
          SELECT TOP 1
            u.CNIC,
            u.FirstName,
            u.LastName,
            un.NHC_Id
          FROM Users u
          INNER JOIN UserNHCs un ON u.CNIC = un.UserCNIC
          WHERE u.CNIC = @CNIC
            AND un.NHC_Id = @NHC_Id
            AND un.IsActive = 1
        `);

      if (personResult.recordset.length === 0) {
        return res.status(404).json({
          error: "Selected person not found in this neighbourhood council",
        });
      }

      const selectedUser = personResult.recordset[0];

      cleanAgainstPersonName =
        `${selectedUser.FirstName || ""} ${selectedUser.LastName || ""}`.trim();
    }

    let cleanBudgetAmount = null;

    if (budgetAmount && budgetAmount.toString().trim() !== "") {
      cleanBudgetAmount = parseFloat(budgetAmount);

      if (isNaN(cleanBudgetAmount) || cleanBudgetAmount <= 0) {
        return res.status(400).json({
          error: "Invalid budget amount",
        });
      }
    }

    const cleanBudgetDetail =
      budgetDetail && budgetDetail.trim() !== ""
        ? budgetDetail.trim()
        : null;

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const result = await new sql.Request(transaction)
      .input("UserCNIC", sql.NVarChar, cleanUserCnic)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .input("Title", sql.NVarChar, title.trim())
      .input("Detail", sql.NVarChar(sql.MAX), detail.trim())
      .input("ComplaintType", sql.NVarChar, finalComplaintType)
      .input("AgainstPersonCNIC", sql.NVarChar, cleanAgainstPersonCnic)
      .input("AgainstPersonName", sql.NVarChar, cleanAgainstPersonName)
      .input("BudgetAmount", sql.Decimal(18, 2), cleanBudgetAmount)
      .input("BudgetDetail", sql.NVarChar(sql.MAX), cleanBudgetDetail)
      .input("Isopen", sql.Bit, cleanIsopen)
      .query(`
        INSERT INTO Complaints
        (
          UserCNIC,
          NHC_Id,
          Title,
          Detail,
          ComplaintType,
          AgainstPersonCNIC,
          AgainstPersonName,
          BudgetAmount,
          BudgetDetail,
          Isopen,
          Status,
          CreatedDate
        )
        OUTPUT INSERTED.Id
        VALUES
        (
          @UserCNIC,
          @NHC_Id,
          @Title,
          @Detail,
          @ComplaintType,
          @AgainstPersonCNIC,
          @AgainstPersonName,
          @BudgetAmount,
          @BudgetDetail,
          @Isopen,
          'Pending',
          GETDATE()
        )
      `);

    const complaintId = result.recordset[0].Id;

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await new sql.Request(transaction)
          .input("ComplaintId", sql.Int, complaintId)
          .input("ImagePath", sql.NVarChar, file.filename)
          .query(`
            INSERT INTO ComplaintImages
            (
              ComplaintId,
              ImagePath,
              CreatedDate
            )
            VALUES
            (
              @ComplaintId,
              @ImagePath,
              GETDATE()
            )
          `);
      }
    }

    await transaction.commit();

    return res.status(201).json({
      message: "Complaint submitted successfully",
      complaintId,
      Isopen:cleanIsopen,
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("createComplaint Error:", err);

    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= GET USER COMPLAINTS =================
exports.getMyComplaints = async (req, res) => {
  try {
    const { cnic } = req.params;
    const pool = await getPool();

    const complaints = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .query(`
        SELECT
          c.Id AS id,
          c.UserCNIC AS userCnic,
          c.NHC_Id AS nhcId,
          c.Title AS title,
          c.Detail AS detail,
          c.ComplaintType AS complaintType,
          c.AgainstPersonCNIC AS againstPersonCnic,
          c.AgainstPersonName AS againstPersonName,
          c.BudgetAmount AS budgetAmount,
          c.BudgetDetail AS budgetDetail,
          c.Isopen AS isopen,
          c.Status AS status,
          c.CommitteeId AS committeeId,
          c.CommitteeRemarks AS committeeRemarks,
          c.PresidentRemarks AS presidentRemarks,
          c.CreatedDate AS createdDate,
          c.UpdatedDate AS updatedDate
        FROM Complaints c
        WHERE c.UserCNIC = @UserCNIC
        ORDER BY
  c.Isopen DESC,
  c.CreatedDate ASC
      `);

    for (const c of complaints.recordset) {
      const complaintImages = await pool
        .request()
        .input("ComplaintId", sql.Int, c.id)
        .query(`
          SELECT
            Id AS id,
            ImagePath AS imagePath,
            CreatedDate AS createdDate
          FROM ComplaintImages
          WHERE ComplaintId = @ComplaintId
          ORDER BY Id DESC
        `);

      const resolutionImages = await pool
        .request()
        .input("ComplaintId", sql.Int, c.id)
        .query(`
          SELECT
            Id AS id,
            ImagePath AS imagePath,
            CreatedDate AS createdDate
          FROM ComplaintResolutionImages
          WHERE ComplaintId = @ComplaintId
          ORDER BY Id DESC
        `);

      c.images = complaintImages.recordset;
      c.resolutionImages = resolutionImages.recordset;
    }

    return res.status(200).json(complaints.recordset);
  } catch (error) {
    console.error("getMyComplaints Error:", error);

    return res.status(500).json({
      error: error.message || "Failed to fetch complaints",
    });
  }
};

// ================= PRESIDENT: ALL NHC COMPLAINTS =================
exports.getComplaintsByNhc = async (req, res) => {
  try {
    const { nhcId } = req.params;
    const pool = await getPool();

    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({
        error: "Invalid NHC id",
      });
    }

    const complaints = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT
          c.Id AS id,
          c.UserCNIC AS userCnic,
          c.NHC_Id AS nhcId,
          c.Title AS title,
          c.Detail AS detail,
          c.ComplaintType AS complaintType,
          c.AgainstPersonCNIC AS againstPersonCnic,
          c.AgainstPersonName AS againstPersonName,
          c.BudgetAmount AS budgetAmount,
          c.BudgetDetail AS budgetDetail,
          c.Isopen AS Isopen,
          c.Status AS status,
          c.CommitteeId AS committeeId,
          c.CommitteeRemarks AS committeeRemarks,
          c.PresidentRemarks AS presidentRemarks,
          c.CreatedDate AS createdDate,
          c.UpdatedDate AS updatedDate,
          u.FirstName + ' ' + u.LastName AS userName,
          cm.CommitteeName AS committeeName
        FROM Complaints c
        INNER JOIN Users u ON c.UserCNIC = u.CNIC
        LEFT JOIN Committees cm ON c.CommitteeId = cm.Id
        WHERE c.NHC_Id = @NHC_Id
        ORDER BY
  c.Isopen DESC,
  c.CreatedDate ASC
      `);

    for (const c of complaints.recordset) {
      const complaintImages = await pool
        .request()
        .input("ComplaintId", sql.Int, c.id)
        .query(`
          SELECT
            Id AS id,
            ImagePath AS imagePath,
            CreatedDate AS createdDate
          FROM ComplaintImages
          WHERE ComplaintId = @ComplaintId
          ORDER BY Id DESC
        `);

      const resolutionImages = await pool
        .request()
        .input("ComplaintId", sql.Int, c.id)
        .query(`
          SELECT
            Id AS id,
            ImagePath AS imagePath,
            CreatedDate AS createdDate
          FROM ComplaintResolutionImages
          WHERE ComplaintId = @ComplaintId
          ORDER BY Id DESC
        `);

      c.images = complaintImages.recordset;
      c.resolutionImages = resolutionImages.recordset;
    }

    return res.status(200).json(complaints.recordset);
  } catch (error) {
    console.error("getComplaintsByNhc Error:", error);

    return res.status(500).json({
      error: error.message || "Failed to fetch complaints",
    });
  }
};

// ================= ASSIGN COMPLAINT TO COMMITTEE =================
exports.assignComplaintToCommittee = async (req, res) => {
  try {
    const pool = await getPool();

    const complaintId = parseInt(req.params.id, 10);
    const parsedCommitteeId = parseInt(req.body.committeeId, 10);

    if (isNaN(complaintId)) {
      return res.status(400).json({ error: "Invalid complaint id" });
    }

    if (isNaN(parsedCommitteeId)) {
      return res.status(400).json({ error: "Committee required" });
    }

    const complaintResult = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        SELECT TOP 1
          Id,
          NHC_Id,
          Title,
          IsUrgent,
          Status
        FROM Complaints
        WHERE Id = @ComplaintId
      `);

    if (complaintResult.recordset.length === 0) {
      return res.status(404).json({ error: "Complaint not found" });
    }

    const currentComplaint = complaintResult.recordset[0];

    if (String(currentComplaint.Status).toLowerCase() === "completed") {
      return res.status(400).json({
        error: "Completed complaint cannot be assigned",
      });
    }

    if (!(currentComplaint.IsUrgent === true || currentComplaint.IsUrgent === 1)) {
      const urgentPendingResult = await pool
        .request()
        .input("NHC_Id", sql.Int, currentComplaint.NHC_Id)
        .query(`
          SELECT TOP 1
            Id,
            Title,
            Status
          FROM Complaints
          WHERE NHC_Id = @NHC_Id
            AND IsUrgent = 1
            AND Status = 'Pending'
          ORDER BY CreatedDate ASC
        `);

      if (urgentPendingResult.recordset.length > 0) {
        return res.status(400).json({
          error: "Urgent complaints must be assigned first",
          urgentComplaint: urgentPendingResult.recordset[0],
        });
      }
    }

    await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .query(`
        UPDATE Complaints
        SET CommitteeId = @CommitteeId,
            Status = 'In Progress',
            UpdatedDate = GETDATE()
        WHERE Id = @ComplaintId
      `);

    return res.status(200).json({
      message: "Complaint assigned successfully",
    });
  } catch (err) {
    console.error("assignComplaintToCommittee Error:", err);

    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= COMMITTEE MEMBER VIEW =================
exports.getCommitteeComplaints = async (req, res) => {
  try {
    const { cnic } = req.params;
    const pool = await getPool();

    const complaints = await pool
      .request()
      .input("MemberCNIC", sql.NVarChar, cnic)
      .query(`
        SELECT
          c.Id AS id,
          c.UserCNIC AS userCnic,
          c.NHC_Id AS nhcId,
          c.Title AS title,
          c.Detail AS detail,
          c.ComplaintType AS complaintType,
          c.AgainstPersonCNIC AS againstPersonCnic,
          c.AgainstPersonName AS againstPersonName,
          c.BudgetAmount AS budgetAmount,
          c.BudgetDetail AS budgetDetail,
          c.IsUrgent AS isUrgent,
          c.Status AS status,
          c.CommitteeId AS committeeId,
          c.CommitteeRemarks AS committeeRemarks,
          c.PresidentRemarks AS presidentRemarks,
          c.CreatedDate AS createdDate,
          c.UpdatedDate AS updatedDate,
          u.FirstName + ' ' + u.LastName AS userName,
          cm.CommitteeName AS committeeName
        FROM Complaints c
        INNER JOIN CommitteeMembers m ON c.CommitteeId = m.CommitteeId
        INNER JOIN Users u ON c.UserCNIC = u.CNIC
        INNER JOIN Committees cm ON c.CommitteeId = cm.Id
        WHERE m.MemberCNIC = @MemberCNIC
        ORDER BY
  c.IsUrgent DESC,
  c.CreatedDate ASC
      `);

    for (const c of complaints.recordset) {
      const complaintImages = await pool
        .request()
        .input("ComplaintId", sql.Int, c.id)
        .query(`
          SELECT
            Id AS id,
            ImagePath AS imagePath,
            CreatedDate AS createdDate
          FROM ComplaintImages
          WHERE ComplaintId = @ComplaintId
          ORDER BY Id DESC
        `);

      const resolutionImages = await pool
        .request()
        .input("ComplaintId", sql.Int, c.id)
        .query(`
          SELECT
            Id AS id,
            ImagePath AS imagePath,
            CreatedDate AS createdDate
          FROM ComplaintResolutionImages
          WHERE ComplaintId = @ComplaintId
          ORDER BY Id DESC
        `);

      c.images = complaintImages.recordset;
      c.resolutionImages = resolutionImages.recordset;
    }

    return res.status(200).json(complaints.recordset);
  } catch (err) {
    console.error("getCommitteeComplaints Error:", err);

    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= COMMITTEE RESOLVE COMPLAINT =================
exports.resolveComplaintByCommittee = async (req, res) => {
  let transaction;

  try {
    const pool = await getPool();

    const complaintId = parseInt(req.params.id, 10);

    const {
      resolvedByCnic,
      committeeId,
      committeeRemarks,
      resolutionRemarks,
    } = req.body;

    if (isNaN(complaintId)) {
      return res.status(400).json({ error: "Invalid complaint id" });
    }

    if (!resolvedByCnic || resolvedByCnic.toString().trim() === "") {
      return res.status(400).json({ error: "resolvedByCnic is required" });
    }

    const parsedCommitteeId = parseInt(committeeId, 10);

    if (isNaN(parsedCommitteeId)) {
      return res.status(400).json({ error: "committeeId is required" });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const complaintCheck = await new sql.Request(transaction)
      .input("ComplaintId", sql.Int, complaintId)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .query(`
        SELECT TOP 1
          Id,
          UserCNIC,
          NHC_Id,
          Title,
          Detail,
          Status,
          CommitteeId,
          IsUrgent
        FROM Complaints
        WHERE Id = @ComplaintId
          AND CommitteeId = @CommitteeId
      `);

    if (complaintCheck.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        error: "Complaint not found for this committee",
      });
    }

    const complaint = complaintCheck.recordset[0];

    if (String(complaint.Status).toLowerCase() === "completed") {
      await transaction.rollback();
      return res.status(400).json({ error: "Complaint is already completed" });
    }

    const committeeMemberCheck = await new sql.Request(transaction)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .input("UserCNIC", sql.NVarChar, resolvedByCnic.toString().trim())
      .query(`
        SELECT TOP 1
          Id,
          CommitteeId,
          UserCNIC,
          Role
        FROM CommitteeMembers
        WHERE CommitteeId = @CommitteeId
          AND UserCNIC = @UserCNIC
      `);

    if (committeeMemberCheck.recordset.length === 0) {
      await transaction.rollback();
      return res.status(403).json({
        error: "Only committee member can resolve this complaint",
      });
    }

    if (!(complaint.IsUrgent === true || complaint.IsUrgent === 1)) {
      const urgentComplaintResult = await new sql.Request(transaction)
        .input("CommitteeId", sql.Int, parsedCommitteeId)
        .query(`
          SELECT TOP 1
            Id,
            Title,
            Status
          FROM Complaints
          WHERE CommitteeId = @CommitteeId
            AND IsUrgent = 1
            AND Status NOT IN ('Completed')
          ORDER BY CreatedDate ASC
        `);

      if (urgentComplaintResult.recordset.length > 0) {
        await transaction.rollback();
        return res.status(400).json({
          error: "Committee must resolve urgent complaints first",
          urgentComplaint: urgentComplaintResult.recordset[0],
        });
      }
    }

    const finalRemarks =
      committeeRemarks && committeeRemarks.toString().trim() !== ""
        ? committeeRemarks.toString().trim()
        : resolutionRemarks && resolutionRemarks.toString().trim() !== ""
        ? resolutionRemarks.toString().trim()
        : null;

    await new sql.Request(transaction)
      .input("ComplaintId", sql.Int, complaintId)
      .input("CommitteeRemarks", sql.NVarChar(sql.MAX), finalRemarks)
      .input("ResolvedByCNIC", sql.NVarChar, resolvedByCnic.toString().trim())
      .query(`
        UPDATE Complaints
        SET Status = 'Completed',
            CommitteeRemarks = @CommitteeRemarks,
            ResolvedByCNIC = @ResolvedByCNIC,
            UpdatedDate = GETDATE()
        WHERE Id = @ComplaintId
      `);

    await transaction.commit();

    return res.status(200).json({
      message: "Complaint resolved successfully",
      complaintId,
      status: "Completed",
      isUrgent: complaint.IsUrgent,
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("resolveComplaintByCommittee error:", error);

    return res.status(500).json({
      error: error.message || "Failed to resolve complaint",
    });
  }
};

// ================= PRESIDENT REVIEW RESOLVED COMPLAINT =================
exports.reviewResolvedComplaintByPresident = async (req, res) => {
  try {
    const pool = await getPool();
    const { id } = req.params;
    const { action, presidentRemarks } = req.body;

    const complaintId = parseInt(id, 10);

    if (isNaN(complaintId)) {
      return res.status(400).json({
        error: "Invalid complaint id",
      });
    }

    if (!action) {
      return res.status(400).json({
        error: "Action is required",
      });
    }

    const complaintResult = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        SELECT TOP 1
          Id,
          UserCNIC,
          Title
        FROM Complaints
        WHERE Id = @ComplaintId
      `);

    if (complaintResult.recordset.length === 0) {
      return res.status(404).json({
        error: "Complaint not found",
      });
    }

    const complaint = complaintResult.recordset[0];

    if (action === "approve") {
      await pool
        .request()
        .input("ComplaintId", sql.Int, complaintId)
        .input("PresidentRemarks", sql.NVarChar(sql.MAX), presidentRemarks || null)
        .query(`
          UPDATE Complaints
          SET Status = 'Completed',
              PresidentRemarks = @PresidentRemarks,
              UpdatedDate = GETDATE()
          WHERE Id = @ComplaintId
        `);

      await pool
        .request()
        .input("RecipientCNIC", sql.NVarChar, complaint.UserCNIC)
        .input(
          "Message",
          sql.NVarChar(sql.MAX),
          `Your complaint "${complaint.Title}" has been resolved successfully.`
        )
        .input("ComplaintId", sql.Int, complaintId)
        .input("Role", sql.NVarChar, "User")
        .query(`
          INSERT INTO Notifications
          (
            RecipientCNIC,
            Message,
            ComplaintId,
            CreatedDate,
            Role
          )
          VALUES
          (
            @RecipientCNIC,
            @Message,
            @ComplaintId,
            GETDATE(),
            @Role
          )
        `);

      return res.status(200).json({
        message: "Complaint approved and complainant notified",
      });
    }

    if (action === "return") {
      await pool
        .request()
        .input("ComplaintId", sql.Int, complaintId)
        .input("PresidentRemarks", sql.NVarChar(sql.MAX), presidentRemarks || null)
        .query(`
          UPDATE Complaints
          SET Status = 'Returned to Committee',
              PresidentRemarks = @PresidentRemarks,
              UpdatedDate = GETDATE()
          WHERE Id = @ComplaintId
        `);

      return res.status(200).json({
        message: "Complaint returned to committee",
      });
    }

    return res.status(400).json({
      error: "Invalid action",
    });
  } catch (err) {
    console.error("reviewResolvedComplaintByPresident Error:", err);

    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= GET COMPLAINT COUNTS BY NHC =================
exports.getComplaintCountsByNhc = async (req, res) => {
  try {
    const { nhcId } = req.params;
    const pool = await getPool();

    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({
        error: "Invalid NHC id",
      });
    }

    const totalResult = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT COUNT(*) AS TotalComplaints
        FROM Complaints
        WHERE NHC_Id = @NHC_Id
      `);

    const pendingResult = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT COUNT(*) AS PendingComplaints
        FROM Complaints
        WHERE NHC_Id = @NHC_Id
          AND Status = 'Pending'
      `);

    return res.status(200).json({
      totalComplaints: totalResult.recordset[0].TotalComplaints || 0,
      pendingComplaints: pendingResult.recordset[0].PendingComplaints || 0,
    });
  } catch (err) {
    console.error("getComplaintCountsByNhc Error:", err);

    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= GET COMPLAINT BY ID =================
exports.getComplaintById = async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await getPool();

    const complaintId = parseInt(id, 10);

    if (isNaN(complaintId)) {
      return res.status(400).json({
        error: "Invalid complaint id",
      });
    }

    const complaintResult = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        SELECT TOP 1
          c.Id AS id,
          c.UserCNIC AS userCnic,
          c.NHC_Id AS nhcId,
          c.Title AS title,
          c.Detail AS detail,
          c.ComplaintType AS complaintType,
          c.AgainstPersonCNIC AS againstPersonCnic,
          c.AgainstPersonName AS againstPersonName,
          c.BudgetAmount AS budgetAmount,
          c.BudgetDetail AS budgetDetail,
          c.IsUrgent AS isUrgent,
          c.Status AS status,
          c.CommitteeId AS committeeId,
          c.CommitteeRemarks AS committeeRemarks,
          c.PresidentRemarks AS presidentRemarks,
          c.CreatedDate AS createdDate,
          c.UpdatedDate AS updatedDate,
          u.FirstName + ' ' + u.LastName AS userName,
          cm.CommitteeName AS committeeName
        FROM Complaints c
        INNER JOIN Users u ON c.UserCNIC = u.CNIC
        LEFT JOIN Committees cm ON c.CommitteeId = cm.Id
        WHERE c.Id = @ComplaintId
      `);

    if (complaintResult.recordset.length === 0) {
      return res.status(404).json({
        error: "Complaint not found",
      });
    }

    const complaint = complaintResult.recordset[0];

    const complaintImages = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        SELECT
          Id AS id,
          ImagePath AS imagePath,
          CreatedDate AS createdDate
        FROM ComplaintImages
        WHERE ComplaintId = @ComplaintId
        ORDER BY Id DESC
      `);

    const resolutionImages = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        SELECT
          Id AS id,
          ImagePath AS imagePath,
          CreatedDate AS createdDate
        FROM ComplaintResolutionImages
        WHERE ComplaintId = @ComplaintId
        ORDER BY Id DESC
      `);

    const meetingCalls = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        SELECT
          Id AS id,
          ComplaintId AS complaintId,
          CommitteeId AS committeeId,
          HeadCNIC AS headCnic,
          MeetingDate AS meetingDate,
          MeetingTime AS meetingTime,
          MeetingLocation AS meetingLocation,
          CommitteeMessage AS committeeMessage,
          AgainstPersonCNIC AS againstPersonCnic,
          AgainstPersonName AS againstPersonName,
          AgainstPersonMessage AS againstPersonMessage,
          Status AS status,
          CreatedDate AS createdDate
        FROM CommitteeMeetingCalls
        WHERE ComplaintId = @ComplaintId
        ORDER BY Id DESC
      `);

    const meetingMinutes = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        SELECT
          Id AS id,
          ComplaintId AS complaintId,
          CommitteeId AS committeeId,
          UploadedByCNIC AS uploadedByCnic,
          MeetingMinutesPdf AS meetingMinutesPdf,
          Remarks AS remarks,
          CreatedDate AS createdDate
        FROM ComplaintMeetings
        WHERE ComplaintId = @ComplaintId
        ORDER BY Id DESC
      `);

    const budgetRequests = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        SELECT
          Id AS id,
          ComplaintId AS complaintId,
          CommitteeId AS committeeId,
          RequestedByCNIC AS requestedByCnic,
          RequestedAmount AS requestedAmount,
          RequestDetail AS requestDetail,
          Status AS status,
          PresidentRemarks AS presidentRemarks,
          TreasurerRemarks AS treasurerRemarks,
          ApprovedAmount AS approvedAmount,
          CreatedDate AS createdDate,
          UpdatedDate AS updatedDate
        FROM ComplaintBudgetRequests
        WHERE ComplaintId = @ComplaintId
        ORDER BY Id DESC
      `);

    const treasuryReleases = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        SELECT
          Id AS id,
          TreasuryFundId AS treasuryFundId,
          NHC_Id AS nhcId,
          BudgetRequestId AS budgetRequestId,
          ComplaintId AS complaintId,
          CommitteeId AS committeeId,
          ReleasedByCNIC AS releasedByCnic,
          ReleasedAmount AS releasedAmount,
          Remarks AS remarks,
          CreatedDate AS createdDate
        FROM CouncilTreasuryFundReleases
        WHERE ComplaintId = @ComplaintId
        ORDER BY Id DESC
      `);

    complaint.images = complaintImages.recordset;
    complaint.resolutionImages = resolutionImages.recordset;
    complaint.meetingCalls = meetingCalls.recordset;
    complaint.meetingMinutesHistory = meetingMinutes.recordset;
    complaint.budgetRequests = budgetRequests.recordset;
    complaint.treasuryReleases = treasuryReleases.recordset;

    if (meetingMinutes.recordset.length > 0) {
      complaint.meetingMinutesPdf = meetingMinutes.recordset[0].meetingMinutesPdf;
      complaint.meetingRemarks = meetingMinutes.recordset[0].remarks;
      complaint.meetingCreatedDate = meetingMinutes.recordset[0].createdDate;
      complaint.uploadedByCnic = meetingMinutes.recordset[0].uploadedByCnic;
    } else {
      complaint.meetingMinutesPdf = "";
      complaint.meetingRemarks = "";
      complaint.meetingCreatedDate = null;
      complaint.uploadedByCnic = "";
    }

    return res.status(200).json(complaint);
  } catch (err) {
    console.error("getComplaintById Error:", err);

    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= UPLOAD MEETING MINUTES =================
// ================= UPLOAD MEETING MINUTES =================
exports.uploadMeetingMinutes = async (req, res) => {
  try {
    const { id } = req.params;
    const { committeeId, uploadedByCnic, remarks, decision } = req.body;

    const complaintId = parseInt(id, 10);
    const parsedCommitteeId = parseInt(committeeId, 10);

    if (isNaN(complaintId)) {
      return res.status(400).json({
        error: "Invalid complaint id",
        receivedParams: req.params,
      });
    }

    if (isNaN(parsedCommitteeId)) {
      return res.status(400).json({
        error: "Invalid committee id",
        receivedBody: req.body,
      });
    }

    if (!uploadedByCnic || uploadedByCnic.toString().trim() === "") {
      return res.status(400).json({
        error: "uploadedByCnic is required",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Meeting minutes PDF is required",
        hint: "Route must use upload.single('minutesPdf')",
      });
    }

    const pool = await getPool();

    const complaintCheck = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .query(`
        SELECT TOP 1
          Id,
          Status,
          CommitteeId,
          IsUrgent
        FROM Complaints
        WHERE Id = @ComplaintId
          AND CommitteeId = @CommitteeId
      `);

    if (complaintCheck.recordset.length === 0) {
      return res.status(404).json({
        error: "Complaint not found for this committee",
        complaintId,
        committeeId: parsedCommitteeId,
      });
    }

    // Urgent-first block is removed.
    // Committee can upload meeting minutes for normal complaint
    // even if urgent complaints exist.

    await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .input("UploadedByCNIC", sql.NVarChar, uploadedByCnic.toString())
      .input("MeetingMinutesPdf", sql.NVarChar, req.file.filename)
      .input(
        "Remarks",
        sql.NVarChar(sql.MAX),
        remarks && remarks.trim() !== "" ? remarks.trim() : null
      )
      .query(`
        INSERT INTO ComplaintMeetings
        (
          ComplaintId,
          CommitteeId,
          UploadedByCNIC,
          MeetingMinutesPdf,
          Remarks,
          CreatedDate
        )
        VALUES
        (
          @ComplaintId,
          @CommitteeId,
          @UploadedByCNIC,
          @MeetingMinutesPdf,
          @Remarks,
          GETDATE()
        )
      `);

    let complaintStatus = "In Progress";

    // Keep status In Progress because after meeting:
    // - budget_needed will continue to budget request
    // - resolved will continue to committee resolution upload
    // - in_progress means still under committee work
    if (decision === "resolved") {
      complaintStatus = "In Progress";
    }

    if (decision === "budget_needed") {
      complaintStatus = "In Progress";
    }

    if (decision === "in_progress") {
      complaintStatus = "In Progress";
    }

    await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .input("Status", sql.NVarChar, complaintStatus)
      .query(`
        UPDATE Complaints
        SET Status = @Status,
            UpdatedDate = GETDATE()
        WHERE Id = @ComplaintId
      `);

    return res.status(201).json({
      message: "Meeting minutes uploaded successfully",
      complaintId,
      committeeId: parsedCommitteeId,
      meetingMinutesPdf: req.file.filename,
      decision: decision || "in_progress",
      status: complaintStatus,
    });
  } catch (error) {
    console.error("uploadMeetingMinutes error:", error);

    return res.status(500).json({
      error: error.message || "Failed to upload meeting minutes",
    });
  }
};
// ================= GET COMPLAINTS BY COMMITTEE ID =================
exports.getComplaintsByCommitteeId = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const pool = await getPool();

    const parsedCommitteeId = parseInt(committeeId, 10);

    if (isNaN(parsedCommitteeId)) {
      return res.status(400).json({
        error: "Invalid Committee Id",
      });
    }

    const complaints = await pool
      .request()
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .query(`
        SELECT
          c.Id AS id,
          c.UserCNIC AS userCnic,
          c.NHC_Id AS nhcId,
          c.Title AS title,
          c.Detail AS detail,
          c.ComplaintType AS complaintType,
          c.AgainstPersonCNIC AS againstPersonCnic,
          c.AgainstPersonName AS againstPersonName,
          c.BudgetAmount AS budgetAmount,
          c.BudgetDetail AS budgetDetail,
          c.IsUrgent AS isUrgent,
          c.Status AS status,
          c.CommitteeId AS committeeId,
          c.CommitteeRemarks AS committeeRemarks,
          c.PresidentRemarks AS presidentRemarks,
          c.CreatedDate AS createdDate,
          c.UpdatedDate AS updatedDate,
          u.FirstName + ' ' + u.LastName AS userName,
          cm.CommitteeName AS committeeName
        FROM Complaints c
        INNER JOIN Users u ON c.UserCNIC = u.CNIC
        LEFT JOIN Committees cm ON c.CommitteeId = cm.Id
        WHERE c.CommitteeId = @CommitteeId
        ORDER BY
  c.IsUrgent DESC,
  c.CreatedDate ASC
      `);

    for (const c of complaints.recordset) {
      const complaintImages = await pool
        .request()
        .input("ComplaintId", sql.Int, c.id)
        .query(`
          SELECT
            Id AS id,
            ImagePath AS imagePath,
            CreatedDate AS createdDate
          FROM ComplaintImages
          WHERE ComplaintId = @ComplaintId
          ORDER BY Id DESC
        `);

      const resolutionImages = await pool
        .request()
        .input("ComplaintId", sql.Int, c.id)
        .query(`
          SELECT
            Id AS id,
            ImagePath AS imagePath,
            CreatedDate AS createdDate
          FROM ComplaintResolutionImages
          WHERE ComplaintId = @ComplaintId
          ORDER BY Id DESC
        `);

      c.images = complaintImages.recordset;
      c.resolutionImages = resolutionImages.recordset;
    }

    return res.status(200).json(complaints.recordset);
  } catch (error) {
    console.error("getComplaintsByCommitteeId error:", error);

    return res.status(500).json({
      error: error.message || "Failed to fetch committee complaints",
    });
  }
};

 exports.getComplaintsbytitle = async (req, res) => {
  try {
    i=req.params.gettitle;
   

    const pool = await getPool();
   const result = await pool
      .request()
      .input("Title", sql.NVarChar,i)
      .query(`
        SELECT * FROM Complaints WHERE Title=@Title
      `);

    return res.status(200).json(result.recordset);
  }
catch (error) {
    console.error("Task Error:", error);
    return res.status(500).json({
      error: error.message || "Failed to feth",
    });
  }
};